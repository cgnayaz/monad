import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";

export default function NotFound() {
  return (
    <>
      <PageHeader eyebrow="404" title="Not found" lead="There is no page or on-chain record at this address." />
      <LinkButton href="/">Back to dashboard</LinkButton>
    </>
  );
}
