import type { Metadata } from "next";
import Link from "next/link";
import { ForkTable } from "@/components/domain/fork-table";
import { LifecycleRail } from "@/components/domain/lifecycle-rail";
import { Pipeline } from "@/components/domain/pipeline";
import { PageHeader, Section } from "@/components/ui/layout";
import { Table, Td, Th } from "@/components/ui/table";

export const metadata: Metadata = { title: "Nasıl çalışır" };

const LAYERS = [
  {
    n: "1",
    name: "Jev",
    role: "kararı yapılandırır",
    does: "Dünyayı hash'lenmiş bir duruma dönüştürür, bu durum hakkında açık sorular sorar ve beş bağımsız analistin her soruyu kapalı bir kümeden bir seçim, skor üreten rubrik puanları, bir olasılık ve bir gerekçeyle yanıtlamasını sağlar.",
    produces: "Durum · Sorular · Seçim · Skor · Olasılık",
    code: "web/lib/jev",
  },
  {
    n: "2",
    name: "DecMarkt",
    role: "hesap verebilirlik ekler",
    does: "Her analiste zincir üstü bir kimlik ve teminat verir, kararlarını sabit tamsayı kurallarıyla toplar, eşiği uygular, tek bir sınırlı eylem seçer ve her teminatı doğrulanmış sonuca göre uzlaştırır.",
    produces: "Toplama · Eşik · Eylem · Ödül / ceza",
    code: "web/lib/decmarkt, DecisionEngine, OutcomeRegistry",
  },
  {
    n: "3",
    name: "Monad",
    role: "sonucu uygular ve kaydeder",
    does: "Yaşam döngüsünü, gönderimleri, teminatları ve hazineyi kontratlarda tutar. Yalnızca onaylanan eylem yürütülebilir; sonuç katı bir pencere içindeki imzalı Pyth fiyatından alınır; her adım herkese açık bir işlemdir.",
    produces: "İşlemler · Yürütme · Doğrulanmış sonuç · Uzlaşma",
    code: "contracts/src",
  },
];

const JEV_MAP: [string, string, string][] = [
  ["Durum (State)", "Kaynaklı girdilerin kanonik JSON'u; ajanlar çalışmadan önce hash'lenir ve zincire işlenir", "Decision.stateHash"],
  ["Sorular (Questions)", "Her birinin kendi kimliği ve değerlendirdiği girdileri olan altı açık soru", "Decision.questionSetHash"],
  ["Seçim (Choice)", "Dört sınırlı çataldan biri; kapalı enum olarak doğrulanır", "Submission.choice"],
  ["Skor (Score)", "0–4 rubrik puanlarından sabit bir formülle hesaplanır (0–10000)", "Submission.score"],
  ["Olasılık (Probability)", "Baz puan cinsinden güven (%1–99); oyu ve uzlaşmayı ağırlıklandırır", "Submission.probability"],
  ["Paralel kararlar", "Her biri kendi operatör adresinden beş yalıtılmış çalıştırma", "5 × submitBatch"],
  ["Toplu kararlar", "Bir ajanın tüm yanıtları tek işlemde, soru başına bir kayıt", "(ajan, soru) başına Submission"],
  ["Sınırlı çatallar", "Sabit enum artı karar başına maske; kasada çatal başına tek kod yolu", "DecisionConfig.allowedForks"],
  ["Eylem (Action)", "Yalnızca motorun (veya bir guardian'ın) onayladığı çatal yürütülür", "ExecutionVault.execute"],
  ["Doğrulama (Verify)", "Katı bir pencere içinde imzalı oracle fiyatı; hash'ler okunurken yeniden hesaplanır", "OutcomeRegistry.resolve"],
];

