import {
  COVERAGE_TIER_NEXT_STEP,
  COVERAGE_TIER_ZIP_HEADLINE,
} from "@/lib/coverage/tier";
import { stampedRowForZip } from "@/lib/coverage/zip-tier";

/**
 * WHAT THE READER IS LOOKING AT, IN PLAIN LANGUAGE (RULING 6 and item 7,
 * 2026-08-20).
 *
 * Every zip surface tells the reader which tier it is showing them. Not with
 * the word "Tier" — a reader-facing string passes the 15-year-old test, and
 * "Tier 1" is an internal enum value, exactly the class of thing the plain-
 * language rule keeps off reader surfaces. The tier renders as a sentence
 * about what we have and what we are still missing.
 *
 * THE REGISTER IS LEVEL, not playful. This is a coverage claim about a real
 * place, and the voice doctrine puts claims — coverage gaps explicitly named
 * among them — in the level register. Nothing here is cute about a gap.
 *
 * THIS IS ONE OF THE FOUR SANCTIONED FRICTIONS. `Reader friction is a defect`
 * has exactly four exceptions, and this is the fourth: honesty about coverage
 * gaps, which may never be smoothed into implied completeness. A reader who
 * scrolls a thin page without this sentence concludes the place is quiet. It
 * is not quiet; we have not finished looking.
 *
 * ABSENCE IS NAMED, NEVER DEFAULTED. A zip with no stamped tier — no ZCTA, or
 * a ledger that would not load — renders "we have not worked this ZIP code out
 * yet", which is a fact about US. It never renders the bottom tier, which
 * would be a fact about the PLACE: that we looked at its governments and found
 * none.
 */
export function CoverageNote({ zip }: { zip: string | null }) {
  if (!zip) return null;

  const row = stampedRowForZip(zip);

  // The named gap, in the gap's own register. `stampedAt` is deliberately not
  // invented here: a missing date may not be filled in with a plausible one.
  if (!row) {
    return (
      <section
        data-coverage-note="UNKNOWN"
        className="mt-4 rounded-md border border-dashed border-muted/40 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-muted"
      >
        <p>
          <span className="font-medium">What we have here:</span> we have not
          worked this ZIP code out yet.
        </p>
      </section>
    );
  }

  const { tier, evidence, unresolvedSpecialDistrictsInCounties, stampedAt } = row;

  return (
    <section
      data-coverage-note={tier}
      data-coverage-stamped-at={stampedAt}
      className="mt-4 rounded-md border border-dashed border-muted/40 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-muted"
    >
      <p>
        <span className="font-medium">What we have here:</span>{" "}
        {COVERAGE_TIER_ZIP_HEADLINE[tier]}
      </p>

      {/*
        The numbers behind the sentence. STATED N EQUALS RENDERED ROWS is the
        rule one floor up; here the equivalent is that the sentence and the
        counts must be readable against each other, so a reader who wants to
        check the claim can.
      */}
      <p className="mt-1.5">
        We have confirmed {evidence.territoryResolved}{" "}
        {evidence.territoryResolved === 1 ? "government" : "governments"} covering
        this ZIP code, and we have the boards and councils inside{" "}
        {evidence.bodiesEnumeratedFor} of them.
      </p>

      {/*
        THE CEILING, NAMED. Special districts are 43.55% of every government in
        the country and the Census publishes no boundary for any of them, so
        nobody can yet say which ones reach a given ZIP code. Leaving this out
        would let the count above read as the whole picture, which is the
        "implied completeness" the coverage-gap exception exists to forbid.
      */}
      {unresolvedSpecialDistrictsInCounties > 0 && (
        <p className="mt-1.5">
          {unresolvedSpecialDistrictsInCounties.toLocaleString()} more — water
          districts, fire districts, and the like — exist in the{" "}
          {evidence.territoryResolved === 1 ? "county" : "counties"} around you.
          We have not worked out which of them reach this ZIP code. Nobody
          publishes their boundaries, so we are going after them one at a time.
        </p>
      )}

      <p className="mt-1.5">
        <span className="font-medium">Next for us:</span>{" "}
        {COVERAGE_TIER_NEXT_STEP[tier]}
      </p>
    </section>
  );
}
