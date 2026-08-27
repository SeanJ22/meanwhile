/**
 * Eligible-edge classification — the ONLY bound on the discovery graph.
 *
 * ## The two failures this sits between
 *
 * **BAD:** try N things, N things failed, therefore absent.
 * **ALSO BAD:** follow every hyperlink forever; completion has no boundary.
 *
 * The first is bounded by an attempt count, which RULING 184 forbids. The
 * second has no completion condition at all, which makes `CONVERGED_AS_OF`
 * unreachable and therefore makes every workstream permanently open — which
 * sounds rigorous and is actually just uninformative.
 *
 * The bound is on SUBJECT, never on effort. A discovered route enlarges the
 * graph when it plausibly advances an owed question. A government page does not
 * recursively make every hyperlink on the internet owed. **Effort remains
 * uncapped** (RULING 177) — nothing here limits how hard an eligible edge is
 * worked.
 *
 * ## Recall-first, on purpose
 *
 * An edge wrongly called eligible costs one walk that returns nothing, and
 * RULING 88 says a route conceived and returning nothing is a reported success.
 * An edge wrongly called INELIGIBLE costs a body nobody hears of again, and
 * nothing in the system would ever surface it. Those are not comparable, so the
 * classifier leans toward eligible and every DECLINE names its reason.
 */

import { type EligibilityVerdict, type OwedQuestion } from "./types.ts";

interface Signal {
  question: OwedQuestion;
  test: RegExp;
}

/**
 * What a link's text or URL suggests it advances.
 *
 * These are SHAPES, not a fixed list of strings (RULING 110). The vocabulary
 * grows as new states teach new words for the same thing — a parish, a borough,
 * a police jury — and adding one is expected rather than exceptional.
 */
