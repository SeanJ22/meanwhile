import { acquireFederalMoney, type FederalMoneyAcquireOptions } from "./acquire.ts";
import { federalMoneyCandidate, federalMoneyCounts, mergeFederalMoneyRecords, type FederalMoneyNationalProjection, type FederalMoneyStateProgress } from "./candidate.ts";
import { joinFederalMoneyFacts, type FederalMoneyJoinInput } from "./join.ts";
import { federalMoneyScope, type FederalMoneyCursor, type FederalMoneyPage, type FederalMoneyProjection, type FederalMoneySource } from "./model.ts";
import { FEDERAL_MONEY_CONFIG, FEDERAL_MONEY_STATES } from "./sources.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate, type PromotionOutcome } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure } from "../civic-data/source-acquisition-failure.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";

export interface FederalMoneyRefreshOptions {
  readonly source: FederalMoneySource; readonly store: RoutineDataStore;
  readonly states?: readonly string[]; readonly acquireOptions?: FederalMoneyAcquireOptions;
  readonly acquire?: typeof acquireFederalMoney; readonly now?: () => string;
  readonly identities: (state: string) => Promise<FederalMoneyJoinInput>;
  readonly doorRead?: (input: { state: string; at: string; rows: number; reason: string | null }) => Promise<void>;
  readonly onState?: (row: FederalMoneyStateProgress) => void;
  /** Bound work to the existing child lifetime, then immediately resume on the next admission. */
  readonly maxRunMs?: number; readonly maxRounds?: number;
}

/** Fair national passes publish each page immediately and retain continuation
 * in the existing durable state pointer. No state can erase another's facts. */
