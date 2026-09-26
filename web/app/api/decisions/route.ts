import { cookies } from "next/headers";
import { z } from "zod";
import { acquireRun } from "@/lib/engine/guard";
import { runDecisionPipeline } from "@/lib/engine/pipeline";
import { pipelineSetup } from "@/lib/engine/runtime";
import { toWireJson } from "@/lib/engine/wire";
import type { PipelineEvent } from "@/lib/model/final-decision";
import { SESSION_COOKIE, operatorFromCookie } from "@/lib/server/operator-session";
import { clientKey, rateLimit, readJsonBody, tooMany } from "@/lib/server/rate-limit";
import { publicError } from "@/lib/server/public-error";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ mode: z.enum(["simulation", "live"]) }).strict();

/**
 * POST /api/decisions — run one Jev decision round and stream its events as NDJSON.
 * The only input is the mode. The browser cannot supply state, forks, thresholds, amounts,
 * addresses or calldata; everything comes from the server's collectors and fixed rules.
 *
 * Live mode spends gas from the server keys and locks agent bonds, so it requires an
 * operator session (a wallet with an operator role on-chain). Simulation mode costs AI
 * credits only and is rate limited per client.
 */
export async function POST(req: Request) {
  const read = await readJsonBody(req, 256);
  if (!read.ok) return read.res;
  const body = Body.safeParse(read.body);
  if (!body.success) return Response.json({ error: 'Body must be {"mode":"simulation"|"live"}' }, { status: 400 });

  if (body.data.mode === "live") {
    const op = operatorFromCookie((await cookies()).get(SESSION_COOKIE)?.value);
    if (!op) return Response.json({ error: "Live rounds require an operator session: sign in with the admin or guardian wallet" }, { status: 401 });
  } else {
    const rl = rateLimit(`simulation:${clientKey(req)}`, 3, 10 * 60_000);
    if (!rl.ok) return tooMany(rl.retryAfterSec);
  }

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
        send({ type: "error", message: publicError(err, "Pipeline failed") });
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
