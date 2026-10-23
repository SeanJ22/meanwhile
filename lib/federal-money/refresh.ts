import { acquireFederalMoney, federalMoneyAcquisitionVault, type FederalMoneyAcquireOptions } from "./acquire.ts";
import { federalMoneyCandidate, federalMoneyCounts, type FederalMoneyNationalProjection, type FederalMoneyStateProgress } from "./candidate.ts";
import { joinFederalMoneyFacts, type FederalMoneyJoinInput } from "./join.ts";
import { federalMoneyScope, OPENFEMA_STATE_PROJECTION_VERSION, type FederalMoneyCursor, type FederalMoneyPage, type FederalMoneyCheckpoint, type FederalMoneySource, type FederalMoneyPartition } from "./model.ts";
import { FEDERAL_MONEY_CONFIG, federalMoneySourceStates } from "./sources.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate, type PromotionOutcome } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure } from "../civic-data/source-acquisition-failure.ts";
import { writeFederalMoneyPartitions, federalMoneyPartitionBaselines, addFederalMoneyCounts, type FederalMoneyPartitionChange } from "./partitions.ts";
import { withFederalMoneyVault, readFederalMoneyCapture } from "./vault.ts";
import { parseFederalMoney } from "./parse.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { withFederalMoneyVerificationCache } from "./verify.ts";

interface FederalMoneyRefreshOptions {
  readonly source: FederalMoneySource; readonly store: RoutineDataStore;
  readonly states?: readonly string[]; readonly acquireOptions?: FederalMoneyAcquireOptions;
  readonly acquire?: typeof acquireFederalMoney; readonly now?: () => string;
  readonly identities: (state: string, facts: FederalMoneyPage["facts"]) => Promise<FederalMoneyJoinInput>;
  readonly locate?: (state: string, facts: FederalMoneyPage["facts"]) => Promise<readonly { id: string; partition: FederalMoneyPartition }[]>;
  readonly onPartition?: (change: FederalMoneyPartitionChange) => Promise<unknown>;
  readonly onProgress?: (row: FederalMoneyStateProgress, at: string) => Promise<void>;
  readonly doorRead?: (input: { state: string; at: string; rows: number; reason: string | null }) => Promise<void>;
  readonly onState?: (row: FederalMoneyStateProgress) => void;
  readonly maxRunMs?: number; readonly maxRounds?: number;
}

