import { supabase } from "./supabaseClient.js";

const { useState, useEffect } = React;

// Hook shared by every app: `undefined` while the session is still loading,
// `null` when logged out, otherwise the active Supabase session.
export function useSession() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return session;
}

// Supabase Auth has no native username identity, so signups use a
// synthetic, non-deliverable email derived from the username (email
// confirmations are disabled, so nothing is ever sent to it) and stash the
// real username in user_metadata for display.
const USERNAME_EMAIL_DOMAIN = "users.ai-apps.local";

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}

export function usernameFromSession(session) {
  return session?.user?.user_metadata?.username || session?.user?.email;
}

export function signIn(username, password) {
  return supabase.auth.signInWithPassword({ email: usernameToEmail(username), password });
}

export function signUp(username, password) {
  return supabase.auth.signUp({
    email: usernameToEmail(username),
    password,
    options: { data: { username: username.trim() } },
  });
}

export function signOut() {
  return supabase.auth.signOut();
}
