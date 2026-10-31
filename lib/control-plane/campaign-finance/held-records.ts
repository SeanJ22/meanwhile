/**
 * Held campaign-finance records, in the model's own types.
 *
 * FEC `totals` are the FEC's own sum across reports, not a filing, so they are
 * materialised as `AuthorityAggregate` with their `EvidenceBasis`.
 * `FundingCandidate.topContributions` are the TOP itemized receipts, not every
 * itemized receipt; universes built from them carry an `itemizationLimit`.
 *
 * Nothing here reads a clock.
 */

import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import {
  PIMA_LOCAL_FINANCE_CONTRACT,
  type AzPimaFinanceReadModel,
} from "../../funding/data-plane.ts";

export interface AzPimaFilingIndexRow {
  readonly portalFilerId: string;
  readonly committeeRegisteredName: string;
  readonly filingId: string;
  readonly documentName: string;
  readonly documentType: string;
  readonly dateSubmitted: string;
  /** The index is public; the bodies may not be. */
  readonly documentBodyHeld: boolean;
  readonly documentBodyWall: string;
}

export interface AzPimaCommitteeRow {
  readonly portalFilerId: string;
  readonly registeredName: string;
  readonly filerType: string;
  readonly status: string;
  readonly officeName: string | null;
  readonly filingCount: number;
  readonly source: string;
}

export interface AzPimaHeld {
  readonly formatVersion: number;
  readonly recordedOn: string;
  readonly filingAuthorityIdentification: {
    readonly authorityId: string;
    readonly officeNameAsPublished: string;
    readonly readFrom: string;
    readonly readOn: string;
    readonly whatThisEstablishesAndWhatItDoesNot: string;
  };
  readonly committeeRegisterCountyPortal: readonly AzPimaCommitteeRow[];
  readonly committeeRegisterStateFtp: readonly Record<string, string | null>[];
  readonly filingsIndexed: readonly AzPimaFilingIndexRow[];
  readonly expectedFilingPeriodsAz2026PacParty: readonly Record<string, string>[];
  readonly acquisitions: readonly Record<string, unknown>[];
  readonly notHeld: readonly string[];
}

function validatePimaProjection(value: AzPimaFinanceReadModel, version: string): void {
  if (
    value.formatVersion !== 1 ||
    value.held?.formatVersion !== 1 ||
    value.transactions?.formatVersion !== 1 ||
    !Array.isArray(value.held.committeeRegisterCountyPortal) ||
    !Array.isArray(value.held.filingsIndexed) ||
    !Array.isArray(value.transactions.contributions) ||
    !Array.isArray(value.transactions.distributions)
  ) {
    throw new Error(`Pima campaign-finance projection ${version} does not satisfy its Reader contract.`);
  }
}

/** Canonical local-finance preload. */
export async function refreshAzPimaFinanceFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  const result = await readPromotedCivicData<AzPimaFinanceReadModel>(
    "LOCAL_CAMPAIGN_FINANCE",
    PIMA_LOCAL_FINANCE_CONTRACT.scope,
    options,
  );
  if (result.kind === "PROMOTED") {
    if (result.metadata.sourceId !== PIMA_LOCAL_FINANCE_CONTRACT.sourceId) {
      throw new Error(`Pima campaign-finance pointer names ${result.metadata.sourceId}, not ${PIMA_LOCAL_FINANCE_CONTRACT.sourceId}.`);
    }
    validatePimaProjection(result.value, result.metadata.versionId ?? "unknown");
    return result.metadata.versionId;
  }
  throw new Error(result.detail);
}

export interface AzPimaContributionRow {
  readonly DocumentFilingId: string;
  readonly DocumentType: string;
  readonly ItemizedListType: string;
  readonly RecipientCommitteeName: string | null;
  readonly OfficeName: string | null;
  readonly ContributorFullName: string | null;
  /** Individual contributors are usually filed as name parts with `ContributorFullName` null. */
  readonly ContributorFirstName: string | null;
  readonly ContributorMiddleName: string | null;
  readonly ContributorLastName: string | null;
  readonly ContributorOrganizationName: string | null;
  readonly ContributionDate: string | null;
  readonly ContributionAmount: number | null;
}

export interface AzPimaDistributionRow {
  readonly DocumentFilingId: string;
  readonly DocumentType: string;
  readonly ItemizedListType: string;
  readonly CandidateCommitteeName: string | null;
  readonly OfficeName: string | null;
  readonly PayeeOrganizationName: string | null;
  readonly PayeeFirstName: string | null;
  readonly PayeeLastName: string | null;
  readonly DistributionDate: string | null;
  readonly DistributionAmount: number | null;
}

export interface AzPimaTransactions {
  readonly formatVersion: number;
  readonly recordedOn: string;
  readonly acquisition: Record<string, unknown>;
  readonly reconciliation: {
    readonly capSuspected: boolean;
    readonly verdict: string;
    readonly probes: readonly { readonly year: string; readonly serverRows: number; readonly localRows: number }[];
  };
  readonly limitsOfThisUniverse: readonly string[];
  readonly counts: Record<string, unknown>;
  readonly contributions: readonly AzPimaContributionRow[];
  readonly distributions: readonly AzPimaDistributionRow[];
}

/* ── The federal materialisation ──────────────────────────────────────────── */

