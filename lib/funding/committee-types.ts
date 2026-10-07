/**
 * What kind of money this is: the whole mapping from FEC filed fields to the
 * committee labels a reader sees. Nothing outside it may invent a label.
 *
 * 1. Every label is derived mechanically from `committee_type`,
 *    `organization_type` and `designation` as filed on the Schedule A row's
 *    `contributor` object, never from a committee's name.
 * 2. An unmapped or absent code falls to the honest generic, never a guess.
 * 3. A label says what a committee is under federal law, never what it is
 *    for or whom it favors.
 *
 * Code sets: https://www.fec.gov/campaign-finance-data/committee-type-code-descriptions/
 * and https://www.fec.gov/campaign-finance-data/committee-master-file-description/
 * (ORG_TP: C = Corporation, L = Labor organization, M = Membership
 * organization, T = Trade association, V = Cooperative, W = Corporation
 * without capital stock).
 */

/** The FEC typing carried on a contribution row, exactly as filed. */
export interface FiledCommitteeTyping {
  /** FEC `committee_type` — H, S, P, N, Q, O, U, V, W, X, Y, Z, D, E, I, C. */
  committeeType: string | null;
  /** FEC `organization_type` (ORG_TP) — C, L, M, T, V, W. */
  organizationType: string | null;
  /** FEC `designation` (CMTE_DSGN) — A, B, D, J, P, U. */
  designation: string | null;
}

/**
 * One label the app may render, with the two plain sentences a reader gets
 * when they tap it, paraphrasing the FEC's own definition.
 */
export interface CommitteeTypeLabel {
  /** Stable key, for tests and for the explainer lookup. */
  id: string;
  /** The label as rendered, lowercase, to sit inside a sentence. */
  label: string;
  /** Two sentences, plain words. */
  explainer: string;
  /** The FEC page the explainer paraphrases. Fetched and verified. */
  sourceUrl: string;
}

const FEC_TYPE_CODES =
  "https://www.fec.gov/campaign-finance-data/committee-type-code-descriptions/";
const FEC_MASTER_FILE =
  "https://www.fec.gov/campaign-finance-data/committee-master-file-description/";

/**
 * Every label the funding surface may render. A label that is not in this
 * array cannot reach a reader — `tests/funding.test.ts` holds that.
 */
export const COMMITTEE_TYPE_LABELS: readonly CommitteeTypeLabel[] = [
  // "The candidate's own money" is answered earlier from entity type CAN (or a
  // line 13A loan), so it has no entry here.
  {
    id: "joint-fundraiser",
    label: "a joint fundraising committee",
    explainer:
      "A joint fundraising committee is a shared account that raises money for two or more campaigns or party committees at once, then splits it between them by an agreed formula. The money passing through it started with the donors to that shared account.",
    sourceUrl: FEC_MASTER_FILE,
  },
  {
    id: "another-candidate-committee",
    label: "another candidate's campaign committee",
    explainer:
      "This is a different candidate's campaign account giving money to this one. Campaigns are allowed to give limited amounts to each other, and it usually means the two are allies.",
    sourceUrl: FEC_TYPE_CODES,
  },
  {
    id: "leadership-pac",
    label: "a leadership PAC",
    explainer:
      "A leadership PAC is a fund an officeholder sets up separately from their own campaign, mainly to give money to other candidates. It is a way politicians build support among their colleagues.",
    sourceUrl: FEC_MASTER_FILE,
  },
  {
    id: "super-pac",
    label: "a super PAC",
    explainer:
      "A super PAC can raise unlimited amounts, but it is only allowed to spend on its own advertising — it cannot give money to a candidate or coordinate with one. The FEC calls these independent-expenditure-only committees.",
    sourceUrl: FEC_TYPE_CODES,
  },
  {
    id: "single-candidate-ie",
    label: "a group that only spends on one candidate",
    explainer:
      "This committee makes independent expenditures about a single candidate — advertising for or against one person, on its own. It is not allowed to give that candidate money or coordinate with them.",
    sourceUrl: FEC_TYPE_CODES,
  },
  {
    id: "hybrid-pac",
    label: "a hybrid PAC",
    explainer:
      "A hybrid PAC keeps two separate pots of money: one it uses to give limited amounts to candidates, and one it can raise without limits but may only spend on its own advertising. The FEC calls the second one a non-contribution account.",
    sourceUrl: FEC_TYPE_CODES,
  },
  {
    id: "party-committee",
    label: "a party committee",
    explainer:
      "This is an official committee of a political party — national, state or local. Parties raise money and spend it to help their own candidates get elected.",
    sourceUrl: FEC_TYPE_CODES,
  },
  {
    id: "pac-corporation",
    label: "a PAC connected to a corporation",
    explainer:
      "A company cannot give its own money to a federal candidate, so it sets up a separate fund and asks its executives and shareholders to contribute. The company pays the fund's running costs, but the money given to candidates comes from those people.",
    sourceUrl: FEC_MASTER_FILE,
  },
  {
    id: "pac-labor",
    label: "a PAC connected to a labor union",
    explainer:
      "A union cannot give its own money to a federal candidate, so it sets up a separate fund and asks its members to contribute. The union pays the fund's running costs, but the money given to candidates comes from members.",
    sourceUrl: FEC_MASTER_FILE,
  },
  {
    id: "pac-trade-association",
    label: "a PAC connected to a trade association",
    explainer:
      "A trade association is a membership group of businesses in the same line of work. Its PAC raises money from the people at those member companies and gives it to candidates.",
    sourceUrl: FEC_MASTER_FILE,
  },
  {
    id: "pac-membership",
    label: "a PAC connected to a membership organization",
    explainer:
      "A membership organization is a group whose members run it under its own bylaws. Its PAC raises money from those members and gives it to candidates.",
    sourceUrl: FEC_MASTER_FILE,
  },
  {
    id: "pac-cooperative",
    label: "a PAC connected to a cooperative",
    explainer:
      "A cooperative is a business owned by the people who use it, such as a farm or rural electric co-op. Its PAC raises money from those members and gives it to candidates.",
    sourceUrl: FEC_MASTER_FILE,
  },
  {
    id: "pac-no-capital-stock",
    label: "a PAC connected to a corporation without shareholders",
    explainer:
      "This is a PAC set up by an incorporated group that has no shareholders — many nonprofits are organized this way. It raises money from the people connected to that group and gives it to candidates.",
    sourceUrl: FEC_MASTER_FILE,
  },
  {
    id: "pac",
    label: "a political action committee",
    explainer:
      "A political action committee raises money from people and gives it to candidates, within limits the law sets. The FEC's filing for this one does not say what organization, if any, it is connected to.",
    sourceUrl: FEC_TYPE_CODES,
  },
  {
    id: "organization",
    label: "an organization",
    explainer:
      "The FEC's filing for this contributor does not classify it any further than this. We render what was filed rather than deciding for ourselves what kind of group it is.",
    sourceUrl: FEC_MASTER_FILE,
  },
] as const;

