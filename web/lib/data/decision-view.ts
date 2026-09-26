import "server-only";
import { reproduce } from "@/lib/decmarkt/reproduce";
import type { DecisionProvenance } from "@/lib/model/provenance";
import { ok, type Availability } from "@/lib/types/protocol";
import { fromProvenance, type DecisionView } from "@/lib/view/decision-view";
import { settlementParams } from "./accountability";
import { getDecisionProvenance } from "./decisions";
import { attachVerifiedPayloads, type VerifiedPayloads } from "./payloads";

/**
 * A chain decision as the UI shows it: provenance from contract storage, off-chain
 * payloads attached only where they verify, and the outcome and settlement reproduced
 * from on-chain inputs with the deterministic rules.
 */
export async function chainDecision(id: bigint): Promise<
  Availability<{ view: DecisionView; provenance: DecisionProvenance; store: VerifiedPayloads["store"] } | null>
> {
  const p = await getDecisionProvenance(id);
  if (p.status !== "ok") return p;
  if (!p.value) return ok(null);
  const [verified, params] = await Promise.all([attachVerifiedPayloads(p.value), settlementParams()]);
  const repro = params.status === "ok" ? { reproduction: reproduce(verified.provenance, params.value), params: params.value } : null;
  return ok({ view: fromProvenance(verified.provenance, verified.checks, repro), provenance: verified.provenance, store: verified.store });
}
