import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";
import { Providers } from "./providers";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: { default: "DecMarkt", template: "%s · DecMarkt" },
  description: "AI decisions with on-chain accountability. Jev-structured decisions, bonded agents, settled on Monad.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-24 pt-10 sm:px-6">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
