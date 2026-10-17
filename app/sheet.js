// ---------------------------------------------------------------------------
// GOOGLE SHEETS (CSV) QUESTION LOADER
//
// Expected sheet columns (header row required, order doesn't matter):
//
//   id | topic | question | choices | correct_answer
//
//   - `choices` is ONE cell with comma-separated answers, e.g.  15, 18, 20, 36
//     (wrap the whole cell in quotes if your sheet export doesn't do it for you).
//   - `correct_answer` must match one of the choices (case-insensitive).
//   - Alternatively use four columns: choice_a | choice_b | choice_c | choice_d
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
 * Commas inside the cell separate the answers; surrounding quotes/whitespace
 * are stripped and empty entries dropped.
 */
export function splitChoices(cell) {
  return String(cell ?? "")
    .split(",")
    .map((c) => c.trim().replace(/^["']+|["']+$/g, "").trim())
    .filter(Boolean);
}

/**
 * Converts CSV text into question objects:
 *   { id, topic, question, choices: string[], correct_answer }
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

    out.push({
      id: iId >= 0 && (r[iId] ?? "").trim() ? r[iId].trim() : `sheet-${n + 1}`,
      topic,
      question,
      choices,
      correct_answer,
    });
  });

  return out;
}
