import type { CSSProperties } from "react";

import { PRODUCT_NAME } from "@/lib/brand";

/**
 * THE LOCKUP. One component, and the only thing allowed to draw the brand.
 *
 * ```
 * meanwhile • • ▪
 * ```
 *
 * A lowercase serif wordmark, two grey dots, and a filled square. The word
 * trails off into an ellipsis whose final beat resolves into a square: while
 * you were living an ordinary week, decisions got made. The dots are the
 * waiting; the square is the decision landing. It is the mission paragraph in
 * `welcome-overlay.tsx` compressed into three marks.
 *
 * ## The rules this file exists to keep, and why each one is a rule
 *
 * **THE SQUARE IS ALWAYS FILLED. There is no hollow brand variant, ever.**
 * Shape already carries meaning on every surface this product ships: hollow
 * or outlined means concluded or a named gap (`.wtp-pin[data-concluded]`,
 * `.legend-dot[data-hollow]`, `.vote-pill--gap`), filled means live and
 * current (`.wtp-pin-dot`, `.vote-pill--yes`), dashed means device-local or
 * unsourced (`.ballot-narrowed`, `.id-chip-unsourced`, `.wtp-here`). A hollow
 * brand square would read as "this product has concluded"; a dashed one as
 * "unsourced". So no brand state varies shape — exactly one form per size.
 *
 * **THERE IS NO CHECKMARK IN IT.** A check is the universal "this is the
 * correct answer" glyph, and this product carries a vote-recommendation ban.
 * A check in the identity would make a promise the product refuses to keep.
 *
 * **THERE IS NO MAP PIN IN IT.** A pin drops onto a house, and a house is
 * identity. The standing rule is that a ZIP and a geolocation are ORIENTATION,
 * not identity. Both surfaces used to carry a pin; both stopped.
 *
 * **THE BEATS ARE DRAWN, NOT TYPED.** No `…`, no `.` glyphs. An ellipsis
 * character renders differently in every face and every fallback, and the
 * spacing between the dots and the square is the whole idea. Geometry does not
 * fall back.
 *
 * **THE COLOUR COMES FROM TOKENS, WITH NO PER-THEME BRANCH.** The square is
 * `--mark` (which is `--accent-state`, deliberately, see the token comment in
 * `globals.css`) and the dots are `--text-muted`. Both already swap per theme,
 * so there is one code path for both themes and no chance of the two drifting.
 * `--mark` may not be referenced anywhere but here — that scoping rule is what
 * stops a small teal square beside a wordmark from reading as a tier claim.
 *
 * **BELOW 18px THE WORDMARK IS DROPPED AND THE SQUARE RENDERS ALONE.** EB
 * Garamond has a small x-height and thin strokes; under 18px the word stops
 * being legible before it stops being drawable, which is the worse failure.
 * The floor is enforced here rather than trusted to call sites.
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
   *
   * A `wordmark` asked for below {@link WORDMARK_MIN_PX} renders as `mark`
   * instead. That is not a silent downgrade — it is the identity's own rule,
   * and putting it here means no call site can get it wrong.
   */
  size?: number;
  /**
   * A repetition inside an already-labelled container.
   *
   * Drops the accessible name so a screen reader is not told the product's
   * name twice in one region.
   */
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
  /* The floor, applied rather than assumed. */
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
      {/*
        PRODUCT_NAME, lowercased by CSS rather than by `.toLowerCase()`.
        `tests/brand.test.ts` refuses a literal "Meanwhile" typed into a
        component, and the accessible name above is the cased one, so the
        casing belongs to the rendering and not to the string.
      */}
      <span className="wtp-logo-word">{PRODUCT_NAME}</span>
      <Beats hidden />
    </span>
  );
}
