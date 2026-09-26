"use client";

import "./globals.css";

/** Last-resort boundary when the root layout itself fails; it replaces the layout, so it renders its own document. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center px-4">
        <div className="max-w-md">
          <p className="label">DecMarkt</p>
          <h1 className="mt-2 text-[22px] font-medium">Something went wrong</h1>
          <p className="mt-2 text-[14px] text-ink-2">The application failed to load. No transaction was sent. Please try again in a moment.</p>
          <div className="mt-5 flex items-center gap-3">
            <button onClick={() => retry()} className="border border-rule bg-surface px-3 py-1.5 text-[13px]">
              Try again
            </button>
            {error.digest && <span className="font-mono text-[12px] text-ink-3">ref {error.digest}</span>}
          </div>
        </div>
      </body>
    </html>
  );
}
