import type { BoxFinding } from "../box.ts";
import type { WorkerResultRecord } from "../workers/types.ts";
import type { AdminEvidenceCopyRequest } from "../evidence/admin-copy-request.ts";
import type { AskGapObservation } from "../ask-gap-observations.ts";
import type { DoorRecord } from "../../doors/registry.ts";
import type { LeadOrder } from "../leads/order.ts";
import { memoryWebsitePacing } from "../website-pacing.ts";
import type { LiveAuditLogRow } from "../live-audit-log.ts";
import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
import { unavailableActiveWorkClaims } from "./active-work-claims.ts";
import { inProcessSpendHoldStore } from "../expansion/spend-holds.ts";

import type { Attempt, ExecutionLease } from "../attempt.ts";
import type { FreshnessDebt } from "../scheduler/debt.ts";
import type { FreshnessOccurrence, StandingObligation } from "../scheduler/durable.ts";
import type { ResearchIntent, ResearchState } from "../scheduler/research-policy.ts";
import { costRepositoryWithCharges, logModelCharges, type ModelChargeRecord } from "./model-charges.ts";
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
import type { FieldManualEntry } from "../field-manual.ts";
import { fieldManualRows } from "./field-manual-rows.ts";
import { aggregateFixMap, type FixMapRow } from "../../method/fix-map.ts";
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
  heldSlotKeys,
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
  type HeldSlots,
  type LockManager,
  type Persisted,
  type PutOutcome,
  type RecordedTransition,
  type RecordProjection,
} from "./types.ts";

/** Stand-in for the database clock behind `changed_at`: a process-wide counter, monotonic, never the wall clock. */
let changeClockMs = Date.parse("2000-01-01T00:00:00.000Z");
const changeClock = { tick: (): number => (changeClockMs += 1), now: (): number => changeClockMs };
const changeIso = (ms: number): string => new Date(ms).toISOString();

/** One in-memory aggregate store with the full CAS contract. */
export function memoryAggregateRepository<T>(kind: string): AggregateRepository<T> {
  const rows = new Map<string, Persisted<T>>();
  /** Each row's `changed_at`, moved on every put that creates and every compare-and-set. */
  const changedAt = new Map<string, number>();
  /** Revision-1 values: `put` compares against the creation, not the latest state. */
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

    /* `AggregateRepository.readMany`: the named rows that exist, in id order, as Postgres answers it. */
    readMany: async (ids: readonly string[]): Promise<readonly Persisted<T>[]> =>
      [...new Set(ids)].sort().flatMap((id) => { const row = rows.get(id); return row === undefined ? [] : [{ ...row, value: jsonCopy(row.value) }]; }),

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
        // Throws IdentityCollision when the creation values differ; a no-op when created from exactly these inputs.
        reconcileIdempotentPut(kind, id, origin, value);
        return { created: false, persisted: { ...existing, value: jsonCopy(existing.value) } };
      }
      const persisted: Persisted<T> = { id, revision: 1, updatedAt: now, value: jsonCopy(value) };
      rows.set(id, persisted);
      changedAt.set(id, changeClock.tick());
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
      changedAt.set(id, changeClock.tick());
      return { ...persisted, value: jsonCopy(persisted.value) };
    },

    list,
    listNarrowed: async (projection: RecordProjection): Promise<readonly Persisted<unknown>[]> =>
      (await list()).map(row => ({ ...row, value: projectAggregate(row.value, projection) })),

    /* `list()` filtered, so the two can never disagree on rows or order. */
    listWhere: async (jsonPath: readonly string[], value: string): Promise<readonly Persisted<T>[]> =>
      (await list()).filter((row) => jsonTextAtPath(row.value, jsonPath) === value),
    listWhereNarrowed: async (jsonPath: readonly string[], value: string, projection: RecordProjection): Promise<readonly Persisted<unknown>[]> =>
      (await list()).filter((row) => jsonTextAtPath(row.value, jsonPath) === value).map(row => ({ ...row, value: projectAggregate(row.value, projection) })),

    listChangedSince: async (since: string | null, held?: HeldSlots) => {
      const through = changeIso(changeClock.now());
      const from = since === null ? null : Date.parse(since);
      const skip = heldSlotKeys(held);
      return { through, rows: (await list()).filter((row) => (from === null || (changedAt.get(row.id) ?? 0) >= from) &&
        !skip.has(`${row.id}\n${row.revision}`)) };
    },
  };
}

