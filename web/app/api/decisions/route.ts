import { acquireRun } from "@/lib/engine/guard";
import { runDecisionPipeline } from "@/lib/engine/pipeline";
import { pipelineSetup } from "@/lib/engine/runtime";
import { toWireJson } from "@/lib/engine/wire";
import type { PipelineEvent } from "@/lib/model/final-decision";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/decisions — run one Jev decision round and stream its events as NDJSON.
 * The request body is ignored: the browser cannot supply state, forks, thresholds, amounts,
 * addresses or calldata. Everything comes from the server's collectors and fixed rules.
 */
export async function POST() {
  const setup = await pipelineSetup();
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
