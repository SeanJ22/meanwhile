import type { BoxRepository } from "../box.ts";
import type { FieldManualSourceHint,FieldManualSourceScope } from "../field-manual-sources.ts";
import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
import type { ActiveWorkClaimReader } from "./active-work-claims.ts";
import type { WorkerResultRecord } from "../workers/types.ts";
import type { AdminEvidenceCopyRequest } from "../evidence/admin-copy-request.ts";

import type { Attempt, ExecutionLease } from "../attempt.ts";
import type { FreshnessDebt } from "../scheduler/debt.ts";
import type { FreshnessOccurrence, StandingObligation } from "../scheduler/durable.ts";
import type { BudgetLedger } from "../budget.ts";
import type { SpendHoldStore } from "../expansion/spend-holds.ts";
import type { CostEntry } from "../cost.ts";
import type { ArtifactTier } from "../evidence/artifact.ts";
import type { RouteDisposition, RouteTask } from "../route-task.ts";
import type { Escalation, WorkItem, WorkItemTransition } from "../work-item.ts";
import type {
  CacheObservationRecord,
  OwnerDecisionIntent,
  OwnerDigestRecord,
  OwnerSnapshot,
  OwnerSnapshotState,
  RunnerHeartbeat,
} from "../owner-surface.ts";
import type { FieldManualEntry, FieldManualQuery, FieldManualRead } from "../field-manual.ts";
import type { FixMapRepository } from "../../method/fix-map.ts";
import type { ResearchIntent, ResearchState } from "../scheduler/research-policy.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type {
  PromotionPipelineRecord,
  WindowIncident,
  WindowIntent,
  WindowRunRecord,
} from "../promotion/types.ts";
import type { ActionReceipt } from "../gateway/contract.ts";
import type { AgentJobRecord } from "../gateway/agent-job.ts";
import type { MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";
import type { CandidateStore } from "../../method/candidate.ts";
import type { AskGapObservation } from "../ask-gap-observations.ts";
import type { LiveAuditLogRow } from "../live-audit-log.ts";
import type { DoorRecord } from "../../doors/registry.ts";
import type { LeadOrder } from "../leads/order.ts";
import type { WebsitePacing } from "../website-pacing.ts";
import type { OwnerSnapshotTotals, SpilledInbox, StateTotals } from "../owner-snapshot-totals.ts";

export interface Persisted<T> {
  readonly id: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly value: T;
}

export interface PutOutcome<T> {
  readonly created: boolean;
  readonly persisted: Persisted<T>;
}

export interface AppendOutcome<T> {
  readonly appended: boolean;
  readonly recordId: string;
  readonly record: T;

  readonly position: number;
}

export class IdentityCollision extends Error {
  readonly kind: string;
  readonly id: string;
  readonly existing: string;
  readonly incoming: string;

  constructor(kind: string, id: string, existing: string, incoming: string) {
    super(
      `${kind} ${id} already holds a DIFFERENT value. Identity here is derived from inputs, so ` +
        "two different values under one id are two obligations wearing one name. The write is " +
        `refused rather than resolved.\n  persisted: ${existing}\n  offered:   ${incoming}`,
    );
    this.name = "IdentityCollision";
    this.kind = kind;
    this.id = id;
    this.existing = existing;
    this.incoming = incoming;
  }
}

export class ConcurrentModification extends Error {
  readonly kind: string;
  readonly id: string;
  readonly expectedRevision: number;
  readonly foundRevision: number | null;

  constructor(kind: string, id: string, expectedRevision: number, foundRevision: number | null) {
    super(
      `${kind} ${id} was modified concurrently: the writer read revision ${expectedRevision} and ` +
        `the store holds ${foundRevision === null ? "NO RECORD" : `revision ${foundRevision}`}. ` +
        "The write is refused rather than applied over the newer state, because a stale writer " +
        "overwriting a live one is how an abandoned belief replaces a finding.",
    );
    this.name = "ConcurrentModification";
    this.kind = kind;
    this.id = id;
    this.expectedRevision = expectedRevision;
    this.foundRevision = foundRevision;
  }
}

export class AppendOnlyViolation extends Error {
  readonly log: string;
  readonly recordId: string;

  constructor(log: string, recordId: string, existing: string, incoming: string) {
    super(
      `Append-only log ${log} already contains record ${recordId} with different content. ` +
        "History is appended to, never rewritten; a corrected record is a NEW record that " +
        `supersedes the old one by name.\n  recorded: ${existing}\n  offered:  ${incoming}`,
    );
    this.name = "AppendOnlyViolation";
    this.log = log;
    this.recordId = recordId;
  }
}

export class CorruptPersistedState extends Error {
  readonly location: string;
  readonly detail: string;

  constructor(location: string, detail: string) {
    super(
      `Persisted control-plane state at ${location} could not be read: ${detail}. ` +
        "This is a FAILED read and is raised rather than returned as an empty result — " +
        "'we could not read it' and 'there is nothing there' are different sentences.",
    );
    this.name = "CorruptPersistedState";
    this.location = location;
    this.detail = detail;
  }
}

export class RepositoryLockHeld extends Error {
  readonly lockName: string;

  constructor(lockName: string, detail: string) {
    super(
      `Exclusive lock ${lockName} is already held (${detail}). The read-modify-write is refused ` +
        "rather than interleaved, because two processes interleaving one read-modify-write is " +
        "precisely the lost update the lock exists to prevent.",
    );
    this.name = "RepositoryLockHeld";
    this.lockName = lockName;
  }
}

export class UnknownAggregate extends Error {
  readonly kind: string;
  readonly id: string;

  constructor(kind: string, id: string) {
    super(
      `${kind} ${id} is not present in the durable store. The operation is refused rather than ` +
        "proceeding against a default: an aggregate that did not load is not an aggregate " +
        "that is empty.",
    );
    this.name = "UnknownAggregate";
    this.kind = kind;
    this.id = id;
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function reconcileIdempotentPut<T>(
  kind: string,
  id: string,
  existing: T,
  incoming: T,
): boolean {
  const a = canonicalJson(existing);
  const b = canonicalJson(incoming);
  if (a === b) return false;
  throw new IdentityCollision(kind, id, a, b);
}

export function reconcileIdempotentAppend<T>(
  log: string,
  recordId: string,
  existing: T,
  incoming: T,
): boolean {
  const a = canonicalJson(existing);
  const b = canonicalJson(incoming);
  if (a === b) return false;
  throw new AppendOnlyViolation(log, recordId, a, b);
}

export interface AggregateRepository<T> {

  read(id: string): Promise<Persisted<T> | null>;

  readNarrowed(id: string, projection: RecordProjection): Promise<Persisted<unknown> | null>;

  mustRead(id: string): Promise<Persisted<T>>;

  put(id: string, value: T, now: string): Promise<PutOutcome<T>>;

  compareAndSet(
    id: string,
    expectedRevision: number,
    next: T,
    now: string,
  ): Promise<Persisted<T>>;

  readMany?(ids: readonly string[]): Promise<readonly Persisted<T>[]>;
  /** `readMany`, each value narrowed to the projection by the store before it leaves. */
  readManyNarrowed?(ids: readonly string[], projection: RecordProjection): Promise<readonly Persisted<unknown>[]>;
  /** Rows whose scalar `#>>` value at `path` is one of `values`, in id order, each narrowed to the projection. */
  listWhereIn?(path: readonly string[], values: readonly string[], projection: RecordProjection): Promise<readonly Persisted<unknown>[]>;
  /** Every aggregate of this kind, ordered by id so reports are diffable. */
  list(): Promise<readonly Persisted<T>[]>;

  listNarrowed(projection: RecordProjection): Promise<readonly Persisted<unknown>[]>;

  listWhere(path: readonly string[], value: string): Promise<readonly Persisted<T>[]>;

  listWhereNarrowed(path: readonly string[], value: string, projection: RecordProjection): Promise<readonly Persisted<unknown>[]>;
  /**
   * Rows whose database-clock `changed_at` is at or after `since` (all when null), in id order, less any row `held`
   * names at its current revision; `through` is the store's clock when the read began.
   */
  listChangedSince?(since: string | null, held?: HeldSlots, options?: ChangedReadOptions<Persisted<T>>): Promise<ChangedRows<T>>;
}

/** `page` takes each page as it is read and the answer then holds no rows; `projection` narrows each one in the store. */
export interface ChangedReadOptions<R> {
  readonly page?: (rows: readonly R[]) => Promise<void> | void;
  readonly projection?: RecordProjection;
}

export type HeldSlots = readonly (readonly [string, number])[];

export function heldSlotKeys(held: HeldSlots | undefined): ReadonlySet<string> {
  return new Set((held ?? []).map(([slot, version]) => `${slot}\n${version}`));
}

export interface FieldManualRepository extends AggregateRepository<FieldManualEntry> {
  readMany(ids: readonly string[]): Promise<readonly Persisted<FieldManualEntry>[]>;

  select(query: FieldManualQuery): Promise<FieldManualRead>;
  sourceHints(scope:FieldManualSourceScope,url:string):Promise<readonly FieldManualSourceHint[]>;
  learnedRoutes(routeIds:readonly string[]):Promise<{present:boolean;routeIds:readonly string[]}>;

  insertNew(entries: readonly FieldManualEntry[], now: string): Promise<ReadonlySet<string>>;

  retireInstructions?(): Promise<void>;
}

export interface ChangedRows<T> {
  readonly rows: readonly Persisted<T>[];
  readonly through: string | null;
}

export interface ChangedRecord<T> {
  readonly key: string;
  readonly recordId: string;
  readonly position: number;
  readonly record: T;
  /** The store's clock when the record was appended, and the time the appender stamped it with. */
  readonly changedAt?: string;
  readonly stampedAt?: string;
}

export interface ChangedRecords<T> {
  readonly records: readonly ChangedRecord<T>[];
  readonly through: string | null;
}

export interface AppendOnlyRepository<T> {
  append(key: string, recordId: string, record: T, now: string): Promise<AppendOutcome<T>>;

  read(key: string): Promise<readonly T[]>;

  readWhere(key: string, path: readonly string[], value: string): Promise<readonly T[]>;

  readRecentWhere(
    key: string,
    path: readonly string[],
    value: string,
    limit: number,
    projection: RecordProjection,
    recordedAtSince?: string,
  ): Promise<readonly unknown[]>;

  readAll(): Promise<readonly T[]>;

  readAllNarrowed(projection: RecordProjection): Promise<readonly unknown[]>;

  readSince(since: string): Promise<readonly T[]>;

  readRecent(key: string, limit: number): Promise<readonly T[]>;

  readLatest(keys: readonly string[], projection: RecordProjection): Promise<ReadonlyMap<string, unknown>>;

  keys(): Promise<readonly string[]>;
  /** Exactly `keys()` narrowed to keys holding a matching record, sorted. */
  keysWhere(path: readonly string[], value: string): Promise<readonly string[]>;
  /** Exactly `read(key)` for each key, in one batched read; a key with no record is absent. */
  readKeys?(keys: readonly string[]): Promise<ReadonlyMap<string, readonly T[]>>;
  /** Records whose `changed_at` is at or after `since` (all when null), less any `held` names, in `readAll()` order, with coordinates. */
  readChangedSince(since: string | null, held?: HeldSlots, options?: ChangedReadOptions<ChangedRecord<T>>): Promise<ChangedRecords<T>>;
  /** Records the appender stamped at or after `from` and before `until`, handed over page by page with both clocks. */
  readStampedBetween?(from: string, until: string, page: (records: readonly ChangedRecord<T>[]) => Promise<void> | void): Promise<void>;
}

export async function readByKeys<T>(log: AppendOnlyRepository<T>, keys: readonly string[]): Promise<ReadonlyMap<string, readonly T[]>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return new Map();
  if (log.readKeys) return log.readKeys(unique);
  const out = new Map<string, readonly T[]>();
  for (const key of unique) {
    const records = await log.read(key);
    if (records.length > 0) out.set(key, records);
  }
  return out;
}

/** `true` keeps a top-level key whole; an object keeps only its named keys. Every other key is dropped. */
export type RecordProjection = Readonly<Record<string, true | readonly string[]>>;

export function projectRecord(record: unknown, projection: RecordProjection): unknown {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return record;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(projection, key)) continue;
    const keep = projection[key];
    if (keep === true || value === null || typeof value !== "object" || Array.isArray(value)) {
      out[key] = value;
      continue;
    }
    out[key] = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([inner]) => keep.includes(inner)),
    );
  }
  return out;
}

