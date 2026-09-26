import type { Fork } from "@/lib/types/protocol";

/**
 * Turkish display copy for protocol values. The protocol identifiers themselves (fork and
 * status enums, contract names) stay as they are on chain; the English ACTION_SPACE text is
 * what the model sees in its prompt and is not changed here.
 */
export const FORK_TR: Readonly<Record<Fork, { label: string; effect: string }>> = {
  NO_ACTION: { label: "Eylem yok", effect: "Hiçbir şey taşınmaz. Başlangıç fiyatı yine kaydedilir, böylece karar doğrulanabilir kalır." },
  DERISK: { label: "Riski azalt", effect: "min(actionBps × ACTIVE, maxMove) kadarını ACTIVE'den RESERVE'e taşır." },
  DEPLOY: { label: "Konuşlandır", effect: "min(actionBps × RESERVE, maxMove) kadarını RESERVE'den ACTIVE'e taşır." },
  ESCALATE: { label: "Yükselt", effect: "Otomatik eylem yok. Bir guardian son tarihten önce NO_ACTION, DERISK veya DEPLOY seçer; seçmezse NO_ACTION." },
};

const SETTLEMENT_TR: Record<string, string> = {
  NOT_LOCKED: "KİLİTLENMEDİ",
  LOCKED: "KİLİTLİ",
  SETTLED: "UZLAŞILDI",
  RELEASED: "SERBEST",
  VOID: "GEÇERSİZ",
};

/** Turkish label for a settlement status; unknown values are shown as they are. */
export function settlementLabel(s: string): string {
  return SETTLEMENT_TR[s] ?? s;
}

const RESULT_TR: Record<string, string> = { CORRECT: "DOĞRU", WRONG: "YANLIŞ", MISSED: "KAÇIRDI", NEUTRAL: "NÖTR" };

/** Turkish label for a per-agent settlement result (CORRECT, WRONG, MISSED, NEUTRAL). */
export function resultLabel(r: string): string {
  return RESULT_TR[r] ?? r;
}

const OUTCOME_TR: Record<string, string> = { verified: "doğrulandı", void: "geçersiz", pending: "bekliyor", na: "uygulanamaz" };

export function outcomeLabel(s: string): string {
  return OUTCOME_TR[s] ?? s;
}

const INTEGRITY_TR: Record<string, string> = { VERIFIED: "doğrulandı", MISMATCH: "uyuşmuyor", UNAVAILABLE: "okunamadı" };

export function integrityLabel(s: string): string {
  return INTEGRITY_TR[s] ?? s.toLowerCase();
}

/**
 * Turkish display names and mandates of the five analysts. The English AgentSpec text stays
 * the prompt's source of truth; this is presentation only.
 */
export const AGENT_TR: Readonly<Record<string, { name: string; short: string; mandate: string }>> = {
  RISK: {
    name: "Risk Analisti",
    short: "Risk",
    mandate: "Kasanın MON değerini korur. Aşağı yönlü hareketin büyüklüğünü ve oynaklığı banda göre tartar; kanıtlar karışıkken kaybı en aza indiren çatalı tercih eder.",
  },
  YIELD: {
    name: "Getiri Analisti",
    short: "Getiri",
    mandate: "Fırsatı belirler. Konuşlandırılan fonu artırmanın, banda göre beklenen olumlu hareketle haklı çıkıp çıkmadığını değerlendirir.",
  },
  SECURITY: {
    name: "Güvenlik Analisti",
    short: "Güvenlik",
    mandate: "Girdilerin ve altyapının eyleme geçmek için yeterince güvenilir olup olmadığını değerlendirir: oracle tazeliği ve güven aralığı, ağ sağlığı, protokol durumu.",
  },
  MARKET: {
    name: "Piyasa Analisti",
    short: "Piyasa",
    mandate: "Güncel piyasayı okur: spot fiyat ile hareketli ortalama, kısa vadeli değişim ve sinyalin güven aralığı ile bandın ima ettiği gürültüyü aşıp aşmadığı.",
  },
  HISTORY: {
    name: "Geçmiş Analisti",
    short: "Geçmiş",
    mandate: "Geçmişi kullanır: benzer pencerelerdeki fiyat davranışı ve daha önce sonuçlanan kararların doğru çatalları. Geçmiş veri azsa bunu açıkça belirtir.",
  },
};

export function agentName(key: string, fallback = key): string {
  return AGENT_TR[key]?.name ?? fallback;
}

/** Turkish display text of the question templates, by category. Question ids hash the English text. */
export const QUESTION_TR: Readonly<Record<string, string>> = {
  ACTION: "Bu duruma göre kasa bir sonraki ufuk için hangi sınırlı eylemi yapmalı?",
  RISK: "Ufuk boyunca kasanın MON değeri için aşağı yönlü risk nedir?",
  YIELD: "Ufuk boyunca konuşlandırılan fonu artırmanın beklenen fırsatı nedir?",
  SECURITY: "Güvenlik veya operasyonel endişe var mı (oracle eskimesi, güven aralığı genişliği, duraklatılmış kontratlar, ağ sağlığı)?",
  MARKET: "Güncel piyasa bilgisi ufuk boyunca yön hakkında ne söylüyor?",
  HISTORY: "Geçmiş fiyatlar ve önceki kararların sonuçları ne gösteriyor?",
};

export function questionText(category: string, fallback: string): string {
  return QUESTION_TR[category] ?? fallback;
}

/** Turkish descriptions of the rubric factors (factor ids stay as they are). */
export const RUBRIC_TR: Readonly<Record<string, string>> = {
  evidence_strength: "Atıf yapılan girdilerin seçilen çatalı ne kadar güçlü desteklediği",
  evidence_agreement: "Bağımsız girdilerin ne kadar tutarlı biçimde aynı yönü gösterdiği",
  data_completeness: "Dayanılan girdilerin ne kadar eksiksiz ve güncel olduğu",
  downside_magnitude: "Olası olumsuz hareketin banda göre büyüklüğü",
  volatility_regime: "Son gerçekleşen oynaklığın uzun geçmişe göre durumu",
  exposure: "Kasa fonlarının ACTIVE kovasındaki payı",
  upside_magnitude: "Olası olumlu hareketin banda göre büyüklüğü",
  momentum: "Son fiyat değişimlerinin yönü ve sürekliliği",
  capacity: "RESERVE'de konuşlandırılabilecek fon",
  oracle_quality: "Fiyat beslemesinin tazeliği ve güven aralığı",
  network_health: "Monad'da blok üretimi ve gas koşulları",
  protocol_state: "Kontrat erişilebilirliği, duraklatma bayrakları, parametre tutarlılığı",
  price_vs_ema: "Spot fiyatın hareketli ortalamasına göre konumu",
  short_term_change: "En son fiyat değişimi",
  signal_clarity: "Güven aralığı ve bant dikkate alındığında sinyalin gürültüyü aşıp aşmadığı",
  historical_pattern: "Benzer pencerelerde geçmiş fiyat davranışının tutarlılığı",
  past_outcomes: "Önceki sonuçlanmış kararların doğru çatallarının gösterdiği",
  sample_size: "Gerçekte ne kadar geçmiş verinin mevcut olduğu",
};

export function rubricText(factor: string, fallback: string): string {
  return RUBRIC_TR[factor] ?? fallback;
}
