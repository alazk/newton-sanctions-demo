import { NextResponse } from "next/server";
import { redstoneFreshness } from "@/lib/redstone";

/**
 * How fresh the sanctions data is.
 *
 * The bound policy reads the RedStone Sanctions Oracle and itself refuses to
 * screen (screening_unavailable) when the list is older than 8 days. This
 * surfaces the same age on the page, read from the same contract, so a stale
 * list is visible before anyone presses the button.
 *
 * Cached per instance for 60s: the list changes weekly, and every page load
 * calls this, so it must not be a free way to hammer the RPC.
 */

export const runtime = "nodejs";

const TTL_MS = 60_000;
let cached: { at: number; body: Record<string, unknown>; status: number } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  let body: Record<string, unknown>;
  let status = 200;
  try {
    const f = await redstoneFreshness();
    body = {
      ok: true,
      source: "redstone",
      count: null,
      ageHours: Math.round((f.ageSeconds / 3600) * 10) / 10,
      generatedAt: new Date(f.lastUpdate * 1000).toISOString(),
      stale: f.stale,
    };
  } catch (err) {
    // Unknown age is reported as stale, never as fresh. RPC errors can carry
    // the RPC URL, so they are logged, not returned.
    console.error("[screening-health] read failed:", err);
    body = { ok: false, stale: true, ageHours: null, error: "Could not read the list's age." };
    status = 502;
  }
  cached = { at: Date.now(), body, status };
  return NextResponse.json(body, { status });
}
