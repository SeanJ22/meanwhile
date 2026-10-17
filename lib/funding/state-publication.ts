import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";
import { normalizedHash, sha256 } from "../civic-data/candidate-builders.ts";
import { processRegisteredFanOutCandidate, type PromotionOutcome } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { sourceProjectionEvidence, type RoutineCandidate, type SourceCheckEvidence } from "../civic-data/types.ts";
import { FederalMoneyIndex, readFederalMoneyJson } from "../federal-money/edge.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { sortSourceRecords } from "../reference/external-sort.ts";
import { acquireCampaignFinanceResource } from "./state-acquisition.ts";
import { CAMPAIGN_FINANCE_PARSER, campaignFinanceNativeScope, campaignFinanceSourceId, type CampaignFinanceResource } from "./state-sources.ts";
import { campaignFinanceDirectoryKey, campaignFinancePublicationIssue, campaignFinanceGovernmentIssue, type CampaignFinanceFiler, type CampaignFinanceGovernment, type CampaignFinancePublication, type CampaignFinanceState } from "./state-projection.ts";
import { campaignSourceRecordHash, type CampaignSourceRecord } from "./state-source-records.ts";
import { readCampaignFinancePage, type CampaignFinancePageRef } from "./state-pages.ts";
import { CampaignFinanceSpool } from "./state-spool.ts";

interface CampaignPage { readonly state: string; readonly records: readonly CampaignSourceRecord[] }
type AcquisitionOptions = Parameters<typeof acquireCampaignFinanceResource>[2];
interface Options extends AcquisitionOptions {
  readonly store: RoutineDataStore;
  readonly artifacts: ReaderArtifactStore;
  readonly onPublished?: (value: { readonly state: string; readonly records: number; readonly unjoined: number }) => void;
}
const groupIdentity = (row: CampaignSourceRecord) => sha256(JSON.stringify([row.resource, row.governmentOcdId, row.nativeGovernmentId, row.filerId]));
const pageKey = (index: number) => String(index).padStart(12, "0");
async function immutable(store: ReaderArtifactStore, value: unknown): Promise<string> {
  return store.putImmutable(Buffer.from(JSON.stringify(value)), "json");
}
function candidate(projection: CampaignFinancePublication, input: { readonly url: string; readonly at: string; readonly rawHash: string; readonly retrievedAt: string; readonly sourceCheck: SourceCheckEvidence }): RoutineCandidate {
  const state = projection.state, sourceId = campaignFinanceSourceId(state), record = projection.records[0];
  const scope = projection.kind === "campaign-finance-source-state" ? campaignFinanceNativeScope(state) : `${sourceId}:filer:${record.id}`;
  const issue = campaignFinancePublicationIssue(projection, state), hash = normalizedHash(projection);
  return {
    id: `cv-${sha256(`${sourceId}:${scope}:${hash}:${input.at}`).slice(0, 32)}`,
    sourceId, recordClass: "CURATED_READER_RECORD", scope,
    sourceProjectionEvidence: sourceProjectionEvidence(sourceId, "CURATED_READER_RECORD", scope),
    retrieval: { succeeded: true, requestedUrl: input.url, finalUrl: input.sourceCheck.finalUrl, httpStatus: 200, retrievedAt: input.retrievedAt, rawHash: input.rawHash, sourceCheck: input.sourceCheck },
    normalization: { succeeded: issue === null, parserVersion: CAMPAIGN_FINANCE_PARSER, schemaVersion: CAMPAIGN_FINANCE_PARSER,
      normalizedHash: hash, normalizedPayloadHash: hash, inputRecords: 1, outputRecords: 1, droppedRecords: 0, missingRequiredFields: [] },
    identities: [{ subjectId: record.id, jurisdiction: `US-${state}`, identifiers: { source_record_id: record.id }, matchBasis: "EXACT_SCOPED_ID", ambiguous: false }],
    temporal: { version: input.at, expectedVersion: input.at, sourceThrough: input.at, staleAtRetrieval: false },
    semantics: { factKind: "State-local campaign records replayed from captured official source rows", violations: issue ? [issue] : [] },
    horizon: { kind: "OPEN_FACT_SET", query: input.url, returnedRecords: 1, declaredTotal: null, paginationComplete: true, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "native campaign-finance artifacts and Ask", passed: issue === null,
      detail: "Every native amount and identifier comes from the configured source columns; bounded immutable pages retain their capture references." }],
    normalizedPayload: projection, readModel: projection,
  };
}

