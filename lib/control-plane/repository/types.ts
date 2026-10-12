import type { BoxFinding } from "../box.ts";
import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
import type { ActiveWorkClaimReader } from "./active-work-claims.ts";
import type { WorkerResultRecord } from "../workers/types.ts";
import type { AdminEvidenceCopyRequest } from "../evidence/admin-copy-request.ts";
/** Provider-neutral persistence for state that must outlive the worker holding it. */

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
  RunnerHeartbeat,
} from "../owner-surface.ts";
import type { FieldManualEntry, FieldManualQuery } from "../field-manual.ts";
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
import type { AdminConfig } from "../gateway/admin-config.ts";
import type { CandidateStore } from "../../method/candidate.ts";
import type { AskGapObservation } from "../ask-gap-observations.ts";
import type { LiveAuditLogRow } from "../live-audit-log.ts";
import type { DoorRecord } from "../../doors/registry.ts";
import type { LeadOrder } from "../leads/order.ts";
import type { WebsitePacing } from "../website-pacing.ts";

/** `revision` starts at 1 and increments by exactly one per accepted write. */
export interface Persisted<T> {
  readonly id: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly value: T;
}

/** `created` is false when this exact record was already here; both are successes. */
export interface PutOutcome<T> {
  readonly created: boolean;
  readonly persisted: Persisted<T>;
}

/** `appended` is false when the identical record was already present: a retried append, a no-op success. */
export interface AppendOutcome<T> {
  readonly appended: boolean;
  readonly recordId: string;
  readonly record: T;
  /** Zero-based position in the log AFTER this call. Order is the history. */
  readonly position: number;
}

/** Two different values offered under one derived id. */
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

/** A compare-and-set quoted a revision that is no longer current; names expected and found. */
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

/** An append tried to change a record that history already contains. */
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

/** Raised instead of returning an empty result: unreadable state is never absent state. */
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

/** An exclusive read-modify-write lock is already held by someone else. */
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

/** An operation named an aggregate the store does not hold. */
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

/** Stable JSON with sorted keys, so value equality does not depend on iteration order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Shared by every implementation so the double cannot drift from the durable store. */
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

/** Decide an idempotent append against an already-recorded record. */
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

/** No `update` and no `delete`: every mutation goes through `compareAndSet`. */
export interface AggregateRepository<T> {
  /** The aggregate, or null when it genuinely is not there. Never null on a failed read. */
  read(id: string): Promise<Persisted<T> | null>;
  /** Narrowed to `projection` by the store before it leaves; null when absent. */
  readNarrowed(id: string, projection: RecordProjection): Promise<Persisted<unknown> | null>;
  /** The aggregate, or `UnknownAggregate`. For callers that cannot proceed without it. */
  mustRead(id: string): Promise<Persisted<T>>;
  /** Idempotent create. Identical re-put is a no-op success; a different value refuses. */
  put(id: string, value: T, now: string): Promise<PutOutcome<T>>;
  /** The only mutation path. Quotes the revision the writer read. */
  compareAndSet(
    id: string,
    expectedRevision: number,
    next: T,
    now: string,
  ): Promise<Persisted<T>>;
  /** The named aggregates that exist, in id order; a failed read throws. Optional. */
  readMany?(ids: readonly string[]): Promise<readonly Persisted<T>[]>;
  /** Every aggregate of this kind, ordered by id so reports are diffable. */
  list(): Promise<readonly Persisted<T>[]>;
  /** Every row in the same id order, each value narrowed to the projection. */
  listNarrowed(projection: RecordProjection): Promise<readonly Persisted<unknown>[]>;
  /** Exactly `list()` filtered by the scalar `#>>` value at `path`. */
  listWhere(path: readonly string[], value: string): Promise<readonly Persisted<T>[]>;
  /**
   * Rows whose database-clock `changed_at` is at or after `since` (all when null), in id order, less any row `held`
   * names at its current revision; `through` is the store's clock when the read began.
   */
  listChangedSince?(since: string | null, held?: HeldSlots): Promise<ChangedRows<T>>;
}

/** Slots a reader already holds, left out of a changed-since read: an aggregate's [id, revision], a log record's [key, position]. */
export type HeldSlots = readonly (readonly [string, number])[];

