/**
 * Keyboard focus checks over the app's CSS:
 *   1. the global `:focus-visible` ring exists;
 *   2. no rule removes the ring from `:focus-visible` without an alternative
 *      (a box-shadow ring or a border) in the same rule.
 * Plain `:focus` may drop the outline; that is the mouse-vs-keyboard split.
 */

export interface FocusOffender {
  line: number;
  selector: string;
  text: string;
}

/** The global default ring. Matched by shape: a `:focus-visible` selector (not
 *  scoped to a class) giving a solid outline. */
export function globalFocusRingPresent(css: string): boolean {
  return /(?:^|[,{}\s])(?:\*\s*)?:focus-visible\s*\{[^}]*outline:\s*\d+px\s+solid/.test(css);
}

/** Any rule whose selector list includes `:focus-visible` and which sets
 *  `outline: none|0` while providing no `box-shadow` and no `border`
 *  alternative — a control that goes dark for keyboard users. */
export function focusRingSuppressedWithoutAlternative(css: string): FocusOffender[] {
  const out: FocusOffender[] = [];
  for (const m of css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)) {
    const selector = m[1].trim();
    const body = m[2];
    const removesOutline = /outline:\s*(?:none|0)\b/.test(body);
    if (!removesOutline) continue;
    const hasAlternative = /box-shadow:|border(?:-[a-z]+)?:/.test(body);
    if (hasAlternative) continue;
    out.push({
      line: css.slice(0, m.index).split("\n").length,
      selector,
      text: m[0].replace(/\s+/g, " ").trim().slice(0, 160),
    });
  }
  return out;
}
