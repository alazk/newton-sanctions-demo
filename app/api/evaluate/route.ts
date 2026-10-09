import { NextRequest, NextResponse } from "next/server";
import { CHAIN_ID } from "@/lib/catalog";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { wasmArgsFor } from "@/lib/policy-set";

/**
 * Submit one real, quorum-signed Newton task for the page's "Check this
 * transfer" button. Nothing else.
 *
 * Audit (Oct 2026) narrowed this route on purpose:
 *
 *  - Submit only. The old `newt_simulatePolicy` branch let any visitor run
 *    their own Rego and oracle on our API key; the page never used it.
 *  - One client. Tasks go to POLICY_CLIENT_REDSTONE and nowhere else. No
 *    provider routing from the request and no fallback to another env var, so
 *    a visitor cannot steer a task at a different client, and a missing
 *    variable fails loudly instead of quietly screening against the wrong
 *    policy.
 *  - Validated input. `to` and `from` must be 20-byte addresses, `value` a
 *    hex quantity, and the body is small. A typo never becomes a paid task.
 *  - Fixed error text. Details go to the server log; the visitor sees a plain
 *    sentence that names no env vars, URLs or raw gateway output.
 *
 * wasm_args (protocol 0.7) carry exactly { to, from } for the RedStone
 * oracle, one entry per policy in the client's set ("0x" for pure-Rego
 * policies; see lib/policy-set.ts). The server builds them; the visitor only
 * supplies the two address values.
 */

export const runtime = "nodejs";

const GATEWAY = process.env.NEWTON_GATEWAY_URL ?? "https://gateway.testnet.newton.xyz/rpc";
const MAX_BODY_BYTES = 2_048;

/** Used when a caller (a script, curl) sends no sender. Excluded from usage counts. */
const DEFAULT_SENDER = "0x8b4bA8708239757e84aD26a503500Bc5fC1c1a48";

const isAddress = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
const isQuantity = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(v);

function fail(error: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, error }, { status, headers });
}

export async function POST(req: NextRequest) {
  // Throttle before reading the body: spend as little as possible on a
  // request we are going to refuse.
  const limited = rateLimit(clientKey(req));
  if (!limited.ok) {
    return fail(`Too many checks. Try again in ${limited.retryAfter}s.`, 429, {
      "retry-after": String(limited.retryAfter),
    });
  }

  const apiKey = process.env.NEWTON_API_KEY;
  const policyClient = process.env.POLICY_CLIENT_REDSTONE;
  if (!apiKey || !isAddress(policyClient)) {
    console.error("[evaluate] misconfigured:", { hasKey: Boolean(apiKey), client: policyClient ?? null });
    return fail("Screening is not configured on this deployment.", 500);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail("Request too large.", 413);

  let body: { mode?: unknown; providerId?: unknown; to?: unknown; from?: unknown; value?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("Invalid JSON body.", 400);
  }

  if (body.mode !== undefined && body.mode !== "submit") return fail("Only submit is supported.", 400);
  if (body.providerId !== undefined && body.providerId !== "redstone") return fail("Unknown provider.", 400);
  if (!isAddress(body.to)) return fail("Recipient must be a 20-byte 0x address.", 400);
  if (body.from !== undefined && !isAddress(body.from)) return fail("Sender must be a 20-byte 0x address.", 400);
  if (body.value !== undefined && !isQuantity(body.value)) return fail("Value must be a hex quantity.", 400);

  const to = body.to;
  const from = (body.from as string | undefined) ?? DEFAULT_SENDER;
  const value = (body.value as string | undefined) ?? "0x0";

  const entry = hexEncodeJson({ to, from });
  const wasmArgs = (await wasmArgsFor(policyClient, entry)) ?? [entry];

  const rpcBody = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "newt_createTask",
    params: {
      chain_id: CHAIN_ID,
      policy_client: policyClient,
      intent: { from, to, value, data: "0x", chain_id: toQuantity(CHAIN_ID), function_signature: "0x" },
      wasm_args: wasmArgs,
    },
  };

  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      console.error("[evaluate] non-JSON gateway response:", res.status, text.slice(0, 500));
      return fail("The Newton gateway returned an unexpected response.", 502);
    }

    if (json.error) {
      console.error("[evaluate] gateway error:", JSON.stringify(json.error).slice(0, 2000));
      return fail("The Newton gateway could not run this check.", 502);
    }

    const taskId = json.result?.taskId ?? json.result?.task_id ?? json.result?.task?.taskId ?? null;
    return NextResponse.json({
      ok: true,
      mode: "submit",
      taskId,
      policyClient,
      explorerUrl: typeof taskId === "string" ? `https://explorer.newton.xyz/testnet/task/${taskId}` : null,
      result: json.result,
    });
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    console.error("[evaluate] request failed:", err);
    return fail(isTimeout ? "The Newton gateway did not answer within 60 seconds." : "Could not reach the Newton gateway.", 504);
  }
}

/** Ethereum JSON-RPC Quantity: compact hex, no leading zeros. */
function toQuantity(n: number): string {
  return "0x" + n.toString(16);
}

/** wasm_args entries are hex-encoded UTF-8 JSON. */
function hexEncodeJson(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return "0x" + out;
}