/** `held` as a set of "slot\nversion" keys. */
export function heldSlotKeys(held: HeldSlots | undefined): ReadonlySet<string> {
  return new Set((held ?? []).map(([slot, version]) => `${slot}\n${version}`));
}

/** The field manual's rows, one aggregate per entry. */
export interface FieldManualRepository extends AggregateRepository<FieldManualEntry> {
  readMany(ids: readonly string[]): Promise<readonly Persisted<FieldManualEntry>[]>;
  /** The rows one job could use (`entryInSlice`); a store may return more, never fewer. */
  slice(query: FieldManualQuery): Promise<readonly Persisted<FieldManualEntry>[]>;
}

/** What `AggregateRepository.listChangedSince` answers. */
export interface ChangedRows<T> {
  readonly rows: readonly Persisted<T>[];
  readonly through: string | null;
}

/** One log record with the coordinates `readAll()` orders it by. */
export interface ChangedRecord<T> {
  readonly key: string;
  readonly recordId: string;
  readonly position: number;
  readonly record: T;
}

/** What `AppendOnlyRepository.readChangedSince` answers. */
export interface ChangedRecords<T> {
  readonly records: readonly ChangedRecord<T>[];
  readonly through: string | null;
}

/** Partitioned by key so a replay need not read the whole world. */
export interface AppendOnlyRepository<T> {
  append(key: string, recordId: string, record: T, now: string): Promise<AppendOutcome<T>>;
  /** Records under one key, in append order. */
  read(key: string): Promise<readonly T[]>;
  /** A content filter returning every match under one key, in append order. */
  readWhere(key: string, path: readonly string[], value: string): Promise<readonly T[]>;
  /** `readWhere`'s newest `limit` matches, newest first, narrowed by the store. */
  readRecentWhere(
    key: string,
    path: readonly string[],
    value: string,
    limit: number,
    projection: RecordProjection,
    recordedAtSince?: string,
  ): Promise<readonly unknown[]>;
  /** Every record, in key order then append order. */
  readAll(): Promise<readonly T[]>;
  /** Records appended at or after `since`, in key then append order; filtered before transfer. */
  readSince(since: string): Promise<readonly T[]>;
  /** The newest `limit` records under one key, newest first. `limit` bounds the response. */
  readRecent(key: string, limit: number): Promise<readonly T[]>;
  /** The newest record under each key, narrowed by the store, in one batched read. A key with no record is absent. */
  readLatest(keys: readonly string[], projection: RecordProjection): Promise<ReadonlyMap<string, unknown>>;
  /** The keys this log holds. */
  keys(): Promise<readonly string[]>;
  /** Exactly `keys()` narrowed to keys holding a matching record, sorted. */
  keysWhere?(path: readonly string[], value: string): Promise<readonly string[]>;
  /** Exactly `read(key)` for each key, in one batched read; a key with no record is absent. */
  readKeys?(keys: readonly string[]): Promise<ReadonlyMap<string, readonly T[]>>;
  /** Records whose `changed_at` is at or after `since` (all when null), less any `held` names, in `readAll()` order, with coordinates. */
  readChangedSince?(since: string | null, held?: HeldSlots): Promise<ChangedRecords<T>>;
}

/** `log.readKeys(keys)`, or `read` per key where the provider has no batched read. */
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

/** The keys of a log holding a record whose value at `path` equals `value`, or null when the provider has no filtered read (the caller then reads as before). */
export async function keysWhere<T>(log: AppendOnlyRepository<T>, path: readonly string[], value: string): Promise<readonly string[] | null> {
  return log.keysWhere ? log.keysWhere(path, value) : null;
}

/** `true` keeps a top-level key whole; an object keeps only its named keys. Every other key is dropped. */
export type RecordProjection = Readonly<Record<string, true | readonly string[]>>;

/** The in-process mirror of the Postgres projection, so every provider returns the same narrowed record. */
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

/** `projectRecord`, and `{}` for an empty projection. */
export function projectAggregate(value: unknown, projection: RecordProjection): unknown {
  return Object.keys(projection).length === 0 ? {} : projectRecord(value, projection);
}

