/**
 * Vote-type explainers (4b) — what kind of vote a roll call was, in plain
 * words, keyed data like the office blurbs.
 *
 * The defect this exists for: a member voting "yes" then "no" on the same
 * act reads as incoherence until the reader knows one vote was passage and
 * the other a motion to recommit. Every rendered vote row states its type
 * in the 15-year-old register.
 *
 * The `basis` fields cite the parliamentary definitions — in this data
 * file, never on the surface (the reader gets plain words; the citation is
 * for whoever maintains these).
 *
 * Matching is on the chamber's own question line ("On Passage", "On
 * Cloture on the Motion to Proceed"). An unmatched question renders no
 * explainer — never a guessed one.
 */

/** The record's jurisdiction, never the candidate's contested office. */
export type VoteJurisdiction =
  | { level: "federal" }
  | { level: "state"; state: string };

export interface VoteExplainer {
  /** Keyword the chamber's question line must contain (case-insensitive). */
  match: RegExp;
  /** The plain-words statement of what this vote decides. */
  plain: string;
  /**
   * 5b (2026-08-17): what a No vote mechanically did on this vote type —
   * one line, mechanical, never evaluative. Derived from the same
   * parliamentary definition as `plain`. Null when the source motion does
   * not establish the direction of a No vote.
   */
  noMeans: string | null;
  /** Where the parliamentary definition lives. Data-file citation only. */
  basis: string;
}

/**
 * Federal procedure only. Order matters: more specific phrases first, so "Motion to Recommit"
 * matches before a generic "Passage" ever could.
 */
export const VOTE_EXPLAINERS: VoteExplainer[] = [
  {
    match: /recommit/i,
    noMeans:
      "Voting No here let the bill move forward.",
    plain:
      "This was a procedural vote — a last chance to send the bill back to committee before passage. Voting no here means letting the bill move forward.",
    basis:
      "House Practice: Motions to Recommit — https://www.govinfo.gov/app/collection/hpractice",
  },
  {
    match: /cloture/i,
    noMeans:
      "A No vote here was a vote to keep debating — against letting the final vote happen.",
    plain:
      "This vote was on whether to end debate so the Senate can move to a final vote. It needs 60 votes, and it is about letting the vote happen — not the final yes or no on the measure itself.",
    basis:
      "Senate glossary: cloture — https://www.senate.gov/about/glossary.htm",
  },
  {
    match: /veto/i,
    noMeans:
      "A No vote here was a vote to let the veto stand.",
    plain:
      "This vote was on whether to pass the bill into law over the President's veto, which takes a two-thirds vote in both chambers.",
    basis:
      "U.S. Constitution, Art. I §7; Senate glossary: veto override — https://www.senate.gov/about/glossary.htm",
  },
  {
    match: /nomination|confirm/i,
    noMeans:
      "A No vote here was a vote against approving the nominee.",
    plain:
      "This vote was on whether to approve the President's nominee for this position.",
    basis:
      "Senate glossary: confirmation — https://www.senate.gov/about/glossary.htm",
  },
  {
    match: /previous question/i,
    noMeans:
      "A No vote here was a vote to keep debate open.",
    plain:
      "This was a procedural vote on whether to cut off debate and block further changes. Losing it usually hands control of the debate to the other side.",
    basis:
      "House Practice: Previous Question — https://www.govinfo.gov/app/collection/hpractice",
  },
  {
    match: /suspend the rules/i,
    noMeans:
      "A No vote here was a vote against passing the bill under the fast-track shortcut.",
    plain:
      "This vote was on passing the bill under a fast-track shortcut that skips the usual debate rules — it needs a two-thirds vote instead of a simple majority.",
    basis:
      "House Practice: Suspension of the Rules — https://www.govinfo.gov/app/collection/hpractice",
  },
  {
    match: /motion to table/i,
    noMeans:
      "A No vote here was a vote to keep the matter alive.",
    plain:
      "This vote was on setting the matter aside — voting yes here stops it without a direct vote on the thing itself.",
    basis:
      "Senate glossary: table — https://www.senate.gov/about/glossary.htm",
  },
  {
    match: /motion to proceed/i,
    noMeans:
      "A No vote here was a vote against taking the measure up.",
    plain:
      "This vote was on whether to take the measure up at all — about starting the debate, not about the measure itself.",
    basis:
      "Senate glossary: motion to proceed — https://www.senate.gov/about/glossary.htm",
  },
  {
    match: /amendment/i,
    noMeans:
      "A No vote here was a vote against making this change to the bill.",
    plain:
      "This vote was on a proposed change to the bill, not on the bill itself.",
    basis:
      "Senate glossary: amendment — https://www.senate.gov/about/glossary.htm",
  },
  {
    match: /concur/i,
    noMeans:
      "A No vote here was a vote against accepting the other chamber's changes.",
    plain:
      "This vote was on accepting the other chamber's changes so the bill can go to the President.",
    basis:
      "Senate glossary: concurrence — https://www.senate.gov/about/glossary.htm",
  },
  {
    match: /agreeing to the resolution|on the resolution/i,
    noMeans:
      "A No vote here was a vote against adopting the resolution.",
    plain:
      "This vote was on adopting a resolution — often the rule that sets the terms of debate for a bill, or a formal statement of the chamber's position.",
    basis:
      "House Practice: Resolutions — https://www.govinfo.gov/app/collection/hpractice",
  },
  {
    match: /passage|on the bill/i,
    noMeans:
      "A No vote here was a vote against passing the bill.",
    plain: "This vote was on whether to pass the bill.",
    basis:
      "Senate glossary: passage — https://www.senate.gov/about/glossary.htm",
  },
];

