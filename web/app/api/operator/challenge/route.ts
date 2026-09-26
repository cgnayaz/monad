import { issueChallenge } from "@/lib/server/operator-session";
import { clientKey, rateLimit, tooMany } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/operator/challenge — a fresh message for the operator wallet to sign. */
export async function GET(req: Request) {
  const rl = rateLimit(`challenge:${clientKey(req)}`, 10, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const c = issueChallenge();
  if (!c) return Response.json({ error: "Operator sessions are not configured" }, { status: 503 });
  return Response.json(c, { headers: { "Cache-Control": "no-store" } });
}