const GUARANTEES = [
  ["Keyfi eylem yok", "Seçimler hem sunucuda hem kontratta kapalı bir enum'a ve kararın çatal maskesine göre doğrulanır."],
  ["AI'ya anahtar veya calldata yok", "Anahtarlar yürütme katmanında kalır; her çağrı, doğrulanmış alanlardan kurulan argümanlarla sabit bir fonksiyonu hedefler."],
  ["Sonuca hiçbir model karar vermez", "Toplama ve eşik tamsayı kurallarıdır; bir şey yürütülmeden önce kontratın sonucu yerel sonuçla karşılaştırılır."],
  ["Kendi kendine uzlaşma yok", "Ödüller ve cezalar, OutcomeRegistry'deki sabit kurallarla oracle sonucundan çıkar."],
  ["Anlaşmazlık fon taşımaz", "Başarısız herhangi bir kapı — yeter sayı, pay veya skor — NO_ACTION'ı onaylar."],
  ["Hatalar görünür", "Zaman aşımları, sağlayıcı hataları, geçersiz JSON ve şema ihlalleri ajan başına kaydedilir ve kaçırılmış olarak uzlaştırılır."],
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHeader
        eyebrow="Protokol"
        title="DecMarkt nasıl çalışır"
        lead="Jev kararı yapılandırır. DecMarkt hesap verebilirlik ekler. Monad sonucu uygular ve kaydeder."
      />

      <Section title="Üç katman">
        <ol className="border border-rule bg-surface">
          {LAYERS.map((l) => (
            <li key={l.name} className="grid grid-cols-1 gap-x-8 gap-y-2 border-b border-rule px-5 py-5 last:border-b-0 md:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_280px]">
              <div>
                <p className="font-mono text-[11px] text-ink-3">katman {l.n}</p>
                <p className="text-[17px] font-medium">{l.name}</p>
                <p className="text-[13px] text-accent">{l.role}</p>
              </div>
              <p className="text-[13.5px] leading-[21px] text-ink-2">{l.does}</p>
              <dl className="space-y-2 text-[12.5px] md:col-start-2 xl:col-start-auto">
                <div>
                  <dt className="label">Ürettiği</dt>
                  <dd className="mt-0.5">{l.produces}</dd>
                </div>
                <div>
                  <dt className="label">Nerede</dt>
                  <dd className="mt-0.5 font-mono text-[12px] text-ink-2">{l.code}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Durumdan uzlaşmaya" description="Her aşama sorumlu katmanı ve bileşeni belirtir. Ana sayfa ve karar kayıtları bu aşamaları gerçek değerlerle gösterir.">
        <Pipeline />
      </Section>

      <Section
        title="Neye karar veriliyor"
        description="Zincir üstü bir kasa test MON'unu iki kovada tutar: ACTIVE ve RESERVE. Her tur, bir sonraki ufuk için bunun bir kısmının taşınıp taşınmayacağına karar verir. Doğru cevabı imzalı Pyth fiyatlarından ölçülen referans piyasa hareketi (ETH/USD) belirler — asla bir görüş değil."
      >
        <ForkTable />
      </Section>

      <Section title="Yaşam döngüsü" description="DecisionRegistry tarafından uygulanır. Geçersiz geçişler revert eder; ulaşılan her durum kendi bloğunu ve işlemini kaydeder.">
        <LifecycleRail />
      </Section>

      <Section
        title="Uygulamada Jev"
        aside={
          <Link href="/docs/jev-integration" className="text-[13px] text-ink-2 hover:text-ink">
            Tam eşleme →
          </Link>
        }
      >
        <Table caption="Jev eşlemesi">
          <thead>
            <tr>
              <Th>Jev kavramı</Th>
              <Th>Uygulama</Th>
              <Th>Zincir üstü karşılığı</Th>
            </tr>
          </thead>
          <tbody>
            {JEV_MAP.map(([c, impl, anchor]) => (
              <tr key={c}>
                <Td className="whitespace-nowrap font-medium">{c}</Td>
                <Td className="min-w-[300px] text-ink-2">{impl}</Td>
                <Td mono className="whitespace-nowrap">{anchor}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title="Kodla garanti altında" description="Her özellik model davranışından değil, kontratlardaki veya sunucudaki belirli bir kontrolden gelir.">
        <dl className="grid grid-cols-1 border border-rule bg-surface md:grid-cols-2">
          {GUARANTEES.map(([g, why], i) => (
            <div key={g} className={`border-rule px-5 py-4 ${i % 2 === 0 ? "md:border-r" : ""} ${i > 0 ? "border-t" : ""} ${i === 1 ? "md:border-t-0" : ""}`}>
              <dt className="font-medium">{g}</dt>
              <dd className="mt-1 text-[13px] text-ink-2">{why}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </>
  );
}
