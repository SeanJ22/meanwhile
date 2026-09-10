/**
 * **THE PROJECTION LAYER: A CARD ASKS THE CORPUS ABOUT A CANDIDACY.**
 * (Session C3, 2026-09-01. RULING 229, RULING 224, RULING 126.)
 *
 * ## The measured defect
 *
 * `app/ballot/page.tsx` keys a certified-lineup nominee's card
 * `${contestId}|${nomineeName}` and called `stateMoneyForTarget` with it. The
 * state campaign-money snapshot keys its records to canonical CANDIDACY ids. So
 * Katie Hobbs' card asked for `ballot-az-pima:governor|Katie Hobbs`, the
 * snapshot held `ballot-az-pima:governor:hobbs-katie` carrying a reconciled
 * FILED $11,109,719.95, and the card rendered *"We don't hold a campaign finance
 * filing for this person"* — a sentence about US that was FALSE about us.
 *
 * Measured on rendered DOM against a local production build of 9703dc9d,
 * 2026-09-01: **85701, 4 money states across 22 non-federal cards; 85641, 4
 * across 25.**
 *
 * ## What this file does, and the one thing it must never do
 *
 * It resolves the card key through the PRECOMPUTED bridge in
 * `data/states/az/identity/az-2026-certified-lineup-reconciliation.json` and asks the
 * corpus with the RECONCILED CANDIDACY ID. **It performs no name matching.**
 * The matching happened once, in `pnpm identity:az`, over the whole lineup
 * population, and its result is committed for a person to read. A runtime name
 * join here is the prohibited thing: this project has already watched one turn
 * five live committees into manufactured absences, and the failure in the other
 * direction puts one candidate's fundraising under their opponent's photograph.
 *
 * ## And nothing silently renders no money state (RULING 224)
 *
 * A certified nominee the bridge could not resolve does NOT fall back to the
 * card's generic *"We don't hold a campaign finance filing for this person"*,
 * which is what a candidate nobody ever looked for renders. It renders the
 * OURS-gap state — one sentence about what WE have not settled, the agency's own
 * next filing deadline, and the reader's route to look for themselves. No
 * figure, no committee name, no hedge over a number.
 */

import {
  lineupBridgeCovers,
  lineupRowForCard,
  azLineupReconciliation,
  azIdentityRegistry,
} from "../identity/az-2026.ts";
import type { LineupReconciliationRow } from "../identity/types.ts";
import { stateMoneyForTarget } from "./state-snapshot.ts";
import type { StateMoneyRecord } from "./state-money.ts";

/** How a card's money was resolved. Reported by the tests, never by a reader surface. */
export type MoneyResolution =
  /** The canonical contest assigns this question to the federal finance system. */
  | "FEDERAL_NOT_APPLICABLE"
  /** The key was already a canonical candidacy id — the pre-existing path. */
  | "DIRECT_CANDIDACY_KEY"
  /** A certified-lineup nominee card, resolved through the committed bridge. */
  | "RECONCILED_NOMINEE"
  /** A certified-lineup nominee the bridge could not resolve. Renders OURS gap. */
  | "UNRECONCILED_NOMINEE"
  /**
   * Reconciled, and the finance corpus holds no record for that candidacy.
   * Also an OURS gap: the corpus was read and we have not resolved a filing.
   */
  | "RECONCILED_NO_CORPUS_RECORD";

export interface CardMoney {
  records: StateMoneyRecord[];
  resolution: MoneyResolution;
  /** The key actually handed to `stateMoneyForTarget`, for a test to assert on. */
  resolvedTargetKey: string | null;
}

const AZ_AGENCY_FALLBACK = "Arizona Secretary of State — See The Money";

interface FinanceAuthority {
  agency: string;
  filingsUrl: string;
  snapshotCollectedAt: string;
}

function financeAuthority(): FinanceAuthority {
  const bridge = azLineupReconciliation() as
    | ({ financeAuthority?: FinanceAuthority } & { generatedAt: string })
    | null;
  return (
    bridge?.financeAuthority ?? {
      agency: AZ_AGENCY_FALLBACK,
      filingsUrl: "https://seethemoney.az.gov/",
      /* A read stamp is never invented. With no artifact there is no read to
         stamp, so the generator's own date is used and the record carries the
         empty office rather than a plausible date nobody took. */
      snapshotCollectedAt: bridge?.generatedAt ?? "",
    }
  );
}

/**
 * The OURS-gap record a certified nominee renders when identity is unresolved.
 *
 * Constructed here rather than written into the finance snapshot deliberately:
 * it is a fact about the IDENTITY layer, and putting it in the money corpus
 * would make the corpus assert something about a candidacy it never observed.
 */
