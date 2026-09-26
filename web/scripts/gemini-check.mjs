// Gemini bağlantı testi: anahtarı doğrular, erişilebilir Flash modellerini listeler ve
// yapılandırılan modelle tek bir küçük JSON çağrısı yapar. Anahtar değeri asla yazdırılmaz.
//
//   cd web && npm run gemini:check        (.env.local okunur)
//
// Çıkış kodu: 0 = çağrı başarılı, 1 = yapılandırma veya API hatası.
import { GoogleGenAI } from "@google/genai";

const clean = (v) => (v ?? "").trim().replace(/^(["'])(.*)\1$/s, "$2").trim();
const key = clean(process.env.GEMINI_API_KEY) || clean(process.env.GOOGLE_API_KEY);
const model = clean(process.env.AI_MODEL) || "gemini-3.8-flash";
const fallback = (clean(process.env.AI_FALLBACK_MODEL) || "gemini-3.7-flash,gemini-3.6-flash").split(",").map((m) => m.trim()).filter(Boolean);

if (!key) {
  console.error("✗ GEMINI_API_KEY (veya GOOGLE_API_KEY) tanımlı değil. web/.env.local dosyasına ekleyin: https://aistudio.google.com/apikey");
  process.exit(1);
}
const provider = clean(process.env.AI_PROVIDER).toLowerCase();
if (provider && provider !== "gemini") console.warn(`! AI_PROVIDER=${provider}: uygulama Gemini yerine bu sağlayıcıyı kullanır.`);

const ai = new GoogleGenAI({ apiKey: key });

/** First line of the API error, with the JSON envelope unwrapped and any key redacted. */
function describe(err) {
  let msg = String(err?.message ?? err).split("\n")[0];
  try {
    msg = JSON.parse(msg).error?.message ?? msg;
  } catch {
    /* not JSON */
  }
  return msg.replace(/AIza[0-9A-Za-z_-]{30,}/g, "[redacted]");
}

try {
  const names = [];
  for await (const m of await ai.models.list({ config: { pageSize: 100 } })) names.push(m.name?.replace(/^models\//, ""));
  console.log(`✓ Anahtar geçerli; ${names.length} model erişilebilir.`);
  for (const m of [model, ...fallback]) console.log(`  ${names.includes(m) ? "✓" : "✗"} ${m}${m === model ? " (birincil)" : " (yedek)"}`);
  if (!names.includes(model)) console.warn(`! ${model} listede yok. Kullanılabilir Flash modelleri: ${names.filter((n) => /flash/.test(n ?? "")).join(", ")}`);
} catch (err) {
  console.error(`✗ Model listesi alınamadı: HTTP ${err?.status ?? "?"} — ${describe(err)}`);
  process.exit(1);
}

const started = Date.now();
try {
  const res = await ai.models.generateContent({
    model,
    contents: 'Yalnızca şu JSON\'u döndür: {"ok": true}',
    config: { responseMimeType: "application/json", maxOutputTokens: 256 },
  });
  console.log(`✓ ${res.modelVersion ?? model} yanıt verdi (${Date.now() - started} ms): ${(res.text ?? "").trim()}`);
} catch (err) {
  console.error(`✗ ${model} çağrısı başarısız: HTTP ${err?.status ?? "?"} — ${describe(err)}`);
  process.exit(1);
}
