import { z } from "zod";
import { AskError, askDecMarkt } from "@/lib/ai/ask";
import { publicError } from "@/lib/server/public-error";
import { clientKey, rateLimit, readJsonBody, tooMany } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ question: z.string().trim().min(3).max(500) });

/** POST /api/ask {question} — answers a visitor's question about DecMarkt (Turkish, Gemini). */
export async function POST(req: Request) {
  const rl = rateLimit(`ask:${clientKey(req)}`, 10, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const raw = await readJsonBody(req, 4_000);
  if (!raw.ok) return raw.res;
  const body = Body.safeParse(raw.body);
  if (!body.success) return Response.json({ error: "Soru 3–500 karakter olmalı." }, { status: 400 });
  try {
    const r = await askDecMarkt(body.data.question, AbortSignal.timeout(45_000));
    return Response.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("ask route:", publicError(err, "unknown"));
    return Response.json({ error: err instanceof AskError ? err.message : `Şu an yanıt verilemiyor (${publicError(err, "bilinmeyen hata")}).` }, { status: 503 });
  }
}
