"use client";

import { useStoredTheme } from "@/hooks/use-stored-theme";

/**
 * Sun/moon theme switch, ported from EdiaStratMap's `.theme-toggle-btn`.
 *
 * Positioning is the caller's job. In the sidebar header it sits absolute at
 * `right: 36px`, with the reset-view button at `right: 0`.
 *
 * The icon shows the theme you would switch *to*, which is the convention Edia
 * uses and the one that reads correctly at a glance: a moon means "go dark".
 */

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useStoredTheme();
  const next = theme === "light" ? "dark" : "light";

  return (
    <button
      type="button"
      className={`icon-btn ${className}`}
      onClick={toggle}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
    >
      {theme === "light" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
