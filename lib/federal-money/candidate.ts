import { sha256 } from "../civic-data/candidate-builders.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../civic-data/types.ts";
import { FEDERAL_MONEY_PARSER, federalMoneyScope, type FederalMoneyPage, type FederalMoneyProjection, type FederalMoneySource, type FederalMoneyCursor } from "./model.ts";
import { FEDERAL_MONEY_CONFIG } from "./sources.ts";

export interface FederalMoneyStateProgress {
  readonly state: string;
  readonly status: "COMPLETE" | "BACKFILL" | "OUTAGE";
  readonly counts: FederalMoneyProjection["counts"];
  readonly cursor: FederalMoneyCursor | null;
  readonly lastCompleteAt: string | null;
  readonly reason: string | null;
}
export interface FederalMoneyNationalProjection {
  readonly formatVersion: 1; readonly source: FederalMoneySource; readonly state: "US";
  readonly states: readonly FederalMoneyStateProgress[];
  readonly counts: FederalMoneyProjection["counts"];
}
export function federalMoneyCounts(records: FederalMoneyProjection["records"]): FederalMoneyProjection["counts"] {
  const joined = records.filter(row => row.joinStatus === "JOINED").length;
  return { loaded: records.length, joined, unjoined: records.length - joined };
}
export function mergeFederalMoneyRecords(prior: FederalMoneyProjection["records"], incoming: FederalMoneyProjection["records"]) {
  const records = new Map(prior.map(row => [row.id, row]));
  for (const row of incoming) records.set(row.id, row);
  return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function federalMoneyCandidate(input: {
  readonly projection: FederalMoneyProjection | FederalMoneyNationalProjection;
  readonly page: FederalMoneyPage;
  readonly now: string;
  readonly predecessorVersionId?: string | null;
}): RoutineCandidate {
  const { projection, page, now } = input;
  const source = projection.source, scope = federalMoneyScope(source, projection.state);
  const readModelHash = sha256(canonicalCivicDataJson(projection));
  const normalizedPayload = { captures: page.captures, predecessorVersionId: input.predecessorVersionId ?? null, incomingIds: page.facts.map(row => row.id), readModelHash };
  const rawHash = sha256(page.captures.map(row => sha256(row.body)).join("\n"));
  const route = FEDERAL_MONEY_CONFIG[source].route;
  // The checkpoint is a real civic metadata member, distinct from the fact
  // inventory. It lets an asynchronous first page retain its continuation
  // without treating zero facts as evidence of absence.
  const records = "records" in projection
    ? [...projection.records, ...(projection.checkpoint ? [{ state: projection.state }] : [])]
    : projection.states;
  const identifiers = records.map(row => ({ subjectId: "id" in row ? row.id : `state:${row.state}`, jurisdiction: `US-${row.state}`,
    identifiers: { source_record_id: "sourceId" in row ? row.sourceId : row.state }, matchBasis: "OFFICIAL_ID" as const, ambiguous: false }));
  // The snapshot's observation clock orders refreshes. Publication dates stay
  // on individual source facts, including historical backfill and corrections.
  const sourceThrough = now;
  return {
    id: `cv-${sha256(`${source}:${scope}:${readModelHash}:${rawHash}:${now}`).slice(0, 32)}`,
    sourceId: source, recordClass: "FEDERAL_MONEY", scope,
    retrieval: { succeeded: true, requestedUrl: route, finalUrl: route, httpStatus: 200, retrievedAt: now, rawHash },
    normalization: { succeeded: true, parserVersion: FEDERAL_MONEY_PARSER, schemaVersion: "federal-money/1",
      normalizedHash: readModelHash, normalizedPayloadHash: sha256(canonicalCivicDataJson(normalizedPayload)),
      inputRecords: records.length, outputRecords: records.length, droppedRecords: 0, missingRequiredFields: [] },
    identities: identifiers,
    temporal: { version: now, expectedVersion: now, sourceThrough, staleAtRetrieval: false },
    semantics: { factKind: "Source-native federal records and acquisition progress, with exact recipient bindings and geographic reach kept separate", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: `${source} source-native pages for ${projection.state}`, returnedRecords: records.length,
      declaredTotal: null, paginationComplete: page.complete, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    sourceProjectionEvidence: sourceProjectionEvidence(source, "FEDERAL_MONEY", scope),
    dependentChecks: [{ consumer: "federal government and district cards and Ask", passed: projection.counts.loaded === projection.counts.joined + projection.counts.unjoined,
      detail: `${projection.counts.loaded} rows retained; ${projection.counts.joined} joined and ${projection.counts.unjoined} unjoined.` }],
    normalizedPayload, readModel: projection,
  };
}
