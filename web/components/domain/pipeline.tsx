/**
 * The DecMarkt pipeline as a typeset sequence (ARCHITECTURE.md §2). Each stage names
 * the layer and the component responsible for it.
 */

type Layer = "Jev" | "DecMarkt" | "Monad";

export const PIPELINE: { stage: string; layer: Layer; where: string; detail: string }[] = [
  { stage: "Gerçek durum", layer: "Jev", where: "collectors", detail: "Pyth referans fiyatı (ETH/USD), Monad RPC, kasa ve kayıt defteri görünümleri." },
  { stage: "Jev durumu", layer: "Jev", where: "lib/jev/state", detail: "Kanonik JSON (RFC 8785), sürümlü, her girdinin kaynağı belli; keccak256 → stateHash." },
  { stage: "Jev soruları", layer: "Jev", where: "lib/jev/questions", detail: "Rubrikli altı açık soru; keccak256 → questionsHash." },
  { stage: "Taahhüt", layer: "Monad", where: "DecisionRegistry", detail: "stateHash ve questionsHash, hiçbir ajan çalışmadan önce zincire yazılır." },
  { stage: "Paralel kararlar", layer: "Jev", where: "lib/jev/parallel", detail: "Aynı durum ve sorular üzerinde beş yalıtılmış ajan çalıştırması." },
  { stage: "Seçim · Skor · Olasılık", layer: "Jev", where: "lib/jev/primitives", detail: "Doğrulanmış çıktı; skor rubrik puanlarından hesaplanır, asla model tarafından verilmez." },
  { stage: "Toplu gönderim", layer: "Jev", where: "lib/jev/batch", detail: "Bir ajanın tüm yanıtları tek bir toplu gönderim oluşturur; her (ajan, soru) yanıtı kendi kaydını korur." },
  { stage: "Teminatlı gönderim", layer: "DecMarkt", where: "DecisionRegistry.submitBatch", detail: "Her ajanın operatör anahtarı, kilitli teminatına karşı toplu gönderimini yapar; geçersiz seçim, skor ve olasılıklar revert eder." },
  { stage: "Karar motoru", layer: "DecMarkt", where: "DecisionEngine.aggregate", detail: "Tamsayı toplama: her çatal için olasılık × geçmiş başarı." },
  { stage: "Eşik", layer: "DecMarkt", where: "DecisionEngine", detail: "Yeter sayı, kazanan pay ve asgari skor kapıları; başarısızlık → NO_ACTION." },
  { stage: "Sınırlı eylem", layer: "Monad", where: "ExecutionVault.execute", detail: "Yalnızca onaylanan çatal çalışır. Dış çağrı yok, AI calldata'sı yok." },
  { stage: "Gerçek sonuç", layer: "Monad", where: "Pyth", detail: "Yürütmede ve ufuktan sonra imzalı Pyth fiyatı." },
  { stage: "Doğrulama", layer: "Monad", where: "OutcomeRegistry.resolve", detail: "Yayın zamanı penceresi uygulanır; doğru çatal hareketten türetilir." },
  { stage: "Ödül / ceza", layer: "DecMarkt", where: "OutcomeRegistry", detail: "Her teminatın deterministik uzlaşması. Ajanların etkisi yoktur." },
];

const layerStyle: Record<Layer, string> = {
  Jev: "text-ink",
  DecMarkt: "text-accent",
  Monad: "text-ink-2",
};

export function Pipeline({ compact = false }: { compact?: boolean }) {
  return (
    <ol className="border border-rule bg-surface">
      {PIPELINE.map((p, i) => (
        <li
          key={p.stage}
          className={`grid grid-cols-[40px_1fr] gap-x-4 border-b border-rule px-4 last:border-b-0 ${compact ? "py-2" : "py-3"} md:grid-cols-[40px_220px_96px_1fr]`}
        >
          <span className="font-mono text-[12px] text-ink-3 tabular">{String(i + 1).padStart(2, "0")}</span>
          <span className="font-medium">{p.stage}</span>
          <span className={`col-start-2 text-[11px] font-medium uppercase tracking-[0.06em] md:col-start-auto ${layerStyle[p.layer]}`}>
            {p.layer}
          </span>
          {!compact && (
            <span className="col-start-2 text-ink-2 md:col-start-auto">
              {p.detail} <span className="font-mono text-[11.5px] text-ink-3">{p.where}</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
