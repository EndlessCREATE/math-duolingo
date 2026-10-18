"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { questions as fallbackQuestions } from "./questions";
import { parseQuestionsFromCSV } from "./sheet";
import { fetchFriendsLeague, isUsernameTakenInCloud, syncProfileToCloud } from "./cloud";

/* ========================================================================
   SUPABASE CLIENT (real Google OAuth)

   Keys live in .env.local (never commit the file — it's git-ignored):
     NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
     NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
   The anon key is designed to be public; security comes from Row Level
   Security policies on your tables, NOT from hiding this key. Restart
   `npm run dev` after editing .env.local.

   One-time Supabase dashboard setup for Google login:
     1. Authentication → Providers → Google → enable, paste the Google
        OAuth Client ID + Secret (Google Cloud Console → Credentials).
     2. In Google Cloud Console add this "Authorized redirect URI":
          https://<project-ref>.supabase.co/auth/v1/callback
     3. Authentication → URL Configuration → add your site to "Redirect URLs":
          http://localhost:3000   (and your production URL)
   ======================================================================== */

// (If the env vars are missing the client is null: the app still works, and the
// Google button shows a "not configured" message instead of crashing the page.)
const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      )
    : null;

// Ids of accounts that came from a real Supabase (Google) session start with this.
const GOOGLE_ID_PREFIX = "google:";
// Fake account created by the old simulated popup; purged on load (see below).
const SIMULATED_ACCOUNT_ID = "google:alex.morgan@example.com";

/* ========================================================================
   CONSTANTS
   ======================================================================== */

const APP_NAME = "OctoPi";

const MAX_HEARTS = 3;
const XP_PER_CORRECT = 10;
const XP_PER_HEART_LEFT = 5;

const BOOT_MIN_MS = 2000; // the π logo is always shown for at least 2 seconds
const BOOT_FADE_MS = 450; // fade-out of the boot screen
const SHEET_TIMEOUT_MS = 8000; // give up on the sheet after this long

// Normal "share" link of the question sheet (the one you copy from the browser).
// The effect below converts it into a CSV download link automatically.
// Share setting required: "Anyone with the link → Viewer".
const GOOGLE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1rn6ysccCkrmNXV_47834nhGZHZSldwvSrKzyrhe9LRQ/edit?hl=id&gid=0#gid=0";

const STORAGE_KEY = "octopi-state-v1";
const LEGACY_STORAGE_KEY = "mathlingo-state-v1"; // pre-rename saves (guest progress only)

const EMPTY_PROFILE = { xp: 0, streak: 0, lastActive: null };
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,16}$/;

