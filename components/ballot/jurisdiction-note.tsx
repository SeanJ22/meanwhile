import { COULD_GOVERN_ACTION } from "@/lib/ballot/could-govern";

/**
 * **JUR-4 ON THE BALLOT PAGE — ONE DELIBERATE ANNOTATION INSTEAD OF TWELVE.**
 * (`NH84`, 2026-08-23. The map surfaces were done on 2026-08-22 and 2026-08-23;
 * this is the page the author named the headline UX problem of the New Jersey
 * pass, and it was the one left untouched.)
 *
 * ## What was there
 *
 * Every affected contest heading carried the full RULING 71 pill —
 * *"Could govern you — add your address to confirm"* — and at 07866 that is
 * **twelve instances across nine contests**. The invitation is right and the
 * repetition is what makes it read as a tic rather than as an offer: the same
 * eleven words, down a page, next to nine different headings, asking the reader
 * nine times to do one thing once.
 *
 * The map solved the same problem the same way. Its who-governs panel went from
 * six full sentences to six marks and one pill, and its meetings list went from
 * nineteen consecutive *Could govern you* rows to one per jurisdiction group.
 *
 * ## What is here instead
 *
 * **One block, once per page, bolder and more explicit than the small inline
 * text it replaces** — because it now has to carry the whole idea on its own
 * rather than being repeated until it lands. It names the jurisdictions
 * outright, so a reader who already knows their town can settle it by reading
 * rather than by typing, and it carries the address invitation ONE time.
 *
 * Each affected contest keeps a **short mark** tying it back here. That is the
 * "used sparingly" half, and it is what stops the page-level block becoming a
 * statement the reader cannot connect to anything.
 *
 * ## It is still not a completeness marker, and that distinction is untouched
 *
 * RULING 71's reasoning survives whole. **Our data is complete** — Rockaway
 * Borough's council race and Rockaway Township's are both held in full. What is
 * unsettled is which one is the READER's, and the reader is the only party who
 * can settle it. This says a thing about a street, never a thing about a record,
 * and it attaches to bodies rather than to people. RULING 44 and RULING 42 are
 * not weakened: neither the block nor the mark says we failed to find anything.
 *
 * ## It never gates anything
 *
 * A reader who provides nothing still sees every contest the zip produced, in
 * full, with every candidate on it. Declining stays the effortless default —
 * the second of the three load-bearing friction exceptions in `CLAUDE.md`.
 */

/** The mark an affected contest heading carries, tying it to the block. */
export const JURISDICTION_MARK = "◆";

/**
 * What the block says, assembled once so nothing assembles it differently —
 * the same reason `lib/ballot/could-govern.ts` holds the pill's words.
 */
export const JURISDICTION_NOTE_HEADING = "Some of these are decided by only part of your zip code";

export function JurisdictionMark() {
  return (
    <sup>
      <a
        href="#jurisdiction-note"
        title={JURISDICTION_NOTE_HEADING}
        aria-label={JURISDICTION_NOTE_HEADING}
        className="ml-0.5 align-super text-[0.625rem] text-signal no-underline"
        data-jurisdiction-mark="true"
      >
        {JURISDICTION_MARK}
      </a>
    </sup>
  );
}

/**
 * The page-level block. Rendered once, above the contests, and only when at
 * least one contest is affected — a note about nothing is noise.
 *
 * `jurisdictions` is the list of body names this zip only partly covers, in the
 * order they appear on the page, deduplicated by the caller.
 */
export function JurisdictionNote({
  jurisdictions,
  unplaceable = 0,
}: {
  /** Bodies MEASURED as covering only part of this zip. Named outright. */
  jurisdictions: readonly string[];
  /**
   * How many marked contests sit on a division this zip has **no boundary
   * measurement for at all** — `UNKNOWN`, not `AMBIGUOUS`.
   *
   * **They are counted, never named**, and that is the whole reason this prop
   * exists. The first version of this block listed them alongside the measured
   * ones, so it told a reader that the *11th Congressional District* covers
   * only part of 07866 — which is not something we measured, it is something we
   * have no polygon for. 07866 in fact sits entirely inside NJ-11.
   *
   * `needsPill` deliberately collapses `UNKNOWN` into `AMBIGUOUS`, and for the
   * INVITATION that collapse is right: offering to narrow is safe under
   * uncertainty. This block makes a far stronger claim — it names bodies as
   * partial — and a render default may never convert absence into an
   * assertion. So the two states are kept apart here even though the mark
   * treats them alike.
   */
  unplaceable?: number;
}) {
  if (jurisdictions.length === 0 && unplaceable === 0) return null;
  return (
    <section
      id="jurisdiction-note"
      data-jurisdiction-note="true"
      className="mt-5 rounded-[10px] border border-[var(--signal)]/40 bg-[var(--signal)]/5 p-4"
    >
      <h2 className="text-[0.9375rem] font-semibold leading-snug text-paper">
        <span aria-hidden="true" className="mr-1.5 text-signal">
          {JURISDICTION_MARK}
        </span>
        {JURISDICTION_NOTE_HEADING}
      </h2>
      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-voice">
        A zip code is a mail route, not a boundary — this one crosses several
        governments, and each of the contests marked{" "}
        <span aria-hidden="true" className="text-signal">
          {JURISDICTION_MARK}
        </span>{" "}
        below is decided by one of them rather than by all of you. We hold every
        one of these races in full; what we cannot tell from a zip code alone is
        which of them is yours.
      </p>
      {jurisdictions.length > 0 && (
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-voice">
          The ones that cover only part of this zip:{" "}
          <span className="font-semibold text-paper">{jurisdictions.join(", ")}</span>.
        </p>
      )}
      {unplaceable > 0 && (
        /*
         * OUR gap, said as ours. These are marked because we cannot place them
         * against this zip's boundary, which is a fact about our data — not a
         * finding that they cover part of it.
         */
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-voice">
          {unplaceable === 1
            ? "One more contest below is marked because we have not yet mapped its district against this zip. That is a gap on our side, not a finding about the district."
            : `${unplaceable} more contests below are marked because we have not yet mapped their districts against this zip. That is a gap on our side, not a finding about those districts.`}
        </p>
      )}
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-voice">
        If yours is on that list you already have your answer. If you would
        rather we narrowed it, {COULD_GOVERN_ACTION}.
      </p>
    </section>
  );
}
