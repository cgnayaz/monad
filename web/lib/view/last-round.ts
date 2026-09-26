import type { DecisionView } from "./decision-view";

/**
 * The last round run from this browser, kept in localStorage as a per-viewer convenience
 * so the dashboard can show it. It is never shared, never sent anywhere and never treated
 * as on-chain data; chain decisions always take precedence.
 */
const KEY = "decmarkt:last-round:v1";
const EVENT = "decmarkt:last-round";

export interface StoredRound {
  savedAt: number;
  view: DecisionView;
}

export function saveLastRound(view: DecisionView) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), view } satisfies StoredRound));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage unavailable (private mode, quota): nothing to remember */
  }
}

export function readLastRoundRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function parseStoredRound(raw: string | null): StoredRound | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredRound;
    return parsed && typeof parsed.savedAt === "number" && parsed.view && Array.isArray(parsed.view.stages) ? parsed : null;
  } catch {
    return null;
  }
}

export function subscribeLastRound(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
