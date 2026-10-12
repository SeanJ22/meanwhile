import type { Meeting } from "../sources/types.ts";

/**
 * One source line at the bottom of a card instead of per-row markers. A render concern only: every row keeps its full
 * provenance in the data.
 */

export interface AttributionNote {
  /** The meeting's jurisdiction, verbatim — never re-derived, never shortened. */
  jurisdiction: string;
  /** Who published the record, verbatim from the provenance. */
  sourceOrg: string;
}

export interface MeetingAttribution {
  jurisdiction: Meeting["jurisdiction"];
  provenance: { sourceOrg: string };
}

export interface SourceCredit {
  /** `none` renders nothing at all, never a placeholder. */
  kind: "none" | "single" | "multi";
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

/** The one credit line for one card. `itemCount` decides only "This was" versus "These were". */
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
