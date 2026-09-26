import type { NextRequest } from "next/server";
import { getDecisionProvenance } from "@/lib/data/decisions";
import { attachVerifiedPayloads } from "@/lib/data/payloads";
import { toWireJson } from "@/lib/engine/wire";
import { fromProvenance } from "@/lib/view/decision-view";

export const dynamic = "force-dynamic";

/** GET /api/decisions/:id — the decision as read from chain, with verified payloads, as a DecisionView. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/decisions/[id]">) {
  const { id } = await ctx.params;
  if (!/^[1-9]\d{0,30}$/.test(id)) return Response.json({ error: "Invalid decision id" }, { status: 400 });
  const p = await getDecisionProvenance(BigInt(id));
  if (p.status !== "ok") return Response.json({ error: p.reason }, { status: 503 });
  if (!p.value) return Response.json({ error: "Decision not found" }, { status: 404 });
  const verified = await attachVerifiedPayloads(p.value);
  return new Response(toWireJson(fromProvenance(verified.provenance, verified.checks)), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
