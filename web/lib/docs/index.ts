import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Technical documentation lives at the repository root (single source of truth).
 * Pages are statically generated, so files are read at build time only.
 */

export const DOCS = [
  { slug: "architecture", file: "ARCHITECTURE.md", title: "Mimari", summary: "Katmanlar, pipeline, çalışma topolojisi, doğrulanmış bilgiler." },
  { slug: "jev-integration", file: "JEV_INTEGRATION.md", title: "Jev entegrasyonu", summary: "Her Jev kavramının koda ve zincire nasıl eşlendiği." },
  { slug: "data-model", file: "DATA_MODEL.md", title: "Veri modeli", summary: "Zincir üstü yapılar, zincir dışı veri yükleri, değerlerin kökeni." },
  { slug: "contract-spec", file: "CONTRACT_SPEC.md", title: "Kontrat spesifikasyonu", summary: "Roller, yaşam döngüsü, toplama, uzlaşma, olaylar." },
  { slug: "security-model", file: "SECURITY_MODEL.md", title: "Güvenlik modeli", summary: "Tehditler, önlemler, açık güven varsayımları." },
  { slug: "design-system", file: "DESIGN_SYSTEM.md", title: "Tasarım sistemi", summary: "Tipografi, renk, bileşenler, dil." },
  { slug: "demo-flow", file: "DEMO_FLOW.md", title: "Demo akışı", summary: "Jüri senaryosu ve hata yönetimi." },
  { slug: "deployment", file: "DEPLOYMENT.md", title: "Dağıtım", summary: "Ağ bilgileri, anahtarlar, kontratlar, Vercel." },
] as const;

export type DocSlug = (typeof DOCS)[number]["slug"];

const ROOT = path.resolve(process.cwd(), "..");

export async function readDoc(slug: string): Promise<{ title: string; markdown: string } | null> {
  const doc = DOCS.find((d) => d.slug === slug);
  if (!doc) return null;
  const markdown = await readFile(path.join(ROOT, doc.file), "utf8");
  return { title: doc.title, markdown };
}

/** Map links between root documents (e.g. `CONTRACT_SPEC.md#x`) to /docs routes. */
export function rewriteDocHref(href: string | undefined): string | undefined {
  if (!href) return href;
  const m = href.match(/^([A-Z_]+\.md)(#.*)?$/);
  if (!m) return href;
  const doc = DOCS.find((d) => d.file === m[1]);
  return doc ? `/docs/${doc.slug}${m[2] ?? ""}` : href;
}
