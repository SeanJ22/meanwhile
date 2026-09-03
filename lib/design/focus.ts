/**
 * **A KEYBOARD READER CAN ALWAYS SEE WHERE THEY ARE.**
 * (The visual-polish session, 2026-09-03. WORK ITEM 3, the focus half.)
 *
 * The app gives every focusable element a visible ring through one global
 * `:focus-visible` rule (`outline: 2px solid var(--link)`), and individual
 * inputs that trade the outline for a lit border do so on plain `:focus` while
 * leaving `:focus-visible` alone. The ring colour is `--link`, which
 * `pnpm contrast` already holds to the 7:1 sun bar in both themes.
 *
 * Two things are asserted, and they are the WORK ITEM 3 focus seeded check:
 *
 *   1. The global `:focus-visible` ring exists — so focus indication is on by
 *      default and a new control inherits it rather than having to remember it.
 *   2. No rule REMOVES the ring from `:focus-visible` without giving back an
 *      alternative (a box-shadow ring or a lit border) in the same rule. A
 *      `:focus-visible { outline: none }` with nothing in its place is a
 *      keyboard reader losing their place, which is the defect this catches.
 *
 * `:focus` (as opposed to `:focus-visible`) MAY drop the outline — that is the
 * deliberate mouse-vs-keyboard split, and those rules light a border instead.
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
