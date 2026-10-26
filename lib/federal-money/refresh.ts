import { acquireFederalMoney, federalMoneyAcquisitionVault, type FederalMoneyAcquireOptions } from "./acquire.ts";
import { federalMoneyCandidate, federalMoneyCounts, type FederalMoneyEvidence, type FederalMoneyNationalProjection, type FederalMoneyStateProgress } from "./candidate.ts";
import { joinFederalMoneyFacts, type FederalMoneyJoinInput } from "./join.ts";
import { federalMoneyScope, FEDERAL_MONEY_JOIN_VERSION, OPENFEMA_STATE_PROJECTION_VERSION, type FederalMoneyCursor, type FederalMoneyPage, type FederalMoneyCheckpoint, type FederalMoneySource, type FederalMoneyPartition, type FederalMoneyProjection, type FederalMoneyCounts } from "./model.ts";
import { FEDERAL_MONEY_CONFIG, federalMoneySourceStates } from "./sources.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate, type PromotionOutcome } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure } from "../civic-data/source-acquisition-failure.ts";
import { writeFederalMoneyPartitions, federalMoneyPartitionBaselines, addFederalMoneyCounts, type FederalMoneyPartitionChange } from "./partitions.ts";
import { withFederalMoneyVault, readFederalMoneyCapture } from "./vault.ts";
import { parseFederalMoney } from "./parse.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { withFederalMoneyVerificationCache } from "./verify.ts";
import { readFederalMoneyProgress } from "./progress.ts";
import { federalMoneyAppliedSourceHash, federalMoneySourceHash, federalMoneySourceKey } from "./source-hash.ts";
import { sha256 } from "../civic-data/candidate-builders.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";

interface FederalMoneyRefreshOptions {
  readonly source: FederalMoneySource; readonly store: RoutineDataStore;
  readonly states?: readonly string[]; readonly acquireOptions?: FederalMoneyAcquireOptions;
  readonly acquire?: typeof acquireFederalMoney; readonly now?: () => string;
  readonly identities: (state: string, facts: FederalMoneyPage["facts"]) => Promise<FederalMoneyJoinInput>;
  /** Compact hashes of the exact native recipient dependencies, acquired without their record bodies. */
  readonly identityHash?: (state: string, facts: FederalMoneyPage["facts"]) => Promise<string>;
  readonly locate?: (state: string, facts: FederalMoneyPage["facts"]) => Promise<readonly { id: string; partition: FederalMoneyPartition }[]>;
  /** Seek one held source/state partition; its facts use the normal publisher. */
  readonly nextHeldPartition?: (state: string, afterScope: string | null) => Promise<string | null>;
  readonly onPartition?: (change: FederalMoneyPartitionChange) => Promise<unknown>;
  readonly onProgress?: (row: FederalMoneyStateProgress, at: string) => Promise<void>;
  readonly doorRead?: (input: { state: string; at: string; rows: number; reason: string | null }) => Promise<void>;
  readonly onState?: (row: FederalMoneyStateProgress) => void;
  readonly maxRunMs?: number; readonly maxRounds?: number;
  readonly deadlineMs?: number;
}

