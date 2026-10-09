import { NextResponse } from "next/server";
import { redstoneScreen } from "@/lib/redstone";
import { clientKey, rateLimit } from "@/lib/rate-limit";

/**
 * Which party is designated, and on which lists.
 *
 * The on-chain verdict is a single bit: it does not say which side tripped.
 * So this asks the same source the operators' oracle asked, the RedStone
 * Sanctions Oracle on Ethereum mainnet, per address.
 *
 * RedStone says listed / not listed only. For a listed address we then ask
 * OpenSanctions (RedStone's upstream, via the yente-compatible service at
 * YENTE_URL) which lists name it, so the page can say "Listed on OFAC SDN".
 * That second lookup is best effort: if it fails, the address is still
 * reported as listed, just without list names. It never turns a RedStone
 * "listed" into "clear".
 *
 * This is an explanation, not the attestation: unsigned, after the fact, and
 * labelled as such on the page. If it disagrees with the signed verdict, the
 * signed verdict stands and the page says they disagree.
 *
 * Bounded (audit, Oct 2026): exactly the transfer's two parties, rate-limited,
 * and fixed error text. It is not a public screening API.
 */

export const runtime = "nodejs";

const isAddress = (a: unknown): a is `0x${string}` => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

/** Dataset ids per address from yente, or {} if unavailable. */
async function datasetsFor(addresses: string[]): Promise<Record<string, string[]>> {
  const base = process.env.YENTE_URL;
  if (!base || !addresses.length) return {};
  const queries: Record<string, unknown> = {};
  addresses.forEach((a, i) => {
    queries[`a${i}`] = { schema: "CryptoWallet", properties: { publicKey: [a] } };
  });
  try {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/match/${encodeURIComponent(process.env.YENTE_DATASET ?? "sanctions")}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries }),
        signal: AbortSignal.timeout(6_000),
        cache: "no-store",
      },
    );
    if (!res.ok) return {};
    const body = await res.json();
    const out: Record<string, string[]> = {};
    addresses.forEach((a, i) => {
      const results = body?.responses?.[`a${i}`]?.results;
      if (!Array.isArray(results)) return;
      // match === true only: near-misses are not designations.
      const ds = new Set<string>();
      for (const r of results) if (r?.match === true) for (const d of r.datasets ?? []) ds.add(d);
      out[a.toLowerCase()] = [...ds];
    });
    return out;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  const limited = rateLimit(clientKey(req), 20, "screen");
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many requests." },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  let addresses: `0x${string}`[] = [];
  try {
    const raw = await req.text();
    if (raw.length > 1_024) return NextResponse.json({ ok: false, error: "Request too large." }, { status: 413 });
    const body = JSON.parse(raw);
    addresses = Array.isArray(body?.addresses) ? body.addresses : [];
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  // The transfer's recipient, and optionally its sender. Nothing more.
  if (addresses.length < 1 || addresses.length > 2 || !addresses.every(isAddress)) {
    return NextResponse.json({ ok: false, error: "Send one or two 0x addresses." }, { status: 400 });
  }

  try {
    const r = await redstoneScreen(addresses);
    const listed = addresses.filter((_, i) => r.flags[i]);
    const ds = await datasetsFor(listed);
    const parties = addresses.map((address, i) => ({
      address,
      screened: true,
      sanctioned: r.flags[i],
      datasets: r.flags[i] ? ds[address.toLowerCase()] ?? [] : [],
    }));

    // Same refusal the policy makes: past 8 days the policy will not screen.
    // The flags are still returned, so the page never says "nobody was found"
    // about an address that is in fact on the list.
    if (r.stale) {
      return NextResponse.json({
        ok: false,
        stale: true,
        ageHours: Math.round(r.ageSeconds / 3600),
        parties,
        error: "The sanctions list is older than 8 days.",
      });
    }

    return NextResponse.json({ ok: true, parties });
  } catch (err) {
    // RPC errors can carry the RPC URL (and any key in it): log, don't return.
    console.error("[screen] lookup failed:", err);
    return NextResponse.json({ ok: false, error: "Sanctions lookup unavailable." }, { status: 502 });
  }
}
