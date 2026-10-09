import { NextResponse } from "next/server";
import { redstoneFreshness } from "@/lib/redstone";

/**
 * How fresh the sanctions data is.
 *
 * The bound policy reads the RedStone Sanctions Oracle and itself refuses to
 * screen (screening_unavailable) when the list is older than 8 days. This
 * surfaces the same age on the page, read from the same contract, so a stale
 * list is visible before anyone presses the button.
 */

export const runtime = "nodejs";

export async function GET() {
  try {
    const f = await redstoneFreshness();
    return NextResponse.json({
      ok: true,
      source: "redstone",
      count: null,
      ageHours: Math.round((f.ageSeconds / 3600) * 10) / 10,
      generatedAt: new Date(f.lastUpdate * 1000).toISOString(),
      stale: f.stale,
    });
  } catch (err) {
    // Unknown age is reported as stale: never call data fresh because we
    // failed to find out how old it is.
    return NextResponse.json(
      { ok: false, stale: true, error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
