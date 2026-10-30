// Read/write access to one user's public.app_data rows (the same blobs the
// apps sync through shared/syncStorage.js), through the server's app_data
// store (server/appData.js), which scopes every query to the user id.
//
// Writes are read-modify-write guarded on updated_at: the update only
// applies if the row hasn't changed since it was read, otherwise it's
// retried against the new value. This keeps a tool call from silently
// overwriting a save made meanwhile by an open app tab.

import { ConflictError } from "../server/appData.js";

const MAX_ATTEMPTS = 5;

// `store` is server/appData.js's createAppDataStore(sql).
export function createAppData(store, userId) {
  async function readRow(appId, key) {
    try {
      return await store.get(userId, appId, key);
    } catch (err) {
      throw new Error(`Couldn't read ${key}: ${err.message}`);
    }
  }

  async function read(appId, key, fallback) {
    const row = await readRow(appId, key);
    return row ? row.value : fallback;
  }

  // `mutate` gets the current value and returns the new one. Returning the
  // same value unchanged skips the write. It may run more than once if the
  // row changes concurrently, so it must not have side effects.
  async function update(appId, key, fallback, mutate) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const row = await readRow(appId, key);
      const current = row ? row.value : fallback;
      const next = mutate(current);
      if (next === current) return next;

      try {
        // null: only if the row still doesn't exist.
        await store.put(userId, appId, key, next, row ? row.updated_at : null);
        return next;
      } catch (err) {
        if (err instanceof ConflictError) continue; // changed or created meanwhile
        throw new Error(`Couldn't save ${key}: ${err.message}`);
      }
    }
    throw new Error(`Couldn't save ${key}: it kept changing while saving, try again`);
  }

  return { read, update };
}
