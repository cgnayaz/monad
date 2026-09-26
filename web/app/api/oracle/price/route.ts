import { latestPrice, priceAt } from "@/lib/collectors/pyth";

export const dynamic = "force-dynamic";

/**
 * GET /api/oracle/price[?at=unix] — MON/USD as published by Pyth (latest, or the update for a
 * given second). Used by simulation mode to observe the real outcome; nothing is invented.
 */
export async function GET(req: Request) {
  const at = new URL(req.url).searchParams.get("at");
  if (at !== null && !/^\d{9,11}$/.test(at)) return Response.json({ error: "Invalid timestamp" }, { status: 400 });
  try {
    const p = at ? await priceAt(Number(at)) : await latestPrice();
    return Response.json(p, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Oracle unavailable" }, { status: 503 });
  }
}
