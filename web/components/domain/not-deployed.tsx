import Link from "next/link";
import { EmptyState } from "@/components/ui/status";

/** Shared empty state for anything that depends on the DecMarkt contracts. */
export function NotDeployed({ what }: { what: string }) {
  return (
    <EmptyState title={`No ${what} yet`}>
      <p>
        The DecMarkt contracts are not deployed to Monad Testnet yet, so there is nothing on-chain to show. Nothing on
        this page is simulated: once the contracts are live, this view reads directly from them. See{" "}
        <Link href="/contracts" className="text-ink underline decoration-rule underline-offset-2 hover:decoration-ink">
          contracts
        </Link>{" "}
        for deployment status.
      </p>
    </EmptyState>
  );
}
