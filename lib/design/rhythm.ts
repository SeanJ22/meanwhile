/**
 * Rhythm checks: spacing on the 4-based `--space-*` scale, radius on the
 * `--radius*` family, elevation on `--shadow-*`, type on `--text-*`. Off-scale
 * literals are frozen to a baseline that may only shrink, not snapped.
 */

/** Spacing scale in px (DESIGN.md). Rem equivalents (×16) are accepted too. */
export const SPACE_PX = [4, 8, 12, 16, 24, 32, 48];
const SPACE_SET = new Set(SPACE_PX);

export interface RhythmOffender {
  line: number;
  text: string;
  value: string;
}

/** Arbitrary component utilities belong to the same shrink-only scale. */
export function componentRhythm(source: string): RhythmOffender[] {
  const out: RhythmOffender[] = [];
  // Tokens and brand colours already in use are preserved by the per-file baseline.
  const patterns = [
    /(?:^|[\s"'`])((?:[\w-]+:)*text-\[(-?\d*\.?\d+(?:px|rem|em))\])/g,
    /(?:^|[\s"'`])((?:[\w-]+:)*-?(?:[pm][trblxyse]?|gap(?:-[xy])?)-\[([^\]]+)\])/g,
    /#[0-9a-fA-F]{3,8}\b/g,
  ];
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "));
  for (const [kind, pattern] of patterns.entries()) {
    for (const m of code.matchAll(pattern)) {
      const text = m[1] ?? m[0];
      const value = m[2] ?? m[0];
      if (kind === 1) {
        const literals = value.match(/-?\d*\.?\d+(?:px|rem|em)/g) ?? [];
        if (!literals.some((lit) => { const px = toPx(lit); return px !== null && px !== 0 && !SPACE_SET.has(px); })) continue;
      }
      out.push({ line: lineOf(source, m.index), text, value });
    }
  }
  return out;
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split("\n").length;
}

/** px/rem/em literals in a declaration value, as absolute px (rem/em ×16). */
function toPx(literal: string): number | null {
  const m = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(literal.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "px" ? Math.abs(n) : Math.abs(n) * 16;
}

const SPACE_PROPS = /(?<![\w-])(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?\s*:\s*([^;{}]+)/g;

/** Padding/margin/gap declarations carrying a raw literal off the spacing
 *  scale. `0`, `auto`, `%`, `var()` and calc() are never offenders. */
export function offScaleSpacing(css: string): RhythmOffender[] {
  const out: RhythmOffender[] = [];
  for (const m of css.matchAll(SPACE_PROPS)) {
    const value = m[1];
    if (/var\(|calc\(|env\(|clamp\(/.test(value)) continue;
    const literals = value.match(/-?\d*\.?\d+(?:px|rem|em)/g);
    if (!literals) continue;
    const off = literals.filter((lit) => {
      const px = toPx(lit);
      return px !== null && px !== 0 && !SPACE_SET.has(px);
    });
    if (off.length) {
      out.push({ line: lineOf(css, m.index), text: m[0].replace(/\s+/g, " ").trim(), value: off.join(" ") });
    }
  }
  return out;
}

/** `border-radius` declarations not on the radius family. `0`/`var(--radius-*)`
 *  are fine; a percentage other than the circle token is an offender. */
export function offFamilyRadius(css: string): RhythmOffender[] {
  const out: RhythmOffender[] = [];
  for (const m of css.matchAll(/(?<![\w-])border-radius\s*:\s*([^;{}]+)/g)) {
    const value = m[1].trim();
    if (/var\(--radius/.test(value)) continue;
    if (/^0$/.test(value)) continue;
    out.push({ line: lineOf(css, m.index), text: m[0].replace(/\s+/g, " ").trim(), value });
  }
  return out;
}

/** `font-size` declarations not reading the type scale. A literal px/rem/em is
 *  the offender; `var(--text-*)`, `inherit`, `100%` and keywords are fine. */
export function rawFontSize(css: string): RhythmOffender[] {
  const out: RhythmOffender[] = [];
  for (const m of css.matchAll(/(?<![\w-])font-size\s*:\s*([^;{}]+)/g)) {
    const value = m[1].trim();
    if (/var\(--text/.test(value)) continue;
    if (!/\d(?:px|rem|em)/.test(value)) continue;
    out.push({ line: lineOf(css, m.index), text: m[0].replace(/\s+/g, " ").trim(), value });
  }
  return out;
}

/** `box-shadow` DROP shadows (elevation) with raw color instead of a
 *  `--shadow-*` token. Focus/selection rings (`0 0 0 …`, or built from
 *  `color-mix`/tokens with no raw rgba) are not elevation and are excluded. */
export function rawElevation(css: string): RhythmOffender[] {
  const out: RhythmOffender[] = [];
  for (const m of css.matchAll(/(?<![\w-])box-shadow\s*:\s*([^;{}]+)/g)) {
    const value = m[1].trim();
    if (/var\(--shadow/.test(value)) continue;
    if (/^none/.test(value)) continue;
    if (!/rgba?\(|#[0-9a-f]/i.test(value)) continue; // ring built from tokens, not elevation
    out.push({ line: lineOf(css, m.index), text: m[0].replace(/\s+/g, " ").trim(), value });
  }
  return out;
}

/** The rhythm token scales must be declared, so a category never silently
 *  loses its scale and passes by measuring nothing. */
export function rhythmScalesDeclared(css: string): boolean {
  return (
    /--space-1:\s*4px/.test(css) &&
    /--radius-pill:/.test(css) &&
    /--text-body:/.test(css)
  );
}
