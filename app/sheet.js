// ---------------------------------------------------------------------------
// GOOGLE SHEETS (CSV) QUESTION LOADER
//
// Expected sheet columns (header row required, order doesn't matter):
//
//   id | topic | question | choices | correct_answer
//
//   - `choices` (or `options`) is ONE cell with answers separated by a pipe "|", e.g.
//         Option A | Option B, with details | 49,000 | Option D
//     so commas inside an answer are safe. (A cell with no "|" at all is still read
//     as comma-separated, the old format, so unconverted rows keep working.)
//   - `correct_answer` must match one of the choices (case-insensitive).
//   - Alternatively use four columns: choice_a | choice_b | choice_c | choice_d
//   - Optional: a `hint` column (also accepted: hints, tip). Rows with hint text get
//     a "Need a hint?" button in the quiz; rows with an empty hint cell get none.
//   - Optional: a `graph_data` column, points as "x,y" pairs separated by ";", e.g.
//         -2,0; 0,2; 2,4
//     Rows with at least two valid points get a coordinate-grid graph in the quiz;
//     a blank or unusable cell means a normal text question.
//
// The sheet itself must be shared as "Anyone with the link → Viewer"
// (Share button, top-right of Google Sheets). The download URL is built in
// app/page.js (look for GOOGLE_SHEET_URL) by turning the normal "/edit" link
// into a ".../export?format=csv" link.
// ---------------------------------------------------------------------------

/**
 * Minimal RFC-4180 CSV parser: handles quoted cells, escaped quotes (""),
 * commas and newlines inside quotes, and \r\n / \n line endings.
 * @param {string} text
 * @returns {string[][]} rows of cells
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  const src = text.replace(/^\uFEFF/, ""); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  // last cell / row (file without trailing newline)
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Splits the `choices` cell into an array of answer strings.
 *
 * The separator is the pipe "|":   Option A | Option B, with details | 49,000 | Option D
 * so commas inside an answer (coordinates, "49,000", sentences) stay in that answer.
 *
 * Backward compatibility: a cell with NO pipe in it is split on commas instead (the old
 * format), so a sheet that hasn't been converted yet keeps working. Such a cell could never
 * have produced the required two choices under pipe-only rules, so the fallback can't change
 * how a pipe-formatted cell is read.
 *
 * Surrounding quotes/whitespace are stripped and empty entries dropped.
 */
export function splitChoices(cell) {
  const raw = String(cell ?? "");
  const separator = raw.includes("|") ? "|" : ",";
  return raw
    .split(separator)
    .map((c) => c.trim().replace(/^["']+|["']+$/g, "").trim())
    .filter(Boolean);
}

/**
 * Parses the optional `graph_data` cell into [[x, y], ...].
 *   "-2,0; 0,2; 2,4"   points separated by ";", x and y separated by "," (or ":")
 * Brackets and a unicode minus are tolerated: "(−2, 0); (0, 2)".
 * Invalid points are dropped; fewer than 2 valid points returns null, and the
 * question is then treated as a normal text question.
 */
export function parseGraphData(cell) {
  const text = String(cell ?? "").trim();
  if (!text) return null;

  const points = [];
  for (const part of text.split(/[;\n]+/)) {
    const cleaned = part.replace(/[()[\]]/g, "").replace(/\u2212/g, "-").trim();
    if (!cleaned) continue;
    const nums = cleaned.split(/[,:]/).map((s) => s.trim());
    if (nums.length !== 2 || nums.some((s) => s === "")) continue;
    const x = Number(nums[0]);
    const y = Number(nums[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) continue;
    points.push([x, y]);
    if (points.length === 24) break; // plenty for a single diagram
  }

  const distinct = new Set(points.map(([x, y]) => `${x},${y}`));
  return distinct.size >= 2 ? points : null;
}

/**
 * Converts CSV text into question objects:
 *   { id, topic, question, choices: string[], correct_answer, hint?, graph?: [x, y][] }
 * Invalid rows are skipped. Returns [] if the text isn't a usable question
 * sheet at all (e.g. an HTML page or a missing header).
 */
export function parseQuestionsFromCSV(text) {
  const rows = parseCSV(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (...names) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;

  const iId = col("id");
  const iTopic = col("topic");
  const iQuestion = col("question");
  const iChoices = col("choices", "options");
  const iCorrect = col("correct_answer", "answer", "correct");
  const iLetters = ["choice_a", "choice_b", "choice_c", "choice_d"].map((n) => col(n));
  const iHint = col("hint", "hints", "tip"); // optional column: shown behind the quiz's "Need a hint?" button
  const iGraph = col("graph_data", "graphdata", "graph"); // optional column: points for an embedded graph

  const hasChoices = iChoices >= 0 || iLetters.every((i) => i >= 0);
  if (iTopic < 0 || iQuestion < 0 || iCorrect < 0 || !hasChoices) return [];

  const out = [];
  rows.slice(1).forEach((r, n) => {
    const topic = (r[iTopic] ?? "").trim();
    const question = (r[iQuestion] ?? "").trim();
    const correctRaw = (r[iCorrect] ?? "").trim();

    const choices =
      iChoices >= 0
        ? splitChoices(r[iChoices])
        : iLetters.map((i) => (r[i] ?? "").trim()).filter(Boolean);

    // Snap the correct answer to the exact choice string (case-insensitive).
    const correct_answer = choices.find((c) => c.toLowerCase() === correctRaw.toLowerCase());

    if (!topic || !question || choices.length < 2 || !correct_answer) return; // skip bad row

    const hint = iHint >= 0 ? (r[iHint] ?? "").trim() : "";
    const graph = iGraph >= 0 ? parseGraphData(r[iGraph]) : null; // blank / unusable -> plain text question

    out.push({
      id: iId >= 0 && (r[iId] ?? "").trim() ? r[iId].trim() : `sheet-${n + 1}`,
      topic,
      question,
      choices,
      correct_answer,
      ...(hint ? { hint } : {}), // only present when the sheet row has hint text
      ...(graph ? { graph } : {}), // only present when the row has usable graph_data
    });
  });

  return out;
}