/** The in-process mirror of Postgres `#>>`: null when the path does not resolve or the leaf is not scalar. */
export function jsonTextAtPath(record: unknown, path: readonly string[]): string | null {
  let cursor: unknown = record;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (cursor === null || cursor === undefined || typeof cursor === "object") return null;
  return String(cursor);
}

/** One shared host/vendor/credential budget aggregate; every worker contends on it. */
export interface BudgetRepository {
  read(): Promise<Persisted<BudgetLedger>>;
  /** Establish the ledger. Idempotent by the same rule as any derived-identity put. */
  install(ledger: BudgetLedger, now: string): Promise<PutOutcome<BudgetLedger>>;
  compareAndSet(
    expectedRevision: number,
    next: BudgetLedger,
    now: string,
  ): Promise<Persisted<BudgetLedger>>;
  /** Read-modify-write under an exclusive lock; the mutator is a pure function of the ledger. */
  mutate<R>(
    mutator: (ledger: BudgetLedger) => { readonly ledger: BudgetLedger; readonly result: R },
    now: string,
  ): Promise<{ readonly result: R; readonly persisted: Persisted<BudgetLedger> }>;
}

/** One row per Send/area spend hold; the rules live in `expansion/spend-holds.ts`. */
export type SpendHoldRepository = SpendHoldStore;

/** For read-modify-writes across OS processes. A held lock is a named refusal, never a wait. */
export interface LockManager {
  withLock<R>(name: string, fn: () => Promise<R>): Promise<R>;
}

