import type { Metadata } from "next";
import "./globals.css";
import SiteNav from "@/components/site-nav";
import { getSummary } from "@/lib/data";
import { Geist, Newsreader } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

// Headings only. Numbers and tables stay in Geist, where legibility beats
// character.
const display = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: "Medicare Provider Risk Analytics",
  description:
    "A ranked, explained view of unusual Medicare Part B billing. Every flag states its reason against the provider's specialty peers.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const summary = await getSummary();

  return (
    <html lang="en" className={cn("h-full antialiased", "font-sans", geist.variable, display.variable)}>
      <body className="min-h-full flex flex-col">
        <SiteNav />

        <main className="flex-1">{children}</main>

        <footer className="border-t border-[var(--hairline)] bg-[var(--surface)] mt-16">
          <div className="mx-auto w-full max-w-5xl px-5 py-8 text-sm text-[var(--ink-secondary)] space-y-2">
            <p>
              Features: CMS Medicare Physician &amp; Other Practitioners, by
              Provider, {summary.data.years[0]}&ndash;{summary.data.years[1]}.
              Labels: OIG LEIE exclusion list, snapshot {summary.leie_snapshot}.
            </p>
            <p className="text-[var(--ink-muted)]">
              The exclusion list refreshes monthly, so labels shift over time.
              Any figure here is tied to that snapshot date. Data generated{" "}
              {summary.generated}.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
