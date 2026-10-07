/** Party label → display color token. Display only; never feeds an inference, grouping or ordering. Unknown is gray. */

export function partyColorVar(partyLabel: string | null | undefined): string {
  if (!partyLabel) return "var(--party-none)";
  if (/democrat/i.test(partyLabel)) return "var(--party-democratic)";
  if (/republican/i.test(partyLabel)) return "var(--party-republican)";
  if (/green/i.test(partyLabel)) return "var(--party-green)";
  if (/independent/i.test(partyLabel)) return "var(--party-independent)";
  return "var(--party-none)";
}