export function projectAggregate(value: unknown, projection: RecordProjection): unknown {
  return Object.keys(projection).length === 0 ? {} : projectRecord(value, projection);
}

export function jsonTextAtPath(record: unknown, path: readonly string[]): string | null {
  let cursor: unknown = record;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (cursor === null || cursor === undefined || typeof cursor === "object") return null;
  return String(cursor);
}

export interface BudgetRepository {
  read(): Promise<Persisted<BudgetLedger>>;

  install(ledger: BudgetLedger, now: string): Promise<PutOutcome<BudgetLedger>>;
  compareAndSet(
    expectedRevision: number,
    next: BudgetLedger,
    now: string,
  ): Promise<Persisted<BudgetLedger>>;

  mutate<R>(
    mutator: (ledger: BudgetLedger) => { readonly ledger: BudgetLedger; readonly result: R },
    now: string,
  ): Promise<{ readonly result: R; readonly persisted: Persisted<BudgetLedger> }>;
}

export type SpendHoldRepository = SpendHoldStore;

export interface LockManager {
  withLock<R>(name: string, fn: () => Promise<R>): Promise<R>;
}

export interface ArtifactRecord {
  readonly artifactId: string;
  readonly workItemId: string;
  readonly routeTaskId: string | null;

  readonly attemptId: string;
  readonly tier: ArtifactTier;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly contentType: string;
  readonly canonicalUrl: string;
  readonly httpStatus?: number | null;
  readonly retrievalUrl?: string;
  readonly permission?: import("../evidence/artifact.ts").Artifact["permission"];
  readonly transport?: import("../evidence/artifact.ts").Artifact["transport"];

