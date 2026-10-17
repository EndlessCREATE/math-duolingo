"use client";

import { useEffect, useMemo, useState } from "react";
import { questions } from "./questions";

/* ========================================================================
   CONSTANTS
   ======================================================================== */

const MAX_HEARTS = 3;
const XP_PER_CORRECT = 10;
const XP_PER_HEART_LEFT = 5;

const STORAGE_KEY = "mathlingo-state-v1";

// Accent themes. Only the app chrome uses these; Pieter's image is never tinted.
const THEMES = {
  green: {
    label: "Duolingo Green",
    accent: "#58cc02",
    dark: "#58a700",
    light: "#d7ffb8",
  },
  blue: {
    label: "Ocean Blue",
    accent: "#1cb0f6",
    dark: "#1899d6",
    light: "#ddf4ff",
  },
  purple: {
    label: "Amethyst Purple",
    accent: "#ce82ff",
    dark: "#a568cc",
    light: "#f3e0ff",
  },
};

// Decorative icon per topic. Unknown topics (e.g. from a future Google Sheet)
// fall back to DEFAULT_ICONS, cycled by index.
const TOPIC_ICONS = {
  "Inverse & Direct Proportions": "⚖️",
  "Rational & Irrational numbers": "π",
  "Standard Form & Non-Standard Form": "🔬",
};
const DEFAULT_ICONS = ["➕", "📐", "🧮", "📊", "🔢"];

// Mock global players (the user is merged in dynamically).
const MOCK_PLAYERS = [
  { name: "Euler_Fan", xp: 520, streak: 41 },
  { name: "PiLover3.14", xp: 465, streak: 28 },
  { name: "AlgebraAce", xp: 410, streak: 19 },
  { name: "Fractionator", xp: 355, streak: 12 },
  { name: "SumSensei", xp: 300, streak: 9 },
  { name: "NinjaNumbers", xp: 240, streak: 7 },
  { name: "GeoGirl", xp: 185, streak: 5 },
  { name: "ProofPanda", xp: 130, streak: 3 },
  { name: "MathMango", xp: 85, streak: 2 },
  { name: "ZeroToHero", xp: 45, streak: 1 },
];

