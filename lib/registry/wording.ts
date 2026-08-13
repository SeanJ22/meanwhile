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
 * **The statutory sentence is gated on an exhausted hunt, not on the state.**
 * "We searched high and low" is a claim about work somebody did, and it is false
 * for a body nobody has looked at — which is 258 of 265 today. Pairing a
 * statutory excuse with a search that never happened would let the law do the
 * explaining for our own backlog. That is why this reads `CoverageStatus`
 * rather than just the identifier.
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
 * already covers it.
 */
export function agendaAbsenceNote(
  ocdId: string | null,
  status: CoverageStatus,
): string | null {
  // Only an exhausted search may say a search happened. Everything else is
  // covered by the coverage notice's own "nobody has searched yet" line.
  if (status !== "NO_SOURCE_FOUND") return null;

  const state = stateOf(ocdId);
  const named = state ? NO_AGENDA_REQUIRED[state] : undefined;

  if (named) {
    return `We searched high and low for the agenda, and could not find one. ${named} does not require an agenda, and this body may not publish one.`;
  }

  // Elsewhere the absence is ours to own: an exhausted search in a state that
  // does require publication is a gap we have not closed, not a lawful silence.
  return "We searched high and low for the agenda, and could not find one.";
}