  readonly partial: boolean;
  readonly recordedAt: string;

  readonly publicationLink?: {
    readonly candidacyId: string;
    readonly approvalRecordId: string;
    readonly sourceArtifactId: string;
    readonly sourceUrl: string;
    readonly sourceContentHash: string;
    readonly start: number;
    readonly end: number;
    readonly quote: string;
    readonly offsetUnit: "UTF16_CODE_UNITS";
  };
}

export interface DispositionCommit {
  readonly commitId: string;
  readonly routeTaskId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly disposition: RouteDisposition;

  readonly closedAttempt: Attempt;
  readonly disposedTask: RouteTask;

  readonly taskRevision: number;

  readonly attemptRevision: number;
  readonly committedAt: string;
}

export interface RecordedTransition {
  readonly transitionId: string;
  readonly workItemId: string;
  readonly transition: WorkItemTransition;
}

export interface ControlPlaneRepositories {

  readonly adminActionHistoryPage?: (query: import("./action-history-atomic.ts").ActionHistoryReadQuery) => Promise<readonly import("./action-history-atomic.ts").ActionHistoryReadRow[]>;
  readonly workItems: AggregateRepository<WorkItem>;
  readonly routeTasks: AggregateRepository<RouteTask>;
  readonly attempts: AggregateRepository<Attempt>;
  readonly obligations: AggregateRepository<StandingObligation>;
  readonly occurrences: AggregateRepository<FreshnessOccurrence>;
  readonly dispatchState: import("./dispatch-state.ts").DispatchStateRepository;

