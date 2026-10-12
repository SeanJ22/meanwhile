import { isJurisdictionSegment } from "../ocd/fips.ts";
import type { CoverageStatus } from "./types.ts";

/**
 * What we may honestly say about a body with no agendas on file. Some states' open-meeting laws require
 * notice of a meeting but no agenda at all, so "we don't have their calendar yet" can misattribute a
 * body's lawful choice to our coverage.
 *
 * The two sentences are gated separately: the statutory sentence is a fact about the state's law and
 * renders for every body in it; the "we searched" sentence is a claim about work done and renders only
 * when that body's audit shows an exhausted hunt.
 */

/** States whose open-meeting law does not require an agenda at all. */
const NO_AGENDA_REQUIRED: Record<string, string> = {
  nh: "New Hampshire",
};

/**
 * The state segment of an OCD-ID, or null. DC and the territories count as their own jurisdictions
 * (`district:dc`, `territory:pr`, as `lib/ocd/fips.ts` mints them).
 */
export function stateOf(ocdId: string | null): string | null {
  if (!ocdId) return null;
  const match = /\/(state|district|territory):([a-z]{2})(\/|$)/.exec(ocdId);
  return match && isJurisdictionSegment(match[1], match[2]) ? match[2] : null;
}

/** The sentence for a body with nothing on its calendar, or null when there is nothing honest to add. */
export function agendaAbsenceNote(
  ocdId: string | null,
  status: CoverageStatus,
): string | null {
  const state = stateOf(ocdId);
  const named = state ? NO_AGENDA_REQUIRED[state] : undefined;

  // Only an exhausted search may say a search happened.
  const searched = status === "NO_SOURCE_FOUND";

  if (searched && named) {
    return `We searched high and low for the agenda, and could not find one. ${named} does not require an agenda, and this body may not publish one.`;
  }

  if (searched) {
    // Elsewhere the absence is ours to own: an exhausted search in a state
    // that does require publication is a gap we have not closed, not a lawful
    // silence.
    return "We searched high and low for the agenda, and could not find one.";
  }

  if (named) {
    // The statutory fact stands on its own for every body in the state; it claims nothing about our
    // diligence.
    return `${named} does not require an agenda, and this body may not publish one.`;
  }

  return null;
}

/**
 * One footnote per distinct sentence, with the bodies it applies to named inline. Identical footnotes
 * across bodies collapse to once per panel; nothing is dropped, every subject is still named in the
 * order the panel meets them, and subjects de-duplicate too.
 */
export interface CollapsedFootnote {
  /** The sentence itself, rendered once. */
  note: string;
  /** Every distinct subject it applies to, in first-seen order. */
  subjects: string;
}

export function collapseFootnotes<T extends { divisionLabel: string }>(
  bodies: readonly T[],
  noteFor: (body: T) => string | null,
): CollapsedFootnote[] {
  // Insertion-ordered: a Map keyed by the sentence keeps the panel's own
  // reading order, which is the order the bodies appear in above it.
  const byNote = new Map<string, string[]>();
  for (const body of bodies) {
    const note = noteFor(body);
    if (!note) continue;
    const subjects = byNote.get(note) ?? [];
    if (!subjects.includes(body.divisionLabel)) subjects.push(body.divisionLabel);
    byNote.set(note, subjects);
  }
  return [...byNote.entries()].map(([note, subjects]) => ({
    note,
    subjects: subjects.join(", "),
  }));
}
