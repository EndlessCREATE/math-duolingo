// ---------------------------------------------------------------------------
// MASCOT MILE-MARKERS
//
// The quiz keeps a session tracker (one entry per checked answer). Every time
// the tracker length reaches a multiple of MILESTONE_EVERY, Pieter pops up with
// a message from here:
//   • a perfect run  → a cheer that names the real "in a row" count
//   • otherwise      → alternates between a math fun-fact and a kind nudge
// ---------------------------------------------------------------------------

export const MILESTONE_EVERY = 5;

const FACTS = [
  "Did you know? The fraction 22/7 is a close approximation of Pi, but Pi itself is irrational and its digits never repeat!",
  "Did you know? A googol is 1 followed by 100 zeros. The search engine Google got its name from a misspelling of it!",
  "Did you know? The equals sign (=) was invented in 1557 by Robert Recorde, who was tired of writing “is equal to”.",
  "Did you know? 111,111,111 × 111,111,111 = 12,345,678,987,654,321. Check it on a calculator!",
  "Did you know? Pythagoras' theorem has hundreds of known proofs, and one of them was published by US president James Garfield!",
  "Did you know? Pi Day is celebrated every year on March 14th (3/14), because Pi starts 3.14!",
  "Did you know? A circle has infinitely many lines of symmetry. Spin it any way you like!",
  "Did you know? The ancient Romans had no symbol for zero. The idea travelled to Europe from India and the Arab world.",
];

const NUDGES = [
  (n) => `${n} questions down! Every mistake is just your brain levelling up. Let's keep going!`,
  (n) => `Nice persistence! ${n} answered, and the next ones get easier with every try. You've got this!`,
  (n) => `${n} answered! Champions aren't the ones who never slip, they're the ones who keep playing. On we go!`,
];

/** @returns {{ kind: "cheer" | "fact" | "nudge", text: string }} */
export function milestoneMessage({ answered, streak }) {
  const nth = Math.round(answered / MILESTONE_EVERY); // 1st, 2nd, 3rd milestone…

  if (streak >= MILESTONE_EVERY) {
    return {
      kind: "cheer",
      text: `Incredible! That's ${streak} answers solved in a row! Your brain is operating at maximum efficiency. Let's keep crushing it!`,
    };
  }
  if (nth % 2 === 1) {
    return { kind: "fact", text: FACTS[Math.floor(Math.random() * FACTS.length)] };
  }
  return { kind: "nudge", text: NUDGES[Math.floor(Math.random() * NUDGES.length)](answered) };
}

/** Consecutive correct answers at the end of the tracker. */
export function trailingStreak(history) {
  let s = 0;
  for (let i = history.length - 1; i >= 0 && history[i]; i--) s++;
  return s;
}
