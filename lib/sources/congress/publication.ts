import { normalizedHash, sha256 } from "../../civic-data/candidate-builders.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../../civic-data/types.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { processRegisteredFanOutCandidate } from "../../civic-data/promotion.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { FEDERAL_PARSER_VERSION, FEDERAL_RECORD_CLASS, federalScope, type FederalSourceId } from "./targets.ts";
import { normalizeFederalCaptureWithRoster } from "./normalize.ts";
import type { FederalCapture, FederalCounts, FederalFact, FederalProjection, HeldFederalCapture, LdaRoster } from "./types.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { readLdaRosterVersion } from "./lda-roster.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { holdRawCapture, readRawCaptureText } from "../../civic-data/raw-capture-vault.ts";
import { runBoundedWorkPool } from "../../ops/bounded-work-pool.ts";
import { canonicalCivicDataHash } from "../../civic-data/canonical-hash.ts";
import { federalSourceInputHash, unchangedFederalSourceInput, type FederalSourceInput } from "./source-hash.ts";
import { readPublishedSourceChecks } from "../../civic-data/source-checks.ts";
import { readerQuery } from "../../civic-data/promoted-reader-query.ts";

const factHash = ({ checkedAt: _checkedAt, sourceKey: _sourceKey, sourceHash: _sourceHash, ...fact }: FederalFact) => normalizedHash(fact);
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
  if (result.kind === "PROMOTED" && result.value.sourceManifestVersion === 1) try {
    const keys = [...new Set(result.value.records.flatMap(row => row.sourceKey ? [row.sourceKey] : []))];
    const store = options.store as Partial<Pick<RoutineDataStore, "readSourceChecks">> | undefined;
    const query = !options.store && !options.edge ? readerQuery() : null;
    const checks = store?.readSourceChecks ? await store.readSourceChecks(FEDERAL_RECORD_CLASS, federalScope(source, partition), keys)
      : query ? await readPublishedSourceChecks(async (text, params) => (await query([{ text, params }]))[0] ?? [], FEDERAL_RECORD_CLASS, federalScope(source, partition), keys) : [];
    const byKey = new Map(checks.map(row => [row.sourceKey, row]));
    return { ...result, value: { ...result.value, records: result.value.records.map(row => {
      const check = row.sourceKey ? byKey.get(row.sourceKey) : undefined;
      return check && result.value.sourceHashes?.[check.sourceKey] === check.rawHash && row.sourceHash === check.rawHash &&
        check.sourceUrls.includes(row.sourceUrl) && Date.parse(check.checkedAt) > Date.parse(row.checkedAt) ? { ...row, checkedAt: check.checkedAt } : row;
    }) } };
  } catch (error) { console.error("FEDERAL_SOURCE_CHECK_READ_FAILED=" + JSON.stringify({ source, partition, detail: error instanceof Error ? error.message : String(error) })); }
  return result;
}

type VaultedCapture = FederalCapture & HeldFederalCapture;
const RETAINED_READ_CONCURRENCY = 8;
async function holdFederalCapture(vault: EvidenceStore, capture: FederalCapture): Promise<VaultedCapture> {
  return { ...capture, raw: await holdRawCapture(vault, capture.source, capture.body, capture.kind === "bill-text" ? "text/plain" : "application/json") };
}

