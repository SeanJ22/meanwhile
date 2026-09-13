/**
 * Party label → display color token (3a, 2026-08-19).
 *
 * DISPLAY ONLY. The color is applied to the party label's own text wherever
 * it renders — it never feeds an inference, a grouping, an ordering, or any
 * other behavior. The author's palette: Democratic blue, Republican red,
 * Green green, Independent purple, and gray for no affiliation or anything
 * we don't recognize (Libertarian, No Labels, and future parties stay gray
 * until the author assigns them a color — a wrong color is a wrong claim
 * about a person, gray is honest).
 *
 * Matching is by keyword so filed variants ("Democrat", "Democratic",
 * "Arizona Independent Party") land in their family. Tokens are defined in
 * both themes in app/globals.css, contrast-checked at phone sizes.
 */

type PartyFamily =
  | "democratic"
  | "republican"
  | "green"
  | "independent"
  | "none";

/** The party family for a filed label, matched by keyword so filed variants
 *  ("Democrat", "Arizona Independent Party") land in their family. */
function partyFamily(partyLabel: string | null | undefined): PartyFamily {
  if (!partyLabel) return "none";
  if (/democrat/i.test(partyLabel)) return "democratic";
  if (/republican/i.test(partyLabel)) return "republican";
  if (/green/i.test(partyLabel)) return "green";
  if (/independent/i.test(partyLabel)) return "independent";
  return "none";
}

/**
 * Party label → display TEXT colour token, for party affiliation rendered as a
 * WORD (the ballot view, popup party lines). Themed — light in dark so the word
 * stays legible. DISPLAY ONLY.
 *
 * Design handoff 2026-09-13: the fill and the text diverged into two tokens so a
 * filled chip can be the deep non-themed brand colour while a word keeps the
 * legible themed value. This function is the TEXT reader; `partyFillVar` is the
 * fill reader. The values are the app's former --party-* set, so party text is
 * unchanged.
 */
export function partyColorVar(partyLabel: string | null | undefined): string {
  return `var(--party-text-${partyFamily(partyLabel)})`;
}

/**
 * Party label → CHIP FILL colour token — the deep, NON-THEMED brand blue/red,
 * paired with --party-on (cream) ink. Only the IdentityChip party variant uses
 * this. DISPLAY ONLY. (Design handoff 2026-09-13, the @proposed party fill.)
 */
export function partyFillVar(partyLabel: string | null | undefined): string {
  return `var(--party-${partyFamily(partyLabel)})`;
}
