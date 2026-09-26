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
        eyebrow="Error"
        title="This page could not be loaded"
        lead="A read from Monad Testnet or an internal service failed. On-chain data is never replaced with estimates, so the page stops here instead. Retrying usually works once the RPC responds again."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <LinkButton href="/">Back to dashboard</LinkButton>
        {error.digest && <span className="font-mono text-[12px] text-ink-3">ref {error.digest}</span>}
      </div>
    </>
  );
}
