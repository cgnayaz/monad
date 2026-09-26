import type { Metadata } from "next";
import { DecisionTable } from "@/components/domain/decision-table";
import { NotDeployed } from "@/components/domain/not-deployed";
import { PageHeader } from "@/components/ui/layout";
import { EmptyState } from "@/components/ui/status";
import { listDecisions } from "@/lib/data/decisions";

export const metadata: Metadata = { title: "Kararlar" };
export const dynamic = "force-dynamic";

export default async function DecisionsPage() {
  const decisions = await listDecisions(100);
  return (
    <>
      <PageHeader
        eyebrow="Geçmiş"
        title="Kararlar"
        lead="DecisionRegistry'ye kaydedilen tüm kararlar, en yeniden eskiye. Tam denetim izi için birini açın: durum, sorular, her ajanın kararı, toplama, eylem, sonuç ve uzlaşma."
      />
      {decisions.status === "unavailable" ? (
        decisions.reason.startsWith("Contracts") ? (
          <NotDeployed what="karar" />
        ) : (
          <EmptyState title="Kararlar okunamadı">{decisions.reason}</EmptyState>
        )
      ) : decisions.value.length === 0 ? (
        <EmptyState title="Kayıtlı karar yok">Dağıtılmış kayıt defterinde henüz karar oluşturulmadı.</EmptyState>
      ) : (
        <DecisionTable rows={decisions.value} />
      )}
    </>
  );
}
