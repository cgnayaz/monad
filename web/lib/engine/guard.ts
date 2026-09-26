import "server-only";

/**
 * Abuse guard for endpoints that spend AI credits or gas: at most one pipeline run at a
 * time per server instance, and a minimum interval between runs. Callers get an explicit
 * refusal with the time to wait, never a silently degraded result.
 */
const MIN_INTERVAL_MS = 30_000;
let running = false;
let lastStart = 0;

export function acquireRun(): { ok: true; release: () => void } | { ok: false; reason: string; retryAfterSec: number } {
  const now = Date.now();
  if (running) return { ok: false, reason: "A decision round is already running", retryAfterSec: 10 };
  const wait = lastStart + MIN_INTERVAL_MS - now;
  if (wait > 0) return { ok: false, reason: "Rounds are rate limited", retryAfterSec: Math.ceil(wait / 1000) };
  running = true;
  lastStart = now;
  return { ok: true, release: () => void (running = false) };
}
