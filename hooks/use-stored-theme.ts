"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";

/**
 * The chosen theme, read from localStorage through useSyncExternalStore with
 * cached, identity-stable snapshots. `data-theme` is set before first paint by
 * an inline script in app/layout.tsx; this hook reports `restored: false`
 * until hydration so the toggle never renders the wrong state.
 */

const STORAGE_KEY = "wtp.theme";

export type Theme = "dark" | "light";

export type ThemeSnapshot =
  | { restored: false; theme: Theme }
  | { restored: true; theme: Theme };

/** Dark is the product default, so it is also the pre-hydration answer. */
const PENDING: ThemeSnapshot = Object.freeze({
  restored: false,
  theme: "dark",
});

const listeners = new Set<() => void>();

let cachedRaw: string | null | undefined;
let cachedSnapshot: ThemeSnapshot = PENDING;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or storage disabled. Falling back to dark is survivable.
    return null;
  }
}

function parse(raw: string | null): Theme {
  return raw === "light" ? "light" : "dark";
}

const subscribe = (onStoreChange: () => void) =>
  subscribeToStorage(listeners, onStoreChange);

function getSnapshot(): ThemeSnapshot {
  const raw = readRaw();

  if (raw !== cachedRaw || cachedSnapshot === PENDING) {
    cachedRaw = raw;
    cachedSnapshot = { restored: true, theme: parse(raw) };
  }

  return cachedSnapshot;
}

function getServerSnapshot(): ThemeSnapshot {
  return PENDING;
}

/** Write the attribute the tokens key off. */
function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
}

export function useStoredTheme() {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setTheme = useCallback((next: Theme) => {
    apply(next);

    commitStorageWrite(
      () => window.localStorage.setItem(STORAGE_KEY, next),
      () => publishToListeners(listeners),
      () => {
        // Not being able to remember the choice is survivable; not honouring it
        // for this session is not. The publish runs either way.
        cachedRaw = next;
        cachedSnapshot = { restored: true, theme: next };
      },
    );
  }, []);

  const toggle = useCallback(() => {
    setTheme(snapshot.theme === "light" ? "dark" : "light");
  }, [setTheme, snapshot.theme]);

  return { ...snapshot, setTheme, toggle };
}
