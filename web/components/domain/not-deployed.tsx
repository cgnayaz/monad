import Link from "next/link";
import { EmptyState } from "@/components/ui/status";

/** Shared empty state for anything that depends on the DecMarkt contracts. */
export function NotDeployed({ what }: { what: string }) {
  return (
    <EmptyState title={`Henüz ${what} yok`}>
      <p>
        DecMarkt kontratları henüz Monad Testnet&apos;e dağıtılmadı, bu yüzden gösterilecek zincir üstü veri yok. Bu
        sayfadaki hiçbir şey simüle edilmez: kontratlar yayına girdiğinde bu görünüm doğrudan onlardan okur. Dağıtım durumu
        için{" "}
        <Link href="/contracts" className="text-ink underline decoration-rule underline-offset-2 hover:decoration-ink">
          kontratlar
        </Link>{" "}
        sayfasına bakın.
      </p>
    </EmptyState>
  );
}
