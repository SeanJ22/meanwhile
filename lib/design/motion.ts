/**
 * Motion checks: every transition and animation uses the duration scale
 * (`--dur-*`) and easing family (`--ease-*`) in `app/globals.css`.
 *   1. No `transition`/`animation` declaration (shorthand or `-duration`
 *      longhand) carries a raw time literal, except the reduced-motion instant.
 *   2. The global reduced-motion floor is present.
 */

/** The reduced-motion instant. A duration this small is motion turned OFF, not
 *  a value on the scale, so it is the one raw literal the sweep permits. */
export const REDUCED_MOTION_INSTANT = "0.01ms";

/** A single offending declaration: the 1-based line, and the text that carries
 *  the raw literal, so a failure points at the exact place to tokenize. */
export interface MotionOffender {
  line: number;
  text: string;
  raw: string;
}

const TIME_LITERAL = /(?<![\w.])\d*\.?\d+m?s(?![\w])/g;

/**
 * Every `transition:`/`animation:` shorthand and `transition-duration:`/
 * `animation-duration:` longhand declaration, with the raw time literals it
 * carries (excluding the reduced-motion instant). A declaration referencing
 * only `var(--dur-*)` carries no literal and is never an offender.
 *
 * The property must begin at a token boundary, so `--default-transition-
 * duration: var(--dur-fast)` (a Tailwind theme key, value already a token) is
 * not treated as a hand-written transition.
 */
export function rawMotionInCss(css: string): MotionOffender[] {
  const out: MotionOffender[] = [];
  // `[^;{}]*` keeps a match inside one declaration, across newlines.
  const decl = /(?<![\w-])(?:transition|animation)(?:-duration)?\s*:[^;{}]*/g;
  for (const m of css.matchAll(decl)) {
    const body = m[0];
    const literals = body
      .match(TIME_LITERAL)
      ?.filter((lit) => lit !== REDUCED_MOTION_INSTANT);
    if (!literals || literals.length === 0) continue;
    const line = css.slice(0, m.index).split("\n").length;
    out.push({ line, text: body.replace(/\s+/g, " ").trim(), raw: literals.join(", ") });
  }
  return out;
}

/**
 * Raw motion in component source: a Tailwind arbitrary duration
 * (`duration-[200ms]`) or a raw time literal inside an inline `transition` /
 * `animation` style. Named durations (`duration-fast`) and token references are
 * fine; this catches the value someone reached past the scale to hardcode.
 */
export function rawMotionInSource(src: string): MotionOffender[] {
  const out: MotionOffender[] = [];
  const patterns = [
    /duration-\[[^\]]*\d[^\]]*\]/g,
    /(?:transition|animation)(?:Duration)?\s*:\s*[^;"'`}]*\d+\.?\d*m?s[^;"'`}]*/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const line = src.slice(0, m.index).split("\n").length;
      out.push({ line, text: m[0].replace(/\s+/g, " ").trim(), raw: m[0] });
    }
  }
  return out;
}

/** The global reduced-motion floor, matched by its shape rather than its exact
 *  bytes: a `prefers-reduced-motion: reduce` block that reaches the universal
 *  selector and neutralizes animation and transition duration. */
export function reducedMotionFloorPresent(css: string): boolean {
  const block = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\*\s*,[\s\S]*?animation-duration:\s*0\.01ms[\s\S]*?transition-duration:\s*0\.01ms[\s\S]*?\}/;
  return block.test(css);
}
