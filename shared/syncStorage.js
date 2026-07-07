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

// The value that was true on both sides as of `markerKey`'s timestamp —
// lets reconcile() tell "local hasn't changed since we last synced" (safe
// to take the new remote value) apart from "local was edited since" (a
// real conflict), instead of just comparing local to the new remote value.
function syncedValueKey(key) {
  return `${key}::synced-value`;
}

function readSyncedValue(key) {
  try {
    const raw = localStorage.getItem(syncedValueKey(key));
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeSyncedState(key, updatedAt, value) {
  localStorage.setItem(markerKey(key), updatedAt);
  try { localStorage.setItem(syncedValueKey(key), JSON.stringify(value)); } catch {}
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Drop-in replacement for a plain useState+localStorage hook. Same
// [value, save] shape, plus a third `conflict` element, but when a
// Supabase session exists it also keeps a `public.app_data` row
// (identified by appId + key) in sync in the background: pulled on
// mount/login, pushed on every save, and picked up live from other
// logged-in tabs/devices via Realtime. Adding a new app just means picking
// a new appId/key — no new table needed.
//
// When a remote value arrives (on pull or via Realtime) that disagrees
// with the local value and we can't tell which one is stale, neither side
// is applied automatically — `conflict` is set to { local, remote,
// keepLocal, keepRemote } so the caller can ask the user which to keep.
export function useSyncedStorage(appId, key, fallback) {
  const [data, setData] = useState(() => readLocal(key, fallback));
  const [conflict, setConflict] = useState(null);
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
    if (row) writeSyncedState(key, row.updated_at, val);
  }, [appId, key]);

  const save = useCallback((val) => {
    setConflict(null);
    setData((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      writeLocal(key, next);
      pushRemote(next);
      return next;
    });
  }, [key, pushRemote]);

  // Applies an incoming remote row, unless it conflicts with a local value
  // we can't confirm is stale — in which case it surfaces `conflict`
  // instead of picking a side.
  const reconcile = useCallback((row) => {
    const localMarker = localStorage.getItem(markerKey(key));
    if (localMarker === row.updated_at) return; // already in sync

    if (sameValue(row.value, dataRef.current)) {
      writeSyncedState(key, row.updated_at, row.value); // catch up the marker only
      return;
    }

    // Local is "clean" (no edits pending since the last known sync point) if
    // it still matches whatever we last confirmed as synced — or, if this
    // device has never synced this key before, if it's still the untouched
    // fallback. Either way there's nothing local worth protecting, so the
    // new remote value can just be taken.
    const lastSynced = readSyncedValue(key);
    const localIsClean = lastSynced !== undefined
      ? sameValue(dataRef.current, lastSynced)
      : sameValue(dataRef.current, fallback);

    if (localIsClean) {
      setData(row.value);
      writeLocal(key, row.value);
      writeSyncedState(key, row.updated_at, row.value);
      return;
    }

    setConflict({
      local: dataRef.current,
      remote: row.value,
      keepLocal: () => {
        setConflict(null);
        pushRemote(dataRef.current);
      },
      keepRemote: () => {
        setConflict(null);
        setData(row.value);
        writeLocal(key, row.value);
        writeSyncedState(key, row.updated_at, row.value);
      },
    });
  }, [key, fallback, pushRemote]);

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

      reconcile(row);
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
          reconcile(row);
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
  }, [appId, key, pushRemote, reconcile]);

  return [data, save, conflict];
}
