import "server-only";
import { formatEther } from "viem";
import { decisionRegistryAbi, executionVaultAbi } from "@/lib/chain/abis";
import { publicClient } from "@/lib/chain/client";
import { deployment } from "@/lib/chain/deployments";
import { unavailableInput, type StateInput } from "@/lib/jev/state";

/** Vault, registry and track-record inputs. Unavailable until the contracts are deployed. */
export async function collectProtocolInputs(now: number): Promise<StateInput[]> {
  const d = deployment();
  if (!d.deployed) {
    const note = "contracts not deployed";
    return [
      unavailableInput("vault.active", "execution-vault", now, note, "MON"),
      unavailableInput("vault.reserve", "execution-vault", now, note, "MON"),
      unavailableInput("record.decision_count", "decision-registry", now, note),
    ];
  }
  try {
    const [balances, count, block] = await Promise.all([
      publicClient.readContract({ address: d.addresses.ExecutionVault, abi: executionVaultAbi, functionName: "balances" }),
      publicClient.readContract({ address: d.addresses.DecisionRegistry, abi: decisionRegistryAbi, functionName: "decisionCount" }),
      publicClient.getBlockNumber(),
    ]);
    const ref = `block=${block}`;
    return [
      { key: "vault.active", value: formatEther(balances[0]), unit: "MON", source: "execution-vault", sourceRef: ref, observedAt: now, status: "ok" },
      { key: "vault.reserve", value: formatEther(balances[1]), unit: "MON", source: "execution-vault", sourceRef: ref, observedAt: now, status: "ok" },
      { key: "record.decision_count", value: count.toString(), source: "decision-registry", sourceRef: ref, observedAt: now, status: "ok" },
    ];
  } catch (err) {
    const note = err instanceof Error ? err.message.split("\n")[0] : "contract read failed";
    return [
      unavailableInput("vault.active", "execution-vault", now, note, "MON"),
      unavailableInput("vault.reserve", "execution-vault", now, note, "MON"),
      unavailableInput("record.decision_count", "decision-registry", now, note),
    ];
  }
}