const SIGNALS: Signal[] = [
  {
    question: "identifies-a-governmental-body",
    test: /\b(board|commission|committee|council|authority|district|precinct|trustees|selectmen|supervisors|assembly|legislature|department|agency|bureau|division|office of|parish|borough|township|police jury|water|fire|library|cemetery|planning|zoning|school)\b/i,
  },
  {
    question: "identifies-an-official-or-candidate",
    test: /\b(mayor|clerk|treasurer|assessor|sheriff|councilmember|commissioner|superintendent|directory|staff|officials?|members?|who'?s who|elected|candidate)\b/i,
  },
  {
    question: "provides-meetings-or-hearings",
    test: /\b(agenda|minutes|meeting|hearing|calendar|schedule|notice|\.ics|public comment)\b/i,
  },
  {
    question: "provides-elections-ballots-or-measures",
    test: /\b(election|ballot|measure|proposition|referendum|precinct map|polling|sample ballot|voter)\b/i,
  },
  {
    question: "provides-filings-or-campaign-finance",
    test: /\b(campaign finance|filing|disclosure|contribution|expenditure|committee registration|form 460|cfs)\b/i,
  },
  {
    question: "identifies-another-authoritative-publisher",
    test: /\b(county|municipalit|cities and towns|local government|state of|secretary of state|\.gov)\b/i,
  },
  {
    question: "provides-an-official-governing-or-legal-record",
    test: /\b(ordinance|resolution|charter|municipal code|statute|budget|audit|annual report|legal notice|tax rate)\b/i,
  },
  {
    question: "reveals-a-new-governmental-layer-or-entity-class",
    test: /\b(special district|village district|authority|regional|joint powers|consolidated|unincorporated)\b/i,
  },
  {
    question: "reveals-a-new-source-or-route-class",
    test: /\b(open data|api|bulk download|data portal|ftp|export|dataset|developer)\b/i,
  },
];

/**
 * Shapes that are NOT owed, however governmental the host.
 *
 * This is where the infinite crawl actually gets stopped, and each entry is a
 * measured false-positive class rather than a guess. The descent session opened
 * its own candidate output and found a **job board producing 154 false
 * candidates** and a **calendar view producing 214** — both on real government
 * hosts, both matching body vocabulary, neither naming a body.
 */
const NOT_OWED: Array<[string, RegExp]> = [
  ["job-board", /\b(job|career|employment|vacanc|apply now|hiring|salary|benefits|human resources|position openings?)\b/i],
  ["calendar-navigation", /\b(previous|next|today|week of|month of|jump to|view all|«|»|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i],
  // Anchored, with ONE deliberate exception: "skip to …" is an accessibility
  // affordance whose trailing words vary ("skip to main content", "skip to
  // navigation"). Everything else stays anchored on purpose — an unanchored
  // "search" or "home" would decline "Board of Health search results" and
  // "Home Rule Charter", which are real bodies lost to a chrome filter.
  ["site-chrome", /^\s*(skip to\b.*|home|back|top|search|menu|login|sign in|print|share|contact us|site map|accessibility|privacy|terms|translate|espa[nñ]ol)\s*$/i],
  ["social", /\b(facebook|twitter|x\.com|instagram|youtube|linkedin|nextdoor|tiktok)\b/i],
  ["file-noise", /\.(jpg|jpeg|png|gif|svg|css|js|woff2?|zip|mp4)(\?|$)/i],
  ["commerce", /\b(pay (a |your )?bill|shop|donate|store|cart|subscribe|newsletter signup)\b/i],
  ["pagination", /^\s*(\d+|page \d+|first|last|prev|previous|next)\s*$/i],
];

/**
 * Classify one edge.
 *
 * The DECLINE reasons are named because a bare `eligible: false` is
 * unauditable, and because a false-positive class that nobody can see is a
 * class nobody can calibrate against.
 */
export function classifyEdge(input: { text: string; url: string }): EligibilityVerdict {
  const hay = `${input.text} ${input.url}`;

  for (const [name, re] of NOT_OWED) {
    if (re.test(input.text) || (name === "file-noise" && re.test(input.url))) {
      return {
        eligible: false,
        advances: [],
        reason: `not owed: ${name} — recorded as evidence, does not enlarge the completion graph`,
      };
    }
  }

  const advances = [...new Set(SIGNALS.filter((s) => s.test.test(hay)).map((s) => s.question))];
  if (advances.length === 0) {
    return {
      eligible: false,
      advances: [],
      reason: "no owed question is plausibly advanced by this link's text or URL",
    };
  }
  return {
    eligible: true,
    advances,
    reason: `advances ${advances.join(", ")}`,
  };
}

export interface CalibrationResult {
  total: number;
  eligible: number;
  declined: number;
  declinedByReason: Record<string, number>;
  /** Known false positives the classifier still let through. */
  falsePositivesAdmitted: number;
  /** Known true positives the classifier wrongly declined. */
  truePositivesLost: number;
}

/**
 * Calibrate the classifier against LABELLED edges.
 *
 * **A detector must not be able to satisfy a success threshold entirely with
 * known false positives** (RULING 183). Non-zero output is not evidence the
 * detector works — the descent produced 1,392 candidates and promoted zero
 * bodies, and every instrument reported healthy.
 */
export function calibrate(
  labelled: ReadonlyArray<{ text: string; url: string; isBody: boolean }>,
): CalibrationResult {
  const declinedByReason: Record<string, number> = {};
  let eligible = 0;
  let falsePositivesAdmitted = 0;
  let truePositivesLost = 0;

  for (const l of labelled) {
    const v = classifyEdge(l);
    if (v.eligible) {
      eligible += 1;
      if (!l.isBody) falsePositivesAdmitted += 1;
    } else {
      const key = v.reason.split("—")[0].trim();
      declinedByReason[key] = (declinedByReason[key] ?? 0) + 1;
      if (l.isBody) truePositivesLost += 1;
    }
  }

  return {
    total: labelled.length,
    eligible,
    declined: labelled.length - eligible,
    declinedByReason,
    falsePositivesAdmitted,
    truePositivesLost,
  };
}

/**
 * The eligibility definition's version.
 *
 * Convergence is stamped with it, so CHANGING what counts as an eligible edge
 * reopens every graph that converged under the old definition — automatically,
 * without anyone having to remember which ones.
 *
 * **Bump this whenever `SIGNALS` or `NOT_OWED` changes.**
 */
export const ELIGIBLE_EDGE_VERSION = "ee-v1-2026-08-26";
