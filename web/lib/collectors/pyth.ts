import "server-only";
import { z } from "zod";
import { PYTH } from "@/lib/config/public";
import { serverEnv } from "@/lib/config/server";
import { unavailableInput, type StateInput } from "@/lib/jev/state";

/**
 * Pyth Hermes collector. Since the Pyth Core upgrade (2026-08-26) Hermes requires an
 * API key; without one every market/history input is reported unavailable.
 */

const PriceSchema = z.object({
  price: z.string(),
  conf: z.string(),
  expo: z.number().int(),
  publish_time: z.number().int(),
});
const HermesResponse = z.object({
  parsed: z.array(z.object({ id: z.string(), price: PriceSchema, ema_price: PriceSchema })).min(1),
});

export type PythPrice = z.infer<typeof PriceSchema>;

export interface PythSnapshot {
  price: PythPrice;
  ema: PythPrice;
}

function scaled(p: { price: string; expo: number }): number {
  return Number(p.price) * 10 ** p.expo;
}

async function fetchPrice(path: string): Promise<PythSnapshot> {
  const env = serverEnv();
  if (!env.PYTH_API_KEY) throw new Error("PYTH_API_KEY is not configured");
  const id = PYTH.feedId;
  const url = `${env.PYTH_HERMES_URL}${path}?ids%5B%5D=${id}&parsed=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.PYTH_API_KEY}` },
    signal: AbortSignal.timeout(6_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Hermes responded ${res.status}`);
  const body = HermesResponse.parse(await res.json());
  const first = body.parsed[0];
  return { price: first.price, ema: first.ema_price };
}

export async function collectPythInputs(now: number): Promise<StateInput[]> {
  const src = "pyth-hermes" as const;
  const marketKeys = ["market.ref.price", "market.ref.conf", "market.ref.ema_price", "market.ref.publish_age"];
  const historyWindows = [
    { key: "history.ref.change_5m", seconds: 300 },
    { key: "history.ref.change_1h", seconds: 3_600 },
    { key: "history.ref.change_24h", seconds: 86_400 },
  ];

  let latest: PythSnapshot;
  try {
    latest = await fetchPrice("/v2/updates/price/latest");
  } catch (err) {
    const note = err instanceof Error ? err.message : "Hermes unavailable";
    return [
      ...marketKeys.map((k) => unavailableInput(k, src, now, note)),
      ...historyWindows.map((w) => unavailableInput(w.key, src, now, note, "bps")),
    ];
  }

  const ref = `publishTime=${latest.price.publish_time}`;
  const spot = scaled(latest.price);
  const inputs: StateInput[] = [
    { key: "market.ref.price", value: spot, unit: "USD", source: src, sourceRef: ref, observedAt: now, status: "ok" },
    { key: "market.ref.conf", value: scaled({ price: latest.price.conf, expo: latest.price.expo }), unit: "USD", source: src, sourceRef: ref, observedAt: now, status: "ok" },
    { key: "market.ref.ema_price", value: scaled(latest.ema), unit: "USD", source: src, sourceRef: `publishTime=${latest.ema.publish_time}`, observedAt: now, status: "ok" },
    {
      key: "market.ref.publish_age",
      value: now - latest.price.publish_time,
      unit: "s",
      source: src,
      sourceRef: ref,
      observedAt: now,
      status: now - latest.price.publish_time > 60 ? "stale" : "ok",
      ...(now - latest.price.publish_time > 60 ? { value: null, note: "latest price older than 60 s" } : {}),
    },
  ];

  const past = await Promise.allSettled(
    historyWindows.map((w) => fetchPrice(`/v2/updates/price/${latest.price.publish_time - w.seconds}`)),
  );
  historyWindows.forEach((w, i) => {
    const r = past[i];
    if (r.status === "fulfilled") {
      const then = scaled(r.value.price);
      inputs.push({
        key: w.key,
        value: Math.round(((spot - then) / then) * 10_000),
        unit: "bps",
        source: src,
        sourceRef: `publishTime=${r.value.price.publish_time}`,
        observedAt: now,
        status: "ok",
      });
    } else {
      inputs.push(unavailableInput(w.key, src, now, r.reason instanceof Error ? r.reason.message : "unavailable", "bps"));
    }
  });
  return inputs;
}

// ─── Signed update data for on-chain verification ─────────────────────────

const UpdateResponse = z.object({
  binary: z.object({ encoding: z.literal("hex"), data: z.array(z.string().regex(/^(0x)?[0-9a-fA-F]+$/)).min(1) }),
  parsed: z.array(z.object({ price: PriceSchema })).min(1),
});

export interface PriceUpdate {
  data: `0x${string}`[]; // bytes[] for IPyth.parsePriceFeedUpdates
  publishTime: number;
}

async function fetchUpdate(path: string): Promise<PriceUpdate> {
  const env = serverEnv();
  if (!env.PYTH_API_KEY) throw new Error("PYTH_API_KEY is not configured; signed price updates are unavailable");
  const url = `${env.PYTH_HERMES_URL}${path}?ids%5B%5D=${PYTH.feedId}&encoding=hex&parsed=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.PYTH_API_KEY}` },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Hermes responded ${res.status}`);
  const body = UpdateResponse.parse(await res.json());
  return {
    data: body.binary.data.map((d) => (d.startsWith("0x") ? d : `0x${d}`) as `0x${string}`),
    publishTime: body.parsed[0].price.publish_time,
  };
}

/** Latest signed reference-price update (for ExecutionVault.execute). */
export function latestPriceUpdate(): Promise<PriceUpdate> {
  return fetchUpdate("/v2/updates/price/latest");
}

/** Signed update published at `timestamp` — the first at or after it (for OutcomeRegistry.resolve). */
export function priceUpdateAt(timestamp: number): Promise<PriceUpdate> {
  return fetchUpdate(`/v2/updates/price/${timestamp}`);
}

export interface ParsedPrice {
  price: string; // integer, scaled by 10^expo
  conf: string;
  expo: number;
  publishTime: number;
}

function parsed(s: PythSnapshot): ParsedPrice {
  return { price: s.price.price, conf: s.price.conf, expo: s.price.expo, publishTime: s.price.publish_time };
}

/** Latest reference price as published by Pyth (signed update, parsed). */
export async function latestPrice(): Promise<ParsedPrice> {
  return parsed(await fetchPrice("/v2/updates/price/latest"));
}

/** Reference price published at `timestamp` (Pyth's update for that second). */
export async function priceAt(timestamp: number): Promise<ParsedPrice> {
  return parsed(await fetchPrice(`/v2/updates/price/${timestamp}`));
}