export async function refreshFederalMoney(input: FederalMoneyRefreshOptions): Promise<{ projection: FederalMoneyNationalProjection; outcome: PromotionOutcome; candidate: ReturnType<typeof federalMoneyCandidate> | null }> {
  const evidenceStore = input.acquireOptions?.evidenceStore ?? federalMoneyAcquisitionVault();
  return withFederalMoneyVault(evidenceStore, () => run({ ...input, acquireOptions: { ...input.acquireOptions, evidenceStore } }));
}
async function run(input: FederalMoneyRefreshOptions): Promise<{ projection: FederalMoneyNationalProjection; outcome: PromotionOutcome; candidate: ReturnType<typeof federalMoneyCandidate> | null }> {
  const now = input.now ?? (() => new Date().toISOString()), started = Date.now();
  const states = input.states ?? federalMoneySourceStates(input.source);
  const acquire = input.acquire ?? acquireFederalMoney;
  const progress = new Map<string, FederalMoneyStateProgress>();
  const finished = new Set<string>();
  const maxRunMs = input.maxRunMs ?? 25 * 60_000;
  for (let round = 0; round < (input.maxRounds ?? Infinity) && Date.now() - started < maxRunMs && finished.size < states.length; round++) {
    for (const state of states) {
      if (finished.has(state) || Date.now() - started >= maxRunMs) continue;
      const scope = federalMoneyScope(input.source, state);
      let prior = await input.store.readPromotion<FederalMoneyCheckpoint>("FEDERAL_MONEY", scope);
      const savedCheckpoint = prior?.payload.checkpoint;
      // Historical county-only OpenFEMA rows need one complete source pass. Keep
      // their published partitions while the new projection resumes page by page.
      const needsProjectionBackfill = input.source === "openfema" && savedCheckpoint?.projectionVersion !== OPENFEMA_STATE_PROJECTION_VERSION;
      const checkpoint = needsProjectionBackfill ? undefined : savedCheckpoint;
      const projectionVersion = input.source === "openfema" ? { projectionVersion: OPENFEMA_STATE_PROJECTION_VERSION } : {};
      const lastCompleteAt = savedCheckpoint?.complete ? prior?.latestConfirmation?.retrieval.retrievedAt ?? savedCheckpoint.lastCompleteAt : savedCheckpoint?.lastCompleteAt;
      if (round === 0 && checkpoint?.complete && lastCompleteAt &&
        Date.parse(now()) - Date.parse(lastCompleteAt) < FEDERAL_MONEY_CONFIG[input.source].everyMs) {
        const row: FederalMoneyStateProgress = { state, status: "COMPLETE", counts: prior!.payload.counts, cursor: null, lastCompleteAt, reason: null };
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
        const row: FederalMoneyStateProgress = { state, status: "OUTAGE", counts: prior?.payload.counts ?? federalMoneyCounts([]),
          cursor: checkpoint?.cursor ?? null, lastCompleteAt: savedCheckpoint?.lastCompleteAt ?? null, reason };
        progress.set(state, row); finished.add(state); input.onState?.(row);
        await input.doorRead?.({ state, at, rows: row.counts.loaded, reason });
        await input.onProgress?.(row, at);
        continue;
      }
      const at = now();
      const priorLocations = checkpoint?.pending?.priorLocations ?? await input.locate?.(state, page.facts) ?? [];
      const baselines = checkpoint?.pending?.baselines ?? await federalMoneyPartitionBaselines(input.store, input.source, state, page.facts, priorLocations);
      if (!checkpoint?.pending && page.facts.length) {
        const { facts: _facts, ...savedPage } = page;
        const pending: FederalMoneyCheckpoint = { formatVersion: 2, source: input.source, state,
          counts: prior?.payload.counts ?? federalMoneyCounts([]),
          checkpoint: { ...projectionVersion, complete: false, cursor: checkpoint?.cursor ?? null, lastCompleteAt: savedCheckpoint?.lastCompleteAt ?? null, refreshStartedAt,
            pending: { page: savedPage, baselines, priorLocations } } };
        const staged = federalMoneyCandidate({ projection: pending, page: { facts: [], captures: [], complete: false, declaredTotal: null }, now: at });
        const saved = await processRegisteredFanOutCandidate(input.store, input.source, staged, at, prior?.versionId ?? null);
        if (!saved.promoted) throw new Error(saved.candidate.failureDetail ?? "Federal page checkpoint could not be saved.");
        prior = saved.promoted as typeof prior;
      }
      let identities: FederalMoneyJoinInput;
      try { identities = await input.identities(state, page.facts); }
      catch (error) {
        const reason = sanitizedErrorDiagnostic(error);
        const row: FederalMoneyStateProgress = { state, status: "OUTAGE", counts: prior?.payload.counts ?? federalMoneyCounts([]),
          cursor: checkpoint?.cursor ?? null, lastCompleteAt: savedCheckpoint?.lastCompleteAt ?? null, reason };
        progress.set(state, row); finished.add(state); input.onState?.(row);
        await input.doorRead?.({ state, at, rows: page.facts.length, reason: null });
        await input.onProgress?.(row, at);
        continue;
      }
      const records = joinFederalMoneyFacts(page.facts, identities);
      const delta = await withFederalMoneyVerificationCache(() => writeFederalMoneyPartitions({ source: input.source, state, page: { ...page, facts: records }, store: input.store, now: at,
        onPartition: input.onPartition, baselines, priorLocations }));
      const cursor = page.continuation ? JSON.parse(JSON.stringify(page.continuation)) as FederalMoneyCursor : null;
      const projection: FederalMoneyCheckpoint = { formatVersion: 2, source: input.source, state,
        counts: addFederalMoneyCounts(prior?.payload.counts ?? federalMoneyCounts([]), delta),
        checkpoint: { ...projectionVersion, complete: page.complete, cursor,
          lastCompleteAt: page.complete ? at : savedCheckpoint?.lastCompleteAt ?? null, refreshStartedAt } };
      const candidate = federalMoneyCandidate({ projection, page: { ...page, facts: [], captures: [] }, now: at, predecessorVersionId: prior?.versionId });
      const outcome = await processRegisteredFanOutCandidate(input.store, input.source, candidate, at, prior?.versionId ?? null);
      if (!outcome.promoted) throw new Error(outcome.candidate.failureDetail ?? `${input.source}:${state} did not publish its source facts.`);
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
    const prior = await input.store.readPromotion<FederalMoneyCheckpoint>("FEDERAL_MONEY", federalMoneyScope(input.source, state));
    const checkpoint = prior?.payload.checkpoint;
    rows.push({ state, status: "BACKFILL", counts: prior?.payload.counts ?? federalMoneyCounts([]),
      cursor: checkpoint?.cursor ?? null, lastCompleteAt: checkpoint?.lastCompleteAt ?? null, reason: null });
  }
  const counts = rows.reduce((total, row) => ({ loaded: total.loaded + row.counts.loaded, joined: total.joined + row.counts.joined, unjoined: total.unjoined + row.counts.unjoined }), federalMoneyCounts([]));
  const projection: FederalMoneyNationalProjection = { formatVersion: 2, source: input.source, state: "US", states: rows, counts };
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
