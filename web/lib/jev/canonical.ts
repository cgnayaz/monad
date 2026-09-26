import canonicalize from "canonicalize";
import { keccak256, stringToHex } from "viem";
import type { Hex } from "@/lib/types/protocol";

/** RFC 8785 (JCS) canonical JSON. The exact bytes that are hashed. */
export function canonicalJson(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new Error("Value cannot be canonicalized");
  return out;
}

/** keccak256 over the UTF-8 bytes of the canonical JSON. */
export function hashCanonical(value: unknown): Hex {
  return keccak256(stringToHex(canonicalJson(value)));
}

/** keccak256 over the UTF-8 bytes of a text (used for reasons). */
export function hashText(text: string): Hex {
  return keccak256(stringToHex(text));
}
