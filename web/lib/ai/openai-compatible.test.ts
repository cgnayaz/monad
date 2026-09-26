import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENTS } from "@/lib/jev/agents";
import { FallbackProvider, OpenAICompatibleProvider } from "./openai-compatible";
import { ProviderError, type DecisionProvider, type EvaluationRequest } from "./provider";

const req = { agent: AGENTS[0], state: { stateId: "st_x", subject: { referenceFeed: "ETH/USD" }, inputs: [] }, questions: [], horizonSec: 60, bandBps: 10 } as unknown as EvaluationRequest;
const cfg = { name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: "k", model: "m1", fallbackModels: [] };
const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("OpenAICompatibleProvider", () => {
  it("posts a JSON-mode chat completion and returns the raw text", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: "m1", choices: [{ message: { content: '{"answers":[]}' }, finish_reason: "stop" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await new OpenAICompatibleProvider(cfg).evaluate(req, signal());
    expect(r).toMatchObject({ provider: "groq", model: "m1", rawText: '{"answers":[]}' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "m1", response_format: { type: "json_object" } });
  });

  it("classifies key, quota and truncation failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(new OpenAICompatibleProvider(cfg).evaluate(req, signal())).rejects.toMatchObject({ kind: "provider_error", message: expect.stringContaining("anahtarını reddetti") });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{" }, finish_reason: "length" }] }))));
    await expect(new OpenAICompatibleProvider(cfg).evaluate(req, signal())).rejects.toMatchObject({ kind: "truncated" });
  });
});

describe("FallbackProvider", () => {
  const failing = (kind: ProviderError["kind"]): DecisionProvider => ({ id: "a", evaluate: async () => { throw new ProviderError(kind, "x"); } });
  const okP: DecisionProvider = { id: "b", evaluate: async () => ({ provider: "b", model: "m", rawText: "{}", latencyMs: 1 }) };

  it("moves on after a provider error", async () => {
    await expect(new FallbackProvider([failing("provider_error"), okP]).evaluate(req, signal())).resolves.toMatchObject({ provider: "b" });
  });

  it("does not retry a timeout or refusal on another provider", async () => {
    await expect(new FallbackProvider([failing("timeout"), okP]).evaluate(req, signal())).rejects.toMatchObject({ kind: "timeout" });
    await expect(new FallbackProvider([failing("refusal"), okP]).evaluate(req, signal())).rejects.toMatchObject({ kind: "refusal" });
  });
});
