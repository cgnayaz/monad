import { latestPriceUpdate } from "@/lib/collectors/pyth";

export const dynamic = "force-dynamic";

/**
 * GET /api/oracle/update — the latest signed Pyth update data (bytes[]) for the wallet to pass
 * to ExecutionVault.execute. The contract verifies the signature; this route only relays it.
 */
export async function GET() {
  try {
    return Response.json(await latestPriceUpdate(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Oracle unavailable" }, { status: 503 });
  }
}