/**
 * State procedure has its own definitions. Only explain what the motion
 * establishes: a concurrence does not establish executive action, and a
 * veto message alone does not identify the question put to the chamber.
 * Thresholds and later legislative outcomes vary and are not inferred here.
 * An unrecognized state motion never falls back to the federal table.
 */
export const STATE_VOTE_EXPLAINERS: VoteExplainer[] = [
  {
    match: /^(?:veto override|on (?:the )?veto override|on overriding (?:the )?veto)$/i,
    plain:
      "This vote was on whether to override the governor's veto of the bill.",
    noMeans:
      "A No vote here was a vote against overriding the veto.",
    basis:
      "State legislative veto procedure; NH New Legislator Orientation Manual, Gubernatorial Action — https://gc.nh.gov/orientation/documents/handbooks/New%20Legislator%20Orientation%20Manual.pdf",
  },
  {
    match: /^veto message(?:\s*-\s*roll call required)?$/i,
    plain:
      "This roll call concerned the governor's objections to a bill.",
    // The source identifies a veto message, but not the direction of the
    // motion. Do not turn a vote on that message into a guessed override.
    noMeans: null,
    basis:
      "State legislative veto messages; NH New Legislator Orientation Manual, Gubernatorial Action — https://gc.nh.gov/orientation/documents/handbooks/New%20Legislator%20Orientation%20Manual.pdf",
  },
  {
    match: /^(?:(?:house|senate|assembly)(?: floor)?\s*[-:]\s*)?(?:on )?(?:motion to )?concur(?:ring)? (?:in|with) (?:the )?(?:senate|house|assembly) amendments?$/i,
    plain:
      "This vote was on whether to accept the other chamber's changes to the bill.",
    noMeans:
      "A No vote here was a vote against accepting those changes.",
    basis:
      "State legislative concurrence; NH New Legislator Orientation Manual, Glossary: Concur — https://gc.nh.gov/orientation/documents/handbooks/New%20Legislator%20Orientation%20Manual.pdf",
  },
  {
    match: /^(?:(?:house|senate|assembly)(?: floor)?\s*[-:]\s*)?(?:third reading - final passage|on (?:the )?(?:final )?passage|on the bill)$/i,
    plain: "This vote was on whether to pass the bill in this chamber.",
    noMeans: "A No vote here was a vote against passing the bill.",
    basis:
      "State legislative passage; NH New Legislator Orientation Manual, The Legislative Process — https://gc.nh.gov/orientation/documents/handbooks/New%20Legislator%20Orientation%20Manual.pdf",
  },
];

/** The explainer for a question in its explicit jurisdiction, or null. */
export function explainVoteQuestion(
  question: string,
  jurisdiction: VoteJurisdiction,
): VoteExplainer | null {
  const explainers = jurisdiction?.level === "federal"
    ? VOTE_EXPLAINERS
    : jurisdiction?.level === "state"
      ? STATE_VOTE_EXPLAINERS
      : [];
  for (const explainer of explainers) {
    if (explainer.match.test(question)) return explainer;
  }
  return null;
}
