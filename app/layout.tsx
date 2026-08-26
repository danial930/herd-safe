import type { Metadata } from "next";
import Link from "next/link";
import { fraunces, plexMono, plexSans } from "./fonts";
import { Logo } from "@/components/Logo";
import "./globals.css";

export const metadata: Metadata = {
  title: "HerdSafe",
  description: "Heat-risk protection across a dairy supply chain's farm, transport, and storage checkpoints.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable} h-full`}>
      <body className="flex min-h-full flex-col font-sans antialiased">
        <header className="border-b border-border-subtle bg-surface-raised">
          <div className="mx-auto flex max-w-5xl items-center px-6 py-4">
            <Link href="/" aria-label="HerdSafe home">
              <Logo />
            </Link>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