/** Facts are verified against the captured bytes; the candidate keeps only their vault references. */
export function federalCandidate(input: { source: FederalSourceId; partition: string; projection: FederalProjection; captures: VaultedCapture[]; now: string; completePartition?: boolean;
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
  const rawHash = sha256(captures.map(capture => capture.raw.rawHash).join("\n"));
  const normalizedPayload = { captures: captures.map(({ body: _body, ...held }): HeldFederalCapture => held) };
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
export async function saveFederalSourceCheck(store: RoutineDataStore, input: FederalSourceInput, versionId: string, sourceUrls: readonly string[] = []) {
  if (!store.recordSourceCheck || !input.captures.length) return false;
  const groups = new Map(input.captures.map(capture => ({ ...input, captures: [capture] }))
    .map(group => [federalSourceInputHash(group).sourceKey, group]));
  let saved = true;
  for (const group of groups.values()) saved = await store.recordSourceCheck({ ...federalSourceInputHash(group), sourceId: input.source,
    recordClass: FEDERAL_RECORD_CLASS, scope: federalScope(input.source, input.partition), pointerVersionId: versionId, parserVersion: FEDERAL_PARSER_VERSION,
    checkedAt: group.captures.map(row => row.retrievedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0],
    sourceUrls: [...new Set([...group.captures.map(row => row.url), ...sourceUrls])], jurisdictionIds: ["US"] }) && saved;
  return saved;
}

export async function publishFederalPartition(input: FederalSourceInput & { captures: FederalCapture[]; records: FederalFact[];
  store: RoutineDataStore; vault: EvidenceStore; now: string; countRecords?: (records: readonly FederalFact[]) => Promise<FederalCounts> }) {
  const unchanged = await unchangedFederalSourceInput(input.store, input);
  if (unchanged && await saveFederalSourceCheck(input.store, input, unchanged.head.versionId, [...unchanged.sourceUrls, ...input.records.map(row => row.sourceUrl)])) {
    console.log("FEDERAL_SOURCE_CONFIRMED_UNCHANGED=" + JSON.stringify({ source: input.source, partition: input.partition, sourceKey: unchanged.hash.sourceKey }));
    return { kind: "UNCHANGED" as const, head: unchanged.head };
  }
  // Routine national checkpoints hold control fields. Preserve any older native facts by reading only those fields and their capture references.
  const prior = input.partition === "national" ? null : await readFederalSourceProjection(input.source, input.partition, { store: input.store, now: input.now });
  const nationalHead = input.partition === "national" ? await input.store.readSourceHead(FEDERAL_RECORD_CLASS, federalScope(input.source)) : null;
  const nationalFields = nationalHead ? await input.store.readPromotionPayloadFields(FEDERAL_RECORD_CLASS, federalScope(input.source), ["cursor", "counts"]) : null;
  const nationalCount = nationalHead ? await input.store.readCandidateField(nationalHead.versionId, ["normalization", "outputRecords"]) : null;
  const nationalRecords = typeof nationalCount === "number" && nationalCount > 2
    ? (await input.store.readPromotionPayloadFields(FEDERAL_RECORD_CLASS, federalScope(input.source), ["records"]))?.records as FederalFact[] ?? [] : [];
  if (prior?.kind === "STORE_UNREACHABLE") throw new Error(prior.detail);
  const held = prior?.kind === "PROMOTED" ? prior.value : nationalHead ? { formatVersion: 1 as const, source: input.source, records: nationalRecords, ...nationalFields } as FederalProjection : null;
  const facts = new Map(input.completePartition ? [] : held?.records.filter(row => !input.replaceFilingId || row.filingId !== input.replaceFilingId).map(row => [row.id, row]) ?? []);
  for (const row of input.records) {
    const old = held?.records.find(fact => fact.id === row.id);
    facts.set(row.id, { ...(old && factHash(old) === factHash(row) ? old : row), checkedAt: row.checkedAt });
  }
  const counts = input.countRecords ? await input.countRecords([...facts.values()]) : input.counts;
  const projection: FederalProjection = { formatVersion: 1, source: input.source, records: [...facts.values()].sort((a, b) => a.id.localeCompare(b.id)),
    ...(input.countsPrimary !== undefined ? { countsPrimary: input.countsPrimary } : held?.countsPrimary !== undefined ? { countsPrimary: held.countsPrimary } : {}),
    sourceManifestVersion: 1, sourceHashes: { ...(input.partition === "national" ? {} : held?.sourceHashes),
      ...Object.fromEntries(input.captures.map(capture => { const single = federalSourceInputHash({ ...input, captures: [capture] }); return [single.sourceKey, single.rawHash]; })) },
    ...(input.cursor !== undefined ? { cursor: input.cursor } : held?.cursor ? { cursor: held.cursor } : {}),
    // The refresh keeps adding to its running total, so the projection holds this moment's copy.
    ...(counts ? { counts: structuredClone(counts) } : held?.counts ? { counts: held.counts } : {}) };
  const previousCaptures = prior?.kind === "PROMOTED"
    ? await input.store.readCandidatePath<HeldFederalCapture[]>(prior.metadata.versionId!, ["normalizedPayload", "captures"]) ?? []
    : nationalRecords.length && nationalHead ? await input.store.readCandidatePath<HeldFederalCapture[]>(nationalHead.versionId, ["normalizedPayload", "captures"]) ?? [] : [];
  const fresh = await Promise.all(input.captures.map(capture => holdFederalCapture(input.vault, capture)));
  const evidence = new Map(fresh.map(row => [row.url, row.raw.rawHash]));
  // Replaced pages can retain records absent from the latest partial response. Keep their original bytes.
  const reads = await runBoundedWorkPool(previousCaptures.filter(row => evidence.get(row.url) !== row.raw.rawHash), RETAINED_READ_CONCURRENCY,
    async (row): Promise<VaultedCapture> => ({ ...row, body: await readRawCaptureText(input.vault, row.raw) }));
  const unread = reads.find(read => !read.ok);
  if (unread) throw new Error(unread.error!);
  const captures = [...fresh, ...reads.flatMap(read => read.ok ? [read.value] : [])];
  const rosters = new Map<string, LdaRoster>();
  for (const version of new Set(captures.flatMap(capture => capture.context?.honoreeRosterVersionId ? [capture.context.honoreeRosterVersionId] : []))) {
    const roster = await readLdaRosterVersion(input.store, input.vault, version);
    if (roster) rosters.set(version, roster);
  }
  const current = new Map(input.records.map(row => [row.id, factHash(row)]));
  const provenance = new Map<string, { sourceKey: string; sourceHash: string }>();
  for (const capture of fresh) {
    const single = federalSourceInputHash({ ...input, captures: [capture] });
    for (const row of normalizeFederalCaptureWithRoster(capture, rosters.get(capture.context?.honoreeRosterVersionId ?? ""))) {
      if (current.get(row.id) === factHash(row) && !provenance.has(row.id)) provenance.set(row.id, { sourceKey: single.sourceKey, sourceHash: single.rawHash });
    }
  }
  projection.records = projection.records.map(row => provenance.has(row.id) ? { ...row, ...provenance.get(row.id)! } : row);
  const relevant = new Set([...input.captures.map(capture => federalSourceInputHash({ ...input, captures: [capture] }).sourceKey),
    ...projection.records.flatMap(row => row.sourceKey ? [row.sourceKey] : [])]);
  projection.sourceHashes = Object.fromEntries(Object.entries(projection.sourceHashes ?? {}).filter(([key]) => relevant.has(key)));
  // Retain only captures which reproduce an extant fact, plus the current listing for cursor evidence.
  const needed = new Set(projection.records.map(row => `${row.id}|${factHash(row)}`));
  const seen = new Set<string>();
  const kept = captures.filter(capture => {
    const key = `${capture.url}|${capture.raw.rawHash}|${normalizedHash(capture.context ?? {})}`;
    if (seen.has(key)) return false;
    if (!fresh.includes(capture) && !normalizeFederalCaptureWithRoster(capture, rosters.get(capture.context?.honoreeRosterVersionId ?? "")).some(row => needed.has(`${row.id}|${factHash(row)}`))) return false;
    seen.add(key); return true;
  });
  const built = federalCandidate({ ...input, projection, captures: kept, rosters });
  const candidate = { ...built, retrieval: { ...built.retrieval, rawHash: canonicalCivicDataHash(projection.sourceHashes), rawHashBasis: "SOURCE_CONTENT_V1" as const, complete: false,
    sourceCheck: { requestedUrl: kept[0]?.url ?? "", finalUrl: kept[0]?.url ?? "", httpStatus: 200 as const,
      rawHash: kept[0]?.raw.rawHash ?? "", checkedAt: kept[0]?.retrievedAt ?? input.now } } };
  const outcome = await processRegisteredFanOutCandidate(input.store, input.source, candidate, input.now, prior?.kind === "PROMOTED" ? prior.metadata.versionId : nationalHead?.versionId ?? null, { confirmUnchanged: false });
  if (!outcome.promoted) throw new Error(outcome.candidate.failureDetail ?? "Federal source publication refused.");
  try { await saveFederalSourceCheck(input.store, input, outcome.promoted.versionId, input.records.map(row => row.sourceUrl)); }
  catch (error) { console.error("FEDERAL_SOURCE_CHECK_WRITE_FAILED=" + JSON.stringify({ source: input.source, partition: input.partition, detail: error instanceof Error ? error.message : String(error) })); }
  return { kind: "PUBLISHED" as const, candidate, outcome, previousCounts: held?.counts, counts };
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
