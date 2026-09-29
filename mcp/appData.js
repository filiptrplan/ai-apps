// Read/write access to one user's public.app_data rows (the same blobs the
// apps sync through shared/syncStorage.js), through a Supabase client that
// carries the user's own access token, so RLS scopes every query to them.
//
// Writes are read-modify-write guarded on updated_at: the update only
// applies if the row hasn't changed since it was read, otherwise it's
// retried against the new value. This keeps a tool call from silently
// overwriting a save made meanwhile by an open app tab.

const MAX_ATTEMPTS = 5;

export function createAppData(supabase, userId) {
  async function readRow(appId, key) {
    const { data, error } = await supabase
      .from("app_data")
      .select("value, updated_at")
      .eq("user_id", userId)
      .eq("app_id", appId)
      .eq("key", key)
      .maybeSingle();
    if (error) throw new Error(`Couldn't read ${key}: ${error.message}`);
    return data;
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

      if (!row) {
        const { error } = await supabase
          .from("app_data")
          .insert({ user_id: userId, app_id: appId, key, value: next });
        if (!error) return next;
        if (error.code === "23505") continue; // created meanwhile
        throw new Error(`Couldn't save ${key}: ${error.message}`);
      }

      const { data, error } = await supabase
        .from("app_data")
        .update({ value: next })
        .eq("user_id", userId)
        .eq("app_id", appId)
        .eq("key", key)
        .eq("updated_at", row.updated_at)
        .select("updated_at");
      if (error) throw new Error(`Couldn't save ${key}: ${error.message}`);
      if (data.length === 1) return next;
    }
    throw new Error(`Couldn't save ${key}: it kept changing while saving, try again`);
  }

  return { read, update };
}
