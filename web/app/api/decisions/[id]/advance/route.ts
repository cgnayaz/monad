import type { NextRequest } from "next/server";
import { chainExecutionLayer } from "@/lib/engine/runtime";
import { toWireJson } from "@/lib/engine/wire";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/decisions/:id/advance — perform the next permissionless lifecycle step that is
 * due (aggregate after the deadline, finalise a timed-out escalation, execute the approved
 * action, resolve the outcome). The step is chosen from on-chain state, not from the caller.
 */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/decisions/[id]/advance">) {
  const { id } = await ctx.params;
  if (!/^[1-9]\d{0,30}$/.test(id)) return Response.json({ error: "Invalid decision id" }, { status: 400 });
  const chain = chainExecutionLayer();
  if (!chain.layer) return Response.json({ error: chain.reason }, { status: 503 });
  try {
    const result = await chain.layer.advance(id);
    return new Response(toWireJson(result), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message.split("\n")[0] : "Step failed" }, { status: 409 });
  }
}
