/**
 * WHICH BINARIES STAY IN THE REPOSITORY — one list, one place.
 *
 * ## Why this file exists
 *
 * This rule was written down TWICE, by hand: once in `scripts/assets.mts`,
 * which enforces it, and once in `tests/asset-store.test.ts`, which guards it.
 * Both copies carried a comment saying they mirrored the other, and neither
 * could tell when they stopped agreeing.
 *
 * **They stopped agreeing.** `docs/proposals/` reached the test and never
 * reached the script, so `pnpm assets migrate` swept twelve files the guard
 * considered exempt — and the divergence was invisible in either file, because
 * each one reads as complete on its own. That is RULING 103's duplicate
 * implementation exactly: two readings of one rule, passing separately.
 *
 * So the list moves here and both import it. A guard that re-derived this from
 * the enforcer would prove only that the file equals itself; what the test
 * still owns is the REASONING for each entry, and the assertion that nothing
 * outside the list escapes the asset store.
 *
 * ## What the rule is
 *
 * RULING 20 sends collected binaries to the content-addressed asset store. The
 * entries below are not that class. Each is either a piece of the application
 * itself, or a fixed input a session or the author must be able to OPEN — never
 * an ingest-volume corpus that is re-fetched forever.
 */

export const STAYS_IN_REPO: readonly RegExp[] = [
  // The application's own chrome and code.
  /^public\/favicon/i,
  /^public\/icons?\//i,
  /^app\//,
  /^components\//,

  /*
   * `docs/feedback/` (2026-08-23, RULING 104) — the author's walkthrough
   * captures are an INPUT a session must reach, not a corpus. A fixed set of
   * one afternoon's screenshots that will never be re-fetched, because the
   * walkthrough happened once.
   */
  /^docs\/feedback\//,

  /*
   * `docs/photo-review/` (2026-08-24) — ONE regenerated file with a STABLE
   * name, which overwrites itself rather than accumulating. The author
   * approves photographs by looking at it; RULING 108 says an input a session
   * must reach lives in the repo, and pushing this to the asset store would put
   * it somewhere neither the author nor a session can open.
   */
  /^docs\/photo-review\//,

  /*
   * `docs/proposals/` — the same shape: a document a person opens, not a
   * collected artifact. **This is the entry that had reached the guard and not
   * the enforcer**, and it is the reason this file exists.
   */
  /^docs\/proposals\//,

  /*
   * `tests/fixtures/` (2026-08-28, AZ04) — `tests/` is the one place in this
   * repository where a binary is an INPUT TO A TEST rather than collected
   * corpus. `CLAUDE.md` requires recorded fixtures and forbids live calls, and
   * two facts the Arizona ingestion rests on are properties of specific PDFs
   * that only real bytes can demonstrate: one born-digital act ending
   * "APPROVED BY THE GOVERNOR", and one mixed-raster scan whose text layer
   * returns ZERO_ROWS. Transcribing them would leave the tests asserting what a
   * previous session typed rather than what the state published.
   */
  /^tests\/fixtures\//,
];

/** Does this repo-relative path stay in the repository rather than the store? */
export function staysInRepo(repoRelativePath: string): boolean {
  const normalized = repoRelativePath.replace(/\\/g, "/");
  return STAYS_IN_REPO.some((rule) => rule.test(normalized));
}
