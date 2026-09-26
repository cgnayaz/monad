import { z } from "zod";
import { acquireRun } from "@/lib/engine/guard";
import { runDecisionPipeline } from "@/lib/engine/pipeline";
import { pipelineSetup } from "@/lib/engine/runtime";
import { toWireJson } from "@/lib/engine/wire";
import type { PipelineEvent } from "@/lib/model/final-decision";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ mode: z.enum(["simulation", "live"]) }).strict();

/**
 * POST /api/decisions — run one Jev decision round and stream its events as NDJSON.
 * The only input is the mode. The browser cannot supply state, forks, thresholds, amounts,
 * addresses or calldata; everything comes from the server's collectors and fixed rules.
 */
export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: 'Body must be {"mode":"simulation"|"live"}' }, { status: 400 });

  const setup = await pipelineSetup(body.data.mode);
  if (!setup.ok) return Response.json({ error: setup.reason }, { status: 503 });

  const lock = acquireRun();
  if (!lock.ok) {
    return Response.json({ error: lock.reason }, { status: 429, headers: { "Retry-After": String(lock.retryAfterSec) } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: PipelineEvent) => controller.enqueue(encoder.encode(toWireJson(e) + "\n"));
      try {
        await runDecisionPipeline(setup.deps, send);
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message.split("\n")[0] : "Pipeline failed" });
      } finally {
        lock.release();
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
