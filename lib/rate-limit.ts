/**
 * Per-IP throttles for the public routes.
 *
 *   /api/evaluate          6 / min   each call is a real, paid Newton task
 *   /api/screen           20 / min   mainnet RPC reads + an OpenSanctions lookup
 *   /api/screening-health  cached instead (see that route)
 *
 * WHAT THIS IS NOT: durable. Vercel runs each region's functions in separate
 * instances and recycles them freely, so these counters reset when an
 * instance does and are not shared between them. A determined abuser gets
 * more than the limit suggests. It stops a stuck retry loop or someone leaning
 * on the button; anything stronger needs durable storage (Upstash) or a
 * Vercel Firewall rate-limit rule, which is the recommended production setup.
 */

type Hit = { count: number; resetAt: number };

const WINDOW_MS = 60_000;

/**
 * Bounded on purpose: an unbounded Map keyed by client IP is a slow memory
 * leak a scraper can accelerate. When full, the oldest keys are evicted. An
 * earlier version cleared the whole map, which let anyone with enough
 * addresses reset everyone's counters, their own included.
 */
const MAX_KEYS = 5_000;
const hits = new Map<string, Hit>();

function sweep(now: number) {
  for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  // Map iterates in insertion order, so the first keys are the oldest.
  while (hits.size > MAX_KEYS) {
    const oldest = hits.keys().next().value;
    if (oldest === undefined) break;
    hits.delete(oldest);
  }
}

/**
 * Vercel sets x-forwarded-for; the client-supplied value is only trustworthy
 * because the platform overwrites it at the edge. Falling back to a constant
 * means everyone shares one bucket, which is the safe direction to fail.
 */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anonymous";
}

export function rateLimit(
  key: string,
  max = 6,
  bucket = "evaluate",
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  sweep(now);

  const k = `${bucket}:${key}`;
  const existing = hits.get(k);
  if (!existing || existing.resetAt <= now) {
    hits.set(k, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }

  if (existing.count >= max) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += 1;
  return { ok: true };
}