  readonly debts: AggregateRepository<FreshnessDebt>;

  readonly leases: AggregateRepository<ExecutionLease>;

  readonly activeWorkClaims: ActiveWorkClaimReader;
  readonly transitions: AppendOnlyRepository<RecordedTransition>;
  readonly escalations: AppendOnlyRepository<Escalation>;
  readonly dispositions: AppendOnlyRepository<DispositionCommit>;
  readonly artifacts: AppendOnlyRepository<ArtifactRecord>;

  readonly artifactsByCanonicalUrl?: (url: string, limit: number) => Promise<readonly ArtifactRecord[]>;

  readonly capturedCanonicalUrls?: (urls: readonly string[]) => Promise<ReadonlySet<string>>;

  readonly adminEvidenceCopyRequests: AggregateRepository<AdminEvidenceCopyRequest>;
  readonly costs: AppendOnlyRepository<CostEntry>;

  readonly ownerSnapshots: AggregateRepository<OwnerSnapshot>;
  /** The running totals the snapshot is folded from, and where each of its reads last stopped. */
  readonly ownerSnapshotTotals: AggregateRepository<OwnerSnapshotTotals>;
  /** Each state's published rows, its running totals, and the rows a publish routed to it before folding it. */
  readonly ownerSnapshotStates: AggregateRepository<OwnerSnapshotState>;
  readonly ownerSnapshotStateTotals: AggregateRepository<StateTotals>;
  readonly ownerSnapshotInboxes: AggregateRepository<SpilledInbox>;
  /** Learned discovery knowledge every model-driven worker reads and writes back, one row per entry. */
  readonly fieldManual: FieldManualRepository;

