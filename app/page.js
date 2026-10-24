"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { questions as fallbackQuestions } from "./questions";
import { parseQuestionsFromCSV } from "./sheet";
import {
  GROUP_NUMBERS,
  GROUP_SHAPES,
  GROUP_SHEET,
  SESSION_SIZE,
  TOPIC_DEFS,
  buildMixedSession,
  buildTopicSession,
  topicDefFor,
} from "./generators";
import {
  MIN_PASSWORD,
  USERNAME_RE,
  awardXp,
  describeAuthError,
  ensureProfile,
  fetchPlayers,
  isMissingSchema,
  isVirtualEmail,
  nameFromAuthUser,
  subscribeToProfiles,
  usernameToEmail,
} from "./cloud";
import { Pieter, PieterSays, QUIPS, QUIP_MS } from "./pieter";
import { TopicIcon, iconKindForSheetTopic } from "./icons";
import { MILESTONE_EVERY, milestoneMessage, trailingStreak } from "./milestones";

/* ========================================================================
   SUPABASE CLIENT (real auth + database)

   The project URL and publishable (anon) key are hardcoded below — nothing is
   read from process.env / .env.local. The publishable key is designed to be
   public; security comes from Row Level Security policies on your tables
   (see supabase/schema.sql), NOT from hiding this key. NEVER put the secret /
   service_role key in this file.

   Dashboard setup (one time):
     1. SQL Editor → run supabase/schema.sql (profiles table, RLS, award_xp()).
     2. Authentication → Providers → Email → turn OFF "Confirm email"
        (username accounts use virtual @octopi.edu addresses that can't receive mail).
     3. Authentication → Providers → Google → enable + paste the Google OAuth
        Client ID / Secret. In Google Cloud Console add this redirect URI:
          https://<project-ref>.supabase.co/auth/v1/callback
     4. Authentication → URL Configuration → Redirect URLs → add
          http://localhost:3000   (and your production URL)
   ======================================================================== */

const supabaseUrl = "https://gdfqytvhdcfnstvvqieu.supabase.co";
const supabaseAnonKey = "sb_publishable_eCMtd5iL9vCrExzUy-V_sw_hmwhCGWk";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/* ========================================================================
   CONSTANTS
   ======================================================================== */

const APP_NAME = "OctoPi";

const MAX_HEARTS = 3;
const XP_PER_CORRECT = 10;
const XP_PER_HEART_LEFT = 5;
// A round is capped at SESSION_SIZE questions, so one round is worth at most
// 10 x 10 + 3 x 5 = 115 XP. award_xp() in schema.sql accepts up to 150 per call.

const BOOT_MIN_MS = 2000; // the π logo is always shown for at least 2 seconds
const BOOT_FADE_MS = 450; // fade-out of the boot screen
const SHEET_TIMEOUT_MS = 8000; // give up on the sheet after this long
const AUTH_TIMEOUT_MS = 6000; // never let the boot screen wait longer than this for auth
const MILESTONE_MS = 9000; // how long Pieter's milestone bubble stays up

// Normal "share" link of the question sheet (the one you copy from the browser).
// The effect below converts it into a CSV download link automatically.
// Share setting required: "Anyone with the link → Viewer".
const GOOGLE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1rn6ysccCkrmNXV_47834nhGZHZSldwvSrKzyrhe9LRQ/edit?hl=id&gid=0#gid=0";

const STORAGE_KEY = "octopi-state-v1"; // guest progress only (signed-in data lives in Supabase)
const LEGACY_STORAGE_KEY = "mathlingo-state-v1";
const THEME_KEY = "octopi-theme"; // must match the inline script in layout.js

const EMPTY_PROFILE = { xp: 0, streak: 0, lastActive: null };

// ---- Pieter's home-page greeting manager --------------------------------------------
const VISITED_KEY = "octopi-visited-v1"; // set on the first ever visit; its presence = "repeat visitor"
const FIRST_GREETING_MS = 3000; // first-time guest: the intro greeting shows for exactly this long
const WELCOME_TYPE_MS = 38; // typewriter speed for the signed-in welcome line (silent, no audio)
const WELCOME_HOLD_MS = 3000; // the finished welcome line stays for exactly this long
// Idle call-outs: after a randomized 3 to 5 minutes without any interaction on the home page.
const IDLE_MIN_MS = 3 * 60 * 1000;
const IDLE_MAX_MS = 5 * 60 * 1000;
const CALLOUT_MS = 9000; // how long a call-out stays in the bubble
const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "click", "touchstart", "touchmove", "keydown", "wheel", "scroll"];

const IDLE_PROMPTS = [
  "Hey, let's learn now!",
  "Math won't solve itself, let's jump into a quiz!",
  "Your daily streak is waiting for you! Let's go!",
  "Psst! A 10-question round only takes a few minutes.",
  "Your brain called. It wants a workout!",
  "I'm getting bored over here... pick a topic!",
];

const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
const randomIdleDelay = () => IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);

// Welcome line for a signed-in player. Streak lines are only used when they are true.
function pickWelcome(name, streak, isNew) {
  if (isNew) return `Welcome to ${APP_NAME}, ${name}! Let's earn your very first XP!`;
  const pool = [
    `Welcome back ${name}! Nice efforts you got there!`,
    `Great to see you again ${name}! Ready to make your brain stronger?`,
  ];
  if (streak >= 7) pool.push(`${streak} days in a row, that's over a week of continuous learning! Keep it up ${name}.`);
  else if (streak >= 5) pool.push(`Almost a week of continuous learning! Keep it up ${name}.`);
  else if (streak >= 2) pool.push(`${streak} days of continuous learning! Keep it up ${name}.`);
  return pickRandom(pool);
}

