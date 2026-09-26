import type { Metadata } from "next";
import { SetupSteps } from "@/components/setup/setup-steps";
import { PageHeader } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/status";
import { PROPOSER_FUNDING, TARGETS, setupStatus, type SetupStatus } from "@/lib/data/setup";
import { publicError } from "@/lib/server/public-error";

export const metadata: Metadata = { title: "Kurulum" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  let status: SetupStatus | null = null;
  let error: string | null = null;
  try {
    status = await setupStatus();
  } catch (err) {
    error = publicError(err, "Zincir okunamadı");
  }
  return (
    <>
      <PageHeader
        eyebrow="Canlı mod kurulumu"
        title="Kurulum"
        lead="Canlı testnet modu için 7 imzacıyı (5 ajan operatörü, proposer, keeper) zincire bağlar. Anahtarlar sunucuda SIGNER_SEED'den türetilir; bu sayfa yalnızca adresleri gösterir. Adımları admin cüzdanıyla sırayla onaylayın."
      />
      {error || !status ? (
        <EmptyState title="Durum okunamadı">{error}</EmptyState>
      ) : (
        <SetupSteps
          s={status}
          funding={{ proposer: String(PROPOSER_FUNDING), agentBond: String(TARGETS.agentBond), agentGas: String(TARGETS.agentGas), keeperGas: String(TARGETS.keeperGas) }}
        />
      )}
    </>
  );
}
