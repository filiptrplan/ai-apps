import { supabase } from "./supabaseClient.js";

const { useState, useEffect, useRef, useCallback } = React;

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function markerKey(key) {
  return `${key}::synced-at`;
}

// Drop-in replacement for a plain useState+localStorage hook. Same
// [value, save] shape, but when a Supabase session exists it also keeps a
// `public.app_data` row (identified by appId + key) in sync in the
// background: pulled on mount/login, pushed on every save, and picked up
// live from other logged-in tabs/devices via Realtime. Adding a new app
// just means picking a new appId/key — no new table needed.
export function useSyncedStorage(appId, key, fallback) {
  const [data, setData] = useState(() => readLocal(key, fallback));
  const dataRef = useRef(data);
  dataRef.current = data;

  const pushRemote = useCallback(async (val) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data: row } = await supabase
      .from("app_data")
      .upsert(
        { user_id: session.user.id, app_id: appId, key, value: val },
        { onConflict: "user_id,app_id,key" }
      )
      .select("updated_at")
      .single();
    if (row) localStorage.setItem(markerKey(key), row.updated_at);
  }, [appId, key]);

  const save = useCallback((val) => {
    setData((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      writeLocal(key, next);
      pushRemote(next);
      return next;
    });
  }, [key, pushRemote]);

  useEffect(() => {
    let channel;
    let cancelled = false;

    async function pullOnce() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;

      const { data: row } = await supabase
        .from("app_data")
        .select("value, updated_at")
        .eq("app_id", appId)
        .eq("key", key)
        .maybeSingle();

      if (cancelled) return;

      if (!row) {
        pushRemote(dataRef.current);
        return;
      }

      const localMarker = localStorage.getItem(markerKey(key));
      if (!localMarker || new Date(row.updated_at) > new Date(localMarker)) {
        setData(row.value);
        writeLocal(key, row.value);
        localStorage.setItem(markerKey(key), row.updated_at);
      }
    }

    async function subscribe() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      if (channel) supabase.removeChannel(channel);

      channel = supabase
        .channel(`app_data:${appId}:${key}:${session.user.id}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "app_data",
          filter: `user_id=eq.${session.user.id}`,
        }, (payload) => {
          const row = payload.new;
          if (!row || row.app_id !== appId || row.key !== key) return;
          setData(row.value);
          writeLocal(key, row.value);
          localStorage.setItem(markerKey(key), row.updated_at);
        })
        .subscribe();
    }

    pullOnce().then(subscribe);

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") pullOnce().then(subscribe);
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      sub.subscription.unsubscribe();
    };
  }, [appId, key, pushRemote]);

  return [data, save];
}
