import { formatEther } from "viem";

/** Presentation formatting only. No business logic. */

export function shortHex(hex: string, head = 6, tail = 4): string {
  if (hex.length <= 2 + head + tail) return hex;
  return `${hex.slice(0, 2 + head)}…${hex.slice(-tail)}`;
}

export function formatMon(wei: bigint, dp = 4): string {
  const [i, f = ""] = formatEther(wei).split(".");
  const frac = f.padEnd(dp, "0").slice(0, dp);
  return `${Number(i).toLocaleString("en-US")}.${frac}`;
}

export function formatBps(bps: number | bigint, dp = 2): string {
  return `${(Number(bps) / 100).toFixed(dp)} %`;
}

export function formatUtc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}

export function formatPrice(price: bigint, expo: number): string {
  const v = Number(price) * 10 ** expo;
  return v.toLocaleString("en-US", { maximumSignificantDigits: 8 });
}
