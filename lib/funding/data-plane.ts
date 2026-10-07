import type {
  CivicRecordMember,
  IdentityEvidence,
  RoutineCandidate,
} from "../civic-data/types.ts";
import { sourceProjectionEvidence } from "../civic-data/types.ts";
import { normalizedHash, sha256 } from "../civic-data/candidate-builders.ts";
import type { StateMoneyRecord, StateMoneySnapshot } from "./state-money.ts";
import type {
  AzPimaHeld,
  AzPimaTransactions,
} from "../control-plane/campaign-finance/held-records.ts";

export const STATE_CAMPAIGN_FINANCE_SOURCES = {
  AZ: {
    contractId: "az-sos-campaign-finance",
    sourceId: "az-sos-campaign-finance",
    scope: "US-AZ:campaign-finance:2026",
    parserVersion: "az-campaign-finance/2",
  },
  NH: {
    contractId: "nh-sos-campaign-finance",
    sourceId: "nh-sos-campaign-finance",
    scope: "US-NH:campaign-finance:2026",
    parserVersion: "nh-campaign-finance/2",
  },
  NJ: {
    contractId: "nj-elec-campaign-finance",
    sourceId: "nj-elec-campaign-finance",
    scope: "US-NJ:campaign-finance:2026",
    parserVersion: "nj-campaign-finance/2",
  },
} as const;

export type StateCampaignFinanceJurisdiction = keyof typeof STATE_CAMPAIGN_FINANCE_SOURCES;

export const PIMA_LOCAL_FINANCE_CONTRACT = {
  contractId: "az-pima-local-finance",
  sourceId: "az-pima-local-finance",
  scope: "US-AZ:county:pima:campaign-finance:2026",
  parserVersion: "pima-campaign-finance/2",
} as const;

export interface AzPimaFinanceReadModel {
  readonly formatVersion: 1;
  readonly held: AzPimaHeld;
  readonly transactions: AzPimaTransactions;
}

function canonicalRawHash(rawBodies: readonly string[]): string {
  return sha256(rawBodies.map((body) => sha256(body)).join("\n"));
}

function stateRecordKey(record: StateMoneyRecord, index: number): string {
  const identity = record.committeeId || record.targetKeys.slice().sort().join("+") || `unresolved-${index}`;
  return `state-money:${record.jurisdiction}:${record.electionYear}:${identity}:${record.filingState}`;
}