  readonly fixMap: FixMapRepository;

  readonly websitePacing: WebsitePacing;

  readonly runnerHeartbeat: AggregateRepository<RunnerHeartbeat>;
  readonly cacheObservations: AggregateRepository<CacheObservationRecord>;

  readonly ownerDigests: AppendOnlyRepository<OwnerDigestRecord>;

  readonly ownerDecisions: AppendOnlyRepository<OwnerDecisionIntent>;
  readonly huntOrders: import("../hunt-orders.ts").HuntOrderRepository;
  readonly planningControls?: import("../scheduler/state-planning.ts").PlanningControls;
  readonly planningState?: string;
  readonly controlReadsBackfill?: import("./control-reads-backfill.ts").ControlReadsBackfill;
  readonly researchState: AggregateRepository<ResearchState>;

  readonly spend: import("../spend-window.ts").SpendRepository;

  readonly methodCandidates: AggregateRepository<CandidateStore>;
  readonly researchIntents: AppendOnlyRepository<ResearchIntent>;
  readonly scoutResults: AppendOnlyRepository<ScoutResult>;
  readonly boxFindings: BoxRepository;
  /** Where each incremental pass last read up to, by pass name. */
  readonly passCursors: AggregateRepository<PassCursor>;
  readonly workerResults: AppendOnlyRepository<WorkerResultRecord>;
  readonly promotionPipeline: AppendOnlyRepository<PromotionPipelineRecord>;
  readonly windowRuns: AppendOnlyRepository<WindowRunRecord>;
  readonly windowIncidents: AppendOnlyRepository<WindowIncident>;
  readonly windowIntents: AppendOnlyRepository<WindowIntent>;
  readonly softwareReleaseReviews: AppendOnlyRepository<SoftwareReleaseReviewRecord>;
  readonly adminReceipts: AppendOnlyRepository<ActionReceipt>;
  readonly agentJobs: AppendOnlyRepository<AgentJobRecord>;

  readonly discoveryAttempts: AppendOnlyRepository<MeetingsDiscoveryAttempt>;

  readonly liveAudits: AppendOnlyRepository<LiveAuditLogRow>;
  readonly adminConfig: import("./admin-config.ts").AdminConfigRepository;

  readonly askGapObservations: AggregateRepository<AskGapObservation>;

  readonly doors: AggregateRepository<DoorRecord>;

  readonly leadOrders: AggregateRepository<LeadOrder>;
  readonly budget: BudgetRepository;

  readonly spendHolds?: SpendHoldRepository;
  readonly locks: LockManager;

  readonly describe: () => string;

  readonly durable: boolean;
}

/** The store's clock as of a pass's last read; the next pass reads what changed since. */
export interface PassCursor { readonly through: string }

/** Refuse a store that cannot outlive the process, where durability is the point. */
export function assertDurableRepositories(
  repos: ControlPlaneRepositories,
  context: string,
): void {
  if (!repos.durable) {
    throw new Error(
      `${context} requires DURABLE control-plane repositories and was given ${repos.describe()}. ` +
        "An in-memory store satisfies every unit test and loses every obligation the moment the " +
        "process ends, which is the exact failure the durable runtime exists to prevent.",
    );
  }
}
