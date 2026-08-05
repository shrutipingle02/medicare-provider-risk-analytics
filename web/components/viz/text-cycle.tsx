"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/* The last word of the headline, swapped on an interval.

   Every word is rendered stacked in one grid cell, so the box is already as
   wide as the longest of them and the line never reflows mid-cycle. Only the
   opacity changes.

   The stack is hidden from assistive tech and a single static word is exposed
   instead: a screen reader should hear one finished sentence, not four
   fragments arriving on a timer. Reduced motion gets that same first word and
   no interval at all. */
export default function TextCycle({
  words,
  interval = 2600,
  className = "",
}: {
  words: string[];
  interval?: number;
  className?: string;
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((n) => (n + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval]);

  return (
    <>
      <span className="sr-only">{words[0]}</span>
      <span aria-hidden className="inline-grid align-bottom">
        {words.map((w, n) => (
          <span
            key={w}
            className={cn(
              "col-start-1 row-start-1 transition-opacity duration-500 motion-reduce:transition-none",
              n === i ? "opacity-100" : "opacity-0",
              className,
            )}
          >
            {w}
          </span>
        ))}
      </span>
    </>
  );
}