export async function refreshFederalMoney(input: FederalMoneyRefreshOptions): Promise<{ projection: FederalMoneyNationalProjection; outcome: PromotionOutcome; candidate: ReturnType<typeof federalMoneyCandidate> | null }> {
  const now = input.now ?? (() => new Date().toISOString()), started = Date.now();
  const states = input.states ?? FEDERAL_MONEY_STATES;
  const acquire = input.acquire ?? acquireFederalMoney;
  const progress = new Map<string, FederalMoneyStateProgress>();
  const finished = new Set<string>();
  const maxRunMs = input.maxRunMs ?? 25 * 60_000;
  let latestPage: FederalMoneyPage = { facts: [], captures: [], complete: false, declaredTotal: null };
  for (let round = 0; round < (input.maxRounds ?? Infinity) && Date.now() - started < maxRunMs && finished.size < states.length; round++) {
    for (const state of states) {
      if (finished.has(state) || Date.now() - started >= maxRunMs) continue;
      const scope = federalMoneyScope(input.source, state);
      const prior = await input.store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", scope);
      const checkpoint = prior?.payload.checkpoint;
      const lastCompleteAt = checkpoint?.complete ? prior?.latestConfirmation?.retrieval.retrievedAt ?? checkpoint.lastCompleteAt : checkpoint?.lastCompleteAt;
      if (round === 0 && checkpoint?.complete && lastCompleteAt &&
        Date.parse(now()) - Date.parse(lastCompleteAt) < FEDERAL_MONEY_CONFIG[input.source].everyMs) {
        progress.set(state, { state, status: "COMPLETE", counts: prior!.payload.counts, cursor: null, lastCompleteAt, reason: null });
        finished.add(state); continue;
      }
      let page: FederalMoneyPage;
      const refreshStartedAt = !checkpoint?.complete && checkpoint?.refreshStartedAt
        ? checkpoint.refreshStartedAt : now();
      try {
        // A deadline stops a work slice without discarding the last durable cursor.
        const signal = AbortSignal.timeout(Math.max(1, maxRunMs - (Date.now() - started)));
        const parent = input.acquireOptions?.signal;
        page = await acquire(input.source, state, { ...input.acquireOptions, signal: parent ? AbortSignal.any([signal, parent]) : signal,
          now, cursor: checkpoint?.complete ? null : checkpoint?.cursor,
          since: checkpoint?.complete ? checkpoint.refreshStartedAt ?? undefined : checkpoint?.cursor?.since,
          maxPages: 1 });
      } catch (error) {
        const reason = sanitizedErrorDiagnostic(error);
        const at = now();
        const row: FederalMoneyStateProgress = { state, status: "OUTAGE", counts: prior?.payload.counts ?? federalMoneyCounts([]),
          cursor: checkpoint?.cursor ?? null, lastCompleteAt: checkpoint?.lastCompleteAt ?? null, reason };
        progress.set(state, row); finished.add(state); input.onState?.(row);
        await input.doorRead?.({ state, at, rows: row.counts.loaded, reason });
        continue;
      }
      let identities: FederalMoneyJoinInput;
      let identityReason: string | null = null;
      try { identities = await input.identities(state); }
      catch (error) { identities = { divisions: [], bodies: [], governments: [] }; identityReason = sanitizedErrorDiagnostic(error); }
      // Rejoin retained native rows when SAM registrations or local identities advance.
      let records = joinFederalMoneyFacts(mergeFederalMoneyRecords(prior?.payload.records ?? [], page.facts), identities);
      if (identityReason) records = records.map(row => row.joinStatus === "UNJOINED" ? { ...row, joinReason: `Held government identities could not be read (${identityReason}); native row retained.` } : row);
      const at = now();
      // Optional provider cursor fields disappear in JSONB. Hash the durable
      // cursor shape rather than an in-memory object containing undefined.
      const cursor = page.continuation ? JSON.parse(JSON.stringify(page.continuation)) as FederalMoneyCursor : null;
      const projection: FederalMoneyProjection = { formatVersion: 1, source: input.source, state, records, counts: federalMoneyCounts(records),
        checkpoint: { complete: page.complete, cursor,
          lastCompleteAt: page.complete ? at : checkpoint?.lastCompleteAt ?? null, refreshStartedAt } };
      const candidate = federalMoneyCandidate({ projection, page, now: at, predecessorVersionId: prior?.versionId });
      const outcome = await processRegisteredFanOutCandidate(input.store, input.source, candidate, at, prior?.versionId ?? null);
      if (!outcome.promoted) throw new Error(outcome.candidate.failureDetail ?? `${input.source}:${state} did not publish its source facts.`);
      const row: FederalMoneyStateProgress = { state, status: page.complete ? "COMPLETE" : "BACKFILL", counts: projection.counts,
        cursor: projection.checkpoint!.cursor, lastCompleteAt: projection.checkpoint!.lastCompleteAt, reason: identityReason };
      progress.set(state, row); input.onState?.(row);
      await input.doorRead?.({ state, at, rows: page.facts.length, reason: null });
      latestPage = page;
      if (page.complete) finished.add(state);
    }
  }
  // The bounded marker is national counts only, never a national record array.
  const rows: FederalMoneyStateProgress[] = [];
  for (const state of states) {
    const visited = progress.get(state);
    if (visited) { rows.push(visited); continue; }
    // A work slice may end before visiting this state. Preserve its durable
    // inventory instead of reporting previously loaded rows as zero.
    const prior = await input.store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", federalMoneyScope(input.source, state));
    const checkpoint = prior?.payload.checkpoint;
    rows.push({ state, status: "BACKFILL", counts: prior?.payload.counts ?? federalMoneyCounts([]),
      cursor: checkpoint?.cursor ?? null, lastCompleteAt: checkpoint?.lastCompleteAt ?? null, reason: null });
  }
  const counts = rows.reduce((total, row) => ({ loaded: total.loaded + row.counts.loaded, joined: total.joined + row.counts.joined, unjoined: total.unjoined + row.counts.unjoined }), federalMoneyCounts([]));
  const projection: FederalMoneyNationalProjection = { formatVersion: 1, source: input.source, state: "US", states: rows, counts };
  const at = now();
  // Partial successes remain published. A real outage records a failed source
  // attempt so the source's retry clock runs and the previous national marker stays live.
  const outages = rows.filter(row => row.status === "OUTAGE");
  if (outages.length) {
    const failed = await recordRegisteredSourceAcquisitionFailure({ store: input.store, contractId: input.source, attemptedAt: at,
      failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", outages.map(row => `${row.state}: ${row.reason}`).join("; ")) });
    return { projection, outcome: failed.outcome, candidate: null };
  }
  const candidate = federalMoneyCandidate({ projection, page: { ...latestPage, complete: rows.every(row => row.status === "COMPLETE") }, now: at });
  const outcome = await processRegisteredRoutineCandidate(input.store, input.source, candidate, at);
  return { projection, outcome, candidate };
}
