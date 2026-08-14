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

export function partyColorVar(partyLabel: string | null | undefined): string {
  if (!partyLabel) return "var(--party-none)";
  if (/democrat/i.test(partyLabel)) return "var(--party-democratic)";
  if (/republican/i.test(partyLabel)) return "var(--party-republican)";
  if (/green/i.test(partyLabel)) return "var(--party-green)";
  if (/independent/i.test(partyLabel)) return "var(--party-independent)";
  return "var(--party-none)";
}
