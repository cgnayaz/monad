import { cookies } from "next/headers";
import { distributeFunds } from "@/lib/data/setup";
import { SESSION_COOKIE, operatorFromCookie } from "@/lib/server/operator-session";
import { publicError } from "@/lib/server/public-error";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/setup/distribute — admin only: bonds and gas for the live-mode signers, paid from the proposer. */
export async function POST() {
  const op = operatorFromCookie((await cookies()).get(SESSION_COOKIE)?.value);
  if (!op || op.role !== "admin") return Response.json({ error: "Admin cüzdanıyla operatör girişi gerekli" }, { status: 401 });
  try {
    return Response.json({ txs: await distributeFunds() });
  } catch (err) {
    return Response.json({ error: publicError(err, "Dağıtım başarısız") }, { status: 409 });
  }
}
