/**
 * **Pictures first, within a contest** — item 5b, 2026-08-16, the author's
 * recorded decision.
 *
 * ## The history, because the trade-off was raised and ruled on
 *
 * 6b3 (2026-08-15) fixed the "photos scattered through a contest read as
 * broken" complaint with GEOMETRY — a uniform tile, its own ground, its own
 * border — and deliberately did NOT reorder, naming the reason: sorting the
 * photographed candidates to the top hands the visual advantage to exactly
 * the candidates who already have the information advantage. That is the
 * thin-card bias the equal-effort rule exists to catch.
 *
 * It also named its own fallback: "if the geometry fix fails the author's eye
 * once built, ordering is revisited as an explicit author decision." It was
 * built, the author has looked, and scattered photos still read wonky. **This
 * is that decision, recorded.**
 *
 * ## What the ruling costs, stated rather than buried
 *
 * Layout position now stacks on top of the information advantage: a
 * candidate we have a photo of appears above one we do not, and a reader
 * scanning a contest sees the better-covered candidates first. The author
 * was told this and ruled anyway. It is recorded here and in the tracker so
 * nobody later mistakes it for an oversight.
 *
 * ## The three constraints that keep it from becoming a ranking
 *
 * 1. **The key is BINARY** — a photo is held, or it is not. Nothing is scored,
 *    and no other attribute participates. Two photo-less candidates are never
 *    separated by anything.
 * 2. **Order WITHIN each group is AS FILED.** Not alphabetical, not by
 *    anything we computed. A stable sort preserves the filing order inside
 *    both groups, which is the neutral criterion the never-rank rule names.
 * 3. **The way a candidate moves up is the HUNT finding their photo**, never
 *    us ranking them. Equal effort stands undiminished: photo hunts run to
 *    the same rung depth for every candidate in a contest and every miss is
 *    recorded per candidate.
 *
 * The uniform geometry from 6b3 is UNCHANGED. This is ordering only.
 */

/**
 * Photo-holding candidates first, filing order preserved inside each group.
 *
 * `Array.prototype.sort` has been stable since ES2019, and the comparator
 * returns 0 for any two candidates on the same side of the line — so filing
 * order survives by construction rather than by a second sort key that could
 * drift into meaning something.
 */
export function photosFirst<T>(
  candidates: readonly T[],
  hasPhoto: (candidate: T) => boolean,
): T[] {
  return [...candidates].sort((a, b) => {
    const pa = hasPhoto(a) ? 0 : 1;
    const pb = hasPhoto(b) ? 0 : 1;
    return pa - pb;
  });
}
