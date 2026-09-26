import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";
import { contractAddress } from "@/lib/chain/deployments";
import { toWireJson } from "@/lib/engine/wire";
import type { AgentRun } from "@/lib/model/decision";
import type { DecisionId } from "@/lib/model/primitives";
import type { QuestionSet } from "@/lib/model/question";
import type { StateRecord } from "@/lib/model/state";
import type { Hex } from "@/lib/types/protocol";

/**
 * Off-chain payloads (DATA_MODEL.md §4): the full state, the question set and every
 * agent's run with reasons. Keys are content hashes or on-chain ids, so a payload can only
 * be trusted after its hash is recomputed and matches the chain — callers do that
 * (lib/data/payloads.ts); this module only stores bytes.
 *
 * Backends: Vercel Blob when BLOB_READ_WRITE_TOKEN is set; the local filesystem
 * (web/.data/payloads) in development; otherwise unavailable.
 */

interface Backend {
  readonly kind: "vercel-blob" | "filesystem";
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
}

class BlobBackend implements Backend {
  readonly kind = "vercel-blob" as const;
  constructor(private readonly token: string) {}
  async put(key: string, body: string) {
    await put(key, body, { access: "public", token: this.token, contentType: "application/json", addRandomSuffix: false, allowOverwrite: true });
  }
  async get(key: string) {
    const r = await get(key, { access: "public", token: this.token });
    return r ? new Response(r.stream).text() : null;
  }
}

class FsBackend implements Backend {
  readonly kind = "filesystem" as const;
  private readonly root = path.join(process.cwd(), ".data", "payloads");
  async put(key: string, body: string) {
    const file = path.join(this.root, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, "utf8");
  }
  async get(key: string) {
    try {
      return await readFile(path.join(this.root, key), "utf8");
    } catch {
      return null;
    }
  }
}

export class PayloadStore {
  constructor(private readonly backend: Backend) {}

  get kind() {
    return this.backend.kind;
  }

  putState(state: StateRecord) {
    return this.backend.put(`states/${state.hash}.json`, toWireJson(state));
  }
  putQuestions(set: QuestionSet) {
    return this.backend.put(`questions/${set.hash}.json`, toWireJson(set));
  }
  /** Runs are keyed by registry address too: decision ids restart at 1 on a new deployment. */
  putRun(run: AgentRun) {
    return this.backend.put(`runs/${registryKey()}/${run.decisionId}/${run.agentId}.json`, toWireJson(run));
  }

  async getState(hash: Hex): Promise<unknown | null> {
    return parse(await this.backend.get(`states/${hash}.json`));
  }
  async getQuestions(hash: Hex): Promise<unknown | null> {
    return parse(await this.backend.get(`questions/${hash}.json`));
  }
  async getRun(decisionId: DecisionId, agentId: number): Promise<unknown | null> {
    return parse(await this.backend.get(`runs/${registryKey()}/${decisionId}/${agentId}.json`));
  }
}

function registryKey(): string {
  return (contractAddress("DecisionRegistry") ?? "undeployed").toLowerCase();
}

function parse(text: string | null): unknown | null {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function payloadStore(): { store: PayloadStore } | { store: null; reason: string } {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return { store: new PayloadStore(new BlobBackend(token)) };
  if (process.env.NODE_ENV !== "production") return { store: new PayloadStore(new FsBackend()) };
  return { store: null, reason: "Payload store not configured (BLOB_READ_WRITE_TOKEN)" };
}
