import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Technical documentation lives at the repository root (single source of truth).
 * Pages are statically generated, so files are read at build time only.
 */

export const DOCS = [
  { slug: "architecture", file: "ARCHITECTURE.md", title: "Architecture", summary: "Layers, pipeline, runtime topology, verified facts." },
  { slug: "jev-integration", file: "JEV_INTEGRATION.md", title: "Jev integration", summary: "How each Jev concept maps to code and chain." },
  { slug: "data-model", file: "DATA_MODEL.md", title: "Data model", summary: "On-chain structs, off-chain payloads, value provenance." },
  { slug: "contract-spec", file: "CONTRACT_SPEC.md", title: "Contract specification", summary: "Roles, lifecycle, aggregation, settlement, events." },
  { slug: "security-model", file: "SECURITY_MODEL.md", title: "Security model", summary: "Threats, mitigations, explicit trust assumptions." },
  { slug: "design-system", file: "DESIGN_SYSTEM.md", title: "Design system", summary: "Typography, colour, components, voice." },
  { slug: "demo-flow", file: "DEMO_FLOW.md", title: "Demo flow", summary: "Judge script and failure handling." },
  { slug: "deployment", file: "DEPLOYMENT.md", title: "Deployment", summary: "Network facts, keys, contracts, Vercel." },
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
