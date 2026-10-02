import type { Meeting } from "../sources/types.ts";

/**
 * **SRC-1 / SRC-2 / SRC-3 (2026-08-24, walkthrough) — ONE SOURCE
 * LINE AT THE BOTTOM OF THE CARD, AND ZERO INLINE ASTERISKS.**
 *
 * The walkthrough captures are the specification. `11-59-24` puts a red arrow on a bare
 * `*` floating between two meetings; `12-24-03` red-boxes the whole footnote
 * block at the foot of a Rockaway Township card —
 *
 *     * Rockaway Township, NJ — Rockaway Township
 *     † Rockaway Township, NJ — Rockaway Township Board of Adjustment
 *     ‡ Rockaway Township, NJ — Rockaway Township Planning Board
 *
 * — and the replacement is a sentence in its place. Single source: *These were
 * sourced from Tucson Unified School District Governing Board.* More than one:
 * *We sourced this information from these three sources,* and then the list,
 * still at the bottom.
 *
 * ## WHAT THIS SUPERSEDES, AND WHAT IT DOES NOT
 *
 * F01 3.2 (2026-08-19) collapsed two lines of provenance under EVERY row into
 * one note per distinct attribution, with a footnote marker on each row
 * pointing at its note. That was a real improvement and it is superseded here:
 * the markers themselves are now the friction. A reader scanning a docket does
 * not resolve footnote symbols, and a bare `*` on its own line between two
 * meetings reads as a defect rather than as a citation.
 *
 * The cost is stated rather than hidden, because it is a real one and it was
 * F01 3.2's stated reason for putting markers on rows: **on a card carrying two
 * bodies at one building, a reader can no longer tell which row came from which
 * source.** Tucson splits city and school meetings at one address, so this is
 * not hypothetical. The trade is deliberate; what it buys is that the other ninety-odd cards, which carry ONE source,
 * stop printing punctuation nobody reads. The list at the foot still names
 * every source in full, so nothing is de-sourced — what is lost is which of
 * two named sources a given row came from, never whether it was sourced.
 *
 * ## NOTHING IS DE-SOURCED — AND THAT IS A CLAIM ABOUT THE DATA, NOT THE VIEW
 *
 * This module is a RENDER concern and only a render concern. Every fact keeps
 * its provenance in the data: `provenance.sourceUrl`, `provenance.sourceOrg`,
 * `provenance.collectedAt` and the rest are untouched, on every row, before
 * and after. `tests/source-consolidation.test.ts` asserts exactly that — the
 * populated provenance fields of a meeting set are identical either side of
 * this function — because "we consolidated the display" and "we dropped the
 * record" are one careless edit apart and only one of them is allowed.
 *
 * The per-row provenance that genuinely VARIES still renders on the row —
 * second-hand sourcing, the carry-forward stamp. Collapsing a fact that
 * differs between rows would be a lie rather than a tidy-up.
 *
 * ## Not to be confused with `./attribution.ts`
 *
 * That module answers *which body acted on which part of an agenda* — the D19
 * Legistar join. Different question, different file, names kept apart.
 */

export interface AttributionNote {
  /** The meeting's jurisdiction, verbatim — never re-derived, never shortened. */
  jurisdiction: string;
  /** Who published the record, verbatim from the provenance. */
  sourceOrg: string;
}

/**
 * Structurally the two fields this needs and nothing else, so a test can build
 * a row without inventing a whole `Provenance` — and so an unrelated change to
 * `Meeting` cannot break a function that reads two strings off it.
 */
export interface MeetingAttribution {
  jurisdiction: Meeting["jurisdiction"];
  provenance: { sourceOrg: string };
}

export interface SourceCredit {
  /**
   * `none` renders nothing at all — never a placeholder, never an empty
   * heading. A card with no attribution to show says nothing about
   * attribution, which is the render-default rule: absence may not be
   * dressed as a finding.
   */
  kind: "none" | "single" | "multi";
  /**
   * The sentence that leads the credit. Empty when `kind` is `none`.
   *
   * Level register — this is a CLAIM surface, so it is plain and neutral and
   * it names the publisher rather than characterising it.
   */
  lead: string;
  /**
   * The distinct sources, verbatim, in first-appearance order.
   *
   * Empty for `single`, because the single form already names its source
   * inside `lead` and printing it twice is the repetition this exists to end.
   */
  sources: AttributionNote[];
}

/** Small counts read as words in a sentence; past ten, digits are clearer. */
const NUMBER_WORD = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

export function numberWord(n: number): string {
  return NUMBER_WORD[n] ?? String(n);
}

/**
 * The one credit line for one rendered card.
 *
 * The key is the exact pair: a body whose jurisdiction and source org are both
 * identical to another's IS the same attribution, and two entries saying the
 * same words would be the repetition this exists to remove.
 *
 * `itemCount` decides only whether the single form reads *This was* or *These
 * were* — a card showing one sitting must not say "these". It defaults to the
 * number of rows handed in, which is right for every current caller.
 */
export function sourceCreditFor(
  meetings: readonly MeetingAttribution[],
  itemCount: number = meetings.length,
): SourceCredit {
  const keyOf = (m: MeetingAttribution) =>
    `${m.jurisdiction}\u0000${m.provenance.sourceOrg}`;

  const byKey = new Map<string, AttributionNote>();
  for (const meeting of meetings) {
    const key = keyOf(meeting);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      jurisdiction: meeting.jurisdiction,
      sourceOrg: meeting.provenance.sourceOrg,
    });
  }

  const sources = [...byKey.values()];

  if (sources.length === 0) return { kind: "none", lead: "", sources: [] };

  if (sources.length === 1) {
    const only = sources[0]!;
    return {
      kind: "single",
      lead:
        itemCount === 1
          ? `This was sourced from ${only.sourceOrg}.`
          : `These were sourced from ${only.sourceOrg}.`,
      sources: [],
    };
  }

  return {
    kind: "multi",
    lead: `We sourced this information from these ${numberWord(sources.length)} sources:`,
    sources,
  };
}
