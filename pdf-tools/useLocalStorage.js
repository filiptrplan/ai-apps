const { useState } = React;

// Per-device settings. Storage can be missing or blocked (private windows),
// in which case the value just isn't remembered.
export function useLocalStorage(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? { ...fallback, ...JSON.parse(stored) } : fallback;
    } catch {
      return fallback;
    }
  });

  function set(next) {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }

  return [value, set];
}
