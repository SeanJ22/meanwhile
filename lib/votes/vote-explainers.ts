/**
 * Vote-type explainers — what kind of vote a roll call was, in plain words, so
 * a "yes" on passage and a "no" on a motion to recommit do not read as
 * incoherence. `basis` cites the parliamentary definition for maintainers and
 * never renders. Matching is on the chamber's own question line ("On
 * Passage"); an unmatched question renders no explainer.
 */

export interface VoteExplainer {
  /** Keyword the chamber's question line must contain (case-insensitive). */
  match: RegExp;
  /** The plain-words statement of what this vote decides. */
  plain: string;
  /** What a No vote mechanically did on this vote type; one line, never evaluative. */
  noMeans: string;
  /** Where the parliamentary definition lives. Data-file citation only. */
  basis: string;
}

/**
 * Order matters: more specific phrases first, so "Motion to Recommit"
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

/** The explainer for a chamber question line, or null — never a guess. */
export function explainVoteQuestion(
  question: string,
): VoteExplainer | null {
  for (const explainer of VOTE_EXPLAINERS) {
    if (explainer.match.test(question)) return explainer;
  }
  return null;
}
