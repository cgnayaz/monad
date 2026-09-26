import { cookies } from "next/headers";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_MAX_AGE, openSession, operatorFromCookie } from "@/lib/server/operator-session";
import { clientKey, rateLimit, readJsonBody, tooMany } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({ message: z.string().max(600), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict();

/** GET — the current operator, or `{ operator: null }` when not signed in (not an error). */
export async function GET() {
  const op = operatorFromCookie((await cookies()).get(SESSION_COOKIE)?.value);
  return Response.json({ operator: op }, { headers: { "Cache-Control": "no-store" } });
}

/** POST {message, signature} — open a session for a wallet with an operator role on-chain. */
export async function POST(req: Request) {
  const rl = rateLimit(`session:${clientKey(req)}`, 10, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const read = await readJsonBody(req, 2_048);
  if (!read.ok) return read.res;
  const body = Body.safeParse(read.body);
  if (!body.success) return Response.json({ error: "Expected {message, signature}" }, { status: 400 });

  const r = await openSession(body.data.message, body.data.signature as `0x${string}`);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  (await cookies()).set(SESSION_COOKIE, r.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return Response.json({ address: r.address, role: r.role });
}

/** DELETE — sign out. */
export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
