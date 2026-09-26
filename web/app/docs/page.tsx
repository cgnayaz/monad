import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/layout";
import { DOCS } from "@/lib/docs";

export const metadata: Metadata = { title: "Belgeler" };

export default function DocsIndexPage() {
  return (
    <>
      <PageHeader
        eyebrow="Belgeler"
        title="Teknik belgeler"
        lead="Uygulamayı tanımlayan belgelerin kendisi. Kod ile belge çeliştiğinde belge de değişiklikle birlikte güncellenir. (Belgeler İngilizcedir.)"
      />
      <ol className="border border-rule bg-surface">
        {DOCS.map((d, i) => (
          <li key={d.slug} className="border-b border-rule last:border-b-0">
            <Link href={`/docs/${d.slug}`} className="grid grid-cols-[40px_1fr] gap-x-4 px-4 py-4 hover:bg-surface-2 md:grid-cols-[40px_260px_1fr]">
              <span className="font-mono text-[12px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-medium">{d.title}</span>
              <span className="col-start-2 text-ink-2 md:col-start-auto">{d.summary}</span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
