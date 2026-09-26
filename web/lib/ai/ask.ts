import "server-only";
import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { publicError } from "@/lib/server/public-error";
import { supportsThinkingLevel } from "./gemini";
import { AGENTS } from "@/lib/jev/agents";
import { AGENT_TR } from "@/lib/i18n";
import { DEFAULT_PARAMS, ROUND_TIMING } from "@/lib/decmarkt/params";
import { providerConfig } from "./index";

/**
 * "Soru sor": answers visitors' questions about DecMarkt in Turkish. The model only explains
 * the system from the facts below; it has no tools, keys or chain access, and its answer is
 * never used by the protocol.
 */
const FACTS = `
DecMarkt, yapay zekâ kararlarını zincir üstünde hesap verebilir kılan bir protokoldür. Katmanlar: Jev kararı yapılandırır → DecMarkt hesap verebilirlik ekler (teminat, eşik, ödül/ceza) → Monad Testnet yürütür ve kaydeder.
Çözdüğü sorun: AI ajanları parayı etkileyen kararlar veriyor ama yanıldıklarında bedel ödemiyor ve kararın neye dayandığı sonradan doğrulanamıyor.
Bir tur: (1) Durum: Pyth ETH/USD fiyatı, Monad ağ verisi ve kasa bakiyeleri toplanır, kanonik JSON'a çevrilir ve hash'lenir. (2) Sorular: durumdan 6 açık soru üretilir (Q0 eylem sorusu + risk, getiri, güvenlik, piyasa, geçmiş). (3) Beş bağımsız AI analisti (Gemini) aynı durumu paralel değerlendirir; hiçbiri diğerini görmez: ${AGENTS.map((a) => `${AGENT_TR[a.key]?.name ?? a.name} (${AGENT_TR[a.key]?.mandate ?? a.mandate})`).join("; ")}. (4) Her ajan bir seçim, rubrik puanlarından hesaplanan bir skor (0–10000), bir olasılık (%1–99) ve kısa bir gerekçe verir. (5) Seçenekler sınırlıdır (bounded forks): NO_ACTION (bekle), DERISK (fonun bir kısmını ACTIVE'den RESERVE'e al), DEPLOY (RESERVE'den ACTIVE'e al), ESCALATE (insana/guardian'a sor). AI asla adres, miktar, calldata veya anahtar üretmez. (6) Toplama: her ajanın oyu olasılık × zincir üstü geçmiş isabetiyle ağırlıklandırılır; yeter sayı ${DEFAULT_PARAMS.quorum}/5, kazanan pay en az %${DEFAULT_PARAMS.thresholdBps / 100}, eylemler için asgari skor ${DEFAULT_PARAMS.minActionScore}. Bir kapı başarısız olursa güvenli varsayılan NO_ACTION'dır. (7) Onaylanan tek eylemi ExecutionVault yürütür. (8) Doğrulama: ${ROUND_TIMING.horizonSec} saniyelik ufuk sonunda imzalı Pyth fiyatı ölçülür; ±${DEFAULT_PARAMS.bandBps} baz puandan fazla düşüş DERISK'i, yükseliş DEPLOY'u, aradaki hareket NO_ACTION'ı doğru yapar. (9) Uzlaşma: her ajan tur başına ${Number(DEFAULT_PARAMS.lockPerAgent) / 1e18} MON teminat kilitler; doğru bilen ceza havuzundan ve tur ödülünden olasılığına göre pay alır, yanılan teminat × %${DEFAULT_PARAMS.slashBps / 100} × olasılık ceza öder, karar göndermeyen %${DEFAULT_PARAMS.missPenaltyBps / 100} ceza öder, ESCALATE nötrdür. Kurallar OutcomeRegistry kontratında sabittir; hiçbir model ödül/cezaya karar vermez.
Kontratlar (Monad Testnet, chain 10143): DecisionRegistry, DecisionEngine, ExecutionVault, OutcomeRegistry. Zincirde tamamlanmış gerçek bir tur var: karar #1 (/decisions/1).
Modlar: Simülasyon modu gerçek veri ve gerçek AI ajanlarıyla çalışır ama zincire işlem göndermez; Canlı mod her adımı Monad Testnet işlemi olarak yapar ve operatör girişi gerektirir.
Güvenlik: anahtarlar yalnızca sunucuda; AI çıktısı katı bir şemayla doğrulanır; teminat, eşik ve uzlaşma kuralları kontratta. Bilinen sınırlar: yalnızca testnet, tek sunucu tüm ajan anahtarlarını tutar (güvenilen röle), ajanlar birbirinin gönderimini son tarihten önce görebilir (commit-reveal henüz yok), dış denetim yapılmadı.
Sitenin sayfaları: Demo (tur çalıştırma), Kararlar, Ajanlar, Kontratlar, Nasıl çalışır, Belgeler.
`.trim();

