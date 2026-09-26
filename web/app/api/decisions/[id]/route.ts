import type { NextRequest } from "next/server";
import { chainDecision } from "@/lib/data/decision-view";
import { toWireJson } from "@/lib/engine/wire";
import { clientKey, rateLimit, tooMany } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** GET /api/decisions/:id — the decision as read from chain, with verified payloads, as a DecisionView. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/decisions/[id]">) {
  const rl = rateLimit(`decision:${clientKey(req)}`, 60, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const { id } = await ctx.params;
  if (!/^[1-9]\d{0,30}$/.test(id)) return Response.json({ error: "Invalid decision id" }, { status: 400 });
  const c = await chainDecision(BigInt(id));
  if (c.status !== "ok") return Response.json({ error: c.reason }, { status: 503 });
  if (!c.value) return Response.json({ error: "Decision not found" }, { status: 404 });
  return new Response(toWireJson(c.value.view), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
