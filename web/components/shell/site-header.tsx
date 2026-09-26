import Link from "next/link";
import { NavLinks } from "./nav-links";
import { NetworkIndicator } from "./network-indicator";
import { WalletButton } from "./wallet-button";

export function SiteHeader() {
  return (
    <header className="border-b border-rule bg-surface">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-8 px-4 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="text-[15px] font-semibold tracking-tight">DecMarkt</span>
          <span className="hidden font-mono text-[11px] text-ink-3 md:inline">on Monad Testnet</span>
        </Link>
        <NavLinks />
        <div className="ml-auto flex items-center gap-4">
          <NetworkIndicator />
          <WalletButton />
        </div>
      </div>
      <div className="border-t border-rule md:hidden">
        <NavLinks mobile />
      </div>
    </header>
  );
}