export function stateCampaignFinanceMembers(snapshot: StateMoneySnapshot): readonly CivicRecordMember[] {
  return snapshot.records
    .map((record, index) => ({ key: stateRecordKey(record, index), record }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function stateIdentities(snapshot: StateMoneySnapshot): readonly IdentityEvidence[] {
  return snapshot.records.map((record, index) => {
    const exactTarget = record.targetKeys.slice().sort().join("+");
    const subjectId = record.committeeId || exactTarget || stateRecordKey(record, index);
    const identifiers: Readonly<Record<string, string>> = record.committeeId
      ? { committee_id: record.committeeId }
      : { candidacy_id: exactTarget || subjectId };
    return {
      subjectId,
      jurisdiction: `US-${record.jurisdiction}`,
      identifiers,
      matchBasis: record.committeeId ? "OFFICIAL_ID" : "EXACT_SCOPED_ID",
      ambiguous: false,
      office: record.officeSought ?? undefined,
      term: String(record.electionYear),
    };
  });
}

function stateViolations(snapshot: StateMoneySnapshot, jurisdiction: StateCampaignFinanceJurisdiction): string[] {
  const violations: string[] = [];
  if (snapshot.formatVersion !== 1) violations.push("State campaign-finance projection has the wrong format version.");
  if (snapshot.cycle !== 2026) violations.push(`State campaign-finance projection carries cycle ${snapshot.cycle}, not 2026.`);
  if (snapshot.records.length === 0) violations.push("State campaign-finance projection contains no normalized records.");
  if (snapshot.records.some((record) => record.jurisdiction !== jurisdiction)) {
    violations.push(`A state campaign-finance row crosses the ${jurisdiction} authority scope.`);
  }
  if (snapshot.records.some((record) => !record.checkedAt || !record.provenance?.sourceUrl || !record.provenance?.sourceOrg)) {
    violations.push("A state campaign-finance row lacks its official read stamp or provenance.");
  }
  if (snapshot.records.some((record) => record.filingState === "LEAD" && record.targetKeys.length > 0)) {
    violations.push("A name-only campaign-finance lead is bound to a Reader candidacy.");
  }
  if (snapshot.records.some((record) => record.filingState !== "FILED" && [record.totals.receipts, record.totals.expenditures, record.totals.cashOnHand].some((value) => value !== null))) {
    violations.push("A non-filed campaign-finance state carries dollar totals.");
  }
  const members = stateCampaignFinanceMembers(snapshot);
  if (new Set(members.map((member) => member.key)).size !== members.length) {
    violations.push("State campaign-finance records do not have unique stable identities.");
  }
  return violations;
}

/** Deterministic candidate for one official state filing authority. */
export function stateCampaignFinanceCandidate(input: {
  readonly jurisdiction: StateCampaignFinanceJurisdiction;
  readonly snapshot: StateMoneySnapshot;
  readonly rawBodies: readonly string[];
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
  readonly query: string;
  readonly paginationComplete: boolean;
  readonly declaredTotal?: number | null;
  readonly excludedFacts?: RoutineCandidate["excludedFacts"];
}): RoutineCandidate {
  const contract = STATE_CAMPAIGN_FINANCE_SOURCES[input.jurisdiction];
  const rawHash = canonicalRawHash(input.rawBodies);
  const members = stateCampaignFinanceMembers(input.snapshot);
  const violations = stateViolations(input.snapshot, input.jurisdiction);
  const claimsAbsence = input.snapshot.records.some((record) => record.filingState === "NO_REPORTS_ON_FILE");
  return {
    id: `cv-${sha256(`${contract.sourceId}\u001f${contract.scope}\u001f${rawHash}\u001f${input.retrievedAt}`).slice(0, 32)}`,
    sourceId: contract.sourceId,
    recordClass: "STATE_CAMPAIGN_FINANCE",
    scope: contract.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(contract.sourceId, "STATE_CAMPAIGN_FINANCE", contract.scope),
    retrieval: {
      succeeded: input.rawBodies.length > 0,
      requestedUrl: input.requestedUrl,
      finalUrl: input.finalUrl,
      httpStatus: input.rawBodies.length > 0 ? 200 : null,
      retrievedAt: input.retrievedAt,
      rawHash: input.rawBodies.length > 0 ? rawHash : null,
      failureDetail: input.rawBodies.length > 0 ? undefined : "No official campaign-finance response bytes were acquired.",
    },
    normalization: {
      succeeded: violations.length === 0,
      parserVersion: contract.parserVersion,
      schemaVersion: "state-money/1",
      normalizedHash: normalizedHash(input.snapshot),
      normalizedPayloadHash: normalizedHash(input.snapshot),
      inputRecords: input.snapshot.records.length,
      outputRecords: input.snapshot.records.length,
      droppedRecords: 0,
      missingRequiredFields: [],
      failureDetail: violations.length > 0 ? violations.join("; ") : undefined,
    },
    identities: stateIdentities(input.snapshot),
    temporal: {
      version: String(input.snapshot.cycle),
      expectedVersion: "2026",
      sourceThrough: input.snapshot.collectedAt,
      staleAtRetrieval: false,
    },
    semantics: { factKind: "official state campaign-finance filing projection", violations },
    horizon: {
      kind: "BOUNDED",
      query: input.query,
      returnedRecords: input.snapshot.records.length,
      declaredTotal: input.declaredTotal ?? null,
      paginationComplete: input.paginationComplete,
      // The projection is candidacy-scoped; it never claims to be every filing in the state.
      claimsComplete: false,
    },
    absence: claimsAbsence
      ? {
          claimsAbsence: true,
          basis: "BOUNDED_AUTHORITATIVE_QUERY",
          exactSubject: `${input.jurisdiction} 2026 candidacies named in the projection`,
          exactHorizon: input.query,
        }
      : { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      {
        consumer: "lib/funding/state-snapshot.ts",
        passed: input.snapshot.records.every((record) => Array.isArray(record.targetKeys)),
        detail: `${input.snapshot.records.length} normalized rows retain exact candidacy bindings and explicit filing states.`,
      },
      {
        consumer: "ballot, map, funding API, and Ask",
        passed: violations.length === 0,
        detail: "The shared state-money projection validates before it can replace LKG.",
      },
    ],
    normalizedPayload: input.snapshot,
    readModel: input.snapshot,
    civicRecords: members,
    excludedFacts: input.excludedFacts ?? [],
  };
}

function pimaMembers(value: AzPimaFinanceReadModel): readonly CivicRecordMember[] {
  const members: CivicRecordMember[] = [];
  for (const row of value.held.committeeRegisterCountyPortal) {
    members.push({ key: `committee:${row.portalFilerId}`, record: row });
  }
  for (const row of value.held.filingsIndexed) {
    members.push({ key: `filing:${row.filingId}`, record: row });
  }
  value.transactions.contributions.forEach((row, index) => {
    members.push({
      key: `contribution:${row.DocumentFilingId}:${index}`,
      record: row,
    });
  });
  value.transactions.distributions.forEach((row, index) => {
    members.push({
      key: `distribution:${row.DocumentFilingId}:${index}`,
      record: row,
    });
  });
  return members.sort((a, b) => a.key.localeCompare(b.key));
}

/** Candidate for a county's public filing index plus public redacted transactions. */
export function pimaCampaignFinanceCandidate(input: {
  readonly held: AzPimaHeld;
  readonly transactions: AzPimaTransactions;
  readonly rawBodies: readonly string[];
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly retrievedAt: string;
}): RoutineCandidate {
  const readModel: AzPimaFinanceReadModel = { formatVersion: 1, held: input.held, transactions: input.transactions };
  const members = pimaMembers(readModel);
  const violations: string[] = [];
  if (input.held.formatVersion !== 1 || input.transactions.formatVersion !== 1) violations.push("Pima projection format version is invalid.");
  if (input.held.committeeRegisterCountyPortal.length === 0) violations.push("The official Pima filer register is empty.");
  if (input.transactions.contributions.length === 0 || input.transactions.distributions.length === 0) {
    violations.push("A public Pima transaction class is empty and cannot establish an empty filing universe.");
  }
  if (input.transactions.reconciliation.capSuspected) violations.push("The Pima transaction result may be capped.");
  if (new Set(members.map((member) => member.key)).size !== members.length) violations.push("Pima filing members do not have unique stable identities.");
  const rawHash = canonicalRawHash(input.rawBodies);
  const identities: IdentityEvidence[] = [
    ...input.held.committeeRegisterCountyPortal.map((row) => ({
      subjectId: `easyvote:pima:${row.portalFilerId}`,
      jurisdiction: "US-AZ",
      identifiers: { portal_filer_id: row.portalFilerId },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
    })),
    ...[...new Set([
      ...input.transactions.contributions.map((row) => row.DocumentFilingId),
      ...input.transactions.distributions.map((row) => row.DocumentFilingId),
    ])].map((filingId) => ({
      subjectId: `easyvote:pima:filing:${filingId}`,
      jurisdiction: "US-AZ",
      identifiers: { filing_id: filingId },
      matchBasis: "OFFICIAL_ID" as const,
      ambiguous: false,
    })),
  ];
  return {
    id: `cv-${sha256(`${PIMA_LOCAL_FINANCE_CONTRACT.sourceId}\u001f${PIMA_LOCAL_FINANCE_CONTRACT.scope}\u001f${rawHash}\u001f${input.retrievedAt}`).slice(0, 32)}`,
    sourceId: PIMA_LOCAL_FINANCE_CONTRACT.sourceId,
    recordClass: "LOCAL_CAMPAIGN_FINANCE",
    scope: PIMA_LOCAL_FINANCE_CONTRACT.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(
      PIMA_LOCAL_FINANCE_CONTRACT.sourceId,
      "LOCAL_CAMPAIGN_FINANCE",
      PIMA_LOCAL_FINANCE_CONTRACT.scope,
    ),
    retrieval: {
      succeeded: input.rawBodies.length >= 3,
      requestedUrl: input.requestedUrl,
      finalUrl: input.finalUrl,
      httpStatus: input.rawBodies.length >= 3 ? 200 : null,
      retrievedAt: input.retrievedAt,
      rawHash: input.rawBodies.length >= 3 ? rawHash : null,
      failureDetail: input.rawBodies.length >= 3 ? undefined : "The Pima filer register and both transaction classes were not all acquired.",
    },
    normalization: {
      succeeded: violations.length === 0,
      parserVersion: PIMA_LOCAL_FINANCE_CONTRACT.parserVersion,
      schemaVersion: "pima-finance/1",
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(readModel),
      inputRecords: members.length,
      outputRecords: members.length,
      droppedRecords: 0,
      missingRequiredFields: [],
      failureDetail: violations.length ? violations.join("; ") : undefined,
    },
    identities,
    temporal: { version: "2026", expectedVersion: "2026", sourceThrough: input.retrievedAt, staleAtRetrieval: false },
    semantics: { factKind: "official Pima County campaign-finance filing records", violations },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "Pima County public filer index and redacted contribution/distribution search",
      returnedRecords: members.length,
      declaredTotal: null,
      paginationComplete: !input.transactions.reconciliation.capSuspected,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/control-plane/campaign-finance/held-records.ts", passed: violations.length === 0, detail: "The promoted payload contains the filing index and both transaction classes." },
      { consumer: "lib/ask/local-finance.ts", passed: input.held.filingAuthorityIdentification.officeNameAsPublished.length > 0, detail: "Ask receives the filing authority and exact filed rows from one projection." },
    ],
    normalizedPayload: readModel,
    readModel,
    civicRecords: members,
    excludedFacts: input.held.notHeld.map((detail, index) => ({ key: `not-held:${index}`, code: "OFFICIAL_FACT_NOT_HELD", detail })),
  };
}
