// Storage keys and id generation, kept free of React/Supabase imports so
// plain modules (format.js, and the MCP server in the Worker) can use them.
export const APP_ID = "climbing-tracker";

export const STORAGE_KEYS = {
  exercises: "climbing-tracker-exercises",
  routines: "climbing-tracker-routines",
  history: "climbing-tracker-history",
  settings: "climbing-tracker-settings",
};

export function uid() {
  return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
