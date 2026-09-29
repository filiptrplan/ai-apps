import { useSyncedStorage } from "../shared/syncStorage.js";
import { APP_ID } from "./data.js";

export { STORAGE_KEYS, uid } from "./data.js";

export function useStorage(key, fallback) {
  return useSyncedStorage(APP_ID, key, fallback);
}
