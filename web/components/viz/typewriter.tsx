"use client";

import { useEffect, useState } from "react";

/* The mono status line under the headline. Types a phrase, pauses, deletes it,
   moves to the next, loops.

   The phrases describe what the pipeline does, so they are decoration over
   real content rather than invented flavour. The whole line is aria-hidden and
   the full text is exposed once, statically: a screen reader reading a string
   grow one character at a time is noise, not information.

   Reduced motion gets the first phrase, finished, with no cursor. */
export default function Typewriter({
  phrases,
  speed = 55,
  deleteSpeed = 28,
  holdMs = 1400,
  className = "",
}: {
  phrases: string[];
  speed?: number;
  deleteSpeed?: number;
  holdMs?: number;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [i, setI] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const raf = requestAnimationFrame(() => setStill(true));
      return () => cancelAnimationFrame(raf);
    }
  }, []);

  useEffect(() => {
    if (still) return;
    const full = phrases[i];

    /* Fully typed: hold, then start deleting. Fully deleted: move on. */
    if (!deleting && text === full) {
      const id = setTimeout(() => setDeleting(true), holdMs);
      return () => clearTimeout(id);
    }
    /* Advancing to the next phrase goes through a timer like every other
       transition here, rather than firing straight from the effect body. It
       also gives the line a beat of rest between phrases. */
    if (deleting && text === "") {
      const id = setTimeout(() => {
        setDeleting(false);
        setI((n) => (n + 1) % phrases.length);
      }, speed);
      return () => clearTimeout(id);
    }

    const id = setTimeout(
      () =>
        setText((t) =>
          deleting ? t.slice(0, -1) : full.slice(0, t.length + 1),
        ),
      deleting ? deleteSpeed : speed,
    );
    return () => clearTimeout(id);
  }, [text, i, deleting, still, phrases, speed, deleteSpeed, holdMs]);

  return (
    <p className={className}>
      <span className="sr-only">{phrases.join(" ")}</span>
      <span aria-hidden>
        <span className="text-[var(--accent)]">&gt;</span>{" "}
        {still ? phrases[0] : text}
        {!still && (
          <span className="animate-pulse text-[var(--accent)]">&#9611;</span>
        )}
      </span>
    </p>
  );
}
