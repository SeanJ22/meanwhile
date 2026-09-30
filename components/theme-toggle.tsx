"use client";

import { useStoredTheme } from "@/hooks/use-stored-theme";

/**
 * The theme switch (approved reader design, 2026-09-28): a half-black,
 * half-white circle that turns 180° as the theme cross-fades. One glyph for
 * both states, so it reads as "switch", not as a picture of the current or
 * the next theme. The label names the destination.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useStoredTheme();
  const next = theme === "light" ? "dark" : "light";

  return (
    <button
      type="button"
      className={`icon-btn mw-ctl-btn mw-theme-btn ${className}`}
      onClick={toggle}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      data-theme-now={theme}
    >
      <span className="mw-theme-glyph" aria-hidden="true" />
    </button>
  );
}
