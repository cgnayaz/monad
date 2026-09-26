/**
 * JSON transport for pipeline events. bigint values (wei, prices, support weights) are sent
 * as decimal strings; `Wire<T>` is the resulting client-side type.
 */

export type Wire<T> = T extends bigint
  ? string
  : T extends number | string | boolean | null | undefined
    ? T
    : T extends readonly (infer U)[]
      ? Wire<U>[]
      : T extends object
        ? { [K in keyof T]: Wire<T[K]> }
        : T;

export function toWireJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}
