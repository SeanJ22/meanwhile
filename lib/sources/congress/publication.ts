import { normalizedHash, sha256 } from "../../civic-data/candidate-builders.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../../civic-data/types.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { processRegisteredFanOutCandidate } from "../../civic-data/promotion.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { FEDERAL_PARSER_VERSION, FEDERAL_RECORD_CLASS, federalScope, type FederalSourceId } from "./targets.ts";
import { normalizeFederalCaptureWithRoster } from "./normalize.ts";
import type { FederalCapture, FederalCounts, FederalFact, FederalProjection, LdaRoster } from "./types.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { readLdaRosterVersion } from "./lda-roster.ts";

const factHash = ({ checkedAt: _checkedAt, ...fact }: FederalFact) => normalizedHash(fact);
export function federalProjectionIssues(value: FederalProjection): string[] {
  if (!value || value.formatVersion !== 1 || !Array.isArray(value.records)) return ["Federal source projection has an invalid shape."];
  const issues: string[] = [];
  if (new Set(value.records.map(row => row.id)).size !== value.records.length) issues.push("Duplicate source-native row IDs.");
  if (value.records.some(row => !row.id || !row.nativeId || row.source !== value.source || row.official !== true ||
    !row.publisher || !/^https:\/\//.test(row.sourceUrl) || !Number.isFinite(Date.parse(row.checkedAt)) ||
    (row.publishedAt !== null && !Number.isFinite(Date.parse(row.publishedAt))))) issues.push("A fact lacks native identity, official source attribution or valid source dates.");
  if (value.source === "senate-lda" && value.records.some(row => row.bioguideId &&
    (row.honoreeJoin?.status !== "JOINED" || row.state !== row.honoreeJoin.state || !row.honoreeName))) {
    issues.push("An LDA member link lacks its unique honoree/roster join evidence.");
  }
  return issues;
}
export async function readFederalSourceProjection(source: FederalSourceId, partition = "national", options: PromotedCivicDataReadOptions = {}) {
  const result = await readPromotedCivicData<FederalProjection>(FEDERAL_RECORD_CLASS, federalScope(source, partition), options);
  if (result.kind === "PROMOTED" && (result.value.source !== source || federalProjectionIssues(result.value).length)) {
    return { ...result, kind: "STORE_UNREACHABLE" as const, value: null, code: "PROMOTION_PROOF_INVALID" as const, detail: "Federal source projection failed its typed reader contract." };
  }
  return result;
}

export function federalCandidate(input: { source: FederalSourceId; partition: string; projection: FederalProjection; captures: FederalCapture[]; now: string; completePartition?: boolean;
  replaceFilingId?: string; rosters?: ReadonlyMap<string, LdaRoster> }): RoutineCandidate {
  const { source, projection, captures, now } = input, scope = federalScope(source, input.partition);
  const issues = federalProjectionIssues(projection);
  const normalize = (capture: FederalCapture) => normalizeFederalCaptureWithRoster(capture, input.rosters?.get(capture.context?.honoreeRosterVersionId ?? ""));
  if ((input.completePartition || input.replaceFilingId) && source === "senate-lda") {
    const filingId = input.replaceFilingId ?? input.partition.replace(/^filing:/, "");
    const bioguide = input.replaceFilingId ? input.partition.replace(/^congress:/, "") : null;
    const expected = normalize(captures[0]).filter(row => row.filingId === filingId && (!bioguide || row.bioguideId === bioguide)).map(row => `${row.id}|${factHash(row)}`).sort();
    const actual = projection.records.filter(row => !input.replaceFilingId || row.filingId === filingId).map(row => `${row.id}|${factHash(row)}`).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) issues.push("The complete LD-203 partition does not reproduce every item in its native filing UUID.");
  }
  const evidence = new Set(captures.flatMap(normalize).map(row => `${row.id}|${factHash(row)}`));
  for (const row of projection.records) if (!evidence.has(`${row.id}|${factHash(row)}`)) issues.push(`Saved source bytes do not reproduce ${row.id}.`);
  const rawHash = sha256(captures.map(capture => sha256(capture.body)).join("\n"));
  const normalizedPayload = { captures };
  const count = projection.records.length + 2; // The cursor and count entries are part of this projection's existing civic-record set.
  return { id: `cv-${sha256(`${scope}|${rawHash}|${normalizedHash(projection)}|${now}`).slice(0, 32)}`,
    sourceId: source, recordClass: FEDERAL_RECORD_CLASS, scope, sourceProjectionEvidence: sourceProjectionEvidence(source, FEDERAL_RECORD_CLASS, scope),
    retrieval: { succeeded: captures.length > 0, requestedUrl: captures[0]?.url ?? "", finalUrl: captures[0]?.url ?? null, httpStatus: 200,
      retrievedAt: now, rawHash, sourceCheck: { requestedUrl: captures[0]?.url ?? "", finalUrl: captures[0]?.url ?? "", httpStatus: 200, rawHash, checkedAt: now } },
    normalization: { succeeded: !issues.length, parserVersion: FEDERAL_PARSER_VERSION, schemaVersion: "federal-native-facts/1",
      normalizedHash: normalizedHash(projection), normalizedPayloadHash: normalizedHash(normalizedPayload), inputRecords: count,
      outputRecords: count, droppedRecords: 0, missingRequiredFields: [], ...(issues.length ? { failureDetail: issues.join("; ") } : {}) },
    identities: [...projection.records.map(row => ({ subjectId: row.id, jurisdiction: "US", identifiers: { native_id: row.nativeId }, matchBasis: "OFFICIAL_ID" as const, ambiguous: false })),
      ...["cursor", "counts"].map(key => ({ subjectId: `${scope}:${key}`, jurisdiction: "US", identifiers: { native_id: scope }, matchBasis: "EXACT_SCOPED_ID" as const, ambiguous: false }))],
    temporal: { version: now, expectedVersion: now, sourceThrough: now, staleAtRetrieval: false },
    semantics: { factKind: "official federal source-native public records with per-fact publication dates", violations: issues },
    horizon: { kind: input.completePartition || input.replaceFilingId ? "BOUNDED" : "OPEN_FACT_SET", query: scope, returnedRecords: count, declaredTotal: input.completePartition || input.replaceFilingId ? count : null, paginationComplete: Boolean(input.completePartition || input.replaceFilingId), claimsComplete: Boolean(input.completePartition || input.replaceFilingId) },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "member cards, public comment and Ask", passed: !issues.length, detail: `${projection.records.length} facts reproduced from saved source bytes; native unjoined rows retained.` }],
    normalizedPayload, readModel: projection };
}