interface LoggedRecord<T> {
  readonly at: string;
  readonly recordId: string;
  readonly record: T;
  readonly changedAt: number;
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
        // Throws AppendOnlyViolation on a rewrite; a byte-identical retry is a no-op success.
        reconcileIdempotentAppend(log, recordId, existing.record, record);
        return {
          appended: false,
          recordId,
          record: jsonCopy(existing.record),
          position: partition.indexOf(existing),
        };
      }
      partition.push({ recordId, record: jsonCopy(record), at: now, changedAt: changeClock.tick() });
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
      value: string | readonly string[],
      limit: number,
      projection: RecordProjection,
      recordedAtSince?: string,
      equals?: Readonly<Record<string, string>>,
      orderBy?: string,
    ): Promise<readonly unknown[]> => {
      const since = recordedAtSince === undefined ? null : Date.parse(recordedAtSince);
      const matches = (partitions.get(key) ?? [])
        .filter((entry) => (typeof value === "string" ? jsonTextAtPath(entry.record, jsonPath) === value : value.includes(jsonTextAtPath(entry.record, jsonPath) ?? "")) &&
          Object.entries(equals ?? {}).every(([field, expected]) => jsonTextAtPath(entry.record, [field]) === expected) &&
          (since === null || Date.parse(entry.at) >= since));
      if (orderBy) matches.sort((a, b) => String(jsonTextAtPath(a.record, [orderBy]) ?? "").localeCompare(String(jsonTextAtPath(b.record, [orderBy]) ?? "")));
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

    readAllNarrowed: async (projection) =>
      [...partitions.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .flatMap(([, entries]) => entries.map((entry) => projectRecord(jsonCopy(entry.record), projection))),

    keys: async (): Promise<readonly string[]> => [...partitions.keys()].sort(),

    readChangedSince: async (since: string | null, held?: HeldSlots) => {
      const through = changeIso(changeClock.now());
      const from = since === null ? null : Date.parse(since);
      const skip = heldSlotKeys(held);
      return {
        through,
        records: [...partitions.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
          .flatMap(([key, entries]) => entries.flatMap((entry, position) =>
            (from !== null && entry.changedAt < from) || skip.has(`${key}\n${position}`) ? []
              : [{ key, recordId: entry.recordId, position, record: jsonCopy(entry.record) }])),
      };
    },

    readKeys: async (keys: readonly string[]): Promise<ReadonlyMap<string, readonly T[]>> => {
      const out = new Map<string, readonly T[]>();
      for (const key of new Set(keys)) {
        const entries = partitions.get(key);
        if (entries !== undefined && entries.length > 0) out.set(key, entries.map((entry) => jsonCopy(entry.record)));
      }
      return out;
    },

    keysWhere: async (jsonPath: readonly string[], value: string): Promise<readonly string[]> =>
      [...partitions.entries()].filter(([, entries]) => entries.some((entry) => jsonTextAtPath(entry.record, jsonPath) === value))
        .map(([key]) => key).sort(),
  };
}

/** Refuses rather than waits, like the file store. */
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
  const adminReceipts = memoryAppendOnlyRepository<ActionReceipt>("admin_receipts");

  const modelCharges = logModelCharges(memoryAppendOnlyRepository<ModelChargeRecord>("model_charges"));
  return {
    async adminActionHistoryPage(query) {
      // Positions belong to the append log, so new rows do not shift an older cursor.
      return (await adminReceipts.read("admin-action")).map((receipt, position) => ({ receipt, position }))
        .filter(row => (query.scope === "us" || row.receipt.subject === query.scope || row.receipt.requestedSubject === query.scope) &&
          (query.beforePosition == null || row.position < query.beforePosition))
        .sort((a, b) => b.position - a.position).slice(0, query.limit);
    },
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
    capturedCanonicalUrls: async (urls) => {
      const wanted = new Set(urls);
      return new Set((await artifacts.readAll()).map(record => record.canonicalUrl).filter(url => wanted.has(url)));
    },
    adminEvidenceCopyRequests: memoryAggregateRepository<AdminEvidenceCopyRequest>("AdminEvidenceCopyRequest"),
    costs: costRepositoryWithCharges(memoryAppendOnlyRepository<CostEntry>("costs"), modelCharges),
    ownerSnapshots: memoryAggregateRepository<OwnerSnapshot>("OwnerSnapshot"),
    fieldManual: fieldManualRows(memoryAggregateRepository<FieldManualEntry>("FieldManualEntry")),
    fixMap: aggregateFixMap(memoryAggregateRepository<FixMapRow>("FixMapRow")),
    websitePacing: memoryWebsitePacing(),
    runnerHeartbeat: memoryAggregateRepository<RunnerHeartbeat>("RunnerHeartbeat"),
    cacheObservations: memoryAggregateRepository<CacheObservationRecord>("CacheObservationRecord"),
    ownerDigests: memoryAppendOnlyRepository<OwnerDigestRecord>("owner_digests"),
    ownerDecisions: memoryAppendOnlyRepository<OwnerDecisionIntent>("owner_decisions"),
    researchState: memoryAggregateRepository<ResearchState>("ResearchState"),
    modelCharges,
    methodCandidates: memoryAggregateRepository<CandidateStore>("MethodCandidateStore"),
    researchIntents: memoryAppendOnlyRepository<ResearchIntent>("research_intents"),
    boxFindings: memoryAggregateRepository<BoxFinding>("BoxFinding"),
    scoutResults: memoryAppendOnlyRepository<ScoutResult>("scout_results"),
    workerResults: memoryAppendOnlyRepository<WorkerResultRecord>("worker_results"),
    promotionPipeline: memoryAppendOnlyRepository<PromotionPipelineRecord>("promotion_pipeline"),
    windowRuns: memoryAppendOnlyRepository<WindowRunRecord>("window_runs"),
    windowIncidents: memoryAppendOnlyRepository<WindowIncident>("window_incidents"),
    windowIntents: memoryAppendOnlyRepository<WindowIntent>("window_intents"),
    softwareReleaseReviews: memoryAppendOnlyRepository<SoftwareReleaseReviewRecord>("software_release_reviews"),
    adminReceipts,
    agentJobs: memoryAppendOnlyRepository<AgentJobRecord>("agent_jobs"),
    discoveryAttempts: memoryAppendOnlyRepository<MeetingsDiscoveryAttempt>("discovery_attempts"),
    liveAudits: memoryAppendOnlyRepository<LiveAuditLogRow>("live_audits"),
    adminConfig: memoryAggregateRepository<AdminConfig>("AdminConfig"),
    askGapObservations: memoryAggregateRepository<AskGapObservation>("AskGapObservation"),
    doors: memoryAggregateRepository<DoorRecord>("Door"),
    leadOrders: memoryAggregateRepository<LeadOrder>("LeadOrder"),
    budget: budgetRepositoryFrom(budgetAggregate, locks),
    spendHolds: inProcessSpendHoldStore(),
    locks,
    describe: () => "in-memory control-plane repositories (lost when this process ends)",
    durable: false,
  };
}
