"use client";

import { useEffect, useRef, useState } from "react";

// What Pieter says when you click or tap him. Add more lines freely.
export const QUIPS = [
  "Hahaha! That tickles!",
  "Hehe! Stop it, that tickles!",
  "Hahaha! You found my ticklish spot!",
  "Ha ha ha! Do that again!",
  "Teehee! My π is wobbling!",
  "Hahaha! Careful, I'm full of irrational giggles!",
  "Hee hee! You're making my digits jiggle!",
  "Hahaha! Okay okay, I'm laughing!",
  "Ooh, that's a 3.14159 kind of tickle!",
  "Hehehe! Pi-ckle me again!",
  "Ha! I can't stop laughing, and it never repeats either!",
  "Tee-hee! Right back at you, friend!",
];
const BACK_TO_WORK = "Hahaha, okay! Ready to do some math now?";
export const QUIP_MS = 2400; // how long the laugh + bubble last

// ---------------------------------------------------------------------------
// PIETER — kinetic mascot
//
// A multi-layer, state-driven SVG (shadow → body → head → π-hair → cheeks →
// eyes → mouth). Figure design adapted from the Numberfold prototype.
//
// Tracking
//   • ONE shared listener set for the whole app (not one per mascot):
//       desktop → window `pointermove` (mouse / pen)
//       mobile  → window `touchstart` + `touchmove` (passive)
//   • Events only store the latest coordinates; work happens at most once per
//     animation frame (requestAnimationFrame throttle), and all DOM reads are
//     batched before all writes, so there is no layout thrash or main-thread
//     blocking on touch devices.
//   • Output is three CSS variables on the figure (`--lx`, `--ly`, `--tilt`),
//     so React never re-renders while the pointer moves.
//
// Thresholds
//   • eyes:  travel up to EYE_X / EYE_Y units, reaching full travel at EYE_REACH px away
//   • torso: ignores pointers within TILT_DEAD_ZONE px of its centre, then tilts
//            proportionally to horizontal offset (full tilt at TILT_REACH px),
//            capped at ±MAX_TILT degrees
// ---------------------------------------------------------------------------

// Eye travel is in SVG user units (the figure's viewBox is 200 wide), so on screen
// it scales with the mascot's size.
const EYE_X = 9;
const EYE_Y = 7;
const EYE_REACH = 160;
const TILT_DEAD_ZONE = 24;
const TILT_REACH = 320; // horizontal distance (px) at which the tilt hits its cap
const MAX_TILT = 9;

/* ---------- shared pointer store ---------- */

const subscribers = new Set();
let px = 0;
let py = 0;
let raf = 0;
let attached = false;

function flush() {
  raf = 0;
  const list = [...subscribers];
  const results = list.map((s) => s.measure(px, py)); // all reads first…
  list.forEach((s, i) => results[i] && s.apply(results[i])); // …then all writes
}

function schedule(x, y) {
  px = x;
  py = y;
  if (!raf) raf = requestAnimationFrame(flush);
}

const onPointer = (e) => {
  if (e.pointerType === "touch") return; // touch is handled by the touch listeners below
  schedule(e.clientX, e.clientY);
};
const onTouch = (e) => {
  const t = e.touches[0];
  if (t) schedule(t.clientX, t.clientY);
};

