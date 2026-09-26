"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/demo", label: "Demo" },
  { href: "/decisions", label: "Kararlar" },
  { href: "/agents", label: "Ajanlar" },
  { href: "/contracts", label: "Kontratlar" },
  { href: "/how-it-works", label: "Nasıl çalışır" },
  { href: "/docs", label: "Belgeler" },
] as const;

export function NavLinks({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Ana menü"
      className={
        mobile
          ? "flex gap-5 overflow-x-auto px-4 py-2 text-[13px] [scrollbar-width:none]"
          : "hidden items-center gap-6 text-[13px] md:flex"
      }
    >
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b py-1 transition-colors ${
              active ? "border-ink text-ink" : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
