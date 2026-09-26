import "server-only";

/**
 * Per-key fixed-window rate limiting (in memory, per server instance). A best-effort guard
 * for public read endpoints that cost RPC or oracle quota; state-changing endpoints are
 * additionally protected by operator sessions.
 */
const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) windows.clear(); // bound memory
    return { ok: true };
  }
  if (w.count >= limit) return { ok: false, retryAfterSec: Math.ceil((w.start + windowMs - now) / 1000) };
  w.count++;
  return { ok: true };
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

export function tooMany(retryAfterSec: number) {
  return Response.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
}

/** Reject bodies larger than `max` bytes before reading them. */
export async function readJsonBody(req: Request, max: number): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > max) return { ok: false, res: Response.json({ error: "Request body too large" }, { status: 413 }) };
  const text = await req.text();
  if (text.length > max) return { ok: false, res: Response.json({ error: "Request body too large" }, { status: 413 }) };
  try {
    return { ok: true, body: text ? JSON.parse(text) : null };
  } catch {
    return { ok: false, res: Response.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}