// Accent colours (the actual values live in globals.css, per mode).
const ACCENTS = {
  green: "Pickle Green",
  blue: "Ocean Blue",
  purple: "Amethyst Purple",
};

/* ========================================================================
   HELPERS
   ======================================================================== */

function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD
}

function initialOf(name) {
  return (name?.trim()?.[0] ?? "?").toUpperCase();
}

function applyTheme(mode, accent) {
  const root = document.documentElement;
  root.setAttribute("data-mode", mode);
  root.setAttribute("data-accent", accent);
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify({ mode, accent }));
  } catch {
    /* storage unavailable (private mode): the theme just won't persist */
  }
}

function cloudStatusFrom(error) {
  return isMissingSchema(error)
    ? { status: "setup" }
    : { status: "error", message: error?.message ?? "Unknown error" };
}

/* ========================================================================
   MATH SYMBOL BACKGROUND + BOOT SCREEN
   ======================================================================== */

// Sits behind every screen. One SVG <pattern> tiles π ∑ √ ∫ ÷ × + forever.
// Colours (light + dark) are set in globals.css (.math-bg text).
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
 * "Log-In / Register" dialog (real Supabase auth).
 *   - Username + password: Supabase email/password auth on a virtual address
 *     (`<username>@octopi.edu`). `onRegister` / `onLogin` live in <Page/>.
 *   - "Sign in with Google": Supabase OAuth. `onGoogleLogin` (handleGoogleLogin
 *     in <Page/>) redirects the browser to Google; on return the auth listener
 *     in <Page/> picks up the session.
 */
