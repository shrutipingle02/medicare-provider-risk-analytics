"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/* Five pages, in the order the story runs. The nav is the table of contents,
   so it keeps that order rather than sorting by importance. */
const NAV = [
  { href: "/", label: "Overview" },
  { href: "/worklist", label: "Worklist" },
  { href: "/atlas", label: "By state" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
];

export default function SiteNav() {
  const path = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-[var(--surface)]/85 backdrop-blur-md">
      {/* justify-between, so the wordmark and the links sit at opposite ends.
          Without it they run together at a single gap and read as one line of
          text rather than as two separate things. */}
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
        <Link href="/" className="font-semibold tracking-tight">
          Medicare Provider Risk
        </Link>
        <nav aria-label="Sections" className="flex flex-wrap gap-5 text-sm">
          {NAV.map((item) => {
            const active = path === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "transition-colors hover:text-[var(--ink-primary)]",
                  active
                    ? "text-[var(--accent)]"
                    : "text-[var(--ink-secondary)]",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