export async function refreshFederalMoney(input: FederalMoneyRefreshOptions): Promise<{ projection: FederalMoneyNationalProjection; outcome: PromotionOutcome; candidate: ReturnType<typeof federalMoneyCandidate> | null }> {
  const evidenceStore = input.acquireOptions?.evidenceStore ?? federalMoneyAcquisitionVault();
  return withFederalMoneyVault(evidenceStore, () => run({ ...input, acquireOptions: { ...input.acquireOptions, evidenceStore } }));
}
async function run(input: FederalMoneyRefreshOptions): Promise<{ projection: FederalMoneyNationalProjection; outcome: PromotionOutcome; candidate: ReturnType<typeof federalMoneyCandidate> | null }> {
  const now = input.now ?? (() => new Date().toISOString()), started = Date.now();
  const states = input.states ?? federalMoneySourceStates(input.source);
  const order = input.maxRounds === 0 ? states : await leastRecentlyServed(input.store, input.source, states);
  const acquire = input.acquire ?? acquireFederalMoney;
  const progress = new Map<string, FederalMoneyStateProgress>();
  const sourceHashes=new Map<string,string|null>(states.map(state=>[state,null]));
  const finished = new Set<string>();
  const maxRunMs = Math.max(0, Math.min(input.maxRunMs ?? 25 * 60_000, (input.deadlineMs ?? Infinity) - started));
  for (let round = 0; round < (input.maxRounds ?? Infinity) && Date.now() - started < maxRunMs && finished.size < states.length; round++) {
    for (const state of order) {
      if (finished.has(state) || Date.now() - started >= maxRunMs) continue;
      let prior = await readFederalMoneyProgress(input.store,input.source,state);
      const savedCheckpoint = prior?.checkpoint;
      sourceHashes.set(state,federalMoneyAppliedSourceHash(input.source,state,savedCheckpoint?.sourcePages));
      if (input.nextHeldPartition && !savedCheckpoint?.pending && savedCheckpoint?.joinVersion !== FEDERAL_MONEY_JOIN_VERSION) {
        const at = now();
        try {
          const previous:FederalMoneyCheckpoint|null=prior?{formatVersion:2,source:input.source,state,counts:prior.counts,
            checkpoint:savedCheckpoint??{complete:false,cursor:null,lastCompleteAt:null,refreshStartedAt:null}}:null;
          const repaired = await rejoinHeldPartition(input,state,previous,prior?.versionId??null,at);
          const row:FederalMoneyStateProgress={state,status:"BACKFILL",counts:repaired.counts,cursor:repaired.checkpoint.cursor,
            lastCompleteAt:repaired.checkpoint.lastCompleteAt,reason:null};
          progress.set(state,row);input.onState?.(row);await input.onProgress?.(row,at);
        } catch(error) {
          const row:FederalMoneyStateProgress={state,status:"OUTAGE",counts:prior?.counts??federalMoneyCounts([]),
            cursor:savedCheckpoint?.cursor??null,lastCompleteAt:savedCheckpoint?.lastCompleteAt??null,reason:sanitizedErrorDiagnostic(error)};
          progress.set(state,row);input.onState?.(row);finished.add(state);await input.onProgress?.(row,at);
        }
        continue;
      }
      // Historical county-only OpenFEMA rows need one complete source pass. Keep
      // their published partitions while the new projection resumes page by page.
      const needsProjectionBackfill = input.source === "openfema" && savedCheckpoint?.projectionVersion !== OPENFEMA_STATE_PROJECTION_VERSION;
      const checkpoint = needsProjectionBackfill ? undefined : savedCheckpoint;
      const projectionVersion = { ...(input.source === "openfema" ? { projectionVersion: OPENFEMA_STATE_PROJECTION_VERSION } : {}), ...(savedCheckpoint?.joinVersion ? { joinVersion: savedCheckpoint.joinVersion } : {}) };
      const lastCompleteAt = savedCheckpoint?.lastCompleteAt ?? (savedCheckpoint?.complete ? prior?.latestConfirmation?.retrieval.retrievedAt : null);
      if (round === 0 && checkpoint?.complete && lastCompleteAt &&
        Date.parse(now()) - Date.parse(lastCompleteAt) < FEDERAL_MONEY_CONFIG[input.source].everyMs) {
        const row: FederalMoneyStateProgress = { state, status: "COMPLETE", counts: prior!.counts, cursor: null, lastCompleteAt, reason: null };
        progress.set(state, row);
        await input.onProgress?.(row, lastCompleteAt);
        finished.add(state); continue;
      }
      let page: FederalMoneyPage;
      const refreshStartedAt = !checkpoint?.complete && checkpoint?.refreshStartedAt
        ? checkpoint.refreshStartedAt : now();
      try {
        // A deadline stops a work slice without discarding the last durable cursor.
        const signal = AbortSignal.timeout(Math.max(1, maxRunMs - (Date.now() - started)));
        const parent = input.acquireOptions?.signal;
        if (checkpoint?.pending) {
          const saved = checkpoint.pending.page;
          const facts = [];
          for (const capture of saved.captures) facts.push(...parseFederalMoney(input.source, capture, state, await readFederalMoneyCapture(capture)));
          page = { ...saved, facts };
        } else page = await acquire(input.source, state, { ...input.acquireOptions, signal: parent ? AbortSignal.any([signal, parent]) : signal,
          now, cursor: checkpoint?.complete ? null : checkpoint?.cursor,
          since: checkpoint?.complete ? checkpoint.refreshStartedAt ?? undefined : checkpoint?.cursor?.since });
      } catch (error) {
        const reason = sanitizedErrorDiagnostic(error);
        const at = now();
        const row: FederalMoneyStateProgress = { state, status: "OUTAGE", counts: prior?.counts ?? federalMoneyCounts([]),
          cursor: checkpoint?.cursor ?? null, lastCompleteAt: savedCheckpoint?.lastCompleteAt ?? null, reason };
        progress.set(state, row); finished.add(state); input.onState?.(row);
        await input.doorRead?.({ state, at, rows: row.counts.loaded, reason });
        await input.onProgress?.(row, at);
        continue;
      }
      const at = now();
      const sourceKey=federalMoneySourceKey(input.source,state,checkpoint?.complete?null:checkpoint?.cursor);
      const rawHash=federalMoneySourceHash(input.source,state,page);
      // A refused metadata read falls back to the ordinary current identity read.
      let dependencyHash=rawHash && input.identityHash ? await input.identityHash(state,page.facts).catch(()=>null) : null;
      const heldSource=savedCheckpoint?.sourcePages?.[sourceKey];
      const unchanged=!checkpoint?.pending && rawHash!==null && dependencyHash!==null &&
        heldSource?.rawHash===rawHash && heldSource.dependencyHash===dependencyHash;
      const startingCounts=checkpoint?.pending?.startingCounts??prior?.counts??federalMoneyCounts([]);
      let delta=federalMoneyCounts([]);
      if(!unchanged) {
        const priorLocations = checkpoint?.pending?.priorLocations ?? await input.locate?.(state, page.facts) ?? [];
        const baselines = checkpoint?.pending?.baselines ?? await federalMoneyPartitionBaselines(input.store, input.source, state, page.facts, priorLocations);
        if (!checkpoint?.pending && page.facts.length) {
          const { facts: _facts, ...savedPage } = page;
          const pending: FederalMoneyCheckpoint = { formatVersion: 2, source: input.source, state,
            counts: prior?.counts ?? federalMoneyCounts([]),
            checkpoint: { ...projectionVersion, complete: false, cursor: checkpoint?.cursor ?? null, lastCompleteAt: savedCheckpoint?.lastCompleteAt ?? null, refreshStartedAt,
              ...(savedCheckpoint?.sourcePages ? {sourcePages:savedCheckpoint.sourcePages} : {}),
              pending: { page: savedPage, baselines, priorLocations, startingCounts } } };
          const staged = federalMoneyCandidate({ projection: pending, page: { facts: [], captures: [], complete: false, declaredTotal: null }, now: at });
          const saved = await processRegisteredFanOutCandidate(input.store, input.source, staged, at, prior?.versionId ?? null);
          if (!saved.promoted) throw new Error(saved.candidate.failureDetail ?? "Federal page checkpoint could not be saved.");
          prior = {versionId:saved.promoted.versionId,promotedAt:saved.promoted.promotedAt,
            latestConfirmation:saved.promoted.latestConfirmation,counts:pending.counts,checkpoint:pending.checkpoint};
        }
        let identities: FederalMoneyJoinInput;
        try { identities = await input.identities(state, page.facts); }
        catch (error) {
          const reason = sanitizedErrorDiagnostic(error);
          const row: FederalMoneyStateProgress = { state, status: "OUTAGE", counts: prior?.counts ?? federalMoneyCounts([]),
            cursor: checkpoint?.cursor ?? null, lastCompleteAt: savedCheckpoint?.lastCompleteAt ?? null, reason };
          progress.set(state, row); finished.add(state); input.onState?.(row);
          await input.doorRead?.({ state, at, rows: page.facts.length, reason: null });
          await input.onProgress?.(row, at);
          continue;
        }
        dependencyHash??=sha256(canonicalCivicDataJson(identities));
        const records = joinFederalMoneyFacts(page.facts, identities);
        const written = await withFederalMoneyVerificationCache(() => writeFederalMoneyPartitions({ source: input.source, state, page: { ...page, facts: records }, store: input.store, now: at,
          onPartition: input.onPartition, baselines, priorLocations,progress:checkpoint?.pending?.partitionProgress,
          shouldContinue:()=>Date.now()-started<maxRunMs,
          onGroup:async partitionProgress=>{
            const {facts:_facts,...savedPage}=page;
            const projection:FederalMoneyCheckpoint={formatVersion:2,source:input.source,state,counts:addFederalMoneyCounts(startingCounts,partitionProgress.delta),
              checkpoint:{...projectionVersion,complete:false,cursor:checkpoint?.cursor??null,lastCompleteAt:savedCheckpoint?.lastCompleteAt??null,refreshStartedAt,
                ...(savedCheckpoint?.sourcePages?{sourcePages:savedCheckpoint.sourcePages}:{}),
                pending:{page:savedPage,baselines,priorLocations,startingCounts,partitionProgress}}};
            const candidate=federalMoneyCandidate({projection,page:{facts:[],captures:[],complete:false,declaredTotal:null},now:at});
            const saved=await processRegisteredFanOutCandidate(input.store,input.source,candidate,at,prior?.versionId??null);
            if(!saved.promoted)throw new Error(saved.candidate.failureDetail??"The federal page could not save its completed partitions.");
            prior={versionId:saved.promoted.versionId,promotedAt:saved.promoted.promotedAt,latestConfirmation:saved.promoted.latestConfirmation,
              counts:projection.counts,checkpoint:projection.checkpoint};
          }}));
        if(!written.complete){
          const row:FederalMoneyStateProgress={state,status:"BACKFILL",counts:prior?.counts??startingCounts,cursor:checkpoint?.cursor??null,
            lastCompleteAt:savedCheckpoint?.lastCompleteAt??null,reason:null};
          progress.set(state,row);input.onState?.(row);await input.onProgress?.(row,at);continue;
        }
        delta=written.delta;
      }
      const cursor = page.continuation ? JSON.parse(JSON.stringify(page.continuation)) as FederalMoneyCursor : null;
      const projection: FederalMoneyCheckpoint = { formatVersion: 2, source: input.source, state,
        counts: unchanged?prior?.counts??startingCounts:addFederalMoneyCounts(startingCounts,delta),
        checkpoint: { ...projectionVersion, complete: page.complete, cursor,
          lastCompleteAt: page.complete ? at : savedCheckpoint?.lastCompleteAt ?? null, refreshStartedAt,
          ...(rawHash && dependencyHash ? {sourcePages:{...savedCheckpoint?.sourcePages,[sourceKey]:{rawHash,dependencyHash}}}
            : savedCheckpoint?.sourcePages ? {sourcePages:savedCheckpoint.sourcePages} : {}) } };
      const candidate = federalMoneyCandidate({ projection, page: { ...page, facts: [], captures: [] }, now: at, predecessorVersionId: prior?.versionId });
      const outcome = await processRegisteredFanOutCandidate(input.store, input.source, candidate, at, prior?.versionId ?? null);
      if (!outcome.promoted) throw new Error(outcome.candidate.failureDetail ?? `${input.source}:${state} did not publish its source facts.`);
      sourceHashes.set(state,federalMoneyAppliedSourceHash(input.source,state,projection.checkpoint.sourcePages));
      const row: FederalMoneyStateProgress = { state, status: page.complete ? "COMPLETE" : "BACKFILL", counts: projection.counts,
        cursor: projection.checkpoint!.cursor, lastCompleteAt: projection.checkpoint!.lastCompleteAt, reason: null };
      progress.set(state, row); input.onState?.(row);
      await input.onProgress?.(row, at);
      await input.doorRead?.({ state, at, rows: page.facts.length, reason: null });
      if (page.complete) finished.add(state);
    }
  }
  const rows: FederalMoneyStateProgress[] = [];
  for (const state of states) {
    const visited = progress.get(state);
    if (visited) { rows.push(visited); continue; }
    const prior = await readFederalMoneyProgress(input.store,input.source,state);
    const checkpoint = prior?.checkpoint;
    sourceHashes.set(state,federalMoneyAppliedSourceHash(input.source,state,checkpoint?.sourcePages));
    rows.push({ state, status: "BACKFILL", counts: prior?.counts ?? federalMoneyCounts([]),
      cursor: checkpoint?.cursor ?? null, lastCompleteAt: checkpoint?.lastCompleteAt ?? null, reason: null });
  }
  const counts = rows.reduce((total, row) => ({ loaded: total.loaded + row.counts.loaded, joined: total.joined + row.counts.joined, unjoined: total.unjoined + row.counts.unjoined }), federalMoneyCounts([]));
  const projection: FederalMoneyNationalProjection = { formatVersion: 2, source: input.source, state: "US", states: rows, counts,
    sourceHashes:Object.fromEntries(sourceHashes) };
  const at = now();
  const outages = rows.filter(row => row.status === "OUTAGE");
  if (outages.length) {
    const failed = await recordRegisteredSourceAcquisitionFailure({ store: input.store, contractId: input.source, attemptedAt: at,
      failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", outages.map(row => `${row.state}: ${row.reason}`).join("; ")) });
    return { projection, outcome: failed.outcome, candidate: null };
  }
  const candidate = federalMoneyCandidate({ projection, page: { facts: [], captures: [], declaredTotal: null, complete: rows.every(row => row.status === "COMPLETE") }, now: at });
  const outcome = await processRegisteredRoutineCandidate(input.store, input.source, candidate, at);
  return { projection, outcome, candidate };
}

/** Reuse saved source evidence to attach a new identity to existing facts. Each
 * turn holds one bounded partition, and a crash resumes its saved count baseline. */
async function rejoinHeldPartition(input: FederalMoneyRefreshOptions, state: string, previous: FederalMoneyCheckpoint | null, previousVersion: string | null, at: string): Promise<FederalMoneyCheckpoint> {
  const saved: FederalMoneyCheckpoint["checkpoint"] = previous?.checkpoint ?? { complete: false, cursor: null, lastCompleteAt: null, refreshStartedAt: null };
  const scope = saved.joinPending?.scope ?? await input.nextHeldPartition!(state, saved.joinCursor ?? null);
  let counts: FederalMoneyCounts = previous?.counts ?? federalMoneyCounts([]);
  let version = previousVersion;
  const save = async (checkpoint: FederalMoneyCheckpoint["checkpoint"]) => {
    const projection: FederalMoneyCheckpoint = { formatVersion: 2, source: input.source, state, counts, checkpoint };
    const candidate = federalMoneyCandidate({ projection, page: { facts: [], captures: [], complete: false, declaredTotal: null }, now: at, predecessorVersionId: version });
    const outcome = await processRegisteredFanOutCandidate(input.store, input.source, candidate, at, version);
    if (!outcome.promoted) throw new Error(outcome.candidate.failureDetail ?? "The held federal records could not update their identities.");
    version = outcome.promoted.versionId;
    return projection;
  };
  const { joinPending: _pending, ...checkpoint } = saved;
  if (scope === null) return save({ ...checkpoint, joinVersion: FEDERAL_MONEY_JOIN_VERSION, joinCursor: null });
  if(!input.store.readPublicationBase)throw new Error("FEDERAL_PUBLICATION_BASE_READER_REQUIRED");
  const base=await input.store.readPublicationBase("FEDERAL_MONEY",scope);
  const held=base.current;
  const previousLeaf=held?.payload as FederalMoneyProjection|undefined;
  if (!previousLeaf || previousLeaf.source !== input.source || previousLeaf.state !== state || previousLeaf.formatVersion !== 2) throw new Error("The held federal partition is unavailable.");
  if (previousLeaf.records?.length) {
    const identity = await input.identities(state, previousLeaf.records);
    const records = joinFederalMoneyFacts(previousLeaf.records, identity);
    const captures=(base.lkg?.candidate.normalizedPayload as FederalMoneyEvidence|undefined)?.captures??[];
    const baselines = saved.joinPending?.baselines ?? await federalMoneyPartitionBaselines(input.store, input.source, state, records);
    if (!saved.joinPending) await save({ ...checkpoint, joinPending: { scope, baselines } });
    const written = await withFederalMoneyVerificationCache(() => writeFederalMoneyPartitions({ source: input.source, state, store: input.store, now: at,
      page: { facts: records, captures, complete: false, declaredTotal: null }, baselines, onPartition: input.onPartition,publicationBases:new Map([[scope,base]]) }));
    counts = addFederalMoneyCounts(counts, written.delta);
  }
  return save({ ...checkpoint, joinCursor: scope });
}

/** A scheduled pass can end at its deadline after a few large states. Each pass starts with the states served longest ago,
 * never-served first, so no state waits behind the same large states pass after pass. Ties keep the configured order. */
async function leastRecentlyServed(store: RoutineDataStore, source: FederalMoneySource, states: readonly string[]): Promise<readonly string[]> {
  const served = new Map<string, number>();
  const pointers = await store.readPromotionIdentities("FEDERAL_MONEY",states.map(state=>federalMoneyScope(source,state)));
  const byScope=new Map(pointers.map(pointer=>[pointer.scope,pointer]));
  for (const state of states) {const prior=byScope.get(federalMoneyScope(source,state));
    served.set(state, prior ? Math.max(Date.parse(prior.promotedAt), Date.parse(prior.latestConfirmation?.retrieval.retrievedAt ?? "") || 0) : -1);}
  return [...states].sort((a, b) => served.get(a)! - served.get(b)!);
}
