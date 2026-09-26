"use client";

import { useState } from "react";
import { shortHex } from "@/lib/format";

/** Hash / address display: 6+4 with full value on hover, click to copy, optional explorer link. */
export function Hash({ value, href, full = false }: { value: string; href?: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  // Full values only where there is room; the complete value is always in the title and copy.
  const text = full ? (
    <>
      <span className="hidden md:inline">{value}</span>
      <span className="md:hidden">{shortHex(value, 10, 8)}</span>
    </>
  ) : (
    shortHex(value)
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable; the full value remains visible on hover */
    }
  };
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[12.5px]">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={value} className="break-all underline decoration-rule underline-offset-2 hover:decoration-ink">
          {text}
        </a>
      ) : (
        <span title={value} className="break-all">
          {text}
        </span>
      )}
      <button type="button" onClick={copy} className="text-[11px] text-ink-3 hover:text-ink" aria-label={`Kopyala: ${value}`}>
        {copied ? "kopyalandı" : "kopyala"}
      </button>
    </span>
  );
}
