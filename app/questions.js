// ---------------------------------------------------------------------------
// QUESTION BANK
//
// Every question has:
//   id             – unique number or string
//   topic          – topic name (the home screen builds its cards from these)
//   question       – the prompt shown to the learner
//   choices        – array of answer strings
//   correct_answer – must match one of the strings in `choices` exactly
// ---------------------------------------------------------------------------

export const questions = [
  // ---------------- Inverse & Direct Proportions ----------------
  {
    id: 1,
    topic: "Inverse & Direct Proportions",
    question:
      "y is directly proportional to x. If y = 12 when x = 3, what is y when x = 5?",
    choices: ["15", "18", "20", "36"],
    correct_answer: "20",
  },
  {
    id: 2,
    topic: "Inverse & Direct Proportions",
    question:
      "4 workers build a wall in 6 days. Working at the same rate, how many days would 8 workers take?",
    choices: ["12 days", "3 days", "4 days", "2 days"],
    correct_answer: "3 days",
  },
  {
    id: 3,
    topic: "Inverse & Direct Proportions",
    question: "Which statement describes inverse proportion?",
    choices: [
      "When one quantity doubles, the other also doubles",
      "When one quantity doubles, the other halves",
      "When one quantity doubles, the other increases by 2",
      "The two quantities are always equal",
    ],
    correct_answer: "When one quantity doubles, the other halves",
  },
  {
    id: 4,
    topic: "Inverse & Direct Proportions",
    question:
      "A car uses 10 litres of fuel to travel 150 km. How many litres are needed for 360 km?",
    choices: ["20 litres", "22 litres", "24 litres", "26 litres"],
    correct_answer: "24 litres",
  },
  {
    id: 5,
    topic: "Inverse & Direct Proportions",
    question:
      "y is inversely proportional to x. If y = 6 when x = 4, what is y when x = 3?",
    choices: ["4.5", "6", "8", "12"],
    correct_answer: "8",
  },

  // ---------------- Rational & Irrational numbers ----------------
  {
    id: 6,
    topic: "Rational & Irrational numbers",
    question: "Which of these numbers is irrational?",
    choices: ["√16", "0.75", "22/7", "√2"],
    correct_answer: "√2",
  },
  {
    id: 7,
    topic: "Rational & Irrational numbers",
    question: "Which of these numbers is rational?",
    choices: ["π", "√49", "√3", "√10"],
    correct_answer: "√49",
  },
  {
    id: 8,
    topic: "Rational & Irrational numbers",
    question: "The sum of a rational number and an irrational number is always…",
    choices: ["Rational", "Irrational", "An integer", "Zero"],
    correct_answer: "Irrational",
  },
  {
    id: 9,
    topic: "Rational & Irrational numbers",
    question: "Which fraction is equal to the decimal 0.125?",
    choices: ["1/4", "1/5", "1/8", "1/12"],
    correct_answer: "1/8",
  },
  {
    id: 10,
    topic: "Rational & Irrational numbers",
    question: "Which decimal is a rational number?",
    choices: [
      "0.1010010001… (never repeats)",
      "3.14159265… (never repeats)",
      "0.333… (the 3 repeats forever)",
      "1.41421356… (never repeats)",
    ],
    correct_answer: "0.333… (the 3 repeats forever)",
  },

  // ---------------- Standard Form & Non-Standard Form ----------------
  {
    id: 11,
    topic: "Standard Form & Non-Standard Form",
    question: "Write 4 500 in standard form.",
    choices: ["45 × 10²", "4.5 × 10³", "0.45 × 10⁴", "4.5 × 10²"],
    correct_answer: "4.5 × 10³",
  },
  {
    id: 12,
    topic: "Standard Form & Non-Standard Form",
    question: "Write 0.00072 in standard form.",
    choices: ["7.2 × 10⁻³", "72 × 10⁻⁵", "7.2 × 10⁻⁴", "7.2 × 10⁴"],
    correct_answer: "7.2 × 10⁻⁴",
  },
  {
    id: 13,
    topic: "Standard Form & Non-Standard Form",
    question: "Which of these is NOT written in standard form?",
    choices: ["3.8 × 10⁵", "25 × 10⁴", "9.9 × 10⁻²", "1 × 10⁷"],
    correct_answer: "25 × 10⁴",
  },
  {
    id: 14,
    topic: "Standard Form & Non-Standard Form",
    question: "Write 3.2 × 10⁵ as an ordinary number.",
    choices: ["3 200", "32 000", "320 000", "3 200 000"],
    correct_answer: "320 000",
  },
  {
    id: 15,
    topic: "Standard Form & Non-Standard Form",
    question: "Calculate (2 × 10³) × (3 × 10⁴). Give your answer in standard form.",
    choices: ["5 × 10⁷", "6 × 10⁷", "6 × 10¹²", "5 × 10¹²"],
    correct_answer: "6 × 10⁷",
  },
];

// ---------------------------------------------------------------------------
// TODO: GOOGLE SHEET API SYNC
//
// Later, replace the hard-coded `questions` array above with data loaded from
// a Google Sheet. Suggested plan:
//   1. Publish a sheet with columns:
//        id | topic | question | choice_a | choice_b | choice_c | choice_d | correct_answer
//   2. Fetch it with the Google Sheets API v4, e.g.
//        https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/Questions?key={API_KEY}
//      (keep the key in .env.local and call it from a server component / route handler).
//   3. Map each row to the shape used above and return it from the function below.
//   4. In app/page.js, swap `import { questions }` for `await getQuestions()`
//      (or load it in a server component and pass it down as a prop).
//
// export async function getQuestions() {
//   const res = await fetch(SHEET_URL, { next: { revalidate: 300 } });
//   const { values } = await res.json();
//   const [, ...rows] = values; // skip header row
//   return rows.map(([id, topic, question, a, b, c, d, correct_answer]) => ({
//     id, topic, question, choices: [a, b, c, d], correct_answer,
//   }));
// }
// ---------------------------------------------------------------------------

export default questions;
