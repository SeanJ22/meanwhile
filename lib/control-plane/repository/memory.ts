import type { WorkerResultRecord } from "../workers/types.ts";
import type { AdminEvidenceCopyRequest } from "../evidence/admin-copy-request.ts";
import type { AskGapObservation } from "../ask-gap-observations.ts";
import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
import { unavailableActiveWorkClaims } from "./active-work-claims.ts";
/**
 * THE IN-PROCESS DOUBLE.
 *
 * This exists to pin semantics, not to store anything. It holds the same rules
 * as `file-store.ts` — idempotent derived-identity puts, append-only histories,
 * compare-and-set with a named `ConcurrentModification`, exclusive locks that
 * REFUSE rather than wait — over a `Map`, so the rule suite can run without a
 * disk.
 *
 * WHAT IT DOES NOT DO, stated here rather than discovered later: it does not
 * survive the process. `durable` is false and `assertDurableRepositories` refuses
 * it wherever durability is the property under test. The crash-recovery
 * acceptance suite therefore runs against the FILE store; this double runs the
 * concurrency-rule suite, where what is being asserted is a refusal rather than
 * a survival.
 *
 * Nothing here reads a clock.
 */

import type { Attempt, ExecutionLease } from "../attempt.ts";
import type { FreshnessDebt } from "../scheduler/debt.ts";
import type { FreshnessOccurrence, StandingObligation } from "../scheduler/durable.ts";
import type { ResearchIntent, ResearchState } from "../scheduler/research-policy.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type {
  PromotionPipelineRecord,
  WindowIncident,
  WindowIntent,
  WindowRunRecord,
} from "../promotion/types.ts";
import type { BudgetLedger } from "../budget.ts";
import type { CostEntry } from "../cost.ts";
import type { RouteTask } from "../route-task.ts";
import type { Escalation, WorkItem } from "../work-item.ts";
import type {
  CacheObservationRecord,
  OwnerDecisionIntent,
  OwnerDigestRecord,
  OwnerSnapshot,
  RunnerHeartbeat,
} from "../owner-surface.ts";
import type { FieldManualStore } from "../field-manual.ts";
import type { ActionReceipt } from "../gateway/contract.ts";
import type { AgentJobRecord } from "../gateway/agent-job.ts";
import type { MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";
import type { CandidateStore } from "../../method/candidate.ts";
import { budgetRepositoryFrom, jsonCopy } from "./shared.ts";
import {
  ConcurrentModification,
  RepositoryLockHeld,
  UnknownAggregate,
  jsonTextAtPath,
  projectAggregate,
  projectRecord,
  reconcileIdempotentAppend,
  reconcileIdempotentPut,
  type AggregateRepository,
  type AppendOnlyRepository,
  type AppendOutcome,
  type ArtifactRecord,
  type ControlPlaneRepositories,
  type DispositionCommit,
  type LockManager,
  type Persisted,
  type PutOutcome,
  type RecordedTransition,
  type RecordProjection,
} from "./types.ts";

/** One in-memory aggregate store with the full CAS contract. */
export function memoryAggregateRepository<T>(kind: string): AggregateRepository<T> {
  const rows = new Map<string, Persisted<T>>();
  /**
   * The revision-1 value of every aggregate, kept because `put` compares against
   * the CREATION rather than the latest state — the same rule the file store
   * gets for free from keeping one file per revision. Without this the double
   * would refuse a re-registration the durable store accepts, which is exactly
   * the kind of drift that makes a double worse than nothing.
   */
  const origins = new Map<string, T>();

  const read = async (id: string): Promise<Persisted<T> | null> => {
    const row = rows.get(id);
    return row === undefined ? null : { ...row, value: jsonCopy(row.value) };
  };

  const list = async (): Promise<readonly Persisted<T>[]> =>
    [...rows.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((row) => ({ ...row, value: jsonCopy(row.value) }));

  return {
    read,

    readNarrowed: async (id: string, projection: RecordProjection): Promise<Persisted<unknown> | null> => {
      const row = await read(id);
      return row === null ? null : { ...row, value: projectAggregate(row.value, projection) };
    },

    mustRead: async (id: string): Promise<Persisted<T>> => {
      const row = await read(id);
      if (row === null) throw new UnknownAggregate(kind, id);
      return row;
    },

    put: async (id: string, value: T, now: string): Promise<PutOutcome<T>> => {
      const existing = rows.get(id);
      const origin = origins.get(id);
      if (existing !== undefined && origin !== undefined) {
        // Throws IdentityCollision when the CREATION values genuinely differ;
        // returns false — a no-op success — when this id was created from
        // exactly these inputs, however far the aggregate has moved since.
        reconcileIdempotentPut(kind, id, origin, value);
        return { created: false, persisted: { ...existing, value: jsonCopy(existing.value) } };
      }
      const persisted: Persisted<T> = { id, revision: 1, updatedAt: now, value: jsonCopy(value) };
      rows.set(id, persisted);
      origins.set(id, jsonCopy(value));
      return { created: true, persisted: { ...persisted, value: jsonCopy(persisted.value) } };
    },

    compareAndSet: async (
      id: string,
      expectedRevision: number,
      next: T,
      now: string,
    ): Promise<Persisted<T>> => {
      const existing = rows.get(id);
      if (existing === undefined) {
        throw new ConcurrentModification(kind, id, expectedRevision, null);
      }
      if (existing.revision !== expectedRevision) {
        throw new ConcurrentModification(kind, id, expectedRevision, existing.revision);
      }
      const persisted: Persisted<T> = {
        id,
        revision: existing.revision + 1,
        updatedAt: now,
        value: jsonCopy(next),
      };
      rows.set(id, persisted);
      return { ...persisted, value: jsonCopy(persisted.value) };
    },

    list,
    listNarrowed: async (projection: RecordProjection): Promise<readonly Persisted<unknown>[]> =>
      (await list()).map(row => ({ ...row, value: projectAggregate(row.value, projection) })),

    /* `list()` filtered, so the two can never disagree on rows or order. */
    listWhere: async (jsonPath: readonly string[], value: string): Promise<readonly Persisted<T>[]> =>
      (await list()).filter((row) => jsonTextAtPath(row.value, jsonPath) === value),
  };
}

interface LoggedRecord<T> {
  readonly at: string;
  readonly recordId: string;
  readonly record: T;
}

/** One in-memory append-only log, partitioned by key. */
export function memoryAppendOnlyRepository<T>(log: string): AppendOnlyRepository<T> {
  const partitions = new Map<string, LoggedRecord<T>[]>();

  return {
    append: async (
      key: string,
      recordId: string,
      record: T,
      now: string,
    ): Promise<AppendOutcome<T>> => {
      const partition = partitions.get(key) ?? [];
      const existing = partition.find((entry) => entry.recordId === recordId);
      if (existing !== undefined) {
        // Throws AppendOnlyViolation on a rewrite; a byte-identical retry after
        // a partial failure is a no-op success rather than a duplicate entry.
        reconcileIdempotentAppend(log, recordId, existing.record, record);
        return {
          appended: false,
          recordId,
          record: jsonCopy(existing.record),
          position: partition.indexOf(existing),
        };
      }
      partition.push({ recordId, record: jsonCopy(record), at: now });
      partitions.set(key, partition);
      return {
        appended: true,
        recordId,
        record: jsonCopy(record),
        position: partition.length - 1,
      };
    },

    read: async (key: string): Promise<readonly T[]> =>
      (partitions.get(key) ?? []).map((entry) => jsonCopy(entry.record)),

    readWhere: async (
      key: string,
      jsonPath: readonly string[],
      value: string,
    ): Promise<readonly T[]> =>
      (partitions.get(key) ?? [])
        .filter((entry) => jsonTextAtPath(entry.record, jsonPath) === value)
        .map((entry) => jsonCopy(entry.record)),

    readRecent: async (key: string, limit: number): Promise<readonly T[]> => {
      const partition = partitions.get(key) ?? [];
      const bounded = Math.max(0, Math.trunc(limit));
      return partition
        .slice(Math.max(0, partition.length - bounded))
        .reverse()
        .map((entry) => jsonCopy(entry.record));
    },

    readRecentWhere: async (
      key: string,
      jsonPath: readonly string[],
      value: string,
      limit: number,
      projection: RecordProjection,
    ): Promise<readonly unknown[]> => {
      const matches = (partitions.get(key) ?? [])
        .filter((entry) => jsonTextAtPath(entry.record, jsonPath) === value);
      const bounded = Math.max(0, Math.trunc(limit));
      return matches
        .slice(Math.max(0, matches.length - bounded))
        .reverse()
        .map((entry) => projectRecord(jsonCopy(entry.record), projection));
    },

    readLatest: async (keys: readonly string[], projection: RecordProjection): Promise<ReadonlyMap<string, unknown>> => {
      const out = new Map<string, unknown>();
      for (const key of new Set(keys)) {
        const partition = partitions.get(key) ?? [];
        const newest = partition[partition.length - 1];
        if (newest !== undefined) out.set(key, projectRecord(jsonCopy(newest.record), projection));
      }
      return out;
    },

    readSince: async (since: string): Promise<readonly T[]> =>
      [...partitions.keys()].sort().flatMap((key) => (partitions.get(key) ?? [])
        .filter((entry) => Date.parse(entry.at) >= Date.parse(since)).map((entry) => jsonCopy(entry.record))),

    readAll: async (): Promise<readonly T[]> =>
      [...partitions.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .flatMap(([, entries]) => entries.map((entry) => jsonCopy(entry.record))),

    keys: async (): Promise<readonly string[]> => [...partitions.keys()].sort(),
  };
}

/**
 * Exclusive sections over a `Set`.
 *
 * Refuses rather than waits, exactly as the file store does. The refusal is the
 * behaviour under test: a lock that silently queued would hide the contention
 * the suite is trying to observe.
 */
export function memoryLockManager(): LockManager {
  const held = new Set<string>();
  return {
    withLock: async <R>(name: string, fn: () => Promise<R>): Promise<R> => {
      if (held.has(name)) {
        throw new RepositoryLockHeld(name, "held by another in-process section");
      }
      held.add(name);
      try {
        return await fn();
      } finally {
        held.delete(name);
      }
    },
  };
}

/** The full bundle, in memory. Never durable, and says so. */
export function createMemoryRepositories(): ControlPlaneRepositories {
  const locks = memoryLockManager();
  const budgetAggregate = memoryAggregateRepository<BudgetLedger>("BudgetLedger");
  const artifacts = memoryAppendOnlyRepository<ArtifactRecord>("artifacts");

  return {
    workItems: memoryAggregateRepository<WorkItem>("WorkItem"),
    routeTasks: memoryAggregateRepository<RouteTask>("RouteTask"),
    attempts: memoryAggregateRepository<Attempt>("Attempt"),
    obligations: memoryAggregateRepository<StandingObligation>("StandingObligation"),
    occurrences: memoryAggregateRepository<FreshnessOccurrence>("FreshnessOccurrence"),
    debts: memoryAggregateRepository<FreshnessDebt>("FreshnessDebt"),
    leases: memoryAggregateRepository<ExecutionLease>("ExecutionLease"),
    activeWorkClaims: unavailableActiveWorkClaims(),
    transitions: memoryAppendOnlyRepository<RecordedTransition>("transitions"),
    escalations: memoryAppendOnlyRepository<Escalation>("escalations"),
    dispositions: memoryAppendOnlyRepository<DispositionCommit>("dispositions"),
    artifacts,
    artifactsByCanonicalUrl: async (url, limit) =>
      (await artifacts.readAll()).filter(record => record.canonicalUrl === url)
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.artifactId.localeCompare(b.artifactId))
        .slice(0, Math.max(0, Math.trunc(limit))),
    adminEvidenceCopyRequests: memoryAggregateRepository<AdminEvidenceCopyRequest>("AdminEvidenceCopyRequest"),
    costs: memoryAppendOnlyRepository<CostEntry>("costs"),
    /* The owner control centre's data plane (ITEM H). */
    ownerSnapshots: memoryAggregateRepository<OwnerSnapshot>("OwnerSnapshot"),
    fieldManual: memoryAggregateRepository<FieldManualStore>("FieldManual"),
    runnerHeartbeat: memoryAggregateRepository<RunnerHeartbeat>("RunnerHeartbeat"),
    cacheObservations: memoryAggregateRepository<CacheObservationRecord>("CacheObservationRecord"),
    ownerDigests: memoryAppendOnlyRepository<OwnerDigestRecord>("owner_digests"),
    ownerDecisions: memoryAppendOnlyRepository<OwnerDecisionIntent>("owner_decisions"),
    /* Level 1 — Research (schema v4). */
    researchState: memoryAggregateRepository<ResearchState>("ResearchState"),
    methodCandidates: memoryAggregateRepository<CandidateStore>("MethodCandidateStore"),
    researchIntents: memoryAppendOnlyRepository<ResearchIntent>("research_intents"),
    scoutResults: memoryAppendOnlyRepository<ScoutResult>("scout_results"),
    workerResults: memoryAppendOnlyRepository<WorkerResultRecord>("worker_results"),
    /* The nightly door (RULING 242, schema v5). */
    promotionPipeline: memoryAppendOnlyRepository<PromotionPipelineRecord>("promotion_pipeline"),
    windowRuns: memoryAppendOnlyRepository<WindowRunRecord>("window_runs"),
    windowIncidents: memoryAppendOnlyRepository<WindowIncident>("window_incidents"),
    windowIntents: memoryAppendOnlyRepository<WindowIntent>("window_intents"),
    /* Software release review (Admin Pass B, schema v8). */
    softwareReleaseReviews: memoryAppendOnlyRepository<SoftwareReleaseReviewRecord>("software_release_reviews"),
    /* The Action Gateway (Admin Pass C, ADM-C6, schema v9). */
    adminReceipts: memoryAppendOnlyRepository<ActionReceipt>("admin_receipts"),
    agentJobs: memoryAppendOnlyRepository<AgentJobRecord>("agent_jobs"),
    discoveryAttempts: memoryAppendOnlyRepository<MeetingsDiscoveryAttempt>("discovery_attempts"),
    adminConfig: memoryAggregateRepository<AdminConfig>("AdminConfig"),
    /* What readers were told Ask does not hold (schema v13). */
    askGapObservations: memoryAggregateRepository<AskGapObservation>("AskGapObservation"),
    budget: budgetRepositoryFrom(budgetAggregate, locks),
    locks,
    describe: () => "in-memory control-plane repositories (lost when this process ends)",
    durable: false,
  };
}
