import { describe, expect, it } from "vitest";
import { envDiagnostics, normalizeEnv, parseServerEnv } from "./server";

describe("server environment", () => {
  it("normalises values pasted into a dashboard", () => {
    const e = normalizeEnv({ AI_PROVIDER: " Gemini ", GEMINI_API_KEY: '"AIzaKEY"', PYTH_API_KEY: "  ", X: undefined });
    expect(e).toEqual({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "AIzaKEY" });
  });

  it("accepts GOOGLE_API_KEY as the Gemini key", () => {
    expect(parseServerEnv({ GOOGLE_API_KEY: "AIzaKEY" }).env.GEMINI_API_KEY).toBe("AIzaKEY");
    expect(parseServerEnv({ GOOGLE_API_KEY: "a", GEMINI_API_KEY: "b" }).env.GEMINI_API_KEY).toBe("b");
  });

  it("drops a malformed variable instead of failing everything", () => {
    const r = parseServerEnv({ GEMINI_API_KEY: "AIzaKEY", KEEPER_PRIVATE_KEY: "not-hex", PYTH_HERMES_URL: "nope" });
    expect(r.env.GEMINI_API_KEY).toBe("AIzaKEY");
    expect(r.env.KEEPER_PRIVATE_KEY).toBeUndefined();
    expect(r.env.PYTH_HERMES_URL).toBe("https://pyth.dourolabs.app/hermes");
    expect(r.invalid.sort()).toEqual(["KEEPER_PRIVATE_KEY", "PYTH_HERMES_URL"]);
  });

  it("matches key names loosely and accepts the common Gemini aliases", () => {
    expect(parseServerEnv({ "gemini_api_key ": "k1" }).env.GEMINI_API_KEY).toBe("k1");
    expect(parseServerEnv({ GOOGLE_GENERATIVE_AI_API_KEY: "k2" }).env.GEMINI_API_KEY).toBe("k2");
    expect(parseServerEnv({ GEMINI_API_KEY: "k3", GOOGLE_API_KEY: "k4" }).env.GEMINI_API_KEY).toBe("k3");
    expect(parseServerEnv({ HERMES_API_KEY: "p1" }).env.PYTH_API_KEY).toBe("p1");
    expect(parseServerEnv({ "pyth api key": "p2" }).env.PYTH_API_KEY).toBe("p2");
  });

  it("reports deployment and unrecognised similar names without values", () => {
    const d = envDiagnostics({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "152c8f38d8", GEMINI_TOKEN: "secret" });
    expect(d).toEqual({ deployment: "production", commit: "152c8f3", geminiKeyName: null, pythKeyName: null, similarNames: ["GEMINI_TOKEN"] });
    expect(JSON.stringify(d)).not.toContain("secret");
  });
});
