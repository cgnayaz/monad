import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DOCS, readDoc, rewriteDocHref } from "@/lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata(props: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  return { title: DOCS.find((d) => d.slug === slug)?.title ?? "Documentation" };
}

export default async function DocPage(props: PageProps<"/docs/[slug]">) {
  const { slug } = await props.params;
  const doc = await readDoc(slug);
  if (!doc) notFound();

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="Documents" className="text-[13px] lg:sticky lg:top-8 lg:self-start">
        <p className="label mb-3">Documents</p>
        <ul className="space-y-1.5">
          {DOCS.map((d) => (
            <li key={d.slug}>
              <Link
                href={`/docs/${d.slug}`}
                aria-current={d.slug === slug ? "page" : undefined}
                className={d.slug === slug ? "text-ink" : "text-ink-2 hover:text-ink"}
              >
                {d.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <article className="prose-doc min-w-0">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              const to = rewriteDocHref(href);
              const external = to?.startsWith("http");
              return (
                <a href={to} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
                  {children}
                </a>
              );
            },
          }}
        >
          {doc.markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}
