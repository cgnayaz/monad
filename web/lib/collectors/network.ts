import "server-only";
import { formatGwei } from "viem";
import { publicClient } from "@/lib/chain/client";
import { unavailableInput, type StateInput } from "@/lib/jev/state";

const WINDOW = 200n; // blocks used for the average interval

export async function collectNetworkInputs(now: number): Promise<StateInput[]> {
  const src = "monad-rpc" as const;
  try {
    const latest = await publicClient.getBlock({ blockTag: "latest" });
    const [earlier, gasPrice] = await Promise.all([
      publicClient.getBlock({ blockNumber: latest.number - WINDOW }),
      publicClient.getGasPrice(),
    ]);
    const ref = `block=${latest.number}`;
    const intervalMs = Math.round((Number(latest.timestamp - earlier.timestamp) * 1000) / Number(WINDOW));
    return [
      { key: "network.block_number", value: latest.number.toString(), source: src, sourceRef: ref, observedAt: now, status: "ok" },
      { key: "network.block_age", value: now - Number(latest.timestamp), unit: "s", source: src, sourceRef: ref, observedAt: now, status: "ok" },
      { key: "network.avg_block_interval", value: intervalMs, unit: "ms", source: src, sourceRef: `blocks=${earlier.number}..${latest.number}`, observedAt: now, status: "ok" },
      { key: "network.gas_price", value: formatGwei(gasPrice), unit: "gwei", source: src, sourceRef: ref, observedAt: now, status: "ok" },
    ];
  } catch (err) {
    const note = err instanceof Error ? err.message.split("\n")[0] : "RPC unavailable";
    return ["network.block_number", "network.block_age", "network.avg_block_interval", "network.gas_price"].map((k) =>
      unavailableInput(k, src, now, note),
    );
  }
}
