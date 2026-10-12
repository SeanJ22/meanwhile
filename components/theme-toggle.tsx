"use client";

import { useStoredTheme } from "@/hooks/use-stored-theme";

/**
 * The theme switch: a half-black, half-white circle that turns as the theme
 * cross-fades. The label names the destination.
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
