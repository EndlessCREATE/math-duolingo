// ---------------------------------------------------------------------------
// CLOUD DATA LAYER (Supabase)
//
// Everything player-related lives in the Supabase database:
//   • auth.users        – credentials / Google identities   (managed by Supabase Auth)
//   • public.profiles   – username, xp, streak, last_active (one row per player)
//
// There are NO local fallback arrays or mock players any more. Streaks, XP and
// ranks come from `profiles`, so a learner sees the same numbers on every device,
// and the league updates live through Supabase Realtime.
//
// One-time setup: run  supabase/schema.sql  in the Supabase SQL editor.
// (It creates the table, row-level-security policies, the award_xp() function,
// the new-user trigger and switches Realtime on for the table.)
//
// Every function takes the Supabase client as its first argument. The client is
// created once in app/page.js.
// ---------------------------------------------------------------------------

/* ========================================================================
   USERNAME  <->  VIRTUAL EMAIL
   ======================================================================== */

// Supabase Auth logs in with an email. Players only choose a username, so it is
// mapped to a virtual address that is never emailed.
export const USER_EMAIL_DOMAIN = "octopi.edu";
export const USERNAME_RE = /^[A-Za-z0-9_-]{3,16}$/;
export const MIN_PASSWORD = 6; // Supabase's default minimum

export function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`;
}

export function isVirtualEmail(email) {
  return !!email && email.toLowerCase().endsWith(`@${USER_EMAIL_DOMAIN}`);
}

/** Best display name for any kind of auth user (password or Google). */
export function nameFromAuthUser(authUser) {
  const meta = authUser?.user_metadata ?? {};
  return (
    meta.username ??
    meta.full_name ?? // Google profile name
    meta.name ??
    authUser?.email?.split("@")[0] ??
    "Player"
  );
}

/* ========================================================================
   ERRORS
   ======================================================================== */

export const CONFIRM_EMAIL_HELP =
  "Your account was created, but Supabase is still asking for email confirmation (which virtual @octopi.edu addresses can never receive). " +
  "In the Supabase dashboard open Authentication → Sign In / Providers → Email and turn OFF “Confirm email”, then log in.";

/** True when the profiles table / award_xp function haven't been created yet. */
export function isMissingSchema(error) {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  return (
    ["PGRST205", "PGRST202", "42P01", "42883"].includes(code) ||
    /schema cache|does not exist|could not find the (table|function)/i.test(msg)
  );
}

/** Friendly text for the errors Supabase Auth can return. */
export function describeAuthError(error) {
  const code = error?.code ?? "";
  const msg = (error?.message ?? "").toLowerCase();
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return CONFIRM_EMAIL_HELP;
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "Wrong username or password.";
  if (code === "user_already_exists" || msg.includes("already registered") || msg.includes("already been registered"))
    return "That username is already taken. Try another one.";
  if (code === "weak_password" || msg.includes("password should be") || msg.includes("password is too"))
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || msg.includes("rate limit"))
    return "Too many attempts. Please wait a minute and try again.";
  if (code === "signup_disabled") return "Sign-ups are turned off for this project.";
  if (msg.includes("failed to fetch") || msg.includes("network")) return "Can't reach the server. Check your connection and try again.";
  return error?.message || "Something went wrong. Please try again.";
}

/* ========================================================================
   PROFILES (read / create)
   ======================================================================== */

const PROFILE_COLUMNS = "id, username, xp, streak, last_active";

/** Top players, highest XP first. */
export async function fetchPlayers(client, limit = 200) {
  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .order("xp", { ascending: false })
    .order("username", { ascending: true })
    .limit(limit);
  return { rows: data ?? [], error };
}

/**
 * Make sure the signed-in user has a profile row.
 * The database trigger normally creates it at sign-up; this is the safety net
 * (e.g. accounts that existed before the trigger was installed).
 */
export async function ensureProfile(client, authUser) {
  const existing = await client.from("profiles").select(PROFILE_COLUMNS).eq("id", authUser.id).maybeSingle();
  if (existing.error) return { row: null, error: existing.error };
  if (existing.data) return { row: existing.data, error: null };

  const base = String(nameFromAuthUser(authUser)).replace(/[^A-Za-z0-9_ .-]/g, "").slice(0, 20) || "player";
  for (let attempt = 0; attempt < 5; attempt++) {
    const username = attempt === 0 ? base : `${base}${Math.floor(Math.random() * 9000) + 1000}`;
    const { data, error } = await client.from("profiles").insert({ id: authUser.id, username }).select(PROFILE_COLUMNS).single();
    if (!error) return { row: data, error: null };
    if (error.code === "23505") {
      // unique violation: either the id (row appeared meanwhile) or the username
      const again = await client.from("profiles").select(PROFILE_COLUMNS).eq("id", authUser.id).maybeSingle();
      if (again.data) return { row: again.data, error: null };
      continue; // username taken -> try a suffixed one
    }
    return { row: null, error };
  }
  return { row: null, error: { message: "Could not create a unique username." } };
}

/* ========================================================================
   XP + STREAK (server-side)
   ======================================================================== */

/**
 * Award XP for a finished quiz. The `award_xp` SQL function (schema.sql) runs on
 * the server: it caps the amount, updates the streak from the server's date and
 * returns the new profile row. Clients cannot UPDATE xp/streak directly.
 *
 * NOTE: the amount is still reported by the client, so a determined player could
 * send a fake (capped) value. Fully cheat-proof XP needs the server to grade the
 * answers itself (e.g. a Supabase Edge Function that holds the questions).
 */
export async function awardXp(client, amount) {
  const { data, error } = await client.rpc("award_xp", { p_xp: Math.max(0, Math.round(amount)) });
  return { row: data ?? null, error };
}

/* ========================================================================
   REALTIME
   ======================================================================== */

/**
 * Continuously listen to the profiles table (Supabase Realtime / postgres_changes).
 * `onChange({ type: "UPSERT" | "DELETE", row })` fires for every insert, update or
 * delete made by anyone — including the same player on another device.
 * Returns an unsubscribe function.
 */
export function subscribeToProfiles(client, onChange) {
  const channel = client
    .channel(`octopi-profiles-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, (payload) => {
      if (payload.eventType === "DELETE") onChange({ type: "DELETE", row: payload.old });
      else onChange({ type: "UPSERT", row: payload.new });
    })
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}