const SYSTEM = [
  "Sen DecMarkt projesinin tanıtım asistanısın. Ziyaretçilerin (ör. hackathon jürisi) sorularını Türkçe, kısa ve anlaşılır yanıtla.",
  "Yalnızca aşağıdaki bilgilere dayan. Bilmediğin bir şey sorulursa bunu açıkça söyle; rakam, performans veya başarı iddiası uydurma.",
  "Yanıtın en fazla 6–8 cümle olsun; gerekirse kısa madde işaretleri kullan. Teknik terimleri bir cümleyle açıkla.",
  "Proje dışı sorulara kibarca yalnızca DecMarkt hakkında yardımcı olabildiğini söyle.",
  "",
  "Bilgiler:",
  FACTS,
].join("\n");

export class AskError extends Error {}

export async function askDecMarkt(question: string, signal: AbortSignal): Promise<{ answer: string; model: string }> {
  const c = providerConfig();
  if (c.provider !== "gemini" || !c.key) throw new AskError("Soru-cevap için Gemini yapılandırılmamış (GEMINI_API_KEY).");
  const ai = new GoogleGenAI({ apiKey: c.key });
  let last: unknown;
  for (const model of [c.model, ...c.fallback.filter((m) => m !== c.model)]) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: question }] }],
        config: {
          systemInstruction: SYSTEM,
          // Same settings as the agents: low thinking, and room for thinking plus the answer.
          ...(supportsThinkingLevel(model) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
          maxOutputTokens: 16_000,
          abortSignal: signal,
        },
      });
      const answer = (res.text ?? "").trim();
      if (!answer) {
        const why = res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason ?? "boş yanıt";
        throw new AskError(why === FinishReason.MAX_TOKENS ? "Yanıt çok uzun sürdü, soruyu kısaltıp tekrar deneyin." : `Model yanıt vermedi (${why}).`);
      }
      return { answer, model: res.modelVersion ?? model };
    } catch (err) {
      last = err;
      console.error(`ask: ${model} failed:`, publicError(err, "unknown"));
      // Try the next model on anything but a rejected key or a bad request.
      if (err instanceof AskError || (err instanceof ApiError && [400, 401, 402, 403].includes(err.status)) || signal.aborted) break;
    }
  }
  if (last instanceof AskError) throw last;
  if (signal.aborted) throw new AskError("Yanıt zamanında gelmedi, tekrar deneyin.");
  if (last instanceof ApiError && last.status === 402) throw new AskError("Gemini hesabının ön ödemeli kredisi bitti. AI Studio'dan kredi yükleyin ya da yeni bir projede yeni anahtar oluşturup Vercel'deki GEMINI_API_KEY'i güncelleyin.");
  if (last instanceof ApiError && last.status === 429) throw new AskError("Gemini kotası doldu, birazdan tekrar deneyin.");
  if (last instanceof ApiError && (last.status === 400 || last.status === 401 || last.status === 403)) throw new AskError("Gemini anahtarı reddedildi.");
  const status = last instanceof ApiError ? `HTTP ${last.status}: ` : "";
  throw new AskError(`Şu an yanıt verilemiyor (${status}${publicError(last, "bilinmeyen hata")}). Tekrar deneyin.`);
}
