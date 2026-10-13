"use client";

import { Moon, Sun } from "lucide-react";
import { useStoredTheme } from "@/hooks/use-stored-theme";

/**
 * The theme switch: sun in dark, moon in light — the glyph and the label both
 * name the destination. The two glyphs cross-fade and turn on the switch.
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
      <span className="mw-theme-glyph" aria-hidden="true">
        <Sun className="mw-theme-sun" strokeWidth={1.5} />
        <Moon className="mw-theme-moon" strokeWidth={1.5} />
      </span>
    </button>
  );
}
