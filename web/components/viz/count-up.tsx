"use client";

import { useEffect, useState } from "react";

/* Counts to the real figure on load. Eased out, so it slows into the number
   rather than stopping dead. Reduced-motion users get the value immediately —
   the number is the content, the animation is decoration. */
export default function CountUp({
  to,
  duration = 1600,
  className = "",
}: {
  to: number;
  duration?: number;
  className?: string;
}) {
  const [n, setN] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    // The reduced-motion jump happens on the first frame rather than in the
    // effect body, so state is never set synchronously during the effect.
    const tick = (now: number) => {
      if (reduce) {
        setN(to);
        return;
      }
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);

  return (
    <span className={className} aria-label={to.toLocaleString("en-US")}>
      {n.toLocaleString("en-US")}
    </span>
  );
}
