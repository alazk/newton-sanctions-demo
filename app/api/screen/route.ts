import { NextResponse } from "next/server";
import { redstoneScreen } from "@/lib/redstone";

/**
 * Which party is designated, and on which lists.
 *
 * The on-chain verdict is a single bit: it does not say which side tripped.
 * So this asks the same source the operators' oracle asked, the RedStone
 * Sanctions Oracle on Ethereum mainnet, per address.
 *
 * RedStone says listed / not listed only. For a listed address we then ask
 * OpenSanctions (RedStone's upstream, via our yente instance at YENTE_URL)
 * which lists name it, so the page can say "Listed on OFAC SDN". That second
 * lookup is best effort: if it fails, the address is still reported as listed,
 * just without list names. It never turns a RedStone "listed" into "clear".
 *
 * IMPORTANT, and surfaced in the UI: this is an explanation, not the
 * attestation. It runs here, unsigned, after the fact. If it ever disagreed
 * with the on-chain verdict, the on-chain verdict is the one that counts.
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
  let addresses: `0x${string}`[] = [];
  try {
    const body = await req.json();
    addresses = Array.isArray(body?.addresses) ? body.addresses.filter(isAddress) : [];
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!addresses.length) {
    return NextResponse.json({ ok: false, error: "No addresses supplied." }, { status: 400 });
  }

  try {
    const r = await redstoneScreen(addresses);

    // Same refusal the policy makes: a stale list is not screened against.
    if (r.stale) {
      return NextResponse.json({
        ok: false,
        stale: true,
        ageHours: Math.round(r.ageSeconds / 3600),
        error: "The sanctions list is older than 8 days; screening refused.",
      });
    }

    // List names only for addresses RedStone actually flags.
    const listed = addresses.filter((_, i) => r.flags[i]);
    const ds = await datasetsFor(listed);

    return NextResponse.json({
      ok: true,
      parties: addresses.map((address, i) => ({
        address,
        screened: true,
        sanctioned: r.flags[i],
        datasets: r.flags[i] ? ds[address.toLowerCase()] ?? [] : [],
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
