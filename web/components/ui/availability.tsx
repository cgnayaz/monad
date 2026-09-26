import type { ReactNode } from "react";
import type { Availability } from "@/lib/types/protocol";
import { Unavailable } from "./status";

/** Render a value only when it is known; otherwise an explicit unavailable marker. */
export function Avail<T>({ value, children }: { value: Availability<T>; children: (v: T) => ReactNode }) {
  return value.status === "ok" ? <>{children(value.value)}</> : <Unavailable reason={value.reason} />;
}