export async function publishCampaignFinanceResource(state: string, resource: CampaignFinanceResource, options: Options): Promise<{ readonly records: number; readonly unjoined: number; readonly outcome: PromotionOutcome }> {
  const sourceId = campaignFinanceSourceId(state), scope = campaignFinanceNativeScope(state);
  const directory = join(options.directory, state, `publication-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const observations = join(directory, "observations");
  await mkdir(observations);
  const spool = new CampaignFinanceSpool(observations, state, resource);
  const inputPath = join(directory, "records"), sortedPath = join(directory, "ordered");
  let records = 0, unjoined = 0;
  let sourceCheck: SourceCheckEvidence | null = null, observedAt: string | null = null;
  const resourceEvidence = createHash("sha256"), publicationId = randomUUID();
  try {
    const priorState = await options.store.readPromotion<CampaignFinancePublication>("CURATED_READER_RECORD", scope);
    const priorDirectory = await options.artifacts.readJsonPointer<CampaignFinanceState>(campaignFinanceDirectoryKey(state));
    let directoryEtag = priorDirectory?.etag ?? null;
    let heldState: CampaignFinanceState = priorDirectory?.value ?? (priorState?.payload.kind === "campaign-finance-source-state" ? priorState.payload.records[0] : {
      id: state, state, groups: null, places: null, filers: null, count: 0, unjoined: 0, resources: {},
    });
    if (campaignFinancePublicationIssue({ kind: "campaign-finance-source-state", state, records: [heldState] }, state)) throw new Error("The campaign-finance directory is not valid for its state.");
    const accepted = heldState.resources[resource.id];
    const output = await open(inputPath, "w");
    try {
      for await (const page of acquireCampaignFinanceResource(state, resource, { ...options, publicationId, ...(accepted?.complete ? { acceptedPublicationId: accepted.publicationId } : {}) })) {
        sourceCheck = page.sourceCheck;
        if (page.capture) { resourceEvidence.update(page.capture.rawHash).update("\n"); if (page.capture.lookup) resourceEvidence.update(page.capture.lookup.rawHash).update("\n"); }
        if (!observedAt || page.observedAt < observedAt) observedAt = page.observedAt;
        for (const row of page.records) {
          await output.write(`${groupIdentity(row)}\x1f${row.id.slice(-64)}\t${await spool.encode(row)}\n`);
          records++; unjoined += Number(row.unjoinedReason !== null);
        }
      }
    } finally { await output.close(); }
    await sortSourceRecords(inputPath, sortedPath, options.signal);
    await rm(inputPath);
    const groups = new FederalMoneyIndex(options.artifacts, `${scope}:groups`);
    const places = new FederalMoneyIndex(options.artifacts, `${scope}:places`);
    const filers = new FederalMoneyIndex(options.artifacts, `${scope}:filers`);
    const stateVersion = priorState?.versionId ?? null;
    let group: CampaignFinanceFiler | null = null, pages: FederalMoneyIndex | null = null;
    let currentGroupId: string | null = null;
    let lastNativeId: string | null = null, lastNativeHash: string | null = null;
    let lastUnkeyedId: string | null = null, unkeyedOccurrence = 0;
    let priorGroup: CampaignFinanceFiler | null = null;
    let batch: CampaignSourceRecord[] = [], batchIndex = 0;
    let evidence = createHash("sha256"), content = createHash("sha256");
    let predecessor: AsyncIterator<CampaignSourceRecord> | null = null;
    let previous: IteratorResult<CampaignSourceRecord> = { done: true, value: undefined };
    async function* previousRows(held: CampaignFinanceFiler | null) {
      for (let index = 0; index < (held?.pageCount ?? 0); index++) {
        const key = await pages!.get(held!.pages, pageKey(index));
        if (!key) throw new Error("Campaign predecessor is missing a declared page.");
        const ref = await readFederalMoneyJson<CampaignFinancePageRef>(options.artifacts, key);
        yield* await readCampaignFinancePage(options.artifacts, ref, state);
      }
    }
    async function append(row: CampaignSourceRecord) {
      evidence.update(row.provenance.rawHash).update("\n");
      if (row.provenance.lookup) evidence.update(row.provenance.lookup.rawHash).update("\n");
      content.update(campaignSourceRecordHash(row)).update("\n");
      group = { ...group!, count: group!.count + 1, unjoined: group!.unjoined + Number(row.unjoinedReason !== null) };
      batch.push(row);
      if (batch.length >= 100) await flush();
    }
    async function flush() {
      if (!group || !pages || !batch.length) return;
      const digest = createHash("sha256");
      for (const row of batch) digest.update(campaignSourceRecordHash(row)).update("\n");
      const hash = digest.digest("hex"), key = pageKey(batchIndex++);
      const oldKey = await pages.get(group.pages, key);
      const old = oldKey ? await readFederalMoneyJson<CampaignFinancePageRef>(options.artifacts, oldKey) : null;
      if (old?.hash !== hash) {
        const page: CampaignPage = { state, records: batch };
        const ref: CampaignFinancePageRef = { key: await options.artifacts.putImmutable(gzipSync(Buffer.from(JSON.stringify(page))), "json.gz"), hash, count: batch.length };
        group = { ...group, pages: await pages.set(group.pages, key, await immutable(options.artifacts, ref)) };
      }
      batch = [];
    }
    async function publishGroup() {
      if (!group || !pages) return;
      while (!previous.done) { await append(previous.value); previous = await predecessor!.next(); }
      await predecessor?.return?.();
      await flush();
      for (let index = batchIndex; index < (priorGroup?.pageCount ?? 0); index++) group = { ...group!, pages: await pages!.set(group!.pages, pageKey(index), null) };
      group = { ...group!, pageCount: batchIndex, evidenceHash: evidence.digest("hex"), contentHash: content.digest("hex") };
      const projection: CampaignFinancePublication = { kind: "campaign-finance-source-filer", state, records: [group] };
      if (priorGroup?.contentHash === group.contentHash && priorGroup.count === group.count) return;
      const at = (options.now ?? (() => new Date().toISOString()))();
      if (!sourceCheck || !observedAt) throw new Error("Campaign publication has no source observation.");
      const next = candidate(projection, { url: resource.url, at, rawHash: group.evidenceHash, retrievedAt: observedAt, sourceCheck });
      const result = await processRegisteredFanOutCandidate(options.store, sourceId, next, at);
      if (!result.promoted) throw new Error(result.candidate.failureDetail ?? "Campaign government publication was not accepted.");
      const groupKey = await immutable(options.artifacts, group);
      heldState = { ...heldState, groups: await groups.set(heldState.groups, group.id, groupKey),
        filers: group.filerId ? await filers.set(heldState.filers, `${encodeURIComponent(group.filerId)}:${group.id}`, groupKey) : heldState.filers,
        count: heldState.count - (priorGroup?.count ?? 0) + group.count,
        unjoined: heldState.unjoined - (priorGroup?.unjoined ?? 0) + group.unjoined };
      if (group.governmentOcdId) {
        const id = group.governmentOcdId, previousKey = await places.get(heldState.places, id);
        const previous = previousKey ? await readFederalMoneyJson<CampaignFinanceGovernment>(options.artifacts, previousKey) : null;
        const index = new FederalMoneyIndex(options.artifacts, `${scope}:government:${id}:filers`);
        const government: CampaignFinanceGovernment = { id, state, filers: await index.set(previous?.filers ?? null, group.id, groupKey),
          count: (previous?.count ?? 0) - (priorGroup?.count ?? 0) + group.count,
          unjoined: (previous?.unjoined ?? 0) - (priorGroup?.unjoined ?? 0) + group.unjoined };
        const issue = campaignFinanceGovernmentIssue(government, state);
        if (issue) throw new Error(issue);
        heldState = { ...heldState, places: await places.set(heldState.places, id, await immutable(options.artifacts, government)) };
      }
      await publishDirectory(at, false);
      options.onPublished?.({ state, records: group.count, unjoined: group.unjoined });
    }
    async function publishDirectory(at: string, complete: boolean) {
      heldState = { ...heldState, resources: { ...heldState.resources, [resource.id]: { checkedAt: at, complete, publicationId } } };
      const written = await options.artifacts.writeJsonPointer(campaignFinanceDirectoryKey(state), heldState, directoryEtag);
      if (!written.modified) throw new Error("The state's campaign-finance directory changed during publication.");
      directoryEtag = written.etag;
    }
    async function publishState(at: string, rawHash: string): Promise<PromotionOutcome> {
      await publishDirectory(at, true);
      const projection: CampaignFinancePublication = { kind: "campaign-finance-source-state", state, records: [heldState] };
      if (!sourceCheck) throw new Error("Campaign publication has no source check.");
      const next = candidate(projection, { url: resource.url, at, rawHash, retrievedAt: observedAt ?? sourceCheck.checkedAt, sourceCheck });
      const result = await processRegisteredFanOutCandidate(options.store, sourceId, next, at, stateVersion);
      if (!result.promoted) throw new Error(result.candidate.failureDetail ?? "Campaign state publication was not accepted.");
      return result;
    }
    const lines = createInterface({ input: createReadStream(sortedPath), crlfDelay: Infinity });
    for await (const line of lines) {
      options.signal.throwIfAborted();
      const tab = line.indexOf("\t");
      let row = await spool.decode(line.slice(line.indexOf("\x1f") + 1, tab), line.slice(tab + 1));
      const id = groupIdentity(row);
      if (id !== currentGroupId) {
        await publishGroup();
        currentGroupId = id;
        lastNativeId = null; lastNativeHash = null;
        lastUnkeyedId = null; unkeyedOccurrence = 0;
        const priorKey = await groups.get(heldState.groups, id);
        priorGroup = priorKey ? await readFederalMoneyJson<CampaignFinanceFiler>(options.artifacts, priorKey) : null;
        group = { id, state, resource: resource.id, filerId: row.filerId, filerName: row.filerId ? row.filerName : null,
          nativeGovernmentId: row.nativeGovernmentId, governmentOcdId: row.governmentOcdId,
          pages: priorGroup?.pages ?? null, count: 0, unjoined: 0, pageCount: 0, evidenceHash: "0".repeat(64), contentHash: "0".repeat(64) };
        pages = new FederalMoneyIndex(options.artifacts, `${scope}:filer:${id}:pages`);
        batchIndex = 0; evidence = createHash("sha256"); content = createHash("sha256");
        predecessor = previousRows(resource.identity.length && resource.identityScope !== "PUBLICATION" ? priorGroup : null)[Symbol.asyncIterator]();
        previous = await predecessor.next();
      }
      if (row.nativeId === null) {
        unkeyedOccurrence = row.id === lastUnkeyedId ? unkeyedOccurrence + 1 : 0;
        lastUnkeyedId = row.id;
        row = { ...row, id: `${row.id}:${String(unkeyedOccurrence).padStart(12, "0")}` };
      }
      const nativeHash = campaignSourceRecordHash(row);
      if (row.id === lastNativeId) {
        if (nativeHash !== lastNativeHash) throw new Error("The source publishes conflicting rows for the same native filing identity.");
        continue;
      }
      lastNativeId = row.id; lastNativeHash = nativeHash;
      while (!previous.done && previous.value.id < row.id) { await append(previous.value); previous = await predecessor!.next(); }
      if (!previous.done && previous.value.id === row.id) {
        const old = previous.value;
        row = { ...row, amounts: [...row.amounts, ...old.amounts.filter(amount => row.invalidAmounts.includes(amount.label)).map(amount => ({ ...amount, provenance: amount.provenance ?? old.provenance }))] };
        previous = await predecessor!.next();
      }
      await append(row);
    }
    await publishGroup();
    const at = (options.now ?? (() => new Date().toISOString()))();
    const outcome = await publishState(at, records ? resourceEvidence.digest("hex") : sourceCheck!.rawHash);
    return { records, unjoined, outcome };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
