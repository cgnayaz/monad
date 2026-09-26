import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, lead, aside }: { eyebrow?: string; title: string; lead?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="mb-10 flex flex-col gap-6 border-b border-rule pb-8 md:flex-row md:items-end md:justify-between">
      <div className="max-w-[68ch]">
        {eyebrow && <p className="label mb-3">{eyebrow}</p>}
        <h1 className="text-[32px] font-medium leading-10 tracking-[-0.01em]">{title}</h1>
        {lead && <p className="mt-3 text-[15px] leading-6 text-ink-2">{lead}</p>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </header>
  );
}

export function Section({
  id,
  index,
  title,
  description,
  children,
  aside,
}: {
  id?: string;
  index?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section id={id} className="mb-14 scroll-mt-20">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {index && <span className="font-mono text-[12px] text-ink-3">{index}</span>}
        <h2 className="text-[20px] font-medium leading-7">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {description && <div className="mb-5 max-w-[72ch] text-ink-2">{description}</div>}
      {children}
    </section>
  );
}

export function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`border border-rule bg-surface ${className}`}>
      {title && <div className="border-b border-rule px-4 py-2.5 text-[13px] font-semibold">{title}</div>}
      {children}
    </div>
  );
}

export function KeyValue({ rows }: { rows: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-rule">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(120px,40%)_1fr] gap-4 px-4 py-2.5">
          <dt className="label self-center">{r.k}</dt>
          <dd className="min-w-0 break-words">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}
