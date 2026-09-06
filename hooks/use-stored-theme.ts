"use client";

import { useCallback, useSyncExternalStore } from "react";
import { commitStorageWrite, publishToListeners, subscribeToStorage } from "@/lib/state/subscribe-to-storage";
import { resolveTheme, updatedReviewThemeUrl, THEME_STORAGE_KEY, type Theme } from "@/lib/state/theme";

export type { Theme } from "@/lib/state/theme";
export type ThemeSnapshot = { restored: boolean; theme: Theme };
const PENDING: ThemeSnapshot = Object.freeze({ restored: false, theme: "light" });
const listeners = new Set<() => void>();
let cachedSnapshot: ThemeSnapshot = PENDING;

function readChoice(): string | null {
  // A refused storage write still honors the explicit choice for this document.
  const session = document.documentElement.getAttribute("data-theme-choice");
  if (session === "light" || session === "dark") return session;
  try { return window.localStorage.getItem(THEME_STORAGE_KEY); } catch { return null; }
}

function systemQuery(): MediaQueryList | null {
  try { return window.matchMedia("(prefers-color-scheme: dark)"); } catch { return null; }
}

function currentTheme(): Theme {
  return resolveTheme(readChoice(), systemQuery()?.matches);
}

function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

function subscribe(onStoreChange: () => void) {
  const update = () => { apply(currentTheme()); onStoreChange(); };
  const unsubscribe = subscribeToStorage(listeners, update);
  const query = systemQuery();
  query?.addEventListener("change", update);
  return () => { unsubscribe(); query?.removeEventListener("change", update); };
}

function getSnapshot(): ThemeSnapshot {
  const theme = currentTheme();
  if (cachedSnapshot === PENDING || cachedSnapshot.theme !== theme) cachedSnapshot = { restored: true, theme };
  return cachedSnapshot;
}

const getServerSnapshot = () => PENDING;

export function useStoredTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setTheme = useCallback((next: Theme) => {
    apply(next);
    const reviewUrl = updatedReviewThemeUrl(window.location.href, next,
      process.env.WTP_BUILD_CONTEXT === "branch-deploy" && process.env.WTP_BUILD_BRANCH === "test");
    if (reviewUrl) window.history.replaceState(window.history.state, "", reviewUrl);
    commitStorageWrite(
      () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
        document.documentElement.removeAttribute("data-theme-choice");
      },
      () => publishToListeners(listeners),
      () => document.documentElement.setAttribute("data-theme-choice", next),
    );
  }, []);
  const toggle = useCallback(() => setTheme(currentTheme() === "light" ? "dark" : "light"), [setTheme]);
  return { ...snapshot, setTheme, toggle };
}
