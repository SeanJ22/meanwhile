import { sha256 } from "../civic-data/candidate-builders.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../civic-data/types.ts";
import { FEDERAL_MONEY_PARSER, federalMoneyScope, federalMoneyPartitionScope, type FederalMoneyPage, type FederalMoneyProjection, type FederalMoneySource, type FederalMoneyCursor, type FederalMoneyCheckpoint, type FederalMoneyCapture, type FederalMoneyCounts } from "./model.ts";
import { FEDERAL_MONEY_CONFIG } from "./sources.ts";

export interface FederalMoneyStateProgress {
  readonly state: string;
  readonly status: "COMPLETE" | "BACKFILL" | "OUTAGE";
  readonly counts: FederalMoneyCounts;
  readonly cursor: FederalMoneyCursor | null;
  readonly lastCompleteAt: string | null;
  readonly reason: string | null;
}
export interface FederalMoneyNationalProjection {
  readonly formatVersion: 2; readonly source: FederalMoneySource; readonly state: "US";
  readonly states: readonly FederalMoneyStateProgress[];
  readonly counts: FederalMoneyCounts;
}
export interface FederalMoneyEvidence {
  readonly captures: readonly FederalMoneyCapture[];
  readonly predecessorVersionId: string | null;
  readonly incomingIds: readonly string[];
  readonly readModelHash: string;
}
export function federalMoneyCounts(records: FederalMoneyProjection["records"]): FederalMoneyCounts {
  const joined = records.reduce((n, row) => n + Number(row.joinStatus === "JOINED"), 0);
  return { loaded: records.length, joined, unjoined: records.length - joined };
}
export function mergeFederalMoneyRecords(prior: FederalMoneyProjection["records"], incoming: FederalMoneyProjection["records"]) {
  const records = new Map(prior.map(row => [row.id, row]));
  for (const row of incoming) records.set(row.id, row);
  return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function federalMoneyCandidate(input: {
  readonly projection: FederalMoneyProjection | FederalMoneyCheckpoint | FederalMoneyNationalProjection;
  readonly page: FederalMoneyPage;
  readonly now: string;
  readonly predecessorVersionId?: string | null;
  readonly retainedCaptures?: readonly FederalMoneyCapture[];
}): RoutineCandidate {
  const { projection, page, now } = input;
  const source = projection.source;
  const scope = "partition" in projection ? federalMoneyPartitionScope(source, projection.state, projection.partition) : federalMoneyScope(source, projection.state);
  const readModelHash = sha256(canonicalCivicDataJson(projection));
  const hashes = new Set("records" in projection ? projection.records.map(row => row.provenance.rawHash) : []);
  const captures = [...new Map([...input.retainedCaptures ?? [], ...page.captures].filter(row => hashes.has(row.rawHash)).map(row => [row.rawHash, row])).values()];
  const normalizedPayload: FederalMoneyEvidence = { captures, predecessorVersionId: input.predecessorVersionId ?? null,
    incomingIds: page.facts.map(row => row.id), readModelHash };
  const rawHash = sha256(captures.map(row => row.rawHash).join("\n"));
  const route = FEDERAL_MONEY_CONFIG[source].route;
  const records = "records" in projection ? [...projection.records, { state: projection.state }]
    : "states" in projection ? projection.states : [{ state: projection.state }];
  const identifiers = records.map(row => ({ subjectId: "id" in row ? row.id : `state:${row.state}`, jurisdiction: `US-${row.state}`,
    identifiers: { source_record_id: "sourceId" in row ? row.sourceId : row.state }, matchBasis: "OFFICIAL_ID" as const, ambiguous: false }));
  return {
    id: `cv-${sha256(`${source}:${scope}:${readModelHash}:${rawHash}:${now}`).slice(0, 32)}`,
    sourceId: source, recordClass: "FEDERAL_MONEY", scope,
    retrieval: { succeeded: true, requestedUrl: route, finalUrl: route, httpStatus: 200, retrievedAt: now, rawHash },
    normalization: { succeeded: true, parserVersion: FEDERAL_MONEY_PARSER, schemaVersion: FEDERAL_MONEY_PARSER,
      normalizedHash: readModelHash, normalizedPayloadHash: sha256(canonicalCivicDataJson(normalizedPayload)),
      inputRecords: records.length, outputRecords: records.length, droppedRecords: 0, missingRequiredFields: [] },
    identities: identifiers,
    temporal: { version: now, expectedVersion: now, sourceThrough: now, staleAtRetrieval: false },
    semantics: { factKind: "Source-native federal records with exact recipient bindings and geographic reach", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: scope, returnedRecords: records.length,
      declaredTotal: null, paginationComplete: page.complete, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    sourceProjectionEvidence: sourceProjectionEvidence(source, "FEDERAL_MONEY", scope),
    dependentChecks: [{ consumer: "federal government and district cards and Ask", passed: projection.counts.loaded === projection.counts.joined + projection.counts.unjoined,
      detail: `${projection.counts.loaded} rows retained; ${projection.counts.joined} joined and ${projection.counts.unjoined} unjoined.` }],
    normalizedPayload, readModel: projection,
  };
}
