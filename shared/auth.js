// Who is signed in, shared by every app. Sign-in itself happens on Pocket
// ID (id.trplan.si): signIn() leaves the page and comes back to it signed
// in, with a session cookie the API reads. Kept free of React at the top
// level so index.html can import it as a bare ES module too.
//
// A session is { user: { id, email } }. The last one seen is remembered in
// localStorage, so apps still know who is signed in while offline.
import { apiFetch } from "./api.js";

const CACHE_KEY = "auth:session";

let current; // undefined until loaded, then a session or null
let loading = null;
const listeners = new Set();

function readCached() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? null;
  } catch {
    return null;
  }
}

function writeCached(session) {
  try {
    if (session) localStorage.setItem(CACHE_KEY, JSON.stringify(session));
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
}

function same(a, b) {
  return (a?.user.id ?? null) === (b?.user.id ?? null);
}

// Sets the session and tells onSessionChange listeners if who is signed in changed.
function set(session) {
  const changed = current !== undefined && !same(current, session);
  current = session;
  writeCached(session);
  if (changed) listeners.forEach((fn) => fn(session));
}

async function load() {
  try {
    const { user } = await apiFetch("/api/auth/session");
    set(user ? { user } : null);
  } catch {
    // Offline, or the server is down: go by the last session seen, and
    // check again once the network is back.
    current = readCached();
    window.addEventListener("online", () => load(), { once: true });
  }
  return current;
}

// Resolves with the session, or null when signed out.
export function getSession() {
  if (current !== undefined) return Promise.resolve(current);
  return (loading ??= load());
}

// Calls fn(session) whenever someone signs in or out, here or in another
// tab. Returns a function that stops it.
export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === CACHE_KEY && current !== undefined) set(readCached());
  });
}

// Hook shared by every app: `undefined` while the session is still loading,
// `null` when signed out, otherwise { user: { id, email } }.
export function useSession() {
  const { useState, useEffect } = React;
  const [session, setSession] = useState(current);

  useEffect(() => {
    let cancelled = false;
    getSession().then((s) => {
      if (!cancelled) setSession(s);
    });
    const off = onSessionChange(setSession);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return session;
}

// Goes to Pocket ID, and comes back to `next` (this page by default).
export function signIn(next = location.pathname + location.search + location.hash) {
  location.assign(`/auth/login?next=${encodeURIComponent(next)}`);
}

// Returns { error } (null on success), like the old Supabase call.
export async function signOut() {
  try {
    await apiFetch("/auth/logout", { method: "POST" });
  } catch (error) {
    return { error };
  }
  set(null);
  return { error: null };
}
