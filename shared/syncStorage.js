import { apiFetch } from "./api.js";
import { getSession, onSessionChange } from "./auth.js";
import { subscribe } from "./events.js";

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

function dataPath(appId, key) {
  return `/api/data/${encodeURIComponent(appId)}/${encodeURIComponent(key)}`;
}

// Drop-in replacement for a plain useState+localStorage hook. Same
// [value, save] shape, plus a third `conflict` element, but when signed
// in it also keeps a `public.app_data` row (identified by appId + key) in
// sync in the background through /api/data: pulled on mount/login, pushed
// on every save, and picked up live from other logged-in tabs/devices via
// /api/events. Adding a new app just means picking a new appId/key — no
// new table needed.
//
// When a remote value arrives (on pull or live) that disagrees
// with the local value and we can't tell which one is stale, neither side
// is applied automatically — `conflict` is set to { local, remote,
// keepLocal, keepRemote } so the caller can ask the user which to keep.
export function useSyncedStorage(appId, key, fallback) {
  const [data, setData] = useState(() => readLocal(key, fallback));
  const [conflict, setConflict] = useState(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  // Pushes go out one at a time: concurrent upserts can land out of order
  // (leaving an older value on the server), and their live echoes can
  // arrive after a newer save and look like a fresh remote change. While a
  // push is in flight, later saves just replace `pending`, so only the
  // latest value is sent next. `written` remembers the updated_at of our
  // recent writes so their late echoes can be told apart from real
  // remote changes.
  const pushQueueRef = useRef({ inFlight: false, pending: undefined, written: [] });

  const pushRemote = useCallback(async (val) => {
    const queue = pushQueueRef.current;
    if (queue.inFlight) {
      queue.pending = val;
      return;
    }
    queue.inFlight = true;
    try {
      let next = val;
      while (next !== undefined) {
        const session = await getSession();
        if (!session) {
          queue.pending = undefined;
          break;
        }
        // Offline or failed: the value stays in localStorage, and the next
        // pull (on reload or reconnect) sorts it out, as before.
        const row = await apiFetch(dataPath(appId, key), { method: "PUT", json: { value: next } }).catch(() => null);
        if (row) {
          writeSyncedState(key, row.updated_at, next);
          queue.written = [...queue.written.slice(-19), row.updated_at];
        }
        next = queue.pending;
        queue.pending = undefined;
      }
    } finally {
      queue.inFlight = false;
    }
  }, [appId, key]);

  const save = useCallback((val) => {
    setConflict(null);
    // Resolve against dataRef rather than inside a setData updater, so
    // several saves in one tick chain correctly and the side effects
    // below run exactly once.
    const next = typeof val === "function" ? val(dataRef.current) : val;
    dataRef.current = next;
    setData(next);
    writeLocal(key, next);
    pushRemote(next);
  }, [key, pushRemote]);

  // Applies an incoming remote row ({ value, updated_at }), unless it conflicts with a local value
  // we can't confirm is stale — in which case it surfaces `conflict`
  // instead of picking a side.
  const reconcile = useCallback((row) => {
    // A local save is still on its way up and will overwrite this row
    // anyway; applying it now would briefly revert the user's edits.
    if (pushQueueRef.current.inFlight) return;

    const localMarker = localStorage.getItem(markerKey(key));
    if (localMarker === row.updated_at) return; // already in sync
    // A late echo of one of our own earlier writes.
    if (pushQueueRef.current.written.includes(row.updated_at)) return;

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
    let cancelled = false;
    let unsubscribe = null;

    async function pullOnce() {
      let row;
      try {
        row = await apiFetch(dataPath(appId, key));
      } catch (err) {
        // 404: there's no row yet. Anything else (offline, server down):
        // leave the local value alone until the next pull.
        if (err.status !== 404) return;
        row = null;
      }
      if (cancelled) return;

      if (!row) {
        pushRemote(dataRef.current);
        return;
      }

      reconcile(row);
    }

    // Events carry no value, so a change we don't already have is read
    // with another pull.
    function onChange(change) {
      if (change.resync) {
        pullOnce();
        return;
      }
      if (change.app_id !== appId || change.key !== key) return;
      if (localStorage.getItem(markerKey(key)) === change.updated_at) return;
      if (pushQueueRef.current.written.includes(change.updated_at)) return;
      pullOnce();
    }

    function start(session) {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      if (!session || cancelled) return;
      unsubscribe = subscribe("data", onChange);
      pullOnce();
    }

    getSession().then(start);
    const stopSession = onSessionChange(start);

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
      stopSession();
    };
  }, [appId, key, pushRemote, reconcile]);

  return [data, save, conflict];
}
