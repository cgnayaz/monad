import { describe, expect, it } from "vitest";
import { publicError } from "./public-error";

describe("publicError", () => {
  it("keeps only the first line", () => {
    expect(publicError(new Error('The contract function "aggregate" reverted.\n\nRequest Arguments:\n  from: 0x…'), "x")).toBe('The contract function "aggregate" reverted.');
  });

  it("redacts secrets", () => {
    const pk = "0x" + "ab".repeat(32);
    const msg = publicError(new Error(`failed sk-ant-api03-abcDEF_123 AIzaSyA1234567890abcdefghijklmnopqrstu key ${pk} Bearer abc.def https://h/x?apikey=zzz&a=1`), "x");
    expect(msg).not.toMatch(/sk-ant-api03|AIzaSy|abababab|abc\.def|zzz/);
    expect(msg).toContain("?apikey=[redacted]&a=1");
  });

  it("falls back for empty or non-error values", () => {
    expect(publicError(undefined, "Step failed")).toBe("Step failed");
    expect(publicError(new Error(""), "Step failed")).toBe("Step failed");
  });

  it("bounds the length", () => {
    expect(publicError(new Error("a".repeat(1000)), "x").length).toBe(238);
  });
});
