// Daily backup/restore of a signed-in user's app_data, shared by every app
// page (to take the daily snapshot whenever the user actually opens
// something) and by index.html (to list/restore backups). Kept dependency
// free so it can be imported both as a bare ES module (index.html, no build
// step) and bundled by esbuild (the React apps).

const RETENTION_DAYS = 7;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function cutoffStr() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (RETENTION_DAYS - 1));
  return d.toISOString().slice(0, 10);
}

// Snapshots today's app_data (once per day) and prunes backups older than
// RETENTION_DAYS. Safe to call repeatedly - a no-op if today's backup
// already exists. Silently does nothing when logged out.
export async function runDailyBackupIfNeeded(supabase, session) {
  if (!session) return;
  const userId = session.user.id;
  const today = todayStr();

  const { data: existing } = await supabase
    .from("app_data_backups")
    .select("backup_date")
    .eq("user_id", userId)
    .eq("backup_date", today)
    .maybeSingle();

  if (!existing) {
    const { data: rows } = await supabase
      .from("app_data")
      .select("app_id, key, value")
      .eq("user_id", userId);

    if (rows && rows.length > 0) {
      await supabase
        .from("app_data_backups")
        .upsert(
          { user_id: userId, backup_date: today, data: rows },
          { onConflict: "user_id,backup_date", ignoreDuplicates: true }
        );
    }
  }

  await supabase
    .from("app_data_backups")
    .delete()
    .eq("user_id", userId)
    .lt("backup_date", cutoffStr());
}

// Newest-first list of available backups for the signed-in user.
export async function listBackups(supabase, session) {
  if (!session) return [];
  const { data, error } = await supabase
    .from("app_data_backups")
    .select("backup_date, created_at")
    .eq("user_id", session.user.id)
    .order("backup_date", { ascending: false });
  if (error) return [];
  return data;
}

// Restores every app_data row captured in the given day's backup, overwriting
// current values. Returns { error } (null on success).
export async function restoreBackup(supabase, session, backupDate) {
  if (!session) return { error: "Not signed in." };
  const userId = session.user.id;

  const { data: backup, error } = await supabase
    .from("app_data_backups")
    .select("data")
    .eq("user_id", userId)
    .eq("backup_date", backupDate)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!backup) return { error: "That backup no longer exists." };

  const rows = backup.data.map((row) => ({
    user_id: userId,
    app_id: row.app_id,
    key: row.key,
    value: row.value,
  }));
  if (rows.length === 0) return { error: null };

  const { error: upsertError } = await supabase
    .from("app_data")
    .upsert(rows, { onConflict: "user_id,app_id,key" });
  if (upsertError) return { error: upsertError.message };
  return { error: null };
}
