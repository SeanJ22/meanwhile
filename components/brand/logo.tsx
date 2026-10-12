import type { CSSProperties } from "react";

import { PRODUCT_NAME } from "@/lib/brand";

/**
 * The only component that draws the brand: a lowercase serif wordmark, two
 * grey dots and a filled square. The square is always filled (hollow and
 * dashed shapes mean other things in this product). The beats are drawn, not
 * typed, so spacing never depends on font fallback. Colours come from
 * `--mark` and `--text-muted`, which swap per theme; `--mark` is used only
 * here. Below 18px the wordmark is dropped and the square renders alone.
 */

/** The smallest size at which the wordmark may be drawn. Below it: the square. */
export const WORDMARK_MIN_PX = 18;

export type LogoVariant = "wordmark" | "mark";

export interface LogoProps {
  /**
   * `wordmark` — the full lockup. `mark` — the square alone, the compressed
   * form for favicons, tight chrome and anywhere the wordmark would wrap.
   */
  variant?: LogoVariant;
  /**
   * The wordmark's font size in px, or the square's side in px for `mark`.
   * A `wordmark` below {@link WORDMARK_MIN_PX} renders as `mark`.
   */
  size?: number;
  /** A repetition inside an already-labelled container: drops the accessible name. */
  decorative?: boolean;
  className?: string;
}

/** The beats, drawn: two circles and a square on one baseline. */
function Beats({ hidden }: { hidden: boolean }) {
  return (
    <svg
      className="wtp-logo-beats"
      viewBox="0 0 86 18"
      aria-hidden={hidden ? "true" : undefined}
      focusable="false"
    >
      <circle className="wtp-logo-dot" cx="9" cy="9" r="9" />
      <circle className="wtp-logo-dot" cx="43" cy="9" r="9" />
      <rect className="wtp-logo-square" x="68" y="0" width="18" height="18" />
    </svg>
  );
}

export function Logo({
  variant = "wordmark",
  size,
  decorative = false,
  className,
}: LogoProps) {
  const wanted = variant === "wordmark";
  const px = size ?? (wanted ? 22 : 16);
  const effective: LogoVariant = wanted && px >= WORDMARK_MIN_PX ? "wordmark" : "mark";

  const label = decorative
    ? { "aria-hidden": true as const }
    : { role: "img", "aria-label": PRODUCT_NAME };

  const style = { "--wtp-logo-size": `${px}px` } as CSSProperties;
  const classes = ["wtp-logo", `wtp-logo--${effective}`, className]
    .filter(Boolean)
    .join(" ");

  if (effective === "mark") {
    return (
      <span className={classes} style={style} {...label}>
        <svg className="wtp-logo-glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
          <rect className="wtp-logo-square" x="0" y="0" width="18" height="18" />
        </svg>
      </span>
    );
  }

  return (
    <span className={classes} style={style} {...label}>
      {/* Lowercased by CSS; the accessible name above keeps the casing. */}
      <span className="wtp-logo-word">{PRODUCT_NAME}</span>
      <Beats hidden />
    </span>
  );
}
