import { beforeEach, describe, expect, it, vi } from "vitest";

// The SDK is replaced by a scripted client; everything else (errors, enums) is the real SDK.
const script = vi.hoisted(() => ({ calls: [] as string[], responses: [] as ((model: string) => unknown)[] }));
vi.mock("@google/genai", async (orig) => {
  const real = await orig<typeof import("@google/genai")>();
  class GoogleGenAI {
    models = {
      generateContent: async ({ model }: { model: string }) => {
        script.calls.push(model);
        const next = script.responses.shift();
        if (!next) throw new Error("no scripted response");
        return next(model);
      },
    };
  }
  return { ...real, GoogleGenAI };
});

import { ApiError, FinishReason } from "@google/genai";
import { AGENTS } from "@/lib/jev/agents";
import { GeminiProvider, supportsThinkingLevel } from "./gemini";
import type { EvaluationRequest } from "./provider";

const req = { agent: AGENTS[0], state: { stateId: "st_x", subject: { referenceFeed: "ETH/USD" }, inputs: [] }, questions: [], horizonSec: 60, bandBps: 10 } as unknown as EvaluationRequest;
const okText = (model: string) => ({ text: '{"answers":[]}', modelVersion: model, candidates: [{ finishReason: FinishReason.STOP }] });
const overloaded = () => {
  throw new ApiError({ message: "high demand", status: 503 });
};

describe("GeminiProvider", () => {
  beforeEach(() => {
    script.calls = [];
    script.responses = [];
  });

  it("returns the raw text and the model that answered", async () => {
    script.responses.push(okText);
    const r = await new GeminiProvider("k", "m1", ["m2"]).evaluate(req, new AbortController().signal);
    expect(r).toMatchObject({ provider: "gemini", model: "m1", rawText: '{"answers":[]}' });
  });

  it("falls back to the next model when the primary is overloaded", async () => {
    script.responses.push(overloaded, okText);
    const r = await new GeminiProvider("k", "m1", ["m2"]).evaluate(req, new AbortController().signal);
    expect(script.calls).toEqual(["m1", "m2"]);
    expect(r.model).toBe("m2");
  });

  it("gives up with a classified error after two passes", async () => {
    script.responses.push(overloaded, overloaded, overloaded, overloaded);
    await expect(new GeminiProvider("k", "m1", ["m2"]).evaluate(req, new AbortController().signal)).rejects.toMatchObject({
      kind: "provider_error",
      message: "Sağlayıcı kullanılamıyor (HTTP 503)",
    });
    expect(script.calls).toEqual(["m1", "m2", "m1", "m2"]);
  });

  it("does not retry non-transient errors", async () => {
    script.responses.push(() => {
      throw new ApiError({ message: "API key not valid", status: 400 });
    });
    await expect(new GeminiProvider("k", "m1", ["m2"]).evaluate(req, new AbortController().signal)).rejects.toMatchObject({ message: expect.stringContaining("API anahtarını reddetti") });
    expect(script.calls).toEqual(["m1"]);
  });

  it("classifies truncation and safety stops", async () => {
    script.responses.push(() => ({ text: "{", modelVersion: "m1", candidates: [{ finishReason: FinishReason.MAX_TOKENS }] }));
    await expect(new GeminiProvider("k", "m1", []).evaluate(req, new AbortController().signal)).rejects.toMatchObject({ kind: "truncated" });
    script.responses.push(() => ({ text: "", modelVersion: "m1", candidates: [{ finishReason: FinishReason.SAFETY }] }));
    await expect(new GeminiProvider("k", "m1", []).evaluate(req, new AbortController().signal)).rejects.toMatchObject({ kind: "refusal" });
  });

  it("sends thinkingLevel only to models that accept it", () => {
    expect(supportsThinkingLevel("gemini-3.8-flash")).toBe(true);
    expect(supportsThinkingLevel("models/gemini-3.7-flash")).toBe(true);
    expect(supportsThinkingLevel("gemini-2.5-flash")).toBe(false);
  });

  it("explains depleted prepay credits (HTTP 402) without retrying", async () => {
    script.responses.push(() => {
      throw new ApiError({ message: "Your prepayment credits are depleted", status: 402 });
    });
    await expect(new GeminiProvider("k", "m1", ["m2"]).evaluate(req, new AbortController().signal)).rejects.toMatchObject({ message: expect.stringContaining("kredisi bitti") });
    expect(script.calls).toEqual(["m1"]);
  });
});