const BY_ID = new Map(COMMITTEE_TYPE_LABELS.map((l) => [l.id, l]));

export function committeeTypeLabelById(id: string): CommitteeTypeLabel | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The label as it renders on a pill: a tag, so a leading "a "/"an " is
 * dropped ("SUPER PAC"). A separate reader over `label`, which stays the
 * lowercase sentence fragment used in prose.
 */
export function committeePillLabel(label: CommitteeTypeLabel): string {
  return label.label.replace(/^an? /, "");
}

/** ORG_TP → the connected-organization label id. */
const ORGANIZATION_TYPE: Readonly<Record<string, string>> = {
  C: "pac-corporation",
  L: "pac-labor",
  M: "pac-membership",
  T: "pac-trade-association",
  V: "pac-cooperative",
  W: "pac-no-capital-stock",
};

/**
 * The derivation, in order. Each step reads one filed field; the order
 * resolves committees that satisfy more than one rule. Null when the filing
 * carries no typing at all.
 */
export function committeeTypeLabelFor(
  typing: FiledCommitteeTyping,
): CommitteeTypeLabel | null {
  const { committeeType, organizationType, designation } = typing;

  // 1. A joint fundraiser is designated J and separately files as whatever
  //    committee type fits it. The designation must win, or a shared account
  //    raising for two campaigns renders as one campaign's own committee.
  if (designation === "J") return committeeTypeLabelById("joint-fundraiser");

  // 2. A leadership PAC files as a PAC and is designated D. Same reasoning:
  //    the designation is the more specific fact about it.
  if (designation === "D") return committeeTypeLabelById("leadership-pac");

  // 3. Another candidate's account. P is a principal campaign committee,
  //    A is any other committee a candidate authorized. The READER'S
  //    candidate giving to themselves never reaches here — that is entity
  //    type CAN, answered by plainContributorLabel before this runs.
  if (designation === "P" || designation === "A") {
    return committeeTypeLabelById("another-candidate-committee");
  }

  // Designation B (a lobbyist's or registrant's PAC) deliberately falls
  // through to the committee type below: it says who ESTABLISHED the PAC,
  // and the connected-organization category underneath is the more useful
  // fact about whose money it is.

  switch (committeeType) {
    // 4. Independent-expenditure-only — the super PAC.
    case "O":
      return committeeTypeLabelById("super-pac");
    case "U":
      return committeeTypeLabelById("single-candidate-ie");
    case "V":
    case "W":
      return committeeTypeLabelById("hybrid-pac");
    case "X":
    case "Y":
    case "Z":
      return committeeTypeLabelById("party-committee");
    case "H":
    case "S":
    case "P":
      return committeeTypeLabelById("another-candidate-committee");
    case "N":
    case "Q": {
      // 5. A separate segregated fund is typed by the organization it is
      //    connected to. Without that category, it is honestly just a PAC.
      const byOrg = organizationType
        ? ORGANIZATION_TYPE[organizationType]
        : undefined;
      return committeeTypeLabelById(byOrg ?? "pac");
    }
    default:
      // 6. Delegate committees, electioneering-communication filers,
      //    communication-cost filers, independent expenditors, and anything
      //    the FEC has not classified. An organization-type category on its
      //    own still says something true; otherwise, the honest generic.
      if (organizationType && ORGANIZATION_TYPE[organizationType]) {
        return committeeTypeLabelById(ORGANIZATION_TYPE[organizationType]);
      }
      return committeeType || organizationType || designation
        ? committeeTypeLabelById("organization")
        : null;
  }
}
