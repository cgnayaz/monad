import Link from "next/link";
import { MONAD_TESTNET, REPO_URL } from "@/lib/config/public";

export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-[12px] text-ink-2 sm:px-6">
        <span>DecMarkt — AI decisions with on-chain accountability.</span>
        <span className="font-mono">chain {MONAD_TESTNET.id}</span>
        <div className="ml-auto flex gap-5">
          <Link href="/docs" className="hover:text-ink">Documentation</Link>
          <a href={REPO_URL} className="hover:text-ink" target="_blank" rel="noreferrer">Source</a>
          <a href={MONAD_TESTNET.explorerUrl} className="hover:text-ink" target="_blank" rel="noreferrer">Explorer</a>
        </div>
      </div>
    </footer>
  );
}
