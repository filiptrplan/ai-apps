import { useSyncedStorage } from "../shared/syncStorage.js";

export const STORAGE_KEYS = {
  exercises: "climbing-tracker-exercises",
  routines: "climbing-tracker-routines",
  history: "climbing-tracker-history",
};

export function uid() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useStorage(key, fallback) {
  return useSyncedStorage("climbing-tracker", key, fallback);
}
