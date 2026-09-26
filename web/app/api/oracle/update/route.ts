import { latestPriceUpdate, priceUpdateAt } from "@/lib/collectors/pyth";

import { clientKey, rateLimit, tooMany } from "@/lib/server/rate-limit";
import { publicError } from "@/lib/server/public-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/oracle/update[?at=unix] — signed Pyth update data (bytes[]) for a wallet to pass to
 * ExecutionVault.execute (latest) or OutcomeRegistry.resolve (published at `at`). The
 * contracts verify the signature and the publish-time window; this route only relays it.
 */
export async function GET(req: Request) {
  const rl = rateLimit(`oracle-update:${clientKey(req)}`, 20, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const at = new URL(req.url).searchParams.get("at");
  if (at !== null && !/^\d{9,11}$/.test(at)) return Response.json({ error: "Invalid timestamp" }, { status: 400 });
  try {
    const u = at ? await priceUpdateAt(Number(at)) : await latestPriceUpdate();
    return Response.json(u, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: publicError(err, "Oracle unavailable") }, { status: 503 });
  }
}