// Accent themes. Only the app chrome uses these; Pieter's image is never tinted.
const THEMES = {
  green: {
    label: "Pickle Green",
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

// Decorative icon per topic. Unknown topics (anything new in the Google Sheet)
// fall back to DEFAULT_ICONS, cycled by index.
const TOPIC_ICONS = {
  "Inverse & Direct Proportions": "⚖️",
  "Rational & Irrational numbers": "π",
  "Standard Form & Non-Standard Form": "🔬",
};
const DEFAULT_ICONS = ["➕", "📐", "🧮", "📊", "🔢"];

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

function initialOf(name) {
  return (name?.trim()?.[0] ?? "?").toUpperCase();
}

/**
 * Builds the ranked "Friends Ranking League".
 *   friends – cloud friends  [{ id, name, xp, streak }]
 *   others  – other accounts registered on this device (shown as friends too)
 *   you     – the current player (signed-in user, or the guest)
 */
function buildLeague({ friends, others, you }) {
  const rows = [
    ...friends.map((f) => ({ id: f.id, name: f.name, xp: f.xp, streak: f.streak })),
    ...others.map((a) => ({
      id: a.id,
      name: a.displayName,
      xp: a.profile.xp,
      streak: a.profile.streak,
    })),
    { ...you, isYou: true },
  ];
  return rows
    .sort((a, b) => b.xp - a.xp || (a.isYou ? 1 : b.isYou ? -1 : 0))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

/* ========================================================================
   MATH SYMBOL BACKGROUND + BOOT SCREEN
   ======================================================================== */

// Sits behind every screen. One SVG <pattern> tiles π ∑ √ ∫ ÷ × + forever.
// The colour is `text-gray-200/40` expressed in plain CSS (see .math-bg in
// globals.css) because this project doesn't use Tailwind.
const MATH_TILE = [
  ["π", 18, 34, -12],
  ["∑", 78, 22, 8],
  ["√", 138, 40, -6],
  ["∫", 40, 96, 10],
  ["÷", 100, 88, -10],
  ["×", 150, 110, 6],
  ["+", 20, 160, 0],
  ["π", 82, 156, 12],
  ["∑", 140, 168, -8],
];

function MathBackground() {
  return (
    <svg className="math-bg" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="octopi-math" width="180" height="190" patternUnits="userSpaceOnUse">
          {MATH_TILE.map(([ch, x, y, rot], i) => (
            <text key={i} x={x} y={y} transform={`rotate(${rot} ${x} ${y})`}>
              {ch}
            </text>
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#octopi-math)" />
    </svg>
  );
}

function BootScreen({ leaving }) {
  return (
    <div
      className={`boot ${leaving ? "leaving" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={`Loading ${APP_NAME}`}
    >
      <div className="boot-pi" aria-hidden="true">π</div>
      <div className="boot-name">{APP_NAME}</div>
      <div className="boot-dots" aria-hidden="true">
        <span /><span /><span />
      </div>
    </div>
  );
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
   AUTH UI: Google icon, account modal, avatar menu
   ======================================================================== */

// Official multi-colour Google "G" mark.
function GoogleIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * "Log-In / Register" dialog.
 *   - Username tab: pick a unique username (no password in this local demo —
 *     a real backend would add email/password, magic link or OAuth).
 *   - "Sign in with Google": REAL Supabase OAuth. `onGoogleLogin` (handleGoogleLogin
 *     in <Page/>) calls supabase.auth.signInWithOAuth, which redirects the browser
 *     to Google; on return the auth listener in <Page/> picks up the session.
 */
function AuthModal({ onClose, onRegister, onLogin, onGoogleLogin }) {
  const [mode, setMode] = useState("register"); // "register" | "login"
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [googleError, setGoogleError] = useState("");
  const [redirecting, setRedirecting] = useState(false); // true while handing off to Google
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape" || redirecting) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [redirecting, onClose]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    const res = await (mode === "register" ? onRegister(username) : onLogin(username));
    if (!res.ok) setError(res.error);
  }

  async function startGoogleLogin() {
    setGoogleError("");
    setRedirecting(true);
    const res = await onGoogleLogin(); // on success the browser navigates to Google
    if (!res.ok) {
      setGoogleError(res.error);
      setRedirecting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="modal-head">
          <span className="logo-mark">π</span>
          <h2 id="auth-title">Join {APP_NAME}</h2>
          <p>Save your streak &amp; XP and climb your friends&apos; league.</p>
        </div>

        <button
          type="button"
          className="google-btn"
          onClick={startGoogleLogin}
          disabled={redirecting}
        >
          <GoogleIcon />
          <span>Sign in with Google</span>
        </button>
        {googleError && (
          <p className="field-error google-error" role="alert">{googleError}</p>
        )}

        <div className="divider"><span>or use a username</span></div>

        <div className="auth-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === "register"}
            className={`auth-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => { setMode("register"); setError(""); }}
          >
            Register
          </button>
          <button
            role="tab"
            aria-selected={mode === "login"}
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => { setMode("login"); setError(""); }}
          >
            Log In
          </button>
        </div>

        <form onSubmit={submit} className="auth-form" noValidate>
          <label className="field">
            <span className="field-label">
              {mode === "register" ? "Choose a unique username" : "Your username"}
            </span>
            <input
              ref={inputRef}
              className="field-input"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(""); }}
              placeholder="e.g. PiPioneer"
              maxLength={16}
              autoComplete="username"
              spellCheck={false}
            />
          </label>
          <p className="field-hint">3–16 characters: letters, numbers, _ . -</p>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="btn big" type="submit" disabled={!username.trim()}>
            {mode === "register" ? "CREATE ACCOUNT" : "LOG IN"}
          </button>
        </form>

        {/* Hand-off card shown while the browser is redirected to Google. */}
        {redirecting && (
          <div className="gpopup-backdrop">
            <div className="gpopup" role="dialog" aria-label="Redirecting to Google">
              <div className="gpopup-head">
                <GoogleIcon size={26} />
                <div>
                  <b>Sign in with Google</b>
                  <small>to continue to {APP_NAME}</small>
                </div>
              </div>
              <div className="gpopup-loading" role="status">
                <span className="spinner" />
                <p>Redirecting to Google…</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UserMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button
        className="avatar-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.displayName}
      >
        <span className="avatar">{initialOf(user.displayName)}</span>
        <span className="avatar-name">{user.displayName}</span>
        <span className="caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="dropdown" role="menu">
          <div className="dropdown-head">
            <span className="avatar big">{initialOf(user.displayName)}</span>
            <div>
              <b>{user.displayName}</b>
              <small>{user.email ?? "Username account"}</small>
            </div>
          </div>
          <button
            className="dropdown-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            ⎋ Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ========================================================================
   NAVBAR
   ======================================================================== */

function Navbar({ themeKey, onThemeChange, profile, user, onOpenAuth, onSignOut, onLogoClick }) {
  return (
    <header className="navbar">
      <button className="logo" onClick={onLogoClick} aria-label={`${APP_NAME} home`}>
        <span className="logo-mark">π</span>
        <span className="logo-text">{APP_NAME}</span>
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

        {user ? (
          <UserMenu user={user} onSignOut={onSignOut} />
        ) : (
          <button className="auth-btn" onClick={onOpenAuth}>
            Log-In / Register
          </button>
        )}
      </div>
    </header>
  );
}

/* ========================================================================
   HOME: TOPICS + LEAGUE
   ======================================================================== */

function TopicCards({ topics, onSelect, source, total }) {
  return (
    <section>
      <PieterSays>
        <b>Hi, I&apos;m Pieter! 👋</b>
        <br />
        Welcome to {APP_NAME}. Pick a topic and let&apos;s practise together —
        you&apos;ve got 3 hearts, so think carefully!
      </PieterSays>

      <h1 className="section-title">What math topic are you struggling on today?</h1>

      <p className={`sync-chip ${source}`}>
        <span className="sync-dot" />
        {source === "sheet"
          ? `Live from Google Sheets · ${total} ${total === 1 ? "question" : "questions"}`
          : `Offline question bank · ${total} ${total === 1 ? "question" : "questions"} (Google Sheet unavailable)`}
      </p>

      <div className="topic-grid">
        {topics.map((t, i) => (
          <button key={t.name} className="topic-card" onClick={() => onSelect(t.name)}>
            <span className="topic-icon">
              {TOPIC_ICONS[t.name] ?? DEFAULT_ICONS[i % DEFAULT_ICONS.length]}
            </span>
            <span className="topic-name">{t.name}</span>
            <span className="topic-count">
              {t.count} {t.count === 1 ? "question" : "questions"}
            </span>
            <span className="topic-start">START</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };

function Leaderboard({ league, user, onOpenAuth }) {
  return (
    <section>
      <h1 className="section-title">Friends Ranking League</h1>
      <p className="section-sub">Earn XP by finishing quizzes to climb your friends&apos; ranks.</p>

      {!user && (
        <div className="league-cta">
          <div>
            <b>Playing as a guest</b>
            <span>Log in to save your streak &amp; XP and appear under your own name.</span>
          </div>
          <button className="btn" onClick={onOpenAuth}>LOG-IN / REGISTER</button>
        </div>
      )}

      <ol className="board">
        {league.map((p) => (
          <li
            key={p.id}
            className={`board-row ${p.isYou ? "you" : ""} ${p.rank <= 3 ? "top" : ""}`}
            aria-current={p.isYou ? "true" : undefined}
          >
            <span className="board-rank">
              {MEDALS[p.rank] && <span className="medal">{MEDALS[p.rank]}</span>}
              #{p.rank}
            </span>
            <span className="board-avatar">{initialOf(p.name)}</span>
            <span className="board-name">
              {p.name}
              {p.isYou && <em className="you-tag">{user ? "YOU" : "GUEST"}</em>}
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

function Quiz({ topic, questions, onExit, onGameOver, onComplete }) {
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
            <span className="rs-label">LEAGUE RANK</span>
            <span className="rs-value">#{rank}</span>
          </div>
        </div>

        <div className="end-actions">
          <button className="btn big" onClick={onHome}>CONTINUE</button>
          <button className="btn ghost big" onClick={onLeaderboard}>VIEW LEAGUE</button>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================
   APP
   ======================================================================== */

export default function Page() {
  /* ---- boot sequence: π logo ≥ 2s AND hydration + sheet download finished ---- */
  const [bootMinDone, setBootMinDone] = useState(false);
  const [bootPhase, setBootPhase] = useState("loading"); // "loading" | "leaving" | "done"

  /* ---- question data ---- */
  const [questions, setQuestions] = useState([]);
  const [source, setSource] = useState("offline"); // "sheet" | "offline"
  const [dataReady, setDataReady] = useState(false);

  /* ---- persisted state ---- */
  const [themeKey, setThemeKey] = useState("green");
  const [guest, setGuest] = useState(EMPTY_PROFILE); // progress while logged out
  const [accounts, setAccounts] = useState({}); // id -> { id, displayName, provider, email?, profile }
  const [sessionId, setSessionId] = useState(null); // id of the logged-in account
  const [hydrated, setHydrated] = useState(false);

  /* ---- ui state ---- */
  const [friends, setFriends] = useState([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [tab, setTab] = useState("learn"); // "learn" | "leaderboard"
  const [screen, setScreen] = useState("home"); // "home" | "quiz" | "gameover" | "complete"
  const [topic, setTopic] = useState(null);
  const [quizKey, setQuizKey] = useState(0); // remount Quiz on retry
  const [endInfo, setEndInfo] = useState(null);
  const [earnedXp, setEarnedXp] = useState(0);

  // Derived auth state
  const user = sessionId ? accounts[sessionId] ?? null : null;
  const userName = user?.displayName ?? null;
  const profile = user ? user.profile : guest;

  /* ---------------- boot: minimum 2s timer ---------------- */
  useEffect(() => {
    const t = setTimeout(() => setBootMinDone(true), BOOT_MIN_MS);
    return () => clearTimeout(t);
  }, []);

  /* ---------------- live Google Sheets sync ---------------- */
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SHEET_TIMEOUT_MS);

    // ".../edit?hl=id&gid=0#gid=0"  →  ".../export?format=csv&gid=0"
    // (everything from "/edit" onward is replaced; the tab id `gid` is kept)
    const gid = GOOGLE_SHEET_URL.match(/gid=(\d+)/)?.[1] ?? "0";
    const convertedUrl = GOOGLE_SHEET_URL.replace(/\/edit.*$/, `/export?format=csv&gid=${gid}`);

    // Used only if the direct request is blocked (CORS / network).
    const proxiedUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(convertedUrl)}`;

    async function loadQuestions() {
      let res;
      try {
        res = await fetch(convertedUrl, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
      } catch (err) {
        if (controller.signal.aborted) throw err; // timed out / unmounted: don't retry
        console.warn("[OctoPi] Direct sheet fetch failed, retrying through proxy:", err.message);
        res = await fetch(proxiedUrl, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`Proxy request failed (${res.status})`);
      }
      const rows = parseQuestionsFromCSV(await res.text());
      if (rows.length === 0) throw new Error("Sheet contained no valid question rows");
      return rows;
    }

    loadQuestions()
      .then((rows) => {
        if (cancelled) return;
        setQuestions(rows);
        setSource("sheet");
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[OctoPi] Using bundled questions instead of the Google Sheet:", err.message);
        setQuestions(fallbackQuestions);
        setSource("offline");
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!cancelled) setDataReady(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  /* ---------------- load saved state ---------------- */
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved) {
        if (saved.themeKey && THEMES[saved.themeKey]) setThemeKey(saved.themeKey);
        if (saved.guest) setGuest(saved.guest);
        // Drop the fake account from the old simulated Google popup: it was never
        // a real login, so it must not stay signed in or show up in the league.
        const { [SIMULATED_ACCOUNT_ID]: _simulated, ...realAccounts } = saved.accounts ?? {};
        setAccounts(realAccounts);
        if (saved.sessionId && realAccounts[saved.sessionId]) setSessionId(saved.sessionId);
      } else {
        // First launch after the rename: carry over the old guest progress.
        const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null");
        if (legacy?.themeKey && THEMES[legacy.themeKey]) setThemeKey(legacy.themeKey);
        if (legacy?.profile) setGuest(legacy.profile);
      }
    } catch {
      /* ignore corrupted storage */
    }
    setHydrated(true);
  }, []);

  /* ---------------- save state (session + progress) ---------------- */
  // NOTE: localStorage is not tamper-proof. See the security note in app/cloud.js.
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ themeKey, guest, accounts, sessionId }));
  }, [themeKey, guest, accounts, sessionId, hydrated]);

  /* ---------------- Supabase auth listener ---------------- */
  // Latest values for use inside the long-lived listener below.
  const guestRef = useRef(guest);
  const accountsRef = useRef(accounts);
  guestRef.current = guest;
  accountsRef.current = accounts;

  useEffect(() => {
    // Wait for localStorage to load so we know which accounts already exist.
    if (!supabase || !hydrated) return;
    let cancelled = false;

    // Maps a Supabase session onto the app's user state (accounts + sessionId).
    function applySession(session) {
      if (!session?.user) {
        // Signed out. Only drop a Google/Supabase login; a local username
        // account has no Supabase session and must stay signed in.
        setSessionId((prev) => (prev?.startsWith(GOOGLE_ID_PREFIX) ? null : prev));
        return;
      }

      const email = session.user.email;
      const fullName =
        session.user.user_metadata?.full_name ?? // Google profile name
        session.user.user_metadata?.name ??
        email?.split("@")[0] ??
        "Player";
      const id = `${GOOGLE_ID_PREFIX}${(email ?? session.user.id).toLowerCase()}`;

      if (accountsRef.current[id]) {
        // Returning player: refresh name/email, keep their saved XP + streak.
        setAccounts((prev) => ({
          ...prev,
          [id]: { ...prev[id], displayName: fullName, email },
        }));
      } else {
        // First login: create the account, carrying over any guest progress.
        setAccounts((prev) => ({
          ...prev,
          [id]: { id, displayName: fullName, email, provider: "google", profile: guestRef.current },
        }));
        setGuest(EMPTY_PROFILE);
      }
      setSessionId(id);
      setAuthOpen(false);
    }

    // 1) Existing session on mount (also covers the return from Google).
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) applySession(data.session);
    });

    // 2) Live changes: SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, ...
    //    (Keep this callback synchronous: don't await Supabase calls inside it.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [hydrated]);

  /* ---------------- leave the boot screen ---------------- */
  useEffect(() => {
    if (bootPhase !== "loading" || !bootMinDone || !dataReady || !hydrated) return;
    setBootPhase("leaving");
  }, [bootPhase, bootMinDone, dataReady, hydrated]);

  useEffect(() => {
    if (bootPhase !== "leaving") return;
    const t = setTimeout(() => setBootPhase("done"), BOOT_FADE_MS);
    return () => clearTimeout(t);
  }, [bootPhase]);

  /* ---------------- friends league + cloud sync hooks ---------------- */
  useEffect(() => {
    let cancelled = false;
    fetchFriendsLeague(sessionId).then((rows) => {
      if (!cancelled) setFriends(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!hydrated || !sessionId) return;
    syncProfileToCloud(sessionId, profile);
  }, [hydrated, sessionId, profile]);

  /* ---------------- derived data ---------------- */
  // Unique topics, in the order they appear in the sheet.
  const topics = useMemo(() => {
    const map = new Map();
    for (const q of questions) map.set(q.topic, (map.get(q.topic) ?? 0) + 1);
    return [...map].map(([name, count]) => ({ name, count }));
  }, [questions]);

  const league = useMemo(
    () =>
      buildLeague({
        friends,
        others: Object.values(accounts).filter((a) => a.id !== sessionId),
        you: {
          id: sessionId ?? "guest",
          name: userName ?? "You",
          xp: profile.xp,
          streak: profile.streak,
        },
      }),
    [friends, accounts, sessionId, userName, profile]
  );
  const myRank = league.find((p) => p.isYou).rank;

  const theme = THEMES[themeKey];
  const themeVars = {
    "--accent": theme.accent,
    "--accent-dark": theme.dark,
    "--accent-light": theme.light,
  };

  /* ---------------- profile + auth actions ---------------- */
  function updateProfile(next) {
    if (user) {
      setAccounts((a) => ({ ...a, [user.id]: { ...a[user.id], profile: next } }));
    } else {
      setGuest(next);
    }
  }

  // Creates an account (carrying over any guest progress) and signs in.
  function createAccountAndSignIn(account) {
    setAccounts((a) => ({ ...a, [account.id]: { ...account, profile: guest } }));
    setGuest(EMPTY_PROFILE);
    setSessionId(account.id);
    setAuthOpen(false);
  }

  async function handleRegister(rawName) {
    const name = rawName.trim();
    if (!USERNAME_RE.test(name)) {
      return { ok: false, error: "Use 3–16 letters, numbers, _ . or -" };
    }
    const id = `user:${name.toLowerCase()}`;
    if (accounts[id] || (await isUsernameTakenInCloud(name))) {
      return { ok: false, error: `"${name}" is already taken. Try another username.` };
    }
    createAccountAndSignIn({ id, displayName: name, provider: "username" });
    return { ok: true };
  }

  async function handleLogin(rawName) {
    const name = rawName.trim();
    const account = accounts[`user:${name.toLowerCase()}`];
    if (!account) {
      return { ok: false, error: `No account named "${name}" on this device. Register first.` };
    }
    setSessionId(account.id);
    setAuthOpen(false);
    return { ok: true };
  }

  // Real Google login. Sends the browser to Google; when Google sends the player
  // back to `window.location.origin`, the auth listener above receives the session.
  async function handleGoogleLogin() {
    try {
      // Force it to use our hardcoded client variable directly
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { 
          redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined 
        },
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message ?? "Google sign-in failed. Please try again." };
    }
  }

  async function handleSignOut() {
    try {
      await supabase?.auth.signOut(); // ends the Supabase session (no-op if there is none)
    } catch (err) {
      console.warn("[OctoPi] Supabase sign-out failed:", err.message);
    }
    setSessionId(null); // also covers username accounts, which have no Supabase session
    setTab("learn");
    setScreen("home");
  }

  /* ---------------- quiz flow ---------------- */
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

    updateProfile({ xp: profile.xp + earned, streak, lastActive: todayKey() });
    setEarnedXp(earned);
    setEndInfo(info);
    setScreen("complete");
  }

  function handleGameOver(info) {
    setEndInfo(info);
    setScreen("gameover");
  }

  /* ---------------- render ---------------- */
  const booting = bootPhase !== "done";

  return (
    <div className="app" style={themeVars}>
      <MathBackground />

      {bootPhase !== "loading" && (
        <div className="app-content">
          {screen === "quiz" ? (
            <Quiz
              key={quizKey}
              topic={topic}
              questions={questions}
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
                user={user}
                onOpenAuth={() => setAuthOpen(true)}
                onSignOut={handleSignOut}
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
                    🏆 Friends Ranking League
                  </button>
                </nav>

                {tab === "learn" ? (
                  <TopicCards
                    topics={topics}
                    onSelect={startQuiz}
                    source={source}
                    total={questions.length}
                  />
                ) : (
                  <Leaderboard league={league} user={user} onOpenAuth={() => setAuthOpen(true)} />
                )}
              </main>
            </>
          )}

          {authOpen && (
            <AuthModal
              onClose={() => setAuthOpen(false)}
              onRegister={handleRegister}
              onLogin={handleLogin}
              onGoogleLogin={handleGoogleLogin}
            />
          )}
        </div>
      )}

      {booting && <BootScreen leaving={bootPhase === "leaving"} />}
    </div>
  );
}