function AuthModal({ onClose, onRegister, onLogin, onGoogleLogin }) {
  const [mode, setMode] = useState("register"); // "register" | "login"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
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
    if (busy) return;
    setError("");
    setBusy(true);
    const res = await (mode === "register" ? onRegister(username, password) : onLogin(username, password));
    setBusy(false);
    if (!res.ok) setError(res.error);
    // on success the auth listener in <Page/> closes this dialog
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

  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="modal-head">
          <span className="logo-mark">π</span>
          <h2 id="auth-title">Join {APP_NAME}</h2>
          <p>Save your streak &amp; XP and climb the league on every device.</p>
        </div>

        <button type="button" className="google-btn" onClick={startGoogleLogin} disabled={redirecting}>
          <GoogleIcon />
          <span>Sign in with Google</span>
        </button>
        {googleError && <p className="field-error google-error" role="alert">{googleError}</p>}

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
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span className="field-label">Password</span>
            <span className="pw-wrap">
              <input
                className="field-input"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder={mode === "register" ? `At least ${MIN_PASSWORD} characters` : "Your password"}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "HIDE" : "SHOW"}
              </button>
            </span>
          </label>

          {mode === "register" && (
            <p className="field-hint">Username: 3–16 letters, numbers, _ or -. No email needed.</p>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="btn big" type="submit" disabled={!canSubmit}>
            {busy ? "PLEASE WAIT…" : mode === "register" ? "CREATE ACCOUNT" : "LOG IN"}
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

function Navbar({ mode, onToggleMode, accent, onAccentChange, profile, user, onOpenAuth, onSignOut, onLogoClick }) {
  const dark = mode === "dark";
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

        <button
          className="mode-toggle"
          onClick={onToggleMode}
          aria-pressed={dark}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          title={dark ? "Light mode" : "Dark mode"}
        >
          <span aria-hidden="true">{dark ? "☀️" : "🌙"}</span>
        </button>

        <label className="theme-select-wrap">
          <span className="swatch" aria-hidden="true" />
          <span className="sr-only">Accent colour</span>
          <select className="theme-select" value={accent} onChange={(e) => onAccentChange(e.target.value)}>
            {Object.entries(ACCENTS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
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

function CloudNotice({ cloud }) {
  if (cloud.status === "setup") {
    return (
      <p className="notice" role="status">
        <b>Cloud database isn&apos;t set up yet.</b> In Supabase open <b>SQL Editor</b> and run{" "}
        <code>supabase/schema.sql</code>. Until then, streaks, XP and ranks can&apos;t be saved or shared.
      </p>
    );
  }
  if (cloud.status === "error") {
    return (
      <p className="notice error" role="status">
        Can&apos;t reach the league right now ({cloud.message}). It will retry when you come back to this tab.
      </p>
    );
  }
  return null;
}

/**
 * What Pieter's home bubble shows. `hero` comes from the greeting manager in <Page/>:
 *   { kind: "greeting" }                         the standard "Hi, I'm Pieter!" intro
 *   { kind: "typing", text, full }               welcome-back line, typed out silently
 *   { kind: "line", text }                       a plain line (idle chatter, call-outs, click replies)
 */
function HeroBubble({ hero }) {
  if (hero.kind === "typing") {
    return (
      <>
        {/* Screen readers get the whole sentence at once instead of letter by letter. */}
        <span className="sr-only">{hero.full}</span>
        <b aria-hidden="true">
          {hero.text}
          <span className="type-caret" />
        </b>
      </>
    );
  }
  if (hero.kind === "line") return <b>{hero.text}</b>;
  return (
    <>
      <b>Hi, I&apos;m Pieter! 👋</b>
      <br />
      Welcome to {APP_NAME}. Pick a topic and let&apos;s practise together — you&apos;ve got 3 hearts, so think
      carefully!
    </>
  );
}

function TopicCards({ entries, onSelect, onSelectMixed, source, total, cloud, hero, onPieterQuip }) {
  // Keep the group order: Numbers and algebra, Relationships and shapes, then the sheet-only topics.
  const groups = [GROUP_NUMBERS, GROUP_SHAPES, GROUP_SHEET]
    .map((name) => ({ name, items: entries.filter((e) => e.group === name) }))
    .filter((g) => g.items.length > 0);

  return (
    <section>
      <PieterSays size={130} className="hero" mood={hero.mood ?? null} onQuip={onPieterQuip}>
        <HeroBubble hero={hero} />
      </PieterSays>

      <h1 className="section-title">What math topic are you struggling on today?</h1>

      <p className={`sync-chip ${source}`}>
        <span className="sync-dot" />
        {source === "sheet"
          ? `Live · ${total} ${total === 1 ? "question" : "questions"}`
          : `Offline question bank · ${total} ${total === 1 ? "question" : "questions"} (Google Sheet unavailable)`}
      </p>

      <CloudNotice cloud={cloud} />

      <button className="topic-card mixed" onClick={onSelectMixed}>
        <span className="topic-icon"><TopicIcon kind="mixed" /></span>
        <span className="mixed-text">
          <span className="topic-name">Mixed Practice Challenge</span>
          <span className="topic-blurb">
            Every topic in one round: your Google Sheet questions shuffled with freshly generated ones.
          </span>
          <span className="topic-count">{SESSION_SIZE} questions per round</span>
        </span>
        <span className="topic-start">START</span>
      </button>

      {groups.map((g) => (
        <div className="topic-group" key={g.name}>
          <h2 className="group-title">{g.name}</h2>
          <div className="topic-grid">
            {g.items.map((t, i) => (
              <button key={t.key} className="topic-card" onClick={() => onSelect(t)}>
                <span className="topic-icon">
                  <TopicIcon kind={t.def?.key ?? iconKindForSheetTopic(t.title)} fallbackIndex={i} />
                </span>
                <span className="topic-name">{t.title}</span>
                {t.blurb && <span className="topic-blurb">{t.blurb}</span>}
                <span className="topic-count">
                  {t.def
                    ? t.sheetCount > 0
                      ? `Endless practice · ${t.sheetCount} ${t.sheetCount === 1 ? "Question" : "Questions"}`
                      : "Endless practice"
                    : `${t.sheetCount} ${t.sheetCount === 1 ? "question" : "questions"}`}
                </span>
                <span className="topic-start">START</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

const MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };

function Leaderboard({ league, user, onOpenAuth, cloud }) {
  return (
    <section>
      {/* Same mascot, same size as on the dashboard; he reacts to clicks like everywhere else. */}
      <div className="league-pieter">
        <Pieter size={130} />
      </div>
      <h1 className="section-title">Friends Ranking League</h1>
      <p className="section-sub">Earn XP by finishing quizzes to climb the ranks. Scores update live.</p>

      {cloud.status === "ok" && (
        <p className="sync-chip live">
          <span className="sync-dot" />
          Live · synced with the cloud
        </p>
      )}
      <CloudNotice cloud={cloud} />

      {!user && (
        <div className="league-cta">
          <div>
            <b>Playing as a guest</b>
            <span>Log in to save your streak &amp; XP and appear in the league under your own name.</span>
          </div>
          <button className="btn" onClick={onOpenAuth}>LOG-IN / REGISTER</button>
        </div>
      )}

      {league.length === 0 ? (
        <p className="board-empty">
          {cloud.status === "loading" ? "Loading the league…" : "No players yet. Be the first on the board!"}
        </p>
      ) : (
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
              <span className="board-avatar">{initialOf(p.username)}</span>
              <span className="board-name">
                {p.username}
                {p.isYou && <em className="you-tag">YOU</em>}
              </span>
              <span className="board-streak">🔥 {p.streak}</span>
              <span className="board-xp">{p.xp} XP</span>
            </li>
          ))}
        </ol>
      )}
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

/* ---------- Graph plotter for sheet questions that have `graph_data` ---------- */

const fmtNum = (n) => String(+n.toFixed(2)).replace("-", "−"); // typographic minus, no 1e-16 noise

// A tick spacing of 1, 2, 5 or 10 × 10ⁿ that gives roughly six grid cells across `span`.
function niceStep(span) {
  const raw = Math.max(span, 1e-9) / 6;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/**
 * Coordinate grid built with plain React SVG elements (no HTML injection).
 *   points: [[x, y], ...] straight from the sheet's graph_data column.
 * The range always includes the axes, grows to fit every point, and the plotted
 * points are labelled. Collinear points are drawn as one straight line running to
 * the edges of the grid; anything else is joined point to point.
 */
function GraphPlot({ points }) {
  const clipId = useId().replace(/:/g, "");
  const W = 320;
  const H = 320;
  const pad = 34;

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const stepX = niceStep(Math.max(...xs, 0) - Math.min(...xs, 0));
  const stepY = niceStep(Math.max(...ys, 0) - Math.min(...ys, 0));
  const minX = Math.floor(Math.min(...xs, 0) / stepX) * stepX - stepX;
  const maxX = Math.ceil(Math.max(...xs, 0) / stepX) * stepX + stepX;
  const minY = Math.floor(Math.min(...ys, 0) / stepY) * stepY - stepY;
  const maxY = Math.ceil(Math.max(...ys, 0) / stepY) * stepY + stepY;

  const sx = (x) => pad + ((x - minX) / (maxX - minX)) * (W - 2 * pad);
  const sy = (y) => H - pad - ((y - minY) / (maxY - minY)) * (H - 2 * pad);

  const ticks = (min, max, step) => {
    const out = [];
    for (let k = Math.ceil(min / step - 1e-9); k * step <= max + 1e-9; k++) out.push(+(k * step).toFixed(10));
    return out;
  };
  const xTicks = ticks(minX, maxX, stepX);
  const yTicks = ticks(minY, maxY, stepY);

  // Are all points on one straight line? (cross product against the first two distinct points)
  const [a] = points;
  const b = points.find((p) => p[0] !== a[0] || p[1] !== a[1]);
  const collinear = points.every(
    (p) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 1e-9
  );
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const far = (maxX - minX + maxY - minY) * 2;
  const len = Math.hypot(dx, dy);
  const line = collinear
    ? { x1: a[0] - (dx / len) * far, y1: a[1] - (dy / len) * far, x2: a[0] + (dx / len) * far, y2: a[1] + (dy / len) * far }
    : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} role="img" aria-label={`Graph through the points ${points.map(([x, y]) => `(${fmtNum(x)}, ${fmtNum(y)})`).join(", ")}`}>
      <defs>
        <clipPath id={clipId}>
          <rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} />
        </clipPath>
      </defs>

      {xTicks.map((t) => <line key={`gx${t}`} className="gl" x1={sx(t)} y1={sy(minY)} x2={sx(t)} y2={sy(maxY)} />)}
      {yTicks.map((t) => <line key={`gy${t}`} className="gl" x1={sx(minX)} y1={sy(t)} x2={sx(maxX)} y2={sy(t)} />)}

      <line className="ax" x1={sx(minX)} y1={sy(0)} x2={sx(maxX)} y2={sy(0)} />
      <line className="ax" x1={sx(0)} y1={sy(minY)} x2={sx(0)} y2={sy(maxY)} />
      <text className="tx acc" x={sx(maxX) - 4} y={sy(0) - 8} textAnchor="end">x</text>
      <text className="tx acc" x={sx(0) + 9} y={sy(maxY) + 12}>y</text>

      {xTicks.filter((t) => t !== 0).map((t) => (
        <text key={`lx${t}`} className="tx soft" x={sx(t)} y={sy(0) + 15} textAnchor="middle">{fmtNum(t)}</text>
      ))}
      {yTicks.filter((t) => t !== 0).map((t) => (
        <text key={`ly${t}`} className="tx soft" x={sx(0) - 7} y={sy(t) + 4} textAnchor="end">{fmtNum(t)}</text>
      ))}

      <g clipPath={`url(#${clipId})`}>
        {line ? (
          <line className="ln" x1={sx(line.x1)} y1={sy(line.y1)} x2={sx(line.x2)} y2={sy(line.y2)} />
        ) : (
          <polyline className="ln" fill="none" points={points.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" ")} />
        )}
      </g>

      {points.map(([x, y], i) => {
        const left = sx(x) > W - pad - 60;
        return (
          <g key={i}>
            <circle className="pt" cx={sx(x)} cy={sy(y)} r="5" />
            <text className="tx" x={sx(x) + (left ? -9 : 9)} y={sy(y) - 8} textAnchor={left ? "end" : "start"}>
              ({fmtNum(x)}, {fmtNum(y)})
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Quiz({ title, session, onExit, onGameOver, onComplete }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null); // null | "correct" | "wrong"
  const [hearts, setHearts] = useState(MAX_HEARTS);
  const [correctCount, setCorrectCount] = useState(0);
  const [showHint, setShowHint] = useState(false);

  // Session tracker: one boolean per CHECKED answer (true = correct).
  // Its length drives Pieter's milestone pop-ups.
  const [history, setHistory] = useState([]);
  const [milestone, setMilestone] = useState(null); // { kind, text } | null
  const milestoneTimer = useRef(null);

  useEffect(() => () => clearTimeout(milestoneTimer.current), []);

  function dismissMilestone() {
    clearTimeout(milestoneTimer.current);
    setMilestone(null);
  }

  const q = session[index];
  const total = session.length;
  const progress = ((index + (result ? 1 : 0)) / total) * 100;
  const mood = result === "correct" ? "happy" : result === "wrong" ? "oops" : null;

  function check() {
    if (selected === null || result) return;
    const ok = selected === q.correct_answer;
    if (ok) {
      setResult("correct");
      setCorrectCount((c) => c + 1);
    } else {
      setResult("wrong");
      setHearts((h) => h - 1);
    }

    // Validated check -> grow the tracker; at every multiple of 5, Pieter pops up.
    const nextHistory = [...history, ok];
    setHistory(nextHistory);
    if (nextHistory.length % MILESTONE_EVERY === 0) {
      setMilestone(milestoneMessage({ answered: nextHistory.length, streak: trailingStreak(nextHistory) }));
      clearTimeout(milestoneTimer.current);
      milestoneTimer.current = setTimeout(() => setMilestone(null), MILESTONE_MS);
    }
  }

  function next() {
    dismissMilestone();
    if (hearts <= 0) {
      onGameOver({ title, correct: correctCount, total });
      return;
    }
    if (index + 1 >= total) {
      onComplete({ title, correct: correctCount, total, heartsLeft: hearts });
      return;
    }
    setIndex(index + 1);
    setSelected(null);
    setResult(null);
    setShowHint(false);
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
        <p className="quiz-topic">{q.topic ?? title}</p>
        <PieterSays size={96} mood={mood}>
          <b>{q.question}</b>
        </PieterSays>

        {q.expr && <div className="plate">{q.expr}</div>}
        {/* Only generated questions carry trusted SVG/HTML diagrams; sheet content is never injected as HTML. */}
        {q.generated && q.visual && <div className="qvisual" dangerouslySetInnerHTML={{ __html: q.visual }} />}
        {/* Sheet questions with a graph_data cell: plotted with real SVG elements, no HTML injection. */}
        {!q.visual && q.graph && (
          <div className="qvisual">
            <GraphPlot points={q.graph} />
          </div>
        )}

        {q.hint && !result && (
          <div className="hint-row">
            {showHint ? (
              <p className="hint-text">💡 {q.hint}</p>
            ) : (
              <button className="hint-btn" onClick={() => setShowHint(true)}>💡 Need a hint?</button>
            )}
          </div>
        )}

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

        {result === "wrong" && q.steps?.length > 0 && (
          <div className="explain">
            <b>How to solve it</b>
            <ol>
              {q.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {milestone && (
        <div className="milestone" role="status" aria-live="polite">
          <Pieter size={72} mood="happy" />
          <div className="milestone-text">
            <b>{milestone.kind === "fact" ? "Pieter's fun fact" : `${history.length} answers!`}</b>
            <p>{milestone.text}</p>
          </div>
          <button className="milestone-close" onClick={dismissMilestone} aria-label="Dismiss">✕</button>
        </div>
      )}

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
        <Pieter size={150} mood="oops" />
        <h1 className="end-title bad">Game Over</h1>
        <p className="end-text">
          You ran out of hearts on <b>{info.title}</b>. You got {info.correct} of {info.total} right
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

function Complete({ info, earnedXp, rank, signedIn, syncNote, onHome, onLeaderboard }) {
  return (
    <div className="center-screen">
      <div className="end-card">
        <Pieter size={150} mood="happy" />
        <h1 className="end-title">Lesson complete! 🎉</h1>
        <p className="end-text">
          {info.correct} of {info.total} correct in <b>{info.title}</b>.
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
            <span className="rs-value">{signedIn && rank ? `#${rank}` : "—"}</span>
          </div>
        </div>

        {!signedIn && (
          <p className="notice">Log in to save this XP and streak to the league. Guest progress stays on this device.</p>
        )}
        {syncNote && <p className="notice error" role="alert">{syncNote}</p>}

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
  /* ---- boot sequence: π logo ≥ 2s AND hydration + sheet download + auth check finished ---- */
  const [bootMinDone, setBootMinDone] = useState(false);
  const [bootPhase, setBootPhase] = useState("loading"); // "loading" | "leaving" | "done"

  /* ---- question data ---- */
  const [questions, setQuestions] = useState([]);
  const [source, setSource] = useState("offline"); // "sheet" | "offline"
  const [dataReady, setDataReady] = useState(false);

  /* ---- theme ---- */
  const [mode, setMode] = useState("light"); // "light" | "dark"
  const [accent, setAccent] = useState("green");

  /* ---- auth + cloud (Supabase is the single source of truth) ---- */
  const [authUser, setAuthUser] = useState(null); // Supabase auth user | null
  const [authReady, setAuthReady] = useState(false);
  const [me, setMe] = useState(null); // my profiles row { id, username, xp, streak, last_active }
  const [players, setPlayers] = useState([]); // league rows from the database
  const [cloud, setCloud] = useState({ status: "loading" }); // loading | ok | setup | error

  /* ---- guest progress (the only data kept locally) ---- */
  const [guest, setGuest] = useState(EMPTY_PROFILE);
  const [hydrated, setHydrated] = useState(false);

  /* ---- ui state ---- */
  const [authOpen, setAuthOpen] = useState(false);
  const [tab, setTab] = useState("learn"); // "learn" | "leaderboard"
  const [screen, setScreen] = useState("home"); // "home" | "quiz" | "gameover" | "complete"
  const [plan, setPlan] = useState(null); // what the current round is: { kind: "topic", entry } | { kind: "mixed" }
  const [session, setSession] = useState([]);
  const [quizKey, setQuizKey] = useState(0); // remount Quiz on retry
  const [endInfo, setEndInfo] = useState(null);
  const [earnedXp, setEarnedXp] = useState(0);
  const [syncNote, setSyncNote] = useState("");

  const authId = authUser?.id ?? null;
  const authUserRef = useRef(null);
  const authIdRef = useRef(null);
  authUserRef.current = authUser;
  authIdRef.current = authId;

  const user = authUser
    ? {
        id: authUser.id,
        displayName: me?.username ?? nameFromAuthUser(authUser),
        email: isVirtualEmail(authUser.email) ? null : authUser.email,
      }
    : null;
  const profile = authUser
    ? { xp: me?.xp ?? 0, streak: me?.streak ?? 0 }
    : guest;

  /* ---------------- Pieter's greeting manager (home page bubble) ----------------
     heroPhase decides the base text of the bubble:
       "greeting"  the standard intro. First-time guest: shown for exactly 3s, then it clears.
                   Returning guest: stays, as a standing prompt to register.
       "welcome"   signed-in player: a welcome-back line typed out silently (no audio); once
                   typing finishes it stays exactly 3s.
       "idle"      Pieter's standard laughing dialogue (what both of the above fall back to).
     On top of that, a click reply (pokeLine) or an idle call-out (callout) can take over the
     bubble for a few seconds. */
  const [visitReady, setVisitReady] = useState(false);
  const [heroPhase, setHeroPhase] = useState("greeting"); // "greeting" | "welcome" | "idle"
  const [welcomeText, setWelcomeText] = useState("");
  const [typedLen, setTypedLen] = useState(0);
  const [idleLine, setIdleLine] = useState(QUIPS[0]);
  const [pokeLine, setPokeLine] = useState(null);
  const [callout, setCallout] = useState(null);

  const visitRef = useRef(null); // "first" | "returning" (a ref, so React's dev double-mount can't flip it)
  const registeringRef = useRef(false); // true between pressing REGISTER and the welcome line
  const pokeTimer = useRef(null);
  const calloutTimer = useRef(null);
  const lastPrompt = useRef("");
  const displayNameRef = useRef("");
  const streakRef = useRef(0);
  displayNameRef.current = user?.displayName ?? "";
  streakRef.current = profile.streak;

  // The bubble only matters (and the timers only run) while the home dashboard is on screen.
  const heroVisible = bootPhase === "done" && screen === "home" && tab === "learn";

  // Repeat-visit tracking (localStorage). Old installs that only have the guest-progress key count as repeat.
  useEffect(() => {
    if (visitRef.current === null) {
      let seen = false;
      try {
        seen = !!(localStorage.getItem(VISITED_KEY) || localStorage.getItem(STORAGE_KEY));
        localStorage.setItem(VISITED_KEY, String(Date.now()));
      } catch {
        /* storage unavailable: treated as a first visit every time */
      }
      visitRef.current = seen ? "returning" : "first";
    }
    setVisitReady(true);
  }, []);

  // Pick the phase when the app is ready and whenever the signed-in player changes.
  useEffect(() => {
    if (bootPhase !== "done" || !visitReady) return;
    if (authId) {
      const isNew = registeringRef.current;
      registeringRef.current = false;
      setWelcomeText(pickWelcome(displayNameRef.current || "friend", streakRef.current, isNew));
      setTypedLen(0); // start the new line from an empty bubble (no flash of the previous length)
      setHeroPhase("welcome");
    } else {
      setHeroPhase("greeting");
    }
  }, [bootPhase, visitReady, authId]);

  // First-time guest: the greeting lasts exactly 3 seconds, then clears to the standard dialogue.
  useEffect(() => {
    if (!heroVisible || !visitReady || authId || heroPhase !== "greeting" || visitRef.current !== "first") return;
    const t = setTimeout(() => {
      visitRef.current = "returning"; // from now on this guest gets the persistent greeting
      setIdleLine(pickRandom(QUIPS));
      setHeroPhase("idle");
    }, FIRST_GREETING_MS);
    return () => clearTimeout(t);
  }, [heroVisible, visitReady, authId, heroPhase]);

  // Signed-in welcome: silent typewriter, then exactly 3s on screen, then the standard dialogue.
  useEffect(() => {
    if (!heroVisible || heroPhase !== "welcome") return;
    let hold;
    const finish = () => {
      hold = setTimeout(() => {
        setIdleLine(pickRandom(QUIPS));
        setHeroPhase("idle");
      }, WELCOME_HOLD_MS);
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setTypedLen(welcomeText.length); // no typing animation for people who asked for less motion
      finish();
      return () => clearTimeout(hold);
    }
    setTypedLen(0);
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      setTypedLen(i);
      if (i >= welcomeText.length) {
        clearInterval(iv);
        finish();
      }
    }, WELCOME_TYPE_MS);
    return () => {
      clearInterval(iv);
      clearTimeout(hold);
    };
  }, [heroVisible, heroPhase, welcomeText]);

  // Click / tap on Pieter: his laugh line replaces the bubble text for a moment.
  const handlePieterQuip = useCallback((text) => {
    setCallout(null);
    setPokeLine(text);
    clearTimeout(pokeTimer.current);
    pokeTimer.current = setTimeout(() => setPokeLine(null), QUIP_MS);
  }, []);

  // Ambient idle call-outs. Any cursor move, click, key press, scroll or touch resets the clock.
  // The listener exists only while the home dashboard is showing, so it is off during a quiz.
  useEffect(() => {
    if (!heroVisible) return;
    let lastActive = Date.now();
    let delay = randomIdleDelay();
    let timer;

    const onActivity = () => {
      lastActive = Date.now(); // cheap on purpose: this fires on every mouse move
      delay = randomIdleDelay(); // a fresh random 3 to 5 minute window after each interaction
    };
    const check = () => {
      const idleFor = Date.now() - lastActive;
      if (idleFor < delay) {
        timer = setTimeout(check, delay - idleFor); // activity moved the deadline: wait the rest
        return;
      }
      if (document.visibilityState === "visible") {
        let prompt;
        do prompt = pickRandom(IDLE_PROMPTS);
        while (prompt === lastPrompt.current && IDLE_PROMPTS.length > 1);
        lastPrompt.current = prompt;
        setPokeLine(null);
        setCallout(prompt);
        clearTimeout(calloutTimer.current);
        calloutTimer.current = setTimeout(() => setCallout(null), CALLOUT_MS);
      }
      lastActive = Date.now();
      delay = randomIdleDelay();
      timer = setTimeout(check, delay);
    };

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    timer = setTimeout(check, delay);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      clearTimeout(timer);
      clearTimeout(calloutTimer.current);
      setCallout(null);
    };
  }, [heroVisible]);

  useEffect(() => () => clearTimeout(pokeTimer.current), []);

  // What the bubble shows right now (click reply > call-out > the phase's own text).
  const hero = pokeLine
    ? { kind: "line", text: pokeLine }
    : callout
      ? { kind: "line", text: callout, mood: "happy" }
      : heroPhase === "welcome" || (authId && heroPhase === "greeting") // signed in: never flash the guest greeting
        ? { kind: "typing", text: welcomeText.slice(0, typedLen), full: welcomeText }
        : heroPhase === "idle"
          ? { kind: "line", text: idleLine }
          : { kind: "greeting" };

  /* ---------------- boot: minimum 2s timer ---------------- */
  useEffect(() => {
    const t = setTimeout(() => setBootMinDone(true), BOOT_MIN_MS);
    return () => clearTimeout(t);
  }, []);

  /* ---------------- theme: read what layout.js applied before paint ---------------- */
  useEffect(() => {
    const root = document.documentElement;
    const m = root.getAttribute("data-mode") === "dark" ? "dark" : "light";
    let a = root.getAttribute("data-accent");
    if (!ACCENTS[a]) a = "green";

    // One-time migration: older versions saved only an accent as `themeKey`.
    try {
      if (!localStorage.getItem(THEME_KEY)) {
        const old = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
        if (old?.themeKey && ACCENTS[old.themeKey]) {
          a = old.themeKey;
          applyTheme(m, a);
        }
      }
    } catch {
      /* ignore */
    }
    setMode(m);
    setAccent(a);
  }, []);

  // Handlers read the *other* axis from <html> (the source of truth) rather than from a
  // closure, so two quick changes in a row can never overwrite each other with stale state.
  function changeMode(next) {
    setMode(next);
    applyTheme(next, document.documentElement.getAttribute("data-accent") || "green");
  }
  function changeAccent(next) {
    setAccent(next);
    applyTheme(document.documentElement.getAttribute("data-mode") || "light", next);
  }

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

  /* ---------------- guest progress: load / save ---------------- */
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved?.guest) {
        setGuest(saved.guest);
      } else {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null");
        if (legacy?.profile) setGuest(legacy.profile);
      }
    } catch {
      /* ignore corrupted storage */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Only guest progress is stored here. Accounts, XP, streaks and ranks of signed-in
    // players live in Supabase (old local username accounts are gone by design).
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guest }));
  }, [guest, hydrated]);

  /* ---------------- Supabase auth listener ---------------- */
  useEffect(() => {
    let cancelled = false;
    const safety = setTimeout(() => !cancelled && setAuthReady(true), AUTH_TIMEOUT_MS);

    // 1) Existing session on mount (also covers the return from Google).
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setAuthUser(data.session?.user ?? null);
        setAuthReady(true);
      })
      .catch(() => !cancelled && setAuthReady(true));

    // 2) Live changes: SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, ...
    //    (Keep this callback synchronous: don't await Supabase calls inside it.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => {
      cancelled = true;
      clearTimeout(safety);
      subscription.unsubscribe();
    };
  }, []);

  // Close the login dialog as soon as a session exists.
  useEffect(() => {
    if (authId) setAuthOpen(false);
  }, [authId]);

  /* ---------------- cloud: my profile, league, realtime ---------------- */
  const upsertPlayer = useCallback((row) => {
    setPlayers((prev) => {
      const i = prev.findIndex((p) => p.id === row.id);
      if (i === -1) return [...prev, row];
      const copy = [...prev];
      copy[i] = row;
      return copy;
    });
  }, []);

  // Whenever a (different) player signs in: load their profile row, creating it if needed.
  useEffect(() => {
    if (!authId) {
      setMe(null);
      return;
    }
    let cancelled = false;
    ensureProfile(supabase, authUserRef.current).then(({ row, error }) => {
      if (cancelled) return;
      if (error) {
        setCloud(cloudStatusFrom(error));
        return;
      }
      setMe(row);
      upsertPlayer(row);
    });
    return () => {
      cancelled = true;
    };
  }, [authId, upsertPlayer]);

  const refreshLeague = useCallback(async () => {
    const { rows, error } = await fetchPlayers(supabase);
    if (error) {
      setCloud(cloudStatusFrom(error));
      return;
    }
    setPlayers(rows);
    setCloud({ status: "ok" });
    const mine = authIdRef.current && rows.find((r) => r.id === authIdRef.current);
    if (mine) setMe(mine);
  }, []);

  // League: initial load + live Supabase Realtime updates (same account on another
  // device included) + a refresh whenever the tab becomes visible again.
  useEffect(() => {
    refreshLeague();
    const unsubscribe = subscribeToProfiles(supabase, ({ type, row }) => {
      if (type === "DELETE") {
        setPlayers((prev) => prev.filter((p) => p.id !== row.id));
        if (row.id === authIdRef.current) setMe(null);
        return;
      }
      upsertPlayer(row);
      if (row.id === authIdRef.current) setMe(row);
    });
    const onVisible = () => document.visibilityState === "visible" && refreshLeague();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshLeague, upsertPlayer]);

  /* ---------------- leave the boot screen ---------------- */
  useEffect(() => {
    if (bootPhase !== "loading" || !bootMinDone || !dataReady || !hydrated || !authReady) return;
    setBootPhase("leaving");
  }, [bootPhase, bootMinDone, dataReady, hydrated, authReady]);

  useEffect(() => {
    if (bootPhase !== "leaving") return;
    const t = setTimeout(() => setBootPhase("done"), BOOT_FADE_MS);
    return () => clearTimeout(t);
  }, [bootPhase]);

  /* ---------------- derived data ---------------- */
  // Topic cards: every generator topic (with any matching sheet topics folded in),
  // plus sheet topics no generator covers (grouped under "Others").
  const entries = useMemo(() => {
    const byKey = new Map(
      TOPIC_DEFS.map((def) => [
        def.key,
        { key: def.key, def, title: def.label, group: def.group, blurb: def.blurb, sheetNames: [], sheetCount: 0 },
      ])
    );
    const extra = new Map();
    for (const q of questions) {
      const def = topicDefFor(q.topic);
      if (def) {
        const e = byKey.get(def.key);
        if (!e.sheetNames.includes(q.topic)) e.sheetNames.push(q.topic);
        e.sheetCount++;
      } else {
        if (!extra.has(q.topic)) {
          extra.set(q.topic, {
            key: `sheet:${q.topic}`,
            def: null,
            title: q.topic,
            group: GROUP_SHEET,
            blurb: "",
            sheetNames: [q.topic],
            sheetCount: 0,
          });
        }
        extra.get(q.topic).sheetCount++;
      }
    }
    return [...byKey.values(), ...extra.values()];
  }, [questions]);

  const league = useMemo(
    () =>
      [...players]
        .sort((a, b) => b.xp - a.xp || a.username.localeCompare(b.username))
        .map((p, i) => ({ ...p, rank: i + 1, isYou: p.id === authId })),
    [players, authId]
  );
  const myRank = league.find((p) => p.isYou)?.rank ?? null;

  /* ---------------- auth actions ---------------- */
  // Username + password sign-up. The username becomes the virtual email
  // `${username}@octopi.edu`; the database trigger then creates the profile row.
  async function handleRegister(rawName, password) {
    registeringRef.current = true; // so Pieter says "Welcome to OctoPi" to a new player, not "Welcome back"
    const res = await registerAccount(rawName, password);
    if (!res.ok) registeringRef.current = false;
    return res;
  }

  async function registerAccount(rawName, password) {
    const username = rawName.trim();
    if (!USERNAME_RE.test(username)) {
      return { ok: false, error: "Use 3–16 letters, numbers, _ or -" };
    }
    if (password.length < MIN_PASSWORD) {
      return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` };
    }
    try {
      const email = usernameToEmail(username);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (error) return { ok: false, error: describeAuthError(error) };
      // With email confirmation on, Supabase hides duplicates by returning a user with no identities.
      if (data.user && data.user.identities?.length === 0) {
        return { ok: false, error: "That username is already taken. Try another one." };
      }
      if (!data.session) {
        // No session yet: try to log in straight away. If "Confirm email" is still enabled
        // in the dashboard this fails with a clear explanation.
        const res = await supabase.auth.signInWithPassword({ email, password });
        if (res.error) return { ok: false, error: describeAuthError(res.error) };
      }
      return { ok: true }; // the auth listener picks up the session and closes the dialog
    } catch (err) {
      return { ok: false, error: describeAuthError(err) };
    }
  }

  async function handleLogin(rawName, password) {
    const username = rawName.trim();
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(username), // `${username}@octopi.edu`
        password,
      });
      if (error) return { ok: false, error: describeAuthError(error) };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeAuthError(err) };
    }
  }

  // Real Google login. Sends the browser to Google; when Google sends the player
  // back to `window.location.origin`, the auth listener above receives the session.
  async function handleGoogleLogin() {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async function handleSignOut() {
    try {
      await supabase.auth.signOut(); // ends the Supabase session
    } catch (err) {
      console.warn("[OctoPi] Supabase sign-out failed:", err.message);
    }
    setAuthUser(null);
    setMe(null);
    setTab("learn");
    setScreen("home");
  }

  /* ---------------- quiz flow ---------------- */
  function startPlan(nextPlan) {
    const round =
      nextPlan.kind === "mixed"
        ? buildMixedSession(questions)
        : buildTopicSession(nextPlan.entry, questions).slice(0, SESSION_SIZE);
    setPlan(nextPlan);
    setSession(round);
    setQuizKey((k) => k + 1);
    setScreen("quiz");
  }

  function goHome(nextTab = "learn") {
    setTab(nextTab);
    setScreen("home");
  }

  async function handleComplete(info) {
    const earned = info.correct * XP_PER_CORRECT + info.heartsLeft * XP_PER_HEART_LEFT;
    setEarnedXp(earned);
    setEndInfo(info);
    setSyncNote("");
    setScreen("complete");

    if (authUser) {
      // Signed in: the database does the XP + streak maths (award_xp in schema.sql), and every
      // device sees the result through Realtime.
      const { row, error } = await awardXp(supabase, earned);
      if (error) {
        setSyncNote(
          isMissingSchema(error)
            ? "Couldn't save your XP: the cloud database isn't set up yet (run supabase/schema.sql in Supabase)."
            : `Couldn't save your XP to the cloud: ${error.message}`
        );
        if (isMissingSchema(error)) setCloud({ status: "setup" });
      } else if (row) {
        setMe(row);
        upsertPlayer(row);
      }
    } else {
      // Guest: progress stays on this device. Streak: +1 if last active yesterday, unchanged if
      // today, otherwise restart at 1.
      setGuest((g) => {
        let streak = 1;
        if (g.lastActive === todayKey()) streak = Math.max(g.streak, 1);
        else if (g.lastActive === todayKey(-1)) streak = g.streak + 1;
        return { xp: g.xp + earned, streak, lastActive: todayKey() };
      });
    }
  }

  function handleGameOver(info) {
    setEndInfo(info);
    setScreen("gameover");
  }

  /* ---------------- render ---------------- */
  const booting = bootPhase !== "done";

  return (
    <div className="app">
      <MathBackground />

      {bootPhase !== "loading" && (
        <div className="app-content">
          {screen === "quiz" ? (
            <Quiz
              key={quizKey}
              title={plan?.kind === "mixed" ? "Mixed Practice Challenge" : plan?.entry?.title ?? ""}
              session={session}
              onExit={() => goHome()}
              onGameOver={handleGameOver}
              onComplete={handleComplete}
            />
          ) : screen === "gameover" ? (
            <GameOver info={endInfo} onRetry={() => startPlan(plan)} onHome={() => goHome()} />
          ) : screen === "complete" ? (
            <Complete
              info={endInfo}
              earnedXp={earnedXp}
              rank={myRank}
              signedIn={!!authUser}
              syncNote={syncNote}
              onHome={() => goHome()}
              onLeaderboard={() => goHome("leaderboard")}
            />
          ) : (
            <>
              <Navbar
                mode={mode}
                onToggleMode={() => changeMode(mode === "dark" ? "light" : "dark")}
                accent={accent}
                onAccentChange={changeAccent}
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
                    entries={entries}
                    onSelect={(entry) => startPlan({ kind: "topic", entry })}
                    onSelectMixed={() => startPlan({ kind: "mixed" })}
                    source={source}
                    total={questions.length}
                    cloud={cloud}
                    hero={hero}
                    onPieterQuip={handlePieterQuip}
                  />
                ) : (
                  <Leaderboard league={league} user={user} onOpenAuth={() => setAuthOpen(true)} cloud={cloud} />
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
