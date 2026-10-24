// ---------------------------------------------------------------------------
// ALGORITHMIC MATH GENERATION ENGINE
//
// Client-side procedural question generators (ported and adapted from the
// "Numberfold" prototype). Every call produces a fresh randomised question in
// OctoPi's multiple-choice shape:
//
//   {
//     question,        // plain text prompt
//     expr?,           // the main expression, shown large in a "plate"
//     visual?,         // trusted SVG/HTML string generated here (never from the sheet)
//     choices,         // string[] (unique, includes the correct answer)
//     correct_answer,  // one of `choices`
//     steps?,          // worked solution, one line per step
//     hint?,
//   }
//
// Each generator takes a difficulty level L (1 = easy … 3 = hard). A quiz
// session ramps the level up as it goes (see `buildTopicSession`).
//
// This file is pure JS (no React / DOM) so it can be unit-tested with node.
// ---------------------------------------------------------------------------

/* ========================================================================
   RANDOM + FORMAT HELPERS
   ======================================================================== */

const ri = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[ri(0, arr.length - 1)];
const sg = () => (Math.random() < 0.5 ? -1 : 1);

export function shuf(arr) {
  const b = [...arr];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
const N = (n) => String(n).replace("-", "−"); // typographic minus
const sgn = (n) => (n < 0 ? "−" : "+");
const coef = (a, v) => (a === 1 ? v : a === -1 ? "−" + v : N(a) + v);

/** "ax + b" (handles 0 and ±1 coefficients). */
function lin(a, b, v = "x") {
  let s = a !== 0 ? coef(a, v) : "";
  if (b !== 0 || a === 0) s += s ? " " + sgn(b) + " " + Math.abs(b) : N(b);
  return s;
}

/** Reduced fraction text, e.g. frStr(4, 6) -> "2/3", frStr(6, 3) -> "2". */
function frStr(p, q) {
  if (q < 0) {
    p = -p;
    q = -q;
  }
  const g = gcd(Math.abs(p), q) || 1;
  p /= g;
  q /= g;
  return q === 1 ? N(p) : N(p) + "/" + q;
}

const divisors = (n) => {
  const d = [];
  for (let i = 1; i <= n; i++) if (n % i === 0) d.push(i);
  return d;
};

/** Correct answer + up to 3 unique wrong answers, shuffled. */
function mkChoices(correct, wrongs) {
  const uniq = [...new Set(wrongs.filter((w) => w !== correct && w !== undefined && w !== ""))];
  const choices = shuf([correct, ...shuf(uniq).slice(0, 3)]);
  return { choices, correct_answer: correct };
}

/** Multiple-choice set for a whole-number answer. `extras` = likely mistakes, tried first. */
function numChoices(ans, { positive = false, extras = [] } = {}) {
  const ok = (v) => Number.isFinite(v) && Number.isInteger(v) && v !== ans && (!positive || v > 0);
  const near = [ans + 1, ans - 1, ans + 2, ans - 2, ans + 3, ans - 3, -ans];
  const far = [ans * 2, Math.round(ans / 2), ans + 10, ans - 10];
  const wrongs = [...extras.filter(ok), ...shuf(near.filter(ok)), ...shuf(far.filter(ok))].map(N);
  return mkChoices(N(ans), wrongs);
}

/* ========================================================================
   DIAGRAM BUILDERS (return SVG / HTML strings; classes styled in globals.css)
   ======================================================================== */

let svgSeq = 0;

function balanceSVG(l, r) {
  const pan = (cx, t) =>
    `<path class="shape" d="M${cx - 65} 134H${cx + 65}Q${cx + 60} 172 ${cx} 172Q${cx - 60} 172 ${cx - 65} 134Z"/>` +
    `<text class="big" x="${cx}" y="124" text-anchor="middle">${t}</text>` +
    `<line class="thin" x1="${cx}" y1="56" x2="${cx - 65}" y2="134"/>` +
    `<line class="thin" x1="${cx}" y1="56" x2="${cx + 65}" y2="134"/>`;
  return (
    `<svg viewBox="0 0 440 200" width="440" role="img" aria-label="Balance scale with ${l} on the left pan and ${r} on the right pan">` +
    `<rect class="shape" x="216" y="56" width="8" height="130"/>` +
    `<rect class="shape" x="170" y="186" width="100" height="8" rx="3"/>` +
    `<line class="ax" x1="70" y1="56" x2="370" y2="56"/>` +
    pan(70, l) +
    pan(370, r) +
    `<circle class="pt" cx="220" cy="56" r="9"/></svg>`
  );
}

function tableHTML(xs, ys, qi) {
  const row = (h, a) =>
    `<tr><th>${h}</th>` +
    a.map((v, i) => `<td${i === qi && h === "y" ? ' class="q"' : ""}>${v}</td>`).join("") +
    `</tr>`;
  return (
    `<table class="pt-table" aria-label="Table of x and y values">` +
    row("x", xs) +
    row("y", ys.map((v, i) => (i === qi ? "?" : v))) +
    `</table>`
  );
}

function plotSVG(pts, curve, k) {
  const W = 250, H = 180, ml = 36, mb = 28, mt = 14, mr = 14;
  const maxX = Math.max(...pts.map((p) => p[0])) * 1.2;
  const maxY = Math.max(...pts.map((p) => p[1])) * 1.2;
  const sx = (x) => ml + (x / maxX) * (W - ml - mr);
  const sy = (y) => H - mb - (y / maxY) * (H - mb - mt);
  let g =
    `<line class="ax" x1="${ml}" y1="${H - mb}" x2="${W - mr}" y2="${H - mb}"/>` +
    `<line class="ax" x1="${ml}" y1="${H - mb}" x2="${ml}" y2="${mt}"/>` +
    `<text class="tx soft" x="${W - mr}" y="${H - 8}" text-anchor="end">x</text>` +
    `<text class="tx soft" x="${ml - 8}" y="${mt + 4}" text-anchor="end">y</text>` +
    `<text class="tx soft" x="${ml - 6}" y="${H - mb + 3}" text-anchor="end">0</text>`;
  if (curve === "line") {
    g += `<line class="ln" x1="${sx(0)}" y1="${sy(0)}" x2="${sx(maxX)}" y2="${sy(Math.min(maxY, k * maxX))}"/>`;
  }
  if (curve === "hyper") {
    let d = "";
    for (let x = Math.min(...pts.map((p) => p[0])) * 0.55; x <= maxX; x += maxX / 60) {
      const y = k / x;
      if (y <= maxY) d += (d ? "L" : "M") + sx(x).toFixed(1) + " " + sy(y).toFixed(1);
    }
    g += `<path class="ln" d="${d}"/>`;
  }
  pts.forEach((p) => {
    g += `<circle class="pt" cx="${sx(p[0])}" cy="${sy(p[1])}" r="5"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="Graph of the table values">${g}</svg>`;
}

function ratioSVG(a, b) {
  const n = a + b, w = Math.min(46, 360 / n), x0 = 10;
  let g = "";
  for (let i = 0; i < n; i++) {
    g += `<rect class="${i < a ? "blockA" : "blockB"}" x="${x0 + i * w}" y="20" width="${w}" height="44" rx="3"/>`;
  }
  g += `<text class="tx" x="${x0 + (a * w) / 2}" y="86" text-anchor="middle">${a} parts</text>`;
  g += `<text class="tx" x="${x0 + a * w + (b * w) / 2}" y="86" text-anchor="middle">${b} parts</text>`;
  return `<svg viewBox="0 0 ${n * w + 20} 100" width="${n * w + 20}" role="img" aria-label="Bar split into ${a} parts and ${b} parts">${g}</svg>`;
}

function gridSVG(p, q, c, pts) {
  const u = 22, cx = 150, cy = 150;
  const sx = (x) => cx + x * u, sy = (y) => cy - y * u;
  const id = "cp" + ++svgSeq;
  let g = `<defs><clipPath id="${id}"><rect x="${sx(-6)}" y="${sy(6)}" width="${12 * u}" height="${12 * u}"/></clipPath></defs>`;
  for (let i = -6; i <= 6; i++) {
    g +=
      `<line class="gl" x1="${sx(i)}" y1="${sy(-6)}" x2="${sx(i)}" y2="${sy(6)}"/>` +
      `<line class="gl" x1="${sx(-6)}" y1="${sy(i)}" x2="${sx(6)}" y2="${sy(i)}"/>`;
  }
  g +=
    `<line class="ax" x1="${sx(-6.4)}" y1="${cy}" x2="${sx(6.4)}" y2="${cy}"/>` +
    `<line class="ax" x1="${cx}" y1="${sy(-6.4)}" x2="${cx}" y2="${sy(6.4)}"/>`;
  [-6, -4, -2, 2, 4, 6].forEach((i) => {
    g +=
      `<text class="tx soft" x="${sx(i)}" y="${cy + 14}" text-anchor="middle">${N(i)}</text>` +
      `<text class="tx soft" x="${cx - 7}" y="${sy(i) + 3}" text-anchor="end">${N(i)}</text>`;
  });
  g +=
    `<text class="tx acc" x="${sx(6.4) - 4}" y="${cy - 7}" text-anchor="end">x</text>` +
    `<text class="tx acc" x="${cx + 8}" y="${sy(6.4) + 10}">y</text>`;
  const m = p / q;
  g += `<g clip-path="url(#${id})"><line class="ln" x1="${sx(-7)}" y1="${sy(-7 * m + c)}" x2="${sx(7)}" y2="${sy(7 * m + c)}"/></g>`;
  pts.forEach((pt) => {
    const left = sx(pt.x) > cx + 80;
    const lab = pt.label || `(${N(pt.x)}, ${N(pt.y)})`;
    g +=
      `<circle class="pt" cx="${sx(pt.x)}" cy="${sy(pt.y)}" r="5"/>` +
      `<text class="tx" x="${sx(pt.x) + (left ? -9 : 9)}" y="${sy(pt.y) - 8}" text-anchor="${left ? "end" : "start"}">${lab}</text>`;
  });
  return `<svg viewBox="0 0 300 300" width="300" role="img" aria-label="Coordinate grid with a straight line">${g}</svg>`;
}

function triSVG(a, b, c, unk) {
  const s = Math.min(230 / a, 130 / b), W = a * s, H = b * s, x0 = 34, y0 = 160, sz = 11;
  const lab = (t, u) => (u ? "?" : t);
  const cls = (u) => "tx" + (u ? " acc" : "");
  return (
    `<svg viewBox="0 0 300 190" width="300" role="img" aria-label="Right-angled triangle with legs ${lab(a, unk === "a")} and ${lab(b, unk === "b")} and hypotenuse ${lab(c, unk === "c")}">` +
    `<path class="shape" d="M${x0} ${y0}L${x0 + W} ${y0}L${x0} ${y0 - H}Z"/>` +
    `<path class="thin" d="M${x0} ${y0 - sz}H${x0 + sz}V${y0}"/>` +
    `<text class="${cls(unk === "a")}" x="${x0 + W / 2}" y="${y0 + 18}" text-anchor="middle">${lab(a, unk === "a")}</text>` +
    `<text class="${cls(unk === "b")}" x="${x0 - 8}" y="${y0 - H / 2 + 4}" text-anchor="end">${lab(b, unk === "b")}</text>` +
    `<text class="${cls(unk === "c")}" x="${x0 + W / 2 + 10}" y="${y0 - H / 2 - 8}">${lab(c, unk === "c")}</text></svg>`
  );
}

/* ========================================================================
   TOPIC GENERATORS
   ======================================================================== */

/* ---------- Example blueprint from the spec (a = 1 excluded: it made two choices identical) ---------- */
export function generateDynamicAlgebra() {
  const a = Math.floor(Math.random() * 9) + 2; // 2..10
  const b = Math.floor(Math.random() * 15) + 1; // 1..15
  return {
    question: `Simplify the algebraic expression: ${a}(x + ${b})`,
    choices: shuf([`${a}x + ${a * b}`, `${a}x + ${b}`, `x + ${a * b}`, `${a + b}x`]),
    correct_answer: `${a}x + ${a * b}`,
    steps: [
      `Multiply every term inside the bracket by ${a}`,
      `${a} × x = ${a}x and ${a} × ${b} = ${a * b}`,
      `So the answer is ${a}x + ${a * b}`,
    ],
    hint: "Multiply every term inside the bracket by the number outside.",
  };
}

/* ---------- Linear equations ---------- */
const addSub = (b) => (b > 0 ? ["Subtract", "from"] : ["Add", "to"]);

export function genEquation(L) {
  let x = ri(-9, 12);
  if (x === 0) x = ri(2, 9);
  const kind = L === 1 ? pick(["add", "mul"]) : L === 2 ? pick(["two", "two", "neg"]) : pick(["both", "brk", "div"]);
  let l, r, steps, a, b, c, d, m;
  const extras = [];

  if (kind === "add") {
    b = sg() * ri(2, 15);
    l = lin(1, b);
    r = N(x + b);
    const w = addSub(b);
    steps = [`${w[0]} ${Math.abs(b)} ${w[1]} both sides: x = ${r} ${b > 0 ? "−" : "+"} ${Math.abs(b)}`, `x = ${N(x)}`];
    extras.push(x + 2 * b, -x);
  } else if (kind === "mul") {
    a = ri(2, 9);
    l = coef(a, "x");
    r = N(a * x);
    steps = [`Divide both sides by ${a}: x = ${r} ÷ ${a}`, `x = ${N(x)}`];
    extras.push(a * x, -x);
  } else if (kind === "two" || kind === "neg") {
    a = ri(2, 9) * (kind === "neg" ? -1 : 1);
    b = sg() * ri(1, 15);
    c = a * x + b;
    l = lin(a, b);
    r = N(c);
    const w = addSub(b);
    steps = [
      `${w[0]} ${Math.abs(b)} ${w[1]} both sides: ${coef(a, "x")} = ${N(c - b)}`,
      `Divide both sides by ${N(a)}: x = ${N(x)}`,
    ];
    extras.push(c - b, -x, Math.round((c + b) / a));
  } else if (kind === "both") {
    a = ri(4, 9);
    c = ri(1, a - 2);
    b = sg() * ri(1, 12);
    d = (a - c) * x + b;
    l = lin(a, b);
    r = lin(c, d);
    const w = addSub(b);
    steps = [
      `Subtract ${c}x from both sides: ${lin(a - c, b)} = ${N(d)}`,
      `${w[0]} ${Math.abs(b)} ${w[1]} both sides: ${a - c}x = ${N(d - b)}`,
      `Divide both sides by ${a - c}: x = ${N(x)}`,
    ];
    extras.push(d - b, -x);
  } else if (kind === "brk") {
    a = ri(2, 6);
    b = sg() * ri(1, 8);
    c = a * (x + b);
    l = `${a}(x ${sgn(b)} ${Math.abs(b)})`;
    r = N(c);
    const w = addSub(b);
    steps = [
      `Divide both sides by ${a}: x ${sgn(b)} ${Math.abs(b)} = ${N(x + b)}`,
      `${w[0]} ${Math.abs(b)} ${w[1]} both sides: x = ${N(x)}`,
    ];
    extras.push(x + b, c - b, -x);
  } else {
    a = ri(2, 6);
    m = ri(1, 6) * sg();
    x = a * m;
    b = sg() * ri(1, 9);
    l = `x/${a} ${sgn(b)} ${Math.abs(b)}`;
    r = N(m + b);
    const w = addSub(b);
    steps = [`${w[0]} ${Math.abs(b)} ${w[1]} both sides: x/${a} = ${N(m)}`, `Multiply both sides by ${a}: x = ${N(x)}`];
    extras.push(m, m + b, -x);
  }

  return {
    question: "Solve for x.",
    expr: `${l} = ${r}`,
    visual: balanceSVG(l, r),
    ...numChoices(x, { extras }),
    steps,
    hint: "Whatever you do to one pan, do to the other so the scale stays balanced. Undo the adding or subtracting first.",
  };
}

/* ---------- Algebra ---------- */
export function genAlgebra(L) {
  const kind = pick(
    L === 1 ? ["eval1", "simp", "blueprint"] : L === 2 ? ["eval2", "expand", "simp", "blueprint"] : ["expand2", "factor", "eval2"]
  );

  if (kind === "blueprint") return generateDynamicAlgebra();

  if (kind === "eval1") {
    const a = ri(2, 9), b = sg() * ri(1, 9), v = ri(2, 7), ans = a * v + b;
    return {
      question: `Evaluate the expression when x = ${v}.`,
      expr: lin(a, b),
      ...numChoices(ans, { extras: [a * v - b, a + v + b, a * (v + b)] }),
      steps: [`Substitute x = ${v}: ${a} × ${v} ${sgn(b)} ${Math.abs(b)}`, `= ${a * v} ${sgn(b)} ${Math.abs(b)} = ${N(ans)}`],
      hint: "Replace x with the number. Multiply first, then add or subtract.",
    };
  }

  if (kind === "eval2") {
    const a = ri(1, 4), b = sg() * ri(1, 6), c = sg() * ri(1, 9), v = -ri(1, 4);
    const ans = a * v * v + b * v + c;
    const ex = `${a === 1 ? "" : a}x² ${sgn(b)} ${Math.abs(b) === 1 ? "" : Math.abs(b)}x ${sgn(c)} ${Math.abs(c)}`;
    return {
      question: `Evaluate the expression when x = ${N(v)}.`,
      expr: ex,
      ...numChoices(ans, { extras: [-a * v * v + b * v + c, a * v * v - b * v + c, a * v * v + c] }),
      steps: [
        `Square first: (${N(v)})² = ${v * v}, so ${a === 1 ? "" : a + " × "}${v * v} = ${a * v * v}`,
        `${N(b)} × (${N(v)}) = ${N(b * v)}`,
        `Add: ${a * v * v} + (${N(b * v)}) + (${N(c)}) = ${N(ans)}`,
      ],
      hint: "A negative number squared is positive. Put brackets round the negative value when you substitute.",
    };
  }

  if (kind === "simp") {
    let p, q, r, s;
    do {
      p = ri(1, 6); q = sg() * ri(1, 9); r = sg() * ri(1, 6); s = sg() * ri(1, 9);
    } while (p + r === 0);
    const a = p + r, b = q + s;
    const ex = `${coef(p, "x")} ${sgn(q)} ${Math.abs(q)} ${sgn(r)} ${coef(Math.abs(r), "x")} ${sgn(s)} ${Math.abs(s)}`;
    return {
      question: "Simplify the expression.",
      expr: ex,
      ...mkChoices(lin(a, b), [lin(a, q - s), lin(p - r, b), lin(a, -b), lin(a + 1, b), lin(a, b + 2)]),
      steps: [
        `Collect the x terms: ${coef(p, "x")} ${sgn(r)} ${coef(Math.abs(r), "x")} = ${coef(a, "x")}`,
        `Collect the numbers: ${N(q)} + (${N(s)}) = ${N(b)}`,
        `So the answer is ${lin(a, b)}`,
      ],
      hint: "Group the x terms together and the plain numbers together. Keep each term's sign.",
    };
  }

  if (kind === "expand") {
    const k = ri(2, 7), p = ri(1, 5), q = sg() * ri(1, 9);
    return {
      question: "Expand the brackets.",
      expr: `${k}(${lin(p, q)})`,
      ...mkChoices(lin(k * p, k * q), [lin(k * p, q), lin(k + p, k * q), lin(k * p, -k * q), lin(p, k * q), lin(k * p, k + q)]),
      steps: [`${k} × ${coef(p, "x")} = ${coef(k * p, "x")}`, `${k} × ${N(q)} = ${N(k * q)}`, `So the answer is ${lin(k * p, k * q)}`],
      hint: "Multiply every term inside the bracket by the number outside.",
    };
  }

  if (kind === "expand2") {
    let k, ms, q, t;
    do {
      k = ri(2, 5); ms = sg() * ri(2, 5); q = sg() * ri(1, 6); t = sg() * ri(1, 6);
    } while (k + ms === 0);
    const a = k + ms, b = k * q + ms * t;
    const ex = `${k}(x ${sgn(q)} ${Math.abs(q)}) ${sgn(ms)} ${Math.abs(ms)}(x ${sgn(t)} ${Math.abs(t)})`;
    return {
      question: "Expand and simplify.",
      expr: ex,
      ...mkChoices(lin(a, b), [lin(a, k * q + Math.abs(ms) * t), lin(a, -b), lin(a, k * q + t), lin(a + 1, b), lin(a, b + 2), lin(-a, b)]),
      steps: [
        `First bracket: ${lin(k, k * q)}`,
        `Second bracket: ${lin(ms, ms * t)}${ms < 0 ? " (the minus sign multiplies both terms)" : ""}`,
        `Add: x terms ${N(k)} + (${N(ms)}) = ${N(a)}, numbers ${N(k * q)} + (${N(ms * t)}) = ${N(b)}`,
        `So the answer is ${lin(a, b)}`,
      ],
      hint: "Expand each bracket on its own. A minus sign in front changes the sign of everything in that bracket.",
    };
  }

  // factor
  let g, u, w;
  do {
    g = pick([4, 6, 8, 9, 10, 12]); u = ri(1, 5); w = sg() * ri(1, 6);
  } while (gcd(u, Math.abs(w)) !== 1);
  const d = g % 2 === 0 ? 2 : 3;
  const correct = `${g}(${lin(u, w)})`;
  return {
    question: "Factor completely.",
    expr: lin(g * u, g * w),
    ...mkChoices(correct, [
      `${d}(${lin((g * u) / d, (g * w) / d)})`,
      `${g}(${lin(u, g * w)})`,
      `${g}(${lin(g * u, w)})`,
      `${g}(${lin(u, -w)})`,
    ]),
    steps: [
      `The biggest number that divides ${g * u} and ${Math.abs(g * w)} is ${g}`,
      `Divide each term by ${g}: ${lin(u, w)}`,
      `So the answer is ${correct}`,
    ],
    hint: "Find the highest common factor of both terms. Pulling out only part of it leaves a bracket that can still be factored.",
  };
}

/* ---------- Rational or irrational ---------- */
const POOL = {
  r1: [["7", "7 = 7/1"], ["−3", "−3 = −3/1"], ["1/2", "a fraction of two integers"], ["0.75", "0.75 = 3/4"], ["√9", "√9 = 3"],
    ["3/8", "a fraction of two integers"], ["−4/5", "a fraction of two integers"], ["√49", "√49 = 7"], ["0.2", "0.2 = 1/5"], ["√100", "√100 = 10"]],
  i1: [["√2", "2 is not a perfect square"], ["√3", "3 is not a perfect square"], ["√5", "5 is not a perfect square"], ["π", "π never ends and never repeats"],
    ["√7", "7 is not a perfect square"], ["√10", "10 is not a perfect square"], ["√11", "11 is not a perfect square"]],
  r2: [["0.333… (repeating)", "a repeating decimal, equal to 1/3"], ["22/7", "a fraction of two integers"], ["3.14", "it ends, so it is 314/100"],
    ["√(1/4)", "√(1/4) = 1/2"], ["∛27", "∛27 = 3"], ["0.125", "0.125 = 1/8"], ["−√36", "−√36 = −6"],
    ["0.2727… (27 repeats)", "a repeating decimal, equal to 3/11"], ["√(9/16)", "√(9/16) = 3/4"]],
  i2: [["0.1010010001…", "the pattern never repeats"], ["3√2", "3 times an irrational number"], ["√2 + 1", "irrational plus rational stays irrational"],
    ["−√5", "the negative of an irrational number"], ["2π", "2 times π"], ["√12", "√12 = 2√3, and 3 is not a perfect square"], ["√0.5", "√0.5 = √2 ÷ 2"]],
  r3: [["√8 ÷ √2", "√8 ÷ √2 = √4 = 2"], ["√2 × √8", "√2 × √8 = √16 = 4"], ["(√3)²", "(√3)² = 3"], ["√18 ÷ √2", "√18 ÷ √2 = √9 = 3"],
    ["(√5 + 1)(√5 − 1)", "5 − 1 = 4"], ["√2 × √2", "√2 × √2 = 2"], ["√0.25", "√0.25 = 0.5"], ["(2√3)²", "4 × 3 = 12"]],
  i3: [["√2 + √3", "cannot be written as a fraction"], ["√2 × √3", "√2 × √3 = √6, and 6 is not a perfect square"], ["2 + √5", "rational plus irrational"],
    ["√50", "√50 = 5√2"], ["√2 + √2", "√2 + √2 = 2√2"], ["π − 3", "irrational minus rational"], ["5/√2", "5/√2 = 5√2/2"], ["(1 + √2)²", "= 3 + 2√2"]],
};

export function genNumbers(L) {
  const R = L === 1 ? POOL.r1 : L === 2 ? [...POOL.r2, ...POOL.r1.slice(0, 4)] : [...POOL.r3, ...POOL.r2.slice(0, 3)];
  const I = L === 1 ? POOL.i1 : L === 2 ? [...POOL.i2, ...POOL.i1.slice(0, 3)] : [...POOL.i3, ...POOL.i2.slice(0, 3)];
  const rationalTexts = new Set(R.map((x) => x[0]));
  const askIrrational = Math.random() < 0.5;
  const one = pick(askIrrational ? I : R);
  const others = shuf(askIrrational ? R : I).slice(0, 3);
  const items = shuf([one, ...others]);
  return {
    question: `Which of these numbers is ${askIrrational ? "irrational" : "rational"}?`,
    choices: items.map((x) => x[0]),
    correct_answer: one[0],
    steps: items.map((it) => `${it[0]} is ${rationalTexts.has(it[0]) ? "rational" : "irrational"}: ${it[1]}`),
    hint:
      "Rational numbers can be written as a fraction of two integers, so their decimals end or repeat. A square root of a number that is not a perfect square is irrational.",
  };
}

/* ---------- Proportion ---------- */
export function genProportion(L) {
  const kind = pick(L === 1 ? ["ratio", "direct"] : L === 2 ? ["direct", "inverse", "identify"] : ["inverse", "identify", "identify"]);

  if (kind === "ratio") {
    let a, b;
    do { a = ri(1, 5); b = ri(1, 5); } while (a === b);
    const unit = ri(2, 9), total = (a + b) * unit, ans = Math.max(a, b) * unit;
    return {
      question: `Share ${total} in the ratio ${a} : ${b}. How much is the larger share?`,
      visual: ratioSVG(a, b),
      ...numChoices(ans, { extras: [Math.min(a, b) * unit, unit, total - unit] }),
      steps: [`Total parts: ${a} + ${b} = ${a + b}`, `One part: ${total} ÷ ${a + b} = ${unit}`, `Larger share: ${Math.max(a, b)} × ${unit} = ${ans}`],
      hint: "Add the parts, divide the total by that to find one part, then multiply.",
    };
  }

  if (kind === "direct") {
    const k = ri(2, 9), p = ri(2, 8);
    let r;
    do { r = ri(2, 12); } while (r === p);
    const ctx = pick([["pay in $", "hours worked"], ["cost in $", "kilograms of rice"], ["pages printed", "minutes"]]);
    const mid = r * 0.4 + p * 0.1;
    return {
      question: `The ${ctx[0]} is directly proportional to the ${ctx[1]}. When x = ${p}, y = ${k * p}. Find y when x = ${r}.`,
      visual: tableHTML([p, r], [k * p, 0], 1) + plotSVG([[p, k * p], [mid, k * mid]], "line", k),
      ...numChoices(k * r, { extras: [k * p + (r - p), k + r, k * r + k] }),
      steps: [`Direct proportion: y ÷ x stays the same. ${k * p} ÷ ${p} = ${k}`, `So y = ${k}x, and y = ${k} × ${r} = ${k * r}`],
      hint: "Find the constant y ÷ x from the known pair, then multiply it by the new x.",
    };
  }

  if (kind === "inverse") {
    let w, d, K, opts;
    do {
      w = ri(2, 12); d = ri(2, 12); K = w * d;
      opts = divisors(K).filter((v) => v !== w && v <= 30);
    } while (!opts.length);
    const w2 = pick(opts), ans = K / w2;
    const abstract = Math.random() < 0.4;
    const question = abstract
      ? `y is inversely proportional to x. When x = ${w}, y = ${d}. Find y when x = ${w2}.`
      : `${w} workers finish a job in ${d} days. The number of workers and the days are inversely proportional. How many days would ${w2} workers need?`;
    return {
      question,
      visual: tableHTML([w, w2], [d, 0], 1) + plotSVG([[w, d]], "hyper", K),
      ...numChoices(ans, { positive: true, extras: [Math.round((d * w2) / w) || 1, d + (w2 - w), K - w2] }),
      steps: [`Inverse proportion: x × y stays the same. ${w} × ${d} = ${K}`, `${w2} × y = ${K}, so y = ${K} ÷ ${w2} = ${ans}`],
      hint: "Multiply the known x and y to get the constant, then divide it by the new value.",
    };
  }

  // identify the relationship from a table + graph
  const t = pick(["direct", "inverse", "neither"]);
  let xs, ys;
  if (t === "direct") {
    const k = ri(2, 6);
    xs = shuf([1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 4).sort((a, b) => a - b);
    ys = xs.map((x) => k * x);
  } else if (t === "inverse") {
    const K = pick([12, 24, 36, 60]);
    xs = shuf(divisors(K).filter((v) => v <= 12)).slice(0, 4).sort((a, b) => a - b);
    ys = xs.map((x) => K / x);
  } else {
    const k = ri(1, 3), c = ri(1, 5);
    xs = shuf([1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 4).sort((a, b) => a - b);
    ys = xs.map((x) => k * x + c);
  }
  const names = { direct: "Directly proportional", inverse: "Inversely proportional", neither: "Neither" };
  const ratios = xs.map((x, i) => frStr(ys[i], x)).join(", ");
  const prods = xs.map((x, i) => x * ys[i]).join(", ");
  const steps =
    t === "direct"
      ? [`y ÷ x gives ${ratios}, always the same`, "A constant y ÷ x means direct proportion"]
      : t === "inverse"
        ? [`x × y gives ${prods}, always the same`, "A constant x × y means inverse proportion"]
        : [`y ÷ x gives ${ratios}, which changes`, `x × y gives ${prods}, which also changes`, "Neither is constant, so the relationship is neither"];
  return {
    question: "Look at the table and the graph. How are y and x related?",
    visual: tableHTML(xs, ys, -1) + plotSVG(xs.map((x, i) => [x, ys[i]]), null, 0),
    choices: Object.values(names),
    correct_answer: names[t],
    steps,
    hint: "Test two things: is y ÷ x the same for every column, or is x × y the same?",
  };
}

/* ---------- Lines and graphs ---------- */
function lineEq(p, q, c) {
  const m = q === 1 ? (p === 1 ? "" : p === -1 ? "−" : N(p)) : "(" + N(p) + "/" + q + ")";
  return "y = " + m + "x" + (c !== 0 ? " " + sgn(c) + " " + Math.abs(c) : "");
}

export function genLines(L, depth = 0) {
  const kind = pick(L === 1 ? ["yint", "slope"] : L === 2 ? ["slope", "equation", "yint"] : ["slope", "equation", "point"]);
  for (let tries = 0; tries < 200; tries++) {
    const q = pick(L === 1 ? [1] : L === 2 ? [1, 1, 2] : [1, 2, 3]);
    const p = q === 1 ? pick([1, 2, 3, -1, -2, -3]) : pick([1, 3, -1, -3, 2, -2].filter((v) => gcd(Math.abs(v), q) === 1));
    const c = ri(-3, 3);
    const cand = [];
    for (let x = -6; x <= 6; x++) {
      if ((p * x) % q === 0) {
        const y = (p * x) / q + c;
        if (y >= -6 && y <= 6) cand.push({ x, y });
      }
    }
    if (cand.length < 4) continue;
    const eq = lineEq(p, q, c), ms = frStr(p, q);

    if (kind === "yint" || kind === "slope") {
      const two = shuf(cand);
      let a = two[0], b = two[1];
      for (let i = 1; i < two.length; i++) {
        if (Math.abs(two[i].x - a.x) >= 2) { b = two[i]; break; }
      }
      if (Math.abs(b.x - a.x) < 1) continue;
      if (a.x > b.x) { const tmp = a; a = b; b = tmp; }
      const dy = b.y - a.y, dx = b.x - a.x;
      const visual = gridSVG(p, q, c, [a, b]);

      if (kind === "slope") {
        return {
          question: "Find the slope of the line.",
          visual,
          ...mkChoices(ms, [frStr(q, p), frStr(-p, q), frStr(p + 1, q), frStr(p - 1, q), frStr(p, q + 1), frStr(2 * p, q), frStr(dy, dx + 1)]),
          steps: [
            "slope = (y₂ − y₁) ÷ (x₂ − x₁)",
            `= (${N(b.y)} − (${N(a.y)})) ÷ (${N(b.x)} − (${N(a.x)}))`,
            `= ${N(dy)} ÷ ${N(dx)} = ${ms}`,
          ],
          hint: "Pick the two marked points. Slope is rise over run: the change in y divided by the change in x.",
        };
      }
      return {
        question: "Where does the line cross the y-axis? Give the y-intercept.",
        visual,
        ...numChoices(c, { extras: [-c, p / q === Math.round(p / q) ? p / q : c + 1, a.y] }),
        steps: [
          `The slope from the marked points is ${N(dy)} ÷ ${N(dx)} = ${ms}`,
          `So y = ${q === 1 ? coef(p, "x") : "(" + ms + ")x"} + c`,
          `Put in the point (${N(a.x)}, ${N(a.y)}): c = ${N(a.y)} − (${ms}) × (${N(a.x)}) = ${N(c)}`,
        ],
        hint: "The y-intercept is where the line meets the y-axis, at x = 0. If it is not marked, use the slope to walk back to x = 0.",
      };
    }

    if (kind === "equation") {
      const two = shuf(cand);
      return {
        question: "Which equation matches the line?",
        visual: gridSVG(p, q, c, [two[0], two[1]]),
        ...mkChoices(eq, [lineEq(-p, q, c), lineEq(p, q, -c), lineEq(p, q, c + 1), lineEq(p, q, c - 1), lineEq(p + (p > 0 ? 1 : -1), q, c)]),
        steps: [`Slope from the marked points: ${ms}`, `The line crosses the y-axis at ${N(c)}`, `So the equation is ${eq}`],
        hint: "Find the slope and the y-intercept, then write y = mx + c.",
      };
    }

    // point on the line
    const on = pick(cand), others = [];
    const used = new Set([on.x + "," + on.y]);
    let guard = 0;
    while (others.length < 3 && guard++ < 100) {
      const x = ri(-5, 5), off = pick([-2, -1, 1, 2]), ty = (p * x) / q + c, y = Math.round(ty) + off;
      if (y < -6 || y > 6 || Math.abs(y - ty) < 0.5 || used.has(x + "," + y)) continue;
      used.add(x + "," + y);
      others.push({ x, y });
    }
    if (others.length < 3) continue;
    const all = shuf([on, ...others]), letters = ["A", "B", "C", "D"];
    const pts = all.map((pt, i) => ({ x: pt.x, y: pt.y, label: letters[i] }));
    const choices = all.map((pt, i) => `${letters[i]} (${N(pt.x)}, ${N(pt.y)})`);
    const ai = all.indexOf(on);
    return {
      question: `Which labelled point lies on the line ${eq}?`,
      visual: gridSVG(p, q, c, pts),
      choices,
      correct_answer: choices[ai],
      steps: [
        `Put each x into ${eq} and see if you get the point's y`,
        `For ${choices[ai]}: y = ${ms} × ${N(on.x)}${c ? " " + sgn(c) + " " + Math.abs(c) : ""} = ${N(on.y)}`,
        `So ${letters[ai]} is on the line`,
      ],
      hint: "A point is on the line when its coordinates fit the equation. Try the x value in the equation.",
    };
  }
  // Level 1 always finds a line within a few tries; the depth guard just rules out endless recursion.
  if (depth > 5) throw new Error("genLines: could not build a question");
  return genLines(1, depth + 1);
}

/* ---------- Pythagoras ---------- */
const TRI = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [6, 8, 10], [9, 12, 15], [12, 16, 20], [15, 20, 25]];

export function genPythagoras(L) {
  const kind = pick(L === 1 ? ["hyp"] : L === 2 ? ["leg", "hyp"] : ["exact", "converse", "leg"]);

  if (kind === "hyp" || kind === "leg") {
    let [a, b, c] = pick(TRI);
    if (Math.random() < 0.5) { const t = a; a = b; b = t; }
    if (kind === "hyp") {
      return {
        question: "Find the length of the hypotenuse.",
        visual: triSVG(a, b, c, "c"),
        ...numChoices(c, { positive: true, extras: [a + b, a * a + b * b, Math.abs(a - b)] }),
        steps: [`c² = a² + b² = ${a * a} + ${b * b} = ${c * c}`, `c = √${c * c} = ${c}`],
        hint: "Square both short sides and add them. Then take the square root.",
      };
    }
    return {
      question: "Find the missing side.",
      visual: triSVG(a, b, c, "a"),
      ...numChoices(a, { positive: true, extras: [c - b, c + b, c * c - b * b] }),
      steps: [`a² + b² = c², so a² = c² − b² = ${c * c} − ${b * b} = ${a * a}`, `a = √${a * a} = ${a}`],
      hint: "The hypotenuse is the longest side. Subtract the square of the known short side from the square of the hypotenuse.",
    };
  }

  if (kind === "exact") {
    let a, b, s;
    do {
      a = ri(2, 8); b = ri(2, 8); s = a * a + b * b;
    } while (a === b || Number.isInteger(Math.sqrt(s)));
    return {
      question: `A right-angled triangle has short sides ${a} and ${b}. What is the exact length of the hypotenuse?`,
      visual: triSVG(a, b, Math.sqrt(s).toFixed(2), "c"),
      ...mkChoices("√" + s, ["" + (a + b), "√" + Math.abs(a * a - b * b), "" + s, "√" + (a + b)]),
      steps: [
        `c² = ${a}² + ${b}² = ${a * a} + ${b * b} = ${s}`,
        `c = √${s}, which is irrational, so the exact length is √${s} (about ${Math.sqrt(s).toFixed(2)})`,
      ],
      hint: "Add the squares of the short sides. If the total is not a perfect square, leave the answer as a square root.",
    };
  }

  // converse
  const [a, b, c0] = pick(TRI.slice(0, 5));
  const right = Math.random() < 0.5;
  const c = right ? c0 : c0 + pick([-1, 1]);
  const yes = "Yes, it is right-angled", no = "No, it is not";
  return {
    question: `A triangle has sides ${a}, ${b} and ${c}. Is it right-angled?`,
    choices: [yes, no],
    correct_answer: right ? yes : no,
    steps: [
      "Test a² + b² = c² with the longest side as c",
      `${a}² + ${b}² = ${a * a + b * b} and ${c}² = ${c * c}`,
      right ? "They match, so it is right-angled" : "They differ, so it is not right-angled",
    ],
    hint: "Square the two shorter sides and add them. Compare with the square of the longest side.",
  };
}

/* ========================================================================
   TOPIC REGISTRY + SESSION BUILDERS
   ======================================================================== */

export const GROUP_NUMBERS = "Numbers and algebra";
export const GROUP_SHAPES = "Relationships and shapes";
export const GROUP_SHEET = "Others"; // heading for sheet topics no generator covers (shown uppercase: OTHERS)

/** Order matters: the first matching `match` wins (so "Linear equations" never lands on "lines"). */
export const TOPIC_DEFS = [
  { key: "equations", label: "Linear equations", group: GROUP_NUMBERS, blurb: "Balance the scale and solve for x.", match: /linear|equation/i, gen: genEquation },
  { key: "algebra", label: "Algebra", group: GROUP_NUMBERS, blurb: "Evaluate, simplify, expand and factor.", match: /algebra|expression|expand|factori/i, gen: genAlgebra },
  { key: "numbers", label: "Rational or irrational", group: GROUP_NUMBERS, blurb: "Sort numbers by what their decimals do.", match: /rational|irrational/i, gen: genNumbers },
  { key: "proportion", label: "Proportion", group: GROUP_SHAPES, blurb: "Ratios, direct and inverse proportion, with tables and graphs.", match: /proportion|ratio/i, gen: genProportion },
  { key: "lines", label: "Lines and graphs", group: GROUP_SHAPES, blurb: "Slope, intercept and equations read from a grid.", match: /\blines?\b|graph|gradient|slope|coordinate/i, gen: genLines },
  { key: "pythagoras", label: "Pythagoras", group: GROUP_SHAPES, blurb: "Find sides of right triangles and test for a right angle.", match: /pythag|right.?angle|triangle/i, gen: genPythagoras },
];

/** Which generator (if any) serves a topic name coming from the sheet. */
export function topicDefFor(name) {
  return TOPIC_DEFS.find((d) => d.match.test(name)) ?? null;
}

export const SESSION_SIZE = 10;
const levelAt = (i, n) => (i < n * 0.3 ? 1 : i < n * 0.7 ? 2 : 3);

let serial = 0;

/** One generated question, retrying a few times to avoid repeats inside a session. */
function make(def, level, seen) {
  let q;
  for (let t = 0; t < 12; t++) {
    q = def.gen(level);
    const sig = `${q.question}|${q.expr ?? ""}|${q.correct_answer}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      break;
    }
  }
  return { ...q, id: `gen-${++serial}`, topic: def.label, level, generated: true };
}

/**
 * Questions for one topic card.
 *   entry     – { def, sheetNames }  (def = generator or null)
 *   questions – every question loaded from the sheet (or the bundled fallback)
 * Sheet questions are the primary stream (up to half the session); the generator
 * fills the rest, ramping difficulty. Sheet-only topics play every sheet question.
 */
export function buildTopicSession(entry, questions, size = SESSION_SIZE) {
  const curated = shuf(questions.filter((q) => entry.sheetNames.includes(q.topic)));
  if (!entry.def) return curated;

  const n = Math.min(curated.length, Math.floor(size / 2));
  const kinds = shuf([...Array(n).fill("c"), ...Array(size - n).fill("g")]);
  const seen = new Set();
  let ci = 0;
  return kinds.map((k, i) => (k === "c" ? curated[ci++] : make(entry.def, levelAt(i, size), seen)));
}

/** "Mixed Practice Challenge": sheet questions and every generator, shuffled together. */
export function buildMixedSession(questions, size = SESSION_SIZE) {
  const sheetPick = shuf(questions).slice(0, Math.floor(size / 2));
  const kinds = shuf([...Array(sheetPick.length).fill("c"), ...Array(size - sheetPick.length).fill("g")]);
  const defs = shuf(TOPIC_DEFS);
  const seen = new Set();
  let ci = 0, di = 0;
  return kinds.map((k, i) => (k === "c" ? sheetPick[ci++] : make(defs[di++ % defs.length], levelAt(i, size), seen)));
}
