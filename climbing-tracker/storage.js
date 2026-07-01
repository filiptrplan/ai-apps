const { useState } = React;

export const STORAGE_KEYS = {
  exercises: "climbing-tracker-exercises",
  routines: "climbing-tracker-routines",
  history: "climbing-tracker-history",
};

export function uid() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useStorage(key, fallback) {
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  });

  const save = (val) => {
    setData(val);
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  };

  return [data, save];
}
