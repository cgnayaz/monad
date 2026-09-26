"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const EXAMPLES = ["DecMarkt hangi sorunu çözüyor?", "Ajanlar neden teminat koyuyor?", "Yanlış karar veren ajana ne olur?", "Simülasyon ile canlı mod farkı ne?"];

/** Visitors ask questions about the system; answered server-side by Gemini from the project's facts. */
export function AskPanel() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ q: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (question: string) => {
    const text = question.trim();
    if (text.length < 3 || busy) return;
    setQ(text);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
      const body = (await res.json().catch(() => null)) as { answer?: string; error?: string } | null;
      if (!res.ok || !body?.answer) throw new Error(res.status === 429 ? "Çok fazla soru soruldu, biraz bekleyin." : (body?.error ?? "Şu an yanıt verilemiyor."));
      setAnswer({ q: text, text: body.answer });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-rule bg-surface">
      <form
        className="flex flex-col gap-2 border-b border-rule px-4 py-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={500}
          placeholder="DecMarkt hakkında bir soru yazın…"
          aria-label="Sorunuz"
          className="h-9 min-w-0 flex-1 rounded-xs border border-rule bg-bg px-3 text-[13.5px] outline-none focus:border-ink"
        />
        <Button type="submit" disabled={busy || q.trim().length < 3}>
          {busy ? "Yanıtlanıyor…" : "Sor"}
        </Button>
      </form>
      <div className="flex flex-wrap gap-2 px-4 py-2.5">
        {EXAMPLES.map((e) => (
          <button key={e} type="button" disabled={busy} onClick={() => void ask(e)} className="rounded-xs border border-rule px-2.5 py-1 text-[12px] text-ink-2 hover:border-ink hover:text-ink disabled:opacity-50">
            {e}
          </button>
        ))}
      </div>
      {(answer || error || busy) && (
        <div className="border-t border-rule px-4 py-3 text-[13.5px] leading-[21px]" aria-live="polite">
          {busy && <p className="dm-pending text-ink-3">Gemini yanıtlıyor…</p>}
          {!busy && error && <p className="text-fail">{error}</p>}
          {!busy && !error && answer && (
            <>
              <p className="label mb-1">{answer.q}</p>
              <p className="whitespace-pre-line">{answer.text}</p>
              <p className="mt-2 text-[11.5px] text-ink-3">Yanıt Gemini tarafından projenin belgelerine dayanarak üretildi; protokolün kararlarını etkilemez.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
