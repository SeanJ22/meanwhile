import type { CoverageStatus } from "./types.ts";

/**
 * What we may honestly say about a body with no agendas on file — D17.
 *
 * **The finding that forced this.** New Hampshire's RSA 91-A:2 requires notice
 * of a meeting's time, date and place, and **does not require an agenda at
 * all**; a body may lawfully publish none, and may take up topics not on one it
 * chose to publish. Compare Arizona's A.R.S. § 38-431.02, which requires the
 * agenda posted on the body's own website, and New Jersey's N.J.S.A. 10:4-8,
 * which requires it only "to the extent known".
 *
 * So "we don't have their calendar yet" — which reads as *our* gap — can be
 * false in New Hampshire in a way it is not in Arizona. There may be nothing to
 * find. Misattributing a body's lawful choice to our own coverage is the same
 * family of error as claiming a place is unincorporated without measuring it.
 *
 * **The two sentences are gated separately — D17, split 2026-08-13.** The
 * statutory sentence is a fact about New Hampshire law, true of every NH body
 * regardless of how hard anyone looked, so it renders for NH bodies now. The
 * diligence sentence — "we searched high and low" — is a claim about work
 * somebody did, false for a body nobody has looked at, so it renders only when
 * that body's audit shows an exhausted hunt. The earlier implementation hung
 * both sentences on the exhausted hunt, and the exhausted count was zero, so
 * the copy rendered for nobody — including Newbury and Kearsarge, the two
 * bodies it was written for.
 */

/** States whose open-meeting law does not require an agenda at all. */
const NO_AGENDA_REQUIRED: Record<string, string> = {
  nh: "New Hampshire",
};

/** The state segment of an OCD-ID, or null. */
export function stateOf(ocdId: string | null): string | null {
  if (!ocdId) return null;
  const match = /\/state:([a-z]{2})(\/|$)/.exec(ocdId);
  return match ? match[1] : null;
}

/**
 * The sentence for a body with nothing on its calendar.
 *
 * Returns null when there is nothing honest to add — the caller's existing copy
 * already covers it. No copy here is new: both sentences are the approved D17
 * wording, and the split is in the gating alone.
 */
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
    // The statutory fact stands on its own for every NH body, however little
    // anyone has searched — it claims nothing about our diligence.
    return `${named} does not require an agenda, and this body may not publish one.`;
  }

  return null;
}

/**
 * One footnote per distinct SENTENCE, with the bodies it applies to named
 * inline — M94, the author's find on production (2026-08-16).
 *
 * ## What the reader was looking at
 *
 * At 03255 the who-governs panel repeated "we couldn't reach their calendar
 * source" and "New Hampshire does not require an agenda" up to FOUR TIMES
 * EACH, one per body row, and Newbury's three land-use boards share a single
 * division so three of the repeats named the same town three times over. Four
 * identical sentences stacked under a card do not read as four facts. They
 * read as a broken page, and they bury the one fact each of them carries —
 * which is the reader-friction defect, at full strength, on the surface that
 * exists to answer a question.
 *
 * ## The rule (e's 6g)
 *
 * A distinct footnote renders **once per body**; identical footnotes across
 * bodies collapse to **once per panel**, with the bodies named inline —
 * "Newbury town, Kearsarge Regional School District — New Hampshire does not
 * require an agenda…". Nothing is dropped and nothing is generalized: every
 * subject the un-collapsed list would have named is still named, in the order
 * the panel meets them, so the collapse costs the reader no information and
 * saves them three re-reads.
 *
 * Subjects de-duplicate too. Three boards of one town are one subject, because
 * the sentence is about the town's publisher, not about each board.
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
