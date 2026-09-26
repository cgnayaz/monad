import { latestPrice, priceAt } from "@/lib/collectors/pyth";

import { clientKey, rateLimit, tooMany } from "@/lib/server/rate-limit";
import { publicError } from "@/lib/server/public-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/oracle/price[?at=unix] — the reference price as published by Pyth (latest, or the update for a
 * given second). Used by simulation mode to observe the real outcome; nothing is invented.
 */
export async function GET(req: Request) {
  const rl = rateLimit(`oracle-price:${clientKey(req)}`, 30, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const at = new URL(req.url).searchParams.get("at");
  if (at !== null && !/^\d{9,11}$/.test(at)) return Response.json({ error: "Invalid timestamp" }, { status: 400 });
  try {
    const p = at ? await priceAt(Number(at)) : await latestPrice();
    return Response.json(p, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: publicError(err, "Oracle unavailable") }, { status: 503 });
  }
}