/* ========================================================================
   HELPERS
   ======================================================================== */

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function buildLeaderboard(profile) {
  const you = {
    name: "You",
    xp: profile.xp,
    streak: profile.streak,
    isYou: true,
  };
  return [...MOCK_PLAYERS, you]
    .sort((a, b) => b.xp - a.xp || (a.isYou ? 1 : -1))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

/* ========================================================================
   PIETER (mascot) — never themed
   ======================================================================== */

function PieterFallback() {
  // Shown only if /pieter.png is missing. Fixed colors, ignores the theme.
  return (
    <svg viewBox="0 0 120 120" className="pieter-img" role="img" aria-label="Pieter placeholder">
      <circle cx="60" cy="64" r="44" fill="#ffc800" />
      <circle cx="44" cy="54" r="12" fill="#fff" />
      <circle cx="76" cy="54" r="12" fill="#fff" />
      <circle cx="46" cy="56" r="5" fill="#3c3c3c" />
      <circle cx="74" cy="56" r="5" fill="#3c3c3c" />
      <path d="M44 80 Q60 94 76 80" stroke="#3c3c3c" strokeWidth="5" fill="none" strokeLinecap="round" />
      <text x="60" y="30" textAnchor="middle" fontSize="20" fontWeight="900" fill="#3c3c3c">
        π
      </text>
    </svg>
  );
}

function Pieter({ size = 120 }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="pieter" style={{ width: size, height: size }}>
      {failed ? (
        <PieterFallback />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/pieter.png"
          alt="Pieter, your math mascot"
          className="pieter-img"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function PieterSays({ children, size = 120 }) {
  return (
    <div className="pieter-row">
      <Pieter size={size} />
      <div className="bubble">{children}</div>
    </div>
  );
}

/* ========================================================================
   NAVBAR
   ======================================================================== */

function Navbar({ themeKey, onThemeChange, profile, onLogoClick }) {
  return (
    <header className="navbar">
      <button className="logo" onClick={onLogoClick} aria-label="Go to home">
        <span className="logo-mark">∑</span>
        <span className="logo-text">mathlingo</span>
      </button>

      <div className="nav-right">
        <div className="stat-pill" title="Day streak">
          🔥 <b>{profile.streak}</b>
        </div>
        <div className="stat-pill xp" title="Total XP">
          ⚡ <b>{profile.xp}</b>
        </div>

        <label className="theme-select-wrap">
          <span className="swatch" aria-hidden="true" />
          <span className="sr-only">Accent theme</span>
          <select
            className="theme-select"
            value={themeKey}
            onChange={(e) => onThemeChange(e.target.value)}
          >
            {Object.entries(THEMES).map(([key, t]) => (
              <option key={key} value={key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}

/* ========================================================================
   HOME: TOPICS + LEADERBOARD
   ======================================================================== */

function TopicCards({ topics, onSelect }) {
  return (
    <section>
      <PieterSays>
        <b>Hi, I&apos;m Pieter! 👋</b>
        <br />
        Welcome to Mathlingo. Pick a topic and let&apos;s practise together —
        you&apos;ve got 3 hearts, so think carefully!
      </PieterSays>

      <h1 className="section-title">What math topic are you struggling on?</h1>

      <div className="topic-grid">
        {topics.map((t, i) => (
          <button key={t.name} className="topic-card" onClick={() => onSelect(t.name)}>
            <span className="topic-icon">
              {TOPIC_ICONS[t.name] ?? DEFAULT_ICONS[i % DEFAULT_ICONS.length]}
            </span>
            <span className="topic-name">{t.name}</span>
            <span className="topic-count">{t.count} questions</span>
            <span className="topic-start">START</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };

function Leaderboard({ profile }) {
  const board = useMemo(() => buildLeaderboard(profile), [profile]);

  return (
    <section>
      <h1 className="section-title">Global Leaderboard</h1>
      <p className="section-sub">Earn XP by finishing quizzes to climb the ranks.</p>

      <ol className="board">
        {board.map((p) => (
          <li key={p.name} className={`board-row ${p.isYou ? "you" : ""} ${p.rank <= 3 ? "top" : ""}`}>
            <span className="board-rank">
              {MEDALS[p.rank] && <span className="medal">{MEDALS[p.rank]}</span>}
              #{p.rank}
            </span>
            <span className="board-avatar">{p.name[0].toUpperCase()}</span>
            <span className="board-name">
              {p.name}
              {p.isYou && <em className="you-tag">YOU</em>}
            </span>
            <span className="board-streak">🔥 {p.streak}</span>
            <span className="board-xp">{p.xp} XP</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ========================================================================
   QUIZ
   ======================================================================== */

function Hearts({ count }) {
  return (
    <div className="hearts" aria-label={`${count} hearts left`}>
      {Array.from({ length: MAX_HEARTS }).map((_, i) => (
        <span key={i} className={`heart ${i < count ? "full" : "empty"}`}>
          {i < count ? "❤️" : "🖤"}
        </span>
      ))}
    </div>
  );
}

function Quiz({ topic, onExit, onGameOver, onComplete }) {
  // Only questions from the chosen topic, in random order.
  const [queue] = useState(() => shuffle(questions.filter((q) => q.topic === topic)));
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null); // null | "correct" | "wrong"
  const [hearts, setHearts] = useState(MAX_HEARTS);
  const [correctCount, setCorrectCount] = useState(0);

  const q = queue[index];
  const total = queue.length;
  const progress = ((index + (result ? 1 : 0)) / total) * 100;

  function check() {
    if (selected === null || result) return;
    if (selected === q.correct_answer) {
      setResult("correct");
      setCorrectCount((c) => c + 1);
    } else {
      setResult("wrong");
      setHearts((h) => h - 1);
    }
  }

  function next() {
    if (hearts <= 0) {
      onGameOver({ topic, correct: correctCount, total });
      return;
    }
    if (index + 1 >= total) {
      onComplete({ topic, correct: correctCount, total, heartsLeft: hearts });
      return;
    }
    setIndex(index + 1);
    setSelected(null);
    setResult(null);
  }

  if (!q) {
    return (
      <div className="center-screen">
        <p>No questions found for this topic yet.</p>
        <button className="btn" onClick={onExit}>Back</button>
      </div>
    );
  }

  return (
    <div className="quiz">
      <div className="quiz-top">
        <button className="close-btn" onClick={onExit} aria-label="Quit quiz">✕</button>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <Hearts count={hearts} />
      </div>

      <div className="quiz-body">
        <p className="quiz-topic">{topic}</p>
        <PieterSays size={90}>
          <b>{q.question}</b>
        </PieterSays>

        <div className="choices">
          {q.choices.map((choice) => {
            let state = "";
            if (result) {
              if (choice === q.correct_answer) state = "correct";
              else if (choice === selected) state = "wrong";
            } else if (choice === selected) {
              state = "selected";
            }
            return (
              <button
                key={choice}
                className={`choice ${state}`}
                disabled={!!result}
                onClick={() => setSelected(choice)}
              >
                {choice}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`quiz-footer ${result ?? ""}`}>
        <div className="footer-inner">
          <div className="feedback">
            {result === "correct" && (
              <>
                <span className="feedback-icon">✔</span>
                <div>
                  <div className="feedback-title">Nicely done!</div>
                </div>
              </>
            )}
            {result === "wrong" && (
              <>
                <span className="feedback-icon">✖</span>
                <div>
                  <div className="feedback-title">Not quite.</div>
                  <div className="feedback-sub">Correct answer: {q.correct_answer}</div>
                </div>
              </>
            )}
          </div>

          {result ? (
            <button className={`btn big ${result}`} onClick={next}>
              {hearts <= 0 ? "CONTINUE" : index + 1 >= total ? "FINISH" : "CONTINUE"}
            </button>
          ) : (
            <button className="btn big" disabled={selected === null} onClick={check}>
              CHECK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========================================================================
   END SCREENS
   ======================================================================== */

function GameOver({ info, onRetry, onHome }) {
  return (
    <div className="center-screen">
      <div className="end-card">
        <Pieter size={140} />
        <h1 className="end-title bad">Game Over</h1>
        <p className="end-text">
          You ran out of hearts on <b>{info.topic}</b>. You got {info.correct} of {info.total} right
          before running out — keep practising and try again!
        </p>
        <Hearts count={0} />
        <div className="end-actions">
          <button className="btn big" onClick={onRetry}>TRY AGAIN</button>
          <button className="btn ghost big" onClick={onHome}>BACK TO TOPICS</button>
        </div>
      </div>
    </div>
  );
}

function Complete({ info, earnedXp, rank, onHome, onLeaderboard }) {
  return (
    <div className="center-screen">
      <div className="end-card">
        <Pieter size={140} />
        <h1 className="end-title">Lesson complete! 🎉</h1>
        <p className="end-text">
          {info.correct} of {info.total} correct in <b>{info.topic}</b>.
        </p>

        <div className="result-stats">
          <div className="result-stat xp">
            <span className="rs-label">XP EARNED</span>
            <span className="rs-value">⚡ {earnedXp}</span>
          </div>
          <div className="result-stat hearts">
            <span className="rs-label">HEARTS LEFT</span>
            <span className="rs-value">❤️ {info.heartsLeft}</span>
          </div>
          <div className="result-stat rank">
            <span className="rs-label">GLOBAL RANK</span>
            <span className="rs-value">#{rank}</span>
          </div>
        </div>

        <div className="end-actions">
          <button className="btn big" onClick={onHome}>CONTINUE</button>
          <button className="btn ghost big" onClick={onLeaderboard}>VIEW LEADERBOARD</button>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================
   APP
   ======================================================================== */

export default function Page() {
  const [themeKey, setThemeKey] = useState("green");
  const [profile, setProfile] = useState({ xp: 0, streak: 0, lastActive: null });
  const [hydrated, setHydrated] = useState(false);

  const [tab, setTab] = useState("learn"); // "learn" | "leaderboard"
  const [screen, setScreen] = useState("home"); // "home" | "quiz" | "gameover" | "complete"
  const [topic, setTopic] = useState(null);
  const [quizKey, setQuizKey] = useState(0); // remount Quiz on retry
  const [endInfo, setEndInfo] = useState(null);
  const [earnedXp, setEarnedXp] = useState(0);

  // Unique topics, in the order they appear in questions.js
  const topics = useMemo(() => {
    const map = new Map();
    for (const q of questions) map.set(q.topic, (map.get(q.topic) ?? 0) + 1);
    return [...map].map(([name, count]) => ({ name, count }));
  }, []);

  // Load saved state
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved?.themeKey && THEMES[saved.themeKey]) setThemeKey(saved.themeKey);
      if (saved?.profile) setProfile(saved.profile);
    } catch {
      /* ignore corrupted storage */
    }
    setHydrated(true);
  }, []);

  // Save state
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ themeKey, profile }));
  }, [themeKey, profile, hydrated]);

  const theme = THEMES[themeKey];
  const themeVars = {
    "--accent": theme.accent,
    "--accent-dark": theme.dark,
    "--accent-light": theme.light,
  };

  function startQuiz(name) {
    setTopic(name);
    setQuizKey((k) => k + 1);
    setScreen("quiz");
  }

  function goHome(nextTab = "learn") {
    setTab(nextTab);
    setScreen("home");
  }

  function handleComplete(info) {
    const earned = info.correct * XP_PER_CORRECT + info.heartsLeft * XP_PER_HEART_LEFT;

    // Streak: +1 if last active yesterday, unchanged if today, otherwise restart at 1.
    let streak = 1;
    if (profile.lastActive === todayKey()) streak = Math.max(profile.streak, 1);
    else if (profile.lastActive === todayKey(-1)) streak = profile.streak + 1;

    setProfile({ xp: profile.xp + earned, streak, lastActive: todayKey() });
    setEarnedXp(earned);
    setEndInfo(info);
    setScreen("complete");
  }

  function handleGameOver(info) {
    setEndInfo(info);
    setScreen("gameover");
  }

  const myRank = useMemo(
    () => buildLeaderboard(profile).find((p) => p.isYou).rank,
    [profile]
  );

  return (
    <div className="app" style={themeVars}>
      {screen === "quiz" ? (
        <Quiz
          key={quizKey}
          topic={topic}
          onExit={() => goHome()}
          onGameOver={handleGameOver}
          onComplete={handleComplete}
        />
      ) : screen === "gameover" ? (
        <GameOver info={endInfo} onRetry={() => startQuiz(topic)} onHome={() => goHome()} />
      ) : screen === "complete" ? (
        <Complete
          info={endInfo}
          earnedXp={earnedXp}
          rank={myRank}
          onHome={() => goHome()}
          onLeaderboard={() => goHome("leaderboard")}
        />
      ) : (
        <>
          <Navbar
            themeKey={themeKey}
            onThemeChange={setThemeKey}
            profile={profile}
            onLogoClick={() => goHome()}
          />

          <main className="container">
            <nav className="tabs" role="tablist">
              <button
                role="tab"
                aria-selected={tab === "learn"}
                className={`tab ${tab === "learn" ? "active" : ""}`}
                onClick={() => setTab("learn")}
              >
                🏠 Learn
              </button>
              <button
                role="tab"
                aria-selected={tab === "leaderboard"}
                className={`tab ${tab === "leaderboard" ? "active" : ""}`}
                onClick={() => setTab("leaderboard")}
              >
                🏆 Global Leaderboard
              </button>
            </nav>

            {tab === "learn" ? (
              <TopicCards topics={topics} onSelect={startQuiz} />
            ) : (
              <Leaderboard profile={profile} />
            )}
          </main>
        </>
      )}
    </div>
  );
}
