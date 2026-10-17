
import {
  lineupBridgeCovers,
  lineupRowForCard,
  azLineupReconciliation,
  azContestIdentity,
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
      snapshotCollectedAt: bridge?.generatedAt ?? "",
    }
  );
}

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

export function stateMoneyForCard(cardKey: string, contestId: string): CardMoney {
  // The Arizona bridge has no authority over another state's candidacy, so an
  // Arizona outage cannot erase another state's finance answer.
  if (!contestId.startsWith("ballot-az-") || !cardKey.includes("|")) {
    return {
      records: stateMoneyForTarget(cardKey),
      resolution: "DIRECT_CANDIDACY_KEY",
      resolvedTargetKey: cardKey,
    };
  }
  // A certified Arizona card key without the identity projection is a failed
  // read, never a name-keyed corpus lookup.
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

  const contest = azContestIdentity(contestId);
  if (!contest) throw new Error("Canonical Arizona contest identity holding unavailable");
  if (contest?.level === "FEDERAL") return {
    records: [], resolution: "FEDERAL_NOT_APPLICABLE",
    resolvedTargetKey: lineupRowForCard(cardKey)?.canonicalCandidacyId ?? null,
  };

  const row = lineupRowForCard(cardKey);
  if (!row) {
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
