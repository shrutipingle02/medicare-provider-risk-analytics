"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
   Story primitives

   The long-scroll pages are built from four pieces: a Section that owns the
   vertical rhythm, a Kicker that names the section, a Panel that holds a card,
   and Reveal, which fades a block in as it enters the viewport.

   Reveal uses an IntersectionObserver and a CSS transition rather than an
   animation library. The site ships no motion dependency and this is the only
   thing that wanted one. Reduced-motion users are handed the final state on
   mount, so nothing is ever hidden from them waiting on a scroll event.
   --------------------------------------------------------------------------- */

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /* Reduced motion skips the observer entirely and reveals on the next
       frame. Deferring past the effect body keeps the state change out of the
       render pass, the same way count-up.tsx handles its own jump. */
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "-80px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-7 opacity-0",
        className,
      )}
      style={{ transitionDelay: shown ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}

/** One beat of the story. Owns the spacing between sections so pages don't. */
export function Section({
  children,
  id,
  className,
}: {
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn("mx-auto w-full max-w-5xl px-5 py-24 sm:py-28", className)}
    >
      {children}
    </section>
  );
}

/** The small label above a section heading. Mono and wide, so it reads as a
    tab on the section rather than as a line of copy. */
export function Kicker({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-[var(--accent)]">
      {icon && (
        <span aria-hidden="true" className="text-[var(--series-1)]">
          {icon}
        </span>
      )}
      {children}
    </p>
  );
}

/** The card. Matches the panels already used on the inner pages, so the story
    sections and the reference tables read as the same material.

    A pointer-tracked spotlight follows the cursor across the surface and the
    card lifts a hair. Both are hover-only and the lift is dropped under
    reduced motion — the card is legible with neither. */
export function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  return (
    <div
      onMouseMove={onMove}
      className={cn(
        "spotlight-card rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-7",
        "transition duration-300 hover:-translate-y-0.5 hover:border-[var(--baseline)]",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The header every inner page opens with: eyebrow, title, lead, centred over
    a soft accent glow. Gives the four inner pages one shared entrance. */
export function PageHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: React.ReactNode;
  /** Optional. Left off, the page drops straight into its first section. */
  lead?: React.ReactNode;
}) {
  return (
    <header className="relative overflow-hidden px-5 pb-12 pt-24 text-center">
      <div
        aria-hidden
        className="absolute left-1/2 top-0 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/3 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(85,152,231,0.22) 0%, rgba(85,152,231,0.06) 45%, transparent 70%)",
          filter: "blur(6px)",
        }}
      />
      <Reveal>
        <p className="mb-5 font-mono text-[11px] uppercase tracking-[0.35em] text-[var(--accent)]">
          {eyebrow}
        </p>
        <h1 className="mx-auto max-w-3xl">{title}</h1>
      </Reveal>
      {lead && (
        <Reveal delay={120}>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--ink-secondary)]">
            {lead}
          </p>
        </Reveal>
      )}
    </header>
  );
}

/** A hairline between story beats. Quieter than a full <hr>, and centred so it
    reads as punctuation rather than as a table rule. */
export function Divider() {
  return (
    <div aria-hidden className="mx-auto flex max-w-5xl items-center gap-3 px-5">
      <span className="h-px flex-1 bg-[var(--hairline)]" />
      <span className="h-1 w-1 rotate-45 bg-[var(--series-1)]" />
      <span className="h-px flex-1 bg-[var(--hairline)]" />
    </div>
  );
}

/** Section heading + lead, so every beat sets them the same way. */
export function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 max-w-2xl text-lg text-[var(--ink-secondary)]">
      {children}
    </p>
  );
}
