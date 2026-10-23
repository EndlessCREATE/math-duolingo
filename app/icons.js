// ---------------------------------------------------------------------------
// TOPIC ICONS — minimalist vector set for the dashboard cards.
//
// Every icon is drawn on a fixed 64 × 48 viewBox and rendered at exactly
// 64 × 48 CSS px (`.ticon` in globals.css), so all cards stay pixel-aligned in
// both themes. Strokes/fills come from CSS variables (`.ax`, `.ln`, `.pt`, …),
// so the same SVG re-colours itself for light / dark mode and the accent theme.
//
// Drawing language (adapted from the Numberfold prototype):
//   .ax   ink axis / beam            .thin  soft construction line
//   .ln   accent line or curve       .pt    accent point
//   .shape  tile-filled outline      .big   display text    .gl  faint grid line
// ---------------------------------------------------------------------------

/** Balanced scale (Linear equations). */
function Scale() {
  return (
    <>
      <line className="ax" x1="12" y1="10" x2="52" y2="10" />
      <rect className="shape" x="30" y="10" width="4" height="30" />
      <rect className="shape" x="20" y="40" width="24" height="4" rx="1" />
      <line className="thin" x1="12" y1="10" x2="5" y2="24" />
      <line className="thin" x1="12" y1="10" x2="19" y2="24" />
      <path className="shape" d="M3 24h18l-3 8H6z" />
      <line className="thin" x1="52" y1="10" x2="45" y2="24" />
      <line className="thin" x1="52" y1="10" x2="59" y2="24" />
      <path className="shape" d="M43 24h18l-3 8h-12z" />
      <circle className="pt" cx="32" cy="10" r="4" />
    </>
  );
}

/** Bracketed expressions 3(x+2) and (a+b)² (Algebra). */
function Algebra() {
  return (
    <>
      <text className="big" x="32" y="20" textAnchor="middle" style={{ fontSize: 16 }}>
        3(x+2)
      </text>
      <text className="big acc" x="32" y="41" textAnchor="middle" style={{ fontSize: 15 }}>
        (a+b)²
      </text>
    </>
  );
}

/** Square root over a fraction: √2 over ¾ (Rational / irrational). */
function Numbers() {
  return (
    <>
      <text className="big" x="32" y="19" textAnchor="middle" style={{ fontSize: 19 }}>
        √2
      </text>
      <line className="thin" x1="14" y1="25" x2="50" y2="25" />
      <text className="big acc" x="32" y="43" textAnchor="middle" style={{ fontSize: 18 }}>
        ¾
      </text>
    </>
  );
}

/** Variable-ratio chart with the ∝ sign (Proportion). */
function Proportion() {
  return (
    <>
      <path className="ax" d="M8 6V42H58" />
      <path className="thin" d="M12 10Q16 34 56 38" />
      <path className="ln" d="M10 40L54 12" />
      <text className="big acc" x="37" y="12" style={{ fontSize: 15 }}>
        ∝
      </text>
    </>
  );
}

/** Grid lines crossing at the intercept axes (Lines and graphs). */
function Lines() {
  return (
    <>
      <path className="gl" d="M19 4V44M45 4V44M6 14H58M6 35H58" />
      <path className="ax" d="M6 24H58M32 4V44" />
      <path className="ln" d="M12 40L54 10" />
      <circle className="pt" cx="32" cy="25.7" r="3.5" />
    </>
  );
}

/** Right-angled triangle with labelled sides a, b, c (Pythagoras). */
function Pythagoras() {
  return (
    <>
      <path className="shape" d="M12 38H52L12 8z" />
      <path className="thin" d="M12 30H20V38" />
      <text className="tx soft" x="32" y="47" textAnchor="middle">a</text>
      <text className="tx soft" x="6" y="25" textAnchor="middle">b</text>
      <text className="tx acc" x="38" y="20">c</text>
    </>
  );
}

/** Crossing arrows (Mixed practice). */
function Mixed() {
  return (
    <>
      <path className="ln" d="M6 14h10c10 0 14 20 24 20h8M6 34h10c10 0 14-20 24-20h8" />
      <path className="ax" d="M44 8l8 6-8 6M44 28l8 6-8 6" />
    </>
  );
}

/** a × 10ⁿ style badge for sheet topics about standard form. */
function Standard() {
  return (
    <text className="big" x="32" y="31" textAnchor="middle" style={{ fontSize: 18 }}>
      ×10<tspan className="acc" dy="-7" style={{ fontSize: 12 }}>n</tspan>
    </text>
  );
}

const ICONS = {
  equations: Scale,
  algebra: Algebra,
  numbers: Numbers,
  proportion: Proportion,
  lines: Lines,
  pythagoras: Pythagoras,
  mixed: Mixed,
  standard: Standard,
};

const FALLBACK_EMOJI = ["➕", "📐", "🧮", "📊", "🔢"];

/**
 * <TopicIcon kind="equations" /> — `kind` is a TOPIC_DEFS key, "mixed" or "standard".
 * Unknown kinds fall back to an emoji so brand-new sheet topics still get an icon.
 */
export function TopicIcon({ kind, fallbackIndex = 0 }) {
  const Glyph = ICONS[kind];
  if (!Glyph) {
    return (
      <span className="ticon ticon-emoji" aria-hidden="true">
        {FALLBACK_EMOJI[fallbackIndex % FALLBACK_EMOJI.length]}
      </span>
    );
  }
  return (
    <svg className="ticon" viewBox="0 0 64 48" width="64" height="48" aria-hidden="true" focusable="false">
      <Glyph />
    </svg>
  );
}

/** Sheet topic names that deserve a dedicated icon without a generator. */
export function iconKindForSheetTopic(name) {
  return /standard form/i.test(name) ? "standard" : null;
}
