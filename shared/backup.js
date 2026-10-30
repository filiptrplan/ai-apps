// The signed-in user's daily backups of their app_data, listed and restored
// from index.html. The server takes the snapshots itself, once a day, and
// keeps the last 7 (server/routes/backups.js). Kept dependency free so
// index.html can import it as a bare ES module.
import { apiFetch } from "./api.js";

// Newest-first list of { backup_date, created_at }; empty when signed out
// or on failure.
export async function listBackups() {
  try {
    return await apiFetch("/api/backups");
  } catch {
    return [];
  }
}

// Restores every app_data row captured in the given day's backup ("YYYY-MM-DD"),
// overwriting current values. Returns { error } (null on success).
export async function restoreBackup(backupDate) {
  try {
    await apiFetch(`/api/backups/${encodeURIComponent(backupDate)}/restore`, { method: "POST" });
    return { error: null };
  } catch (err) {
    return { error: err.message };
  }
}
