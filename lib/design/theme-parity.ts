/**
 * Theme parity: `:root` holds the dark palette and `[data-theme="light"]`
 * overrides it. A token whose value is a literal colour (hex, rgb/hsl, or a
 * color-mix carrying a literal) must be declared in both blocks. A var alias
 * or a derivation of other tokens is exempt: it inherits theme variance.
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
