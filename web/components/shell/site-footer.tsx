import Link from "next/link";
import { MONAD_TESTNET, REPO_URL } from "@/lib/config/public";

export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-[12px] text-ink-2 sm:px-6">
        <span>DecMarkt — zincir üstünde hesap verebilir AI kararları.</span>
        <span className="font-mono">zincir {MONAD_TESTNET.id}</span>
        <div className="ml-auto flex gap-5">
          <Link href="/kurulum" className="hover:text-ink">Kurulum</Link>
          <Link href="/docs" className="hover:text-ink">Belgeler</Link>
          <a href={REPO_URL} className="hover:text-ink" target="_blank" rel="noreferrer">Kaynak kod</a>
          <a href={MONAD_TESTNET.explorerUrl} className="hover:text-ink" target="_blank" rel="noreferrer">Gezgin</a>
        </div>
      </div>
    </footer>
  );
}