export function unresolvedNomineeGapRecord(
  row: LineupReconciliationRow,
  whatIsMissing: string,
): StateMoneyRecord {
  const authority = financeAuthority();
  const bridge = azLineupReconciliation();
  const nextDue = bridge?.agencyNextFilingDue ?? null;
  return {
    dataClass: "STATE_COMMITTEE",
    jurisdiction: "AZ",
    agency: authority.agency,
    filingsUrl: authority.filingsUrl,
    committeeId: null,
    registeredName: "",
    candidateNameAsFiled: row.nomineeName,
    officeSought: null,
    electionYear: bridge?.cycle ?? 2026,
    filingState: "OURS_GAP",
    totals: {
      receipts: null,
      expenditures: null,
      cashOnHand: null,
      reportCount: null,
      coveringPeriod: null,
    },
    targetKeys: [row.cardKey],
    match: {
      registeredName: "",
      officeAsFiled: null,
      officeOnBallot: null,
      electionYearAsFiled: null,
      electionYearOnBallot: bridge?.cycle ?? 2026,
      allThreeAgree: false,
      note: `OURS GAP — ${whatIsMissing}`,
    },
    /* The date the AGENCY was asked, carried from the corpus that asked it. A
       date this file invented would make the reader's attribution line false. */
    checkedAt: authority.snapshotCollectedAt,
    provenance: {
      sourceUrl: authority.filingsUrl,
      sourceOrg: authority.agency,
      collectedAt: authority.snapshotCollectedAt,
      verifiedAt: authority.snapshotCollectedAt,
    },
    ourGap: {
      whatIsMissing,
      nextDue: nextDue?.filingPeriodEndDate ?? null,
      nextDueName: nextDue?.reportName ?? null,
    },
  };
}

/**
 * The state-money records ONE ballot card renders.
 *
 * `cardKey` is whatever the ballot page keys that card on. A canonical candidacy
 * id passes straight through, which is what every non-lineup contest and every
 * other state does. A certified-lineup nominee key is resolved through the
 * committed bridge FIRST, and only the resolved candidacy id ever reaches
 * `stateMoneyForTarget`.
 */
export function stateMoneyForCard(cardKey: string, contestId: string): CardMoney {
  // Arizona's certified-lineup bridge has no authority over another state's
  // candidacy. Select the state/contest before opening that independent
  // identity holding so an AZ outage cannot erase an NH or NJ finance answer.
  if (!contestId.startsWith("ballot-az-")) {
    return {
      records: stateMoneyForTarget(cardKey),
      resolution: "DIRECT_CANDIDACY_KEY",
      resolvedTargetKey: cardKey,
    };
  }
  // Certified Arizona card keys require the committed identity projection.
  // Its absence is a failed holding read, never an invitation to ask the
  // finance corpus with a display-name key and manufacture a no-record answer.
  // Direct candidacy keys and other states do not depend on this bridge.
  if (contestId.startsWith("ballot-az-") && cardKey.includes("|") && !azLineupReconciliation()) {
    throw new Error("Canonical Arizona candidacy identity holding unavailable");
  }
  if (!lineupBridgeCovers(contestId)) {
    return {
      records: stateMoneyForTarget(cardKey),
      resolution: "DIRECT_CANDIDACY_KEY",
      resolvedTargetKey: cardKey,
    };
  }

  const registry = azIdentityRegistry();
  if (!registry) throw new Error("Canonical Arizona contest identity holding unavailable");
  const contest = registry.contests.find(c => c.canonicalContestIds.includes(contestId));
  if (contest?.level === "FEDERAL") return {
    records: [], resolution: "FEDERAL_NOT_APPLICABLE",
    resolvedTargetKey: lineupRowForCard(cardKey)?.canonicalCandidacyId ?? null,
  };

  const row = lineupRowForCard(cardKey);
  if (!row) {
    /* The bridge speaks for this contest and not for this card: a nominee the
       lineup does not carry, or a key built some other way. It is treated as a
       direct key rather than as a gap, because inventing a gap sentence about a
       card the identity layer never saw would be a claim we cannot support. */
    return {
      records: stateMoneyForTarget(cardKey),
      resolution: "DIRECT_CANDIDACY_KEY",
      resolvedTargetKey: cardKey,
    };
  }

  if (row.outcome !== "RECONCILED" || !row.canonicalCandidacyId) {
    return {
      records: [
        unresolvedNomineeGapRecord(
          row,
          row.readerGapSentence ??
            "We have not established which of the Secretary of State's filed candidacies this nominee is.",
        ),
      ],
      resolution: "UNRECONCILED_NOMINEE",
      resolvedTargetKey: null,
    };
  }

  const records = stateMoneyForTarget(row.canonicalCandidacyId);
  if (records.length > 0) {
    return {
      records,
      resolution: "RECONCILED_NOMINEE",
      resolvedTargetKey: row.canonicalCandidacyId,
    };
  }

  /*
   * RECONCILED, AND THE CORPUS HOLDS NOTHING FOR THAT CANDIDACY.
   *
   * The identity is settled and the money is not, which is OUR gap and not the
   * agency's — so it renders as one rather than as silence. Falling through to
   * an empty array here would put the card back on the generic line, which is
   * the exact sentence this file was written to stop.
   */
  return {
    records: [
      unresolvedNomineeGapRecord(
        row,
        "We have matched this nominee to their filed candidacy and have not yet resolved a campaign finance filing for it.",
      ),
    ],
    resolution: "RECONCILED_NO_CORPUS_RECORD",
    resolvedTargetKey: row.canonicalCandidacyId,
  };
}
