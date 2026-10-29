// The AI podcast episodes (see the german-podcast edge function). That
// function is the only writer of their app_data row, so unlike
// useSyncedStorage this just reads it: on open, when the app comes back to
// the foreground, on refresh(), and live through Realtime. The last value
// is kept in localStorage, so the list (and cached episodes) work offline.
import { supabase } from "../shared/supabaseClient.js";
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
    const { data } = await supabase
      .from("app_data")
      .select("value")
      .eq("app_id", APP_ID)
      .eq("key", KEYS.episodes)
      .maybeSingle();
    if (data) apply(data.value);
  }, [userId, apply]);

  useEffect(() => {
    if (!userId) return;
    refresh();
    const channel = supabase
      .channel(`app_data:${APP_ID}:episodes:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_data", filter: `user_id=eq.${userId}` }, payload => {
        const row = payload.new;
        if (row && row.app_id === APP_ID && row.key === KEYS.episodes) apply(row.value);
      })
      .subscribe();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, refresh, apply]);

  return [value, refresh];
}
