/**
 * **How many of these the member actually voted on** — F01 5.1, 2026-08-19.
 *
 * The author, on Ciscomani's card: *"it says when it mattered 36, however when
 * I click on it, it says votes on laws 20 and votes on people none... that
 * number 36 should be representative of the ones he actually has participated
 * in."*
 *
 * The 36 was `rows.length` — every entry in the curated list, House and
 * nomination questions alike. A House member cannot vote on a nomination, so
 * sixteen of those thirty-six were questions his chamber never put to him, and
 * the headline counted them anyway. **A total that does not describe what sits
 * under it is defect class D68**, the same shape as a stated N that disagrees
 * with its rendered rows.
 *
 * ## What counts
 *
 * A row counts when the member has a RECORDED POSITION on at least one of its
 * roll calls — `YES`, `NO`, `PRESENT`, `NOT_VOTING`. `DID_NOT_VOTE` counts too,
 * and deliberately: it is a recorded absence from a roll call the member was
 * seated for, which is participation in the sense the reader is asking about
 * ("was he there for this?"), and the row renders it as its own state.
 *
 * A row does NOT count when every position is null. Null means one of two
 * things — the member was not in that chamber for that vote, or we have not
 * recorded the roll call yet — and neither is a vote the member cast. Both
 * still RENDER, each with its own sentence, because the gap being visible is
 * the point; what changes is only whether the headline claims it.
 *
 * ## The gap does not disappear, it gets a denominator
 *
 * The prior rule — "the stated N counts every entry, including the ones whose
 * roll calls were refused; a count that quietly dropped them would make our own
 * gap invisible" — was protecting something real, and this does not undo it.
 * The group headers now state `voted of total`, so a refused row is visible as
 * the difference between two printed numbers instead of hidden inside one. Two
 * numbers where collection and rendering diverge (`CLAUDE.md`).
 *
 * ## Why it lives here
 *
 * Client-safe and importable: it is used by a `"use client"` component, so it
 * may not sit beside `keyVoteRowsFor` on the `node:fs` snapshot graph — and it
 * may not sit inside the `.tsx` either, because the test runner cannot import
 * one. A rule this load-bearing is tested directly, not through a string match
 * on a component.
 *
 * The parameter is STRUCTURAL rather than the component's `KeyVoteRow`, for the
 * same reason: the only field it reads is `positions`.
 */
export function votedCount(
  rows: readonly { positions: readonly (string | null)[] }[],
): number {
  return rows.filter((row) => row.positions.some((p) => p !== null)).length;
}
