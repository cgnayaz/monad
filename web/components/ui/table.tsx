import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

export function Table({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <div className="relative overflow-x-auto border border-rule bg-surface">
      <table className="w-full border-collapse text-left text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({ children, align = "left", className = "", ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={`label whitespace-nowrap border-b border-rule bg-surface-2 px-4 py-2 font-medium ${align === "right" ? "text-right" : "text-left"} ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  mono = false,
  className = "",
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right"; mono?: boolean }) {
  return (
    <td
      className={`border-b border-rule px-4 py-2.5 align-top last:border-b-0 ${align === "right" ? "text-right tabular" : ""} ${mono ? "font-mono text-[12.5px]" : ""} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}
