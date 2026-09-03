/**
 * **A COLOUR IS AUTHORED IN BOTH THEMES, OR IT IS NOT A COLOUR TOKEN.**
 * (The visual-polish session, 2026-09-03. WORK ITEM 7.)
 *
 * The theme system is dark-first: `:root` holds the dark palette and
 * `[data-theme="light"]` overrides it. A token given a LITERAL colour in one
 * block and not the other renders its dark bytes in light (or the reverse) —
 * the failure mode the contrast audit cannot see, because it seeds the light
 * map from dark and so never notices the value it inherited was never chosen.
 *
 * The rule this enforces, and its one deliberate exemption:
 *
 *   - A token whose value is a LITERAL colour (`#hex`, `rgb()/rgba()`,
 *     `hsl()/hsla()`, or a `color-mix()` carrying a literal) must be declared
 *     in BOTH blocks. Dark-only or light-only fails.
 *   - A token whose value is a VAR ALIAS or a derivation of other tokens
 *     (`var(--link)`, `color-mix(in srgb, var(--link) …)`) is exempt: it
 *     inherits the theme variance of what it references, so `--signal:
 *     var(--link)` is correct in both themes with one declaration. Duplicating
 *     it would create two copies to drift apart, which is the opposite of the
 *     goal.
 *
 * Dimension tokens (`--dur-*`, `--space-*`, `--radius-*`, `--text-*`) are not
 * colours and are theme-independent by nature; they never enter this check.
 */

export interface ThemeToken {
  name: string;
  value: string;
}

const ROOT_BLOCK = /(?:^|\n):root\s*\{([\s\S]*?)\n\}/;
const LIGHT_BLOCK = /(?:^|\n)\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/;

/** A hardcoded colour: a hex, an rgb/hsl function, or a color-mix that carries
 *  a literal hex/rgb (a color-mix over only var()s is a derivation, not a
 *  literal, and inherits theme variance). */
export function isLiteralColor(value: string): boolean {
  if (/#[0-9a-fA-F]{3,8}\b/.test(value)) return true;
  if (/\b(?:rgba?|hsla?)\(/.test(value)) {
    // rgb/hsl of literal numbers is a literal; there is no var-only form of it.
    return true;
  }
  if (/color-mix\(/.test(value) && /#[0-9a-fA-F]{3,8}\b/.test(value)) return true;
  return false;
}

function tokensIn(css: string, block: RegExp): Map<string, string> {
  const m = block.exec(css);
  const out = new Map<string, string>();
  if (!m) return out;
  for (const t of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(t[1], t[2].trim());
  }
  return out;
}

export function rootTokens(css: string): Map<string, string> {
  return tokensIn(css, ROOT_BLOCK);
}
export function lightTokens(css: string): Map<string, string> {
  return tokensIn(css, LIGHT_BLOCK);
}

/** Literal-colour tokens present in one theme block but not the other. */
export function themeParityGaps(css: string): { darkOnly: ThemeToken[]; lightOnly: ThemeToken[] } {
  const dark = rootTokens(css);
  const light = lightTokens(css);
  const darkOnly: ThemeToken[] = [];
  const lightOnly: ThemeToken[] = [];
  for (const [name, value] of dark) {
    if (isLiteralColor(value) && !light.has(name)) darkOnly.push({ name, value });
  }
  for (const [name, value] of light) {
    if (isLiteralColor(value) && !dark.has(name)) lightOnly.push({ name, value });
  }
  return { darkOnly, lightOnly };
}