function subscribe(sub) {
  subscribers.add(sub);
  if (!attached) {
    attached = true;
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });
  }
  return () => {
    subscribers.delete(sub);
    if (subscribers.size === 0 && attached) {
      attached = false;
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("touchmove", onTouch);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------- the figure ---------- */

/**
 * @param size  rendered width in px (the viewBox keeps the aspect ratio exactly)
 * @param mood  null | "happy" | "oops"   (also drives a jump / slump animation)
 */
export function Pieter({ size = 120, mood = null, onQuip = null }) {
  const wrapRef = useRef(null);
  const stageRef = useRef(null);

  // Poking: clicking / tapping Pieter makes him laugh and say something.
  const [quip, setQuip] = useState(null); // { id, text } | null
  const lastQuip = useRef(-1);
  const pokes = useRef(0);
  const quipTimer = useRef(null);

  useEffect(() => () => clearTimeout(quipTimer.current), []);

  function poke() {
    // Random line, never the same one twice in a row.
    let i;
    do {
      i = Math.floor(Math.random() * QUIPS.length);
    } while (i === lastQuip.current && QUIPS.length > 1);
    lastQuip.current = i;
    pokes.current += 1;
    // Every 7th poke he asks to get back to the maths.
    const text = pokes.current % 7 === 0 ? BACK_TO_WORK : QUIPS[i];
    setQuip({ id: pokes.current, text });
    onQuip?.(text); // a parent that owns a speech bubble can show the line there instead
    clearTimeout(quipTimer.current);
    quipTimer.current = setTimeout(() => setQuip(null), QUIP_MS);
  }

  const laughing = quip !== null;

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    if (!wrap || !stage) return;

    return subscribe({
      measure(x, y) {
        const r = stage.getBoundingClientRect();
        if (!r.width) return null;
        const dx = x - (r.left + r.width * 0.5);
        const dy = y - (r.top + r.height * 0.57);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / EYE_REACH);
        const tilt =
          Math.abs(dx) < TILT_DEAD_ZONE
            ? 0
            : clamp(dx / TILT_REACH, -1, 1) * MAX_TILT;
        return {
          lx: ((dx / d) * EYE_X * k).toFixed(1),
          ly: ((dy / d) * EYE_Y * k).toFixed(1),
          tilt: tilt.toFixed(1),
        };
      },
      apply({ lx, ly, tilt }) {
        wrap.style.setProperty("--lx", `${lx}px`);
        wrap.style.setProperty("--ly", `${ly}px`);
        wrap.style.setProperty("--tilt", `${tilt}deg`);
      },
    });
  }, []);

  return (
    <div
      ref={wrapRef}
      className={`pwrap idle${laughing ? " mood-happy laugh" : mood ? ` mood-${mood}` : ""}`}
      style={{ width: size, "--pw": `${size}px` }}
    >
      {quip && !onQuip && (
        <span key={quip.id} className="quip" role="status">
          {quip.text}
        </span>
      )}
      <button
        type="button"
        ref={stageRef}
        className="pstage"
        onClick={poke}
        aria-label="Tickle Pieter"
        title="Tickle me!"
      >
        <svg className="pfig" viewBox="0 0 200 230" role="img" aria-label="Pieter, your math mascot" focusable="false">
          <ellipse className="shadow" cx="100" cy="218" rx="48" ry="7" />
          <g className="tilt">
            <g className="pbody">
              <circle className="head" cx="100" cy="132" r="68" />
              <ellipse className="shine" cx="72" cy="94" rx="18" ry="9" transform="rotate(-28 72 94)" />
              {/* π-shaped hair: the "Pi cap" */}
              <g className="hair">
                <path d="M50 46Q100 32 150 46" />
                <path d="M78 42Q76 70 72 96" />
                <path d="M122 42Q124 72 124 90Q125 102 140 99" />
              </g>
              <ellipse className="cheek" cx="54" cy="152" rx="12" ry="8" />
              <ellipse className="cheek" cx="146" cy="152" rx="12" ry="8" />
              <g className="eyes">
                <g className="look">
                  <g className="eye">
                    <ellipse className="iris" cx="76" cy="128" rx="9" ry="12" />
                    <circle className="glint" cx="79" cy="123" r="3.6" />
                  </g>
                  <g className="eye">
                    <ellipse className="iris" cx="124" cy="128" rx="9" ry="12" />
                    <circle className="glint" cx="127" cy="123" r="3.6" />
                  </g>
                </g>
              </g>
              <g className="happyeyes">
                <path className="arc" d="M64 134Q76 112 88 134" />
                <path className="arc" d="M112 134Q124 112 136 134" />
              </g>
              <g className="brows">
                <path className="brow" d="M62 108L88 100" />
                <path className="brow" d="M138 108L112 100" />
              </g>
              <path className="m-idle" d="M76 160Q100 180 124 160" />
              <g className="m-happy">
                <path className="m-open" d="M70 156H130Q128 196 100 196Q72 196 70 156Z" />
                <path className="tongue" d="M84 188Q100 172 116 188Q100 198 84 188Z" />
              </g>
              <path className="m-oops" d="M82 172Q100 162 118 172" />
            </g>
          </g>
        </svg>
      </button>
    </div>
  );
}

/** Pieter on the left, speech bubble on the right (used for questions + the home hero). */
export function PieterSays({ children, size = 120, mood = null, className = "", onQuip = null }) {
  return (
    <div className={`pieter-row ${className}`}>
      <Pieter size={size} mood={mood} onQuip={onQuip} />
      <div className="bubble">{children}</div>
    </div>
  );
}
