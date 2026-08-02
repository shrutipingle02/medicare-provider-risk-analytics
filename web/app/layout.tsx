import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
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

const NAV = [
  { href: "/", label: "Worklist" },
  { href: "/atlas", label: "By state" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/method", label: "Method & limits" },
];

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const summary = await getSummary();

  return (
    <html lang="en" className={cn("h-full antialiased", "font-sans", geist.variable, display.variable)}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-[var(--hairline)] bg-[var(--surface)]">
          <div className="mx-auto w-full max-w-5xl px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/" className="font-semibold tracking-tight">
              Medicare Provider Risk
            </Link>
            <nav className="flex gap-5 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

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
