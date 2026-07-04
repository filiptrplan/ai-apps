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

export function signInWithOtp(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
}

export function signOut() {
  return supabase.auth.signOut();
}
