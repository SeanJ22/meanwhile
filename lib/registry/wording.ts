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
