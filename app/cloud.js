// ---------------------------------------------------------------------------
// CLOUD / AUTH PLACEHOLDERS
//
// Everything in this file is a LOCAL STAND-IN for a real backend. Each function
// documents where to plug in a real service. page.js only talks to the cloud
// through these functions, so swapping them out is the only change needed.
//
// IMPORTANT (security): the browser's localStorage is NOT secure storage. Any
// player can open dev-tools and edit their XP/streak. For leaderboards that
// can't be cheated, XP must be awarded SERVER-SIDE (e.g. a Supabase Edge
// Function / Firebase Cloud Function / Next.js route handler that checks the
// quiz answers) and protected with row-level security so a user can only
// write their own row.
// ---------------------------------------------------------------------------

/* ========================================================================
   FRIENDS DATA (mock)
   ======================================================================== */

const MOCK_FRIENDS = [
  { id: "mock:euler", name: "Euler_Fan", xp: 520, streak: 41 },
  { id: "mock:pi", name: "PiLover3.14", xp: 465, streak: 28 },
  { id: "mock:algebra", name: "AlgebraAce", xp: 410, streak: 19 },
  { id: "mock:fraction", name: "Fractionator", xp: 355, streak: 12 },
  { id: "mock:sum", name: "SumSensei", xp: 300, streak: 9 },
  { id: "mock:ninja", name: "NinjaNumbers", xp: 240, streak: 7 },
  { id: "mock:geo", name: "GeoGirl", xp: 185, streak: 5 },
  { id: "mock:panda", name: "ProofPanda", xp: 130, streak: 3 },
  { id: "mock:mango", name: "MathMango", xp: 85, streak: 2 },
  { id: "mock:zero", name: "ZeroToHero", xp: 45, streak: 1 },
];

/* ========================================================================
   USERNAMES
   ======================================================================== */

/**
 * Is this username already used by someone in the cloud?
 *
 * TODO (Supabase):
 *   const { data } = await supabase
 *     .from("profiles").select("id").ilike("username", username).maybeSingle();
 *   return !!data;
 *   // + a UNIQUE index on lower(username) so races can't create duplicates.
 *
 * TODO (Firebase): query a `usernames/{lowercaseName}` document, or reserve
 * it in a transaction when registering.
 */
export async function isUsernameTakenInCloud(username) {
  const wanted = username.trim().toLowerCase();
  return MOCK_FRIENDS.some((f) => f.name.toLowerCase() === wanted);
}

/* ========================================================================
   GOOGLE SIGN-IN
   ======================================================================== */

// The fake Google account offered by the simulated popup.
export const SIMULATED_GOOGLE_PROFILE = {
  name: "Alex Morgan",
  email: "alex.morgan@example.com",
};

/**
 * Simulated Google OAuth popup result. Resolves with the Google profile
 * ({ name, email }) after a short delay, like a real popup would.
 *
 * ── OPTION A: NextAuth.js (Auth.js) ───────────────────────────────────────
 *  1. npm i next-auth
 *  2. Google Cloud Console → APIs & Services → Credentials → "OAuth client ID"
 *     (type: Web). Authorized redirect URI:
 *       http://localhost:3000/api/auth/callback/google   (and your prod URL)
 *  3. .env.local
 *       GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
 *       GOOGLE_CLIENT_SECRET=xxxxxxxx
 *       NEXTAUTH_SECRET=<openssl rand -base64 32>
 *       NEXTAUTH_URL=http://localhost:3000
 *  4. app/api/auth/[...nextauth]/route.js
 *       import NextAuth from "next-auth";
 *       import GoogleProvider from "next-auth/providers/google";
 *       const handler = NextAuth({
 *         providers: [GoogleProvider({
 *           clientId: process.env.GOOGLE_CLIENT_ID,
 *           clientSecret: process.env.GOOGLE_CLIENT_SECRET,
 *         })],
 *       });
 *       export { handler as GET, handler as POST };
 *  5. Wrap the app in <SessionProvider> (client component) and replace this
 *     function with:   signIn("google")          // from "next-auth/react"
 *     Read the user with useSession(): session.user.name / .email / .image
 *     and sign out with signOut().
 *
 * ── OPTION B: Supabase ────────────────────────────────────────────────────
 *  1. npm i @supabase/supabase-js
 *  2. Supabase dashboard → Authentication → Providers → Google: paste the
 *     Google OAuth client ID + secret from Google Cloud Console. Add the
 *     callback URL Supabase shows you to Google's authorized redirect URIs.
 *  3. .env.local
 *       NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
 *       NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
 *  4. Replace this function with:
 *       await supabase.auth.signInWithOAuth({
 *         provider: "google",
 *         options: { redirectTo: window.location.origin },
 *       });
 *     After the redirect, read the user with supabase.auth.getUser() →
 *     user.user_metadata.full_name / user.email, and listen for changes with
 *     supabase.auth.onAuthStateChange(...). Sign out: supabase.auth.signOut().
 *
 * With either option the Google "client ID" is public, the "client secret"
 * must only ever live in server-side env vars.
 */
export async function signInWithGoogle() {
  await new Promise((resolve) => setTimeout(resolve, 1100));
  return { ...SIMULATED_GOOGLE_PROFILE };
}

/* ========================================================================
   FRIENDS LEAGUE (multi-tenant data)
   ======================================================================== */

/**
 * Load the friends that appear in the signed-in user's league.
 *
 * TODO (Supabase):
 *   // tables: profiles(id, username, xp, streak) and
 *   //         friendships(user_id, friend_id, status)
 *   const { data } = await supabase
 *     .from("friendships")
 *     .select("friend:profiles!friend_id(id, username, xp, streak)")
 *     .eq("user_id", userId).eq("status", "accepted");
 *   return data.map(({ friend }) => ({ id: friend.id, name: friend.username,
 *                                      xp: friend.xp, streak: friend.streak }));
 *   // Turn on Realtime for `profiles` to live-update the leaderboard.
 *
 * TODO (Firebase):
 *   // collection `users`, each doc has `friends: [uid, ...]`
 *   const snap = await getDocs(query(collection(db, "users"),
 *                                    where(documentId(), "in", friendUids)));
 *   return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
 *
 * @param {string|null} userId  the signed-in user's id (null for guests)
 * @returns {Promise<{id:string,name:string,xp:number,streak:number}[]>}
 */
// eslint-disable-next-line no-unused-vars
export async function fetchFriendsLeague(userId) {
  return MOCK_FRIENDS;
}

/**
 * Save a user's streak + XP to the cloud (called after every change).
 *
 * TODO (Supabase):
 *   // Do NOT trust XP sent from the client. Call an RPC / Edge Function that
 *   // validates the completed quiz and increments XP itself:
 *   await supabase.rpc("award_xp", { quiz_id, answers });
 *   // RLS policy: using (auth.uid() = id) with check (auth.uid() = id)
 *
 * TODO (Firebase): write via a callable Cloud Function and lock the `users`
 * collection with Security Rules (allow write: if false from the client).
 */
// eslint-disable-next-line no-unused-vars
export async function syncProfileToCloud(userId, profile) {
  /* no-op while running locally */
}
