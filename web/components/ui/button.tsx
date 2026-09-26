import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary";

const styles: Record<Variant, string> = {
  primary: "bg-ink text-bg border-ink hover:bg-ink-2 hover:border-ink-2 disabled:bg-ink-3 disabled:border-ink-3",
  secondary: "bg-transparent text-ink border-rule hover:border-ink disabled:text-ink-3 disabled:hover:border-rule",
};
const base = "inline-flex h-9 items-center justify-center gap-2 rounded-xs border px-4 text-[13px] font-medium transition-colors disabled:cursor-not-allowed";

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${base} ${styles[variant]} ${className}`} {...rest} />;
}

export function LinkButton({ href, variant = "secondary", children }: { href: string; variant?: Variant; children: ReactNode }) {
  return (
    <Link href={href} className={`${base} ${styles[variant]}`}>
      {children}
    </Link>
  );
}
