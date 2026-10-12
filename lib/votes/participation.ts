/**
 * How many of the key-vote questions the member actually voted on. A row
 * counts when the member has a RECORDED POSITION on at least one of its roll
 * calls (`YES`, `NO`, `PRESENT`, `NOT_VOTING`, and `DID_NOT_VOTE`, a recorded
 * absence while seated). A row whose positions are all null (not in that
 * chamber then, or the roll call not recorded yet) still renders but is not
 * counted; group headers state `voted of total`, so the gap stays visible.
 *
 * Client-safe and structural (it reads only `positions`), so the `"use client"`
 * component and the tests share it.
 */
export function votedCount(
  rows: readonly { positions: readonly (string | null)[] }[],
): number {
  return rows.filter((row) => row.positions.some((p) => p !== null)).length;
}
