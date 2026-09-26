"use client";

import { Button, LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";

/**
 * Route error boundary. In production Next.js replaces server error messages with a generic
 * one and a digest, so nothing internal reaches the browser; the digest matches the server
 * log entry for the same failure.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <PageHeader
        eyebrow="Hata"
        title="Bu sayfa yüklenemedi"
        lead="Monad Testnet ya da bir iç servisten okuma başarısız oldu. Zincir üstü veri hiçbir zaman tahminle değiştirilmez; bu yüzden sayfa burada durdu. RPC yeniden yanıt verdiğinde tekrar denemek genellikle işe yarar."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => retry()}>Tekrar dene</Button>
        <LinkButton href="/">Ana sayfaya dön</LinkButton>
        {error.digest && <span className="font-mono text-[12px] text-ink-3">ref {error.digest}</span>}
      </div>
    </>
  );
}