/** Each partition publishes as its page arrives; an outage never rolls back earlier verified pages. */
export async function publishFederalPartition(input: { source: FederalSourceId; partition: string; captures: FederalCapture[]; records: FederalFact[];
  store: RoutineDataStore; now: string; cursor?: string; counts?: FederalCounts; completePartition?: boolean; replaceFilingId?: string }) {
  const prior = await readFederalSourceProjection(input.source, input.partition, { store: input.store, now: input.now, bypassCache: true });
  if (prior.kind === "STORE_UNREACHABLE") throw new Error(prior.detail);
  const held = prior.kind === "PROMOTED" ? prior.value : null;
  const facts = new Map(input.completePartition ? [] : held?.records.filter(row => !input.replaceFilingId || row.filingId !== input.replaceFilingId).map(row => [row.id, row]) ?? []);
  for (const row of input.records) {
    const old = held?.records.find(fact => fact.id === row.id);
    facts.set(row.id, old && factHash(old) === factHash(row) ? old : row);
  }
  const projection: FederalProjection = { formatVersion: 1, source: input.source, records: [...facts.values()].sort((a, b) => a.id.localeCompare(b.id)),
    ...(input.cursor !== undefined ? { cursor: input.cursor } : held?.cursor ? { cursor: held.cursor } : {}),
    ...(input.counts ? { counts: input.counts } : held?.counts ? { counts: held.counts } : {}) };
  const priorCandidate = prior.kind === "PROMOTED" ? await input.store.readCandidate(prior.metadata.versionId!) : null;
  const previousCaptures = (priorCandidate?.candidate.normalizedPayload as { captures?: FederalCapture[] } | null)?.captures ?? [];
  const evidence = new Map(input.captures.map(row => [row.url, row]));
  // Replaced pages can retain records absent from the latest partial response. Keep their original bytes.
  const captures = [...input.captures, ...previousCaptures.filter(row => !evidence.has(row.url) || evidence.get(row.url)!.body !== row.body)];
  const rosters = new Map<string, LdaRoster>();
  for (const version of new Set(captures.flatMap(capture => capture.context?.honoreeRosterVersionId ? [capture.context.honoreeRosterVersionId] : []))) {
    const roster = await readLdaRosterVersion(input.store, version);
    if (roster) rosters.set(version, roster);
  }
  // Retain only captures which reproduce an extant fact, plus the current listing for cursor evidence.
  const needed = new Set(projection.records.map(row => `${row.id}|${factHash(row)}`));
  const seen = new Set<string>();
  const kept = captures.filter(capture => {
    const key = `${capture.url}|${sha256(capture.body)}|${normalizedHash(capture.context ?? {})}`;
    if (seen.has(key)) return false;
    if (!input.captures.includes(capture) && !normalizeFederalCaptureWithRoster(capture, rosters.get(capture.context?.honoreeRosterVersionId ?? "")).some(row => needed.has(`${row.id}|${factHash(row)}`))) return false;
    seen.add(key); return true;
  });
  const candidate = federalCandidate({ ...input, projection, captures: kept, rosters });
  const outcome = await processRegisteredFanOutCandidate(input.store, input.source, candidate, input.now, prior.kind === "PROMOTED" ? prior.metadata.versionId : null);
  if (!outcome.promoted) throw new Error(outcome.candidate.failureDetail ?? "Federal source publication refused.");
  return { candidate, outcome, previousCounts: held?.counts };
}

export function countFederalFacts(records: readonly FederalFact[], joined: ReadonlySet<string>): FederalCounts {
  const counts: FederalCounts = { loaded: records.length, joined: 0, unjoined: 0, byState: Object.fromEntries([...Object.values(FIPS_TO_STATE).map(state => state.postal), "US"].map(state => [state, { loaded: 0, joined: 0, unjoined: 0 }])) };
  for (const row of records) {
    const key = /^[A-Z]{2}$/.test(row.state ?? "") ? row.state! : "US";
    const state = counts.byState[key] ??= { loaded: 0, joined: 0, unjoined: 0 };
    state.loaded++;
    if (joined.has(row.id)) { counts.joined++; state.joined++; } else {
      counts.unjoined++; state.unjoined++;
      const reasons = counts.unjoinedReasons ??= {};
      const reason = row.honoreeJoin?.status === "UNJOINED" ? row.honoreeJoin.reason : row.kind === "UNPARSED" ? "UNPARSED" : "NO_HELD_IDENTITY";
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  }
  return counts;
}
