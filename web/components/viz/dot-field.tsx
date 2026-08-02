"use client";

import { useEffect, useRef } from "react";

/* One dot per sampled provider: a quiet field with the flagged few lit and
   slowly breathing. Canvas rather than SVG because a few thousand nodes in the
   DOM would cost more than they are worth for a background.

   Honours prefers-reduced-motion by drawing a single static frame. */
export default function DotField({
  count = 6000,
  total,
  listed,
  className = "",
}: {
  count?: number;
  /** Providers in the population the field stands for. */
  total: number;
  /** How many of them are on the worklist. */
  listed: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  /* The lit share is the real one, not a number chosen because it looked good.
     At 5,000 of 1.67M that is 0.3%, so a 6,000-point field lights about
     eighteen — few enough to be truthful and, on a full-height hero, still
     plenty to see. Rounded up so the field is never entirely dark. */
  const flagged = Math.max(1, Math.round(count * (listed / total)));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let w = 0;
    let h = 0;

    // Deterministic layout, so the field is the same on every load.
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const dots = Array.from({ length: count }, (_, i) => ({
      x: rnd(),
      y: rnd(),
      r: 0.6 + rnd() * 0.9,
      lit: i < flagged,
      phase: rnd() * Math.PI * 2,
      speed: 0.4 + rnd() * 0.6,
    }));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        const x = d.x * w;
        const y = d.y * h;
        if (d.lit) {
          const pulse = reduce
            ? 0.85
            : 0.55 + 0.45 * Math.sin(t * 0.0012 * d.speed + d.phase);
          const glow = ctx.createRadialGradient(x, y, 0, x, y, 16);
          glow.addColorStop(0, `rgba(120, 190, 255, ${0.5 * pulse})`);
          glow.addColorStop(1, "rgba(120, 190, 255, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, 16, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = `rgba(216, 238, 255, ${0.75 + 0.25 * pulse})`;
          ctx.beginPath();
          ctx.arc(x, y, d.r * 1.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = "rgba(150, 170, 200, 0.20)";
          ctx.beginPath();
          ctx.arc(x, y, d.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    draw(0);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [count, flagged]);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
