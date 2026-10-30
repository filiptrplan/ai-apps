// The AI podcast episodes (see the german-podcast function). That function
// is the only writer of their app_data row, so unlike useSyncedStorage this
// just reads it: on open, when the app comes back to the foreground, on
// refresh(), and live through /api/events. The last value is kept in
// localStorage, so the list (and cached episodes) work offline.
import { apiFetch } from "../shared/api.js";
import { subscribe } from "../shared/events.js";
import { APP_ID, KEYS, DEFAULT_EPISODES } from "./model.js";

const { useState, useEffect, useCallback } = React;

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.episodes)) || DEFAULT_EPISODES;
  } catch {
    return DEFAULT_EPISODES;
  }
}

export function useEpisodes(session) {
  const [value, setValue] = useState(readLocal);
  const userId = session?.user.id;

  const apply = useCallback(v => {
    setValue(v);
    try { localStorage.setItem(KEYS.episodes, JSON.stringify(v)); } catch {}
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const row = await apiFetch(`/api/data/${APP_ID}/${KEYS.episodes}`).catch(() => null);
    if (row) apply(row.value);
  }, [userId, apply]);

  useEffect(() => {
    if (!userId) return;
    refresh();
    const unsubscribe = subscribe("data", change => {
      if (change.resync || (change.app_id === APP_ID && change.key === KEYS.episodes)) refresh();
    });
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, refresh]);

  return [value, refresh];
}
