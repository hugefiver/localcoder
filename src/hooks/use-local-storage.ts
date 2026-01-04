import { useCallback, useEffect, useState } from "react";

function safeJsonParse<T>(value: string | null): T | null {
  if (value == null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * A tiny replacement for Spark KV.
 * - Persists to localStorage
 * - JSON-serializes values
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const parsed = safeJsonParse<T>(window.localStorage.getItem(key));
    return parsed ?? defaultValue;
  });

  useEffect(() => {
    // Keep state in sync across tabs/windows
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== window.localStorage) return;
      if (e.key !== key) return;
      const parsed = safeJsonParse<T>(e.newValue);
      setValue(parsed ?? defaultValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key, defaultValue]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        window.localStorage.setItem(key, JSON.stringify(resolved));
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}

export async function localStorageGet<T>(key: string): Promise<T | null> {
  return safeJsonParse<T>(window.localStorage.getItem(key));
}

export async function localStorageSet<T>(key: string, value: T): Promise<void> {
  window.localStorage.setItem(key, JSON.stringify(value));
}
