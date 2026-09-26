import { describe, expect, it } from "vitest";
import { normalizeEnv, parseServerEnv } from "./server";

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
});
