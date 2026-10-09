/**
 * Submit one real, quorum-signed task to the Newton gateway and print the verdict.
 *
 *   NEWTON_API_KEY=… node policy/task-test.mjs <client> <to> [n_policies]
 *
 * wasm_args (protocol 0.7) is one entry per policy in the client's set. Every
 * entry carries { to, from } hex-encoded; a pure-Rego policy ignores its entry.
 * The sender is random, like the page's.
 */
import { randomBytes, randomUUID } from "node:crypto";

const [client, to, nArg] = process.argv.slice(2);
const KEY = process.env.NEWTON_API_KEY;
if (!client || !to || !KEY) {
  console.error("usage: NEWTON_API_KEY=… node policy/task-test.mjs <client> <to> [n_policies]");
  process.exit(1);
}
const n = Number(nArg || 1);
const from = "0x" + randomBytes(20).toString("hex");
const hex = (o) => "0x" + Buffer.from(JSON.stringify(o), "utf8").toString("hex");

const body = {
  jsonrpc: "2.0",
  id: randomUUID(),
  method: "newt_createTask",
  params: {
    chain_id: 11155111,
    policy_client: client,
    intent: { from, to, value: "0x0", data: "0x", chain_id: "0xaa36a7", function_signature: "0x" },
    wasm_args: Array.from({ length: n }, () => hex({ to, from })),
  },
};

const t0 = Date.now();
const res = await fetch("https://gateway.testnet.newton.xyz/rpc", {
  method: "POST",
  headers: { "content-type": "application/json", Authorization: `Bearer ${KEY}` },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(90_000),
});
const json = await res.json().catch(() => null);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

if (!json || json.error) {
  console.log(`${to}  ERROR (${secs}s)  ${JSON.stringify(json?.error ?? res.status).slice(0, 400)}`);
  process.exit(1);
}

const found = [];
(function walk(x, d = 0) {
  if (!x || typeof x !== "object" || d > 8) return;
  for (const [k, v] of Object.entries(x)) {
    if (k === "allowed" && typeof v === "boolean") found.push(v);
    else if (v && typeof v === "object") walk(v, d + 1);
  }
})(json.result);

const taskId = json.result?.task_id ?? json.result?.taskId ?? json.result?.task?.task_id ?? "";
const err = json.result?.error ?? json.result?.operator_errors?.[0]?.message;
const verdict = err ? `NO DECISION: ${String(err).slice(0, 300)}` : found.length && found.every((b) => b === found[0]) ? (found[0] ? "ALLOWED" : "DENIED") : "UNREADABLE";
console.log(`${to}  ${verdict}  (${secs}s)${taskId ? `  https://explorer.newton.xyz/testnet/task/${taskId}` : ""}`);