/** Evidence metadata only, never bytes; the bodies belong to `evidence/`. */
export interface ArtifactRecord {
  readonly artifactId: string;
  readonly workItemId: string;
  readonly routeTaskId: string | null;
  /** The Attempt that actually retrieved it. Immutable, and never re-pointed. */
  readonly attemptId: string;
  readonly tier: ArtifactTier;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly contentType: string;
  readonly canonicalUrl: string;
  /** True when the capture was interrupted: kept and labelled, never treated as complete. */
  readonly partial: boolean;
  readonly recordedAt: string;
  /** A separately acquired candidate publication must retain the exact link
   * on an approved campaign page that authorized walking this URL. Offsets
   * address the captured UTF-16 HTML string, never a later reconstruction. */
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

/** The commit point of a route disposition; the two aggregate writes apply it and `reconcile()` finishes it. */
export interface DispositionCommit {
  readonly commitId: string;
  readonly routeTaskId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly disposition: RouteDisposition;
  /** The two aggregate values to apply, already computed by the domain. */
  readonly closedAttempt: Attempt;
  readonly disposedTask: RouteTask;
  /** The revision of the RouteTask this commit was computed against. */
  readonly taskRevision: number;
  /** The revision of the Attempt this commit was computed against. */
  readonly attemptRevision: number;
  readonly committedAt: string;
}

/** A WorkItem transition, with the log's own record identity. */
export interface RecordedTransition {
  readonly transitionId: string;
  readonly workItemId: string;
  readonly transition: WorkItemTransition;
}

/** Everything the control-plane runtime persists, behind one neutral surface. */
export interface ControlPlaneRepositories {
  /** Bounded, newest-first projection joined to its authoritative receipt. */
  readonly adminActionHistoryPage?: (query: import("./action-history-atomic.ts").ActionHistoryReadQuery) => Promise<readonly import("./action-history-atomic.ts").ActionHistoryReadRow[]>;
  readonly workItems: AggregateRepository<WorkItem>;
  readonly routeTasks: AggregateRepository<RouteTask>;
  readonly attempts: AggregateRepository<Attempt>;
  readonly obligations: AggregateRepository<StandingObligation>;
  readonly occurrences: AggregateRepository<FreshnessOccurrence>;
  /** Keyed by OBLIGATION id: one debt row per obligation, so the row is the state. */
  readonly debts: AggregateRepository<FreshnessDebt>;
  /** Keyed by ROUTE TASK id: one lease slot per task, so the slot is the race. */
  readonly leases: AggregateRepository<ExecutionLease>;
  /** Indexed, bounded read of all non-internal active lease claims; unsupported providers say unavailable. */
  readonly activeWorkClaims: ActiveWorkClaimReader;
  readonly transitions: AppendOnlyRepository<RecordedTransition>;
  readonly escalations: AppendOnlyRepository<Escalation>;
  readonly dispositions: AppendOnlyRepository<DispositionCommit>;
  readonly artifacts: AppendOnlyRepository<ArtifactRecord>;
  /** Exact source-owned captures across jobs, newest acquisition first; no general log scan in Postgres. */
  readonly artifactsByCanonicalUrl?: (url: string, limit: number) => Promise<readonly ArtifactRecord[]>;
  /** Which of these exact canonical URLs have a capture, in one indexed read. */
  readonly capturedCanonicalUrls?: (urls: readonly string[]) => Promise<ReadonlySet<string>>;
  /** Exact Admin original-byte copy requests, CAS-leased by the permanent runner. */
  readonly adminEvidenceCopyRequests: AggregateRepository<AdminEvidenceCopyRequest>;
  readonly costs: AppendOnlyRepository<CostEntry>;
  /** Read server-side by the admin host. Every record is aggregate-only (`assertAggregateOnly`). */
  readonly ownerSnapshots: AggregateRepository<OwnerSnapshot>;
  /** Learned discovery knowledge every model-driven worker reads and writes back, one row per entry. */
  readonly fieldManual: FieldManualRepository;
  /** What each reusable method did in each place. */
  readonly fixMap: FixMapRepository;
  /** Every reader's shared count and holds per website. */
  readonly websitePacing: WebsitePacing;
  /** Keyed by runner id. "Alive" is DERIVED from this beat, never stored. */
  readonly runnerHeartbeat: AggregateRepository<RunnerHeartbeat>;
  readonly cacheObservations: AggregateRepository<CacheObservationRecord>;
  /** Every digest the runner wrote: the latest one, and the history. */
  readonly ownerDigests: AppendOnlyRepository<OwnerDigestRecord>;
  /** What a decision button appended. */
  readonly ownerDecisions: AppendOnlyRepository<OwnerDecisionIntent>;
  readonly researchState: AggregateRepository<ResearchState>;
  /** Canonical live method-candidate lifecycle. Git holds historical evidence only. */
  readonly methodCandidates: AggregateRepository<CandidateStore>;
  readonly researchIntents: AppendOnlyRepository<ResearchIntent>;
  readonly scoutResults: AppendOnlyRepository<ScoutResult>;
  readonly boxFindings: AggregateRepository<BoxFinding>;
  readonly workerResults: AppendOnlyRepository<WorkerResultRecord>;
  readonly promotionPipeline: AppendOnlyRepository<PromotionPipelineRecord>;
  readonly windowRuns: AppendOnlyRepository<WindowRunRecord>;
  readonly windowIncidents: AppendOnlyRepository<WindowIncident>;
  readonly windowIntents: AppendOnlyRepository<WindowIntent>;
  readonly softwareReleaseReviews: AppendOnlyRepository<SoftwareReleaseReviewRecord>;
  readonly adminReceipts: AppendOnlyRepository<ActionReceipt>;
  readonly agentJobs: AppendOnlyRepository<AgentJobRecord>;
  /** Every walk of a government's own site for its meeting route, keyed by jurisdiction id. */
  readonly discoveryAttempts: AppendOnlyRepository<MeetingsDiscoveryAttempt>;
  /** Live-audit results by UTC day, corrections, and pulls by work item (`live-audit-log.ts`). */
  readonly liveAudits: AppendOnlyRepository<LiveAuditLogRow>;
  readonly adminConfig: AggregateRepository<AdminConfig>;
  /** One aggregate per body, gap code and UTC day: `<body id>#<code>#<day>`. */
  readonly askGapObservations: AggregateRepository<AskGapObservation>;
  /** One aggregate per door. Written only through `door.save` and by derive steps that never overwrite a newer manual edit. */
  readonly doors: AggregateRepository<DoorRecord>;
  /** One aggregate per research-leads order, keyed by its receipt id. */
  readonly leadOrders: AggregateRepository<LeadOrder>;
  readonly budget: BudgetRepository;
  /** Absent in the file store, where holds stay on the budget ledger row. */
  readonly spendHolds?: SpendHoldRepository;
  readonly locks: LockManager;
  /** What this store is, for a report that must say where the state lives. */
  readonly describe: () => string;
  /** True only for a store whose contents survive this process. */
  readonly durable: boolean;
}

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
