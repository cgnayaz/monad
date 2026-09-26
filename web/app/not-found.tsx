import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";

export default function NotFound() {
  return (
    <>
      <PageHeader eyebrow="404" title="Bulunamadı" lead="Bu adreste bir sayfa ya da zincir üstü kayıt yok." />
      <LinkButton href="/">Ana sayfaya dön</LinkButton>
    </>
  );
}
