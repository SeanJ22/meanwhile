import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
import type { ActiveWorkClaimReader } from "./active-work-claims.ts";
import type { WorkerResultRecord } from "../workers/types.ts";
import type { AdminEvidenceCopyRequest } from "../evidence/admin-copy-request.ts";
/**
 * THE CONTROL-PLANE REPOSITORIES — provider-neutral persistence for the state
 * that must outlive the worker holding it.
 *
 * ============================================================================
 * WHY THIS EXISTS, AND WHY IT IS NOT A DATABASE TABLE
 *
 * `lib/control-plane/*` is, up to this file, a set of PURE functions over
 * in-memory values. That is exactly right for the rules and exactly useless for
 * the claim the architecture actually makes:
 *
 *     WORKERS ARE DISPOSABLE. THE OBLIGATION IS NOT.
 *
 * A rule that lives only in one process's heap dies with that process, and a
 * WorkItem that dies with its worker was never durable — it was a variable. This
 * directory is where "survives process death" stops being a design intention and
 * becomes something a test can fail.
 *
 * THE SUBSTRATE DECISION, stated here because a later session will ask:
 *
 *   - Postgres/Neon in this repository is the SERVING substrate for
 *     reader-facing data. Control-plane work state is not reader-facing.
 *     campaign-finance filings are already kept out of Postgres where it does not
 *     belong, and adding a migration for it would additionally trip
 *     `pnpm db:gate` — which asks PRODUCTION whether a schema is applied — and
 *     freeze a release for a reason with nothing to do with truth.
 *   - The repository's EXISTING, governed durability substrate for canonical
 *     multi-session work state is the committed file store: `data/workstate/*.json`,
 *     `data/method/knowledge.json`, `docs/governance/ledger.jsonl`. That is an
 *     already-authorized substrate that satisfies "survives process death".
 *
 * So: these are INTERFACES. `memory.ts` is the in-process double used to pin the
 * semantics; `file-store.ts` is the durable atomic-rename/append-only filesystem
 * implementation. THE DOMAIN LAYER MUST NOT IMPORT EITHER. `work-item.ts`,
 * `route-task.ts`, `attempt.ts` and `completion.ts` stay pure and know nothing
 * about where anything is written, which is what lets the rules be tested
 * without a disk and the disk be swapped without touching a rule.
 * ============================================================================
 *
 * FOUR PROPERTIES EVERY IMPLEMENTATION OWES, each of which is a defect this
 * project has actually paid for somewhere:
 *
 *   1. IDEMPOTENT WRITES WHERE IDENTITY IS DERIVED. `ids.ts` makes a WorkItem
 *      and a RouteTask id a pure function of their inputs precisely so two
 *      workers that independently decide the same route must be walked collide
 *      instead of duplicating a side effect. A `put` of an IDENTICAL value under
 *      an existing id is therefore a no-op SUCCESS. A `put` of a DIFFERENT value
 *      under that id is an `IdentityCollision` — two different obligations have
 *      been given one name, and silently keeping either one is a wrong answer.
 *
 *   2. APPEND-ONLY WHERE HISTORY MATTERS. Attempt closures, WorkItem
 *      transitions, dispositions, artifact metadata and cost records are
 *      HISTORY. An append that would overwrite an existing distinct record under
 *      the same record id refuses. History that can be rewritten is not history.
 *
 *   3. COMPARE-AND-SET, HONESTLY. Every persisted aggregate carries a
 *      monotonically increasing `revision`. A mutating write STATES the revision
 *      it read. A mismatch is `ConcurrentModification`, naming what was expected
 *      and what was found. There is no last-writer-wins path, because
 *      last-writer-wins is how a stale worker's abandoned belief overwrites a
 *      live worker's finding.
 *
 *   4. A FAILED READ IS NEVER AN EMPTY RESULT. Corrupt or unparseable persisted
 *      state raises `CorruptPersistedState` naming the file and the corruption.
 *      This is the cross-cutting non-negotiable applied to our own storage: a
 *      zero-row extraction is a FAILED extraction, never an empty document. An
 *      `isOutstanding`-style caller must never be able to mistake "we could not
 *      read it" for "there is nothing there".
 *
 * TIME IS ALWAYS A PARAMETER. Nothing in this directory reads a clock. Every
 * mutating operation takes `now`, for the same reason every other control-plane
 * module does: so a test can put the clock where it needs it and a replay is
 * exact.
 *
 * EVERY OPERATION IS ASYNC AND RETURNS SOMETHING CHECKABLE. There is no bare
 * `Promise<void>` mutator here. A write that returns nothing is a write whose
 * lost update is invisible, and an invisible lost update in this system is a
 * disposition that quietly did not happen.
 */

import type { Attempt, ExecutionLease } from "../attempt.ts";
import type { FreshnessDebt } from "../scheduler/debt.ts";
import type { FreshnessOccurrence, StandingObligation } from "../scheduler/durable.ts";
import type { BudgetLedger } from "../budget.ts";
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
import type { FieldManualStore } from "../field-manual.ts";
import type { ResearchIntent, ResearchState } from "../scheduler/research-policy.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type {
  PromotionPipelineRecord,
  WindowIncident,
  WindowIntent,
  WindowRunRecord,
} from "../promotion/types.ts";
import type { ReadinessStateSnapshot } from "../readiness/model.ts";
import type { ActionReceipt } from "../gateway/contract.ts";
import type { AgentJobRecord } from "../gateway/agent-job.ts";
import type { MeetingsDiscoveryAttempt } from "../../hunt/meetings-site-discovery.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";
import type { CandidateStore } from "../../method/candidate.ts";
import type { AskGapObservation } from "../ask-gap-observations.ts";

/** ------------------------------------------------------------- envelopes */

/**
 * One persisted aggregate, with the revision a compare-and-set must quote.
 *
 * `revision` starts at 1 on creation and increments by exactly one per accepted
 * write. It is not a timestamp and must never be replaced by one: two writes in
 * the same millisecond are two writes, and a clock-derived version would call
 * them one.
 */
export interface Persisted<T> {
  readonly id: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly value: T;
}

/**
 * The result of an idempotent put.
 *
 * `created` distinguishes "this write made the record" from "this record was
 * already exactly here". Both are successes and they are not the same fact —
 * a caller that needs to know whether it won a creation race needs the
 * difference, and a bare boolean success would have destroyed it.
 */
export interface PutOutcome<T> {
  readonly created: boolean;
  readonly persisted: Persisted<T>;
}

/**
 * The result of an append.
 *
 * `appended` is false when the identical record was already present under the
 * same record id — a retried append after a partial failure, which is a no-op
 * success rather than a duplicate history entry.
 */
export interface AppendOutcome<T> {
  readonly appended: boolean;
  readonly recordId: string;
  readonly record: T;
  /** Zero-based position in the log AFTER this call. Order is the history. */
  readonly position: number;
}

/** ------------------------------------------------------------- refusals */

/**
 * Two different values were offered under one derived id.
 *
 * This is never a storage inconvenience. `routeTaskId(workItem, routeId, target)`
 * is a fingerprint of the obligation; two distinct RouteTasks hashing to it means
 * either a genuine hash collision or — far more likely — that a caller mutated an
 * aggregate and re-put it instead of using `compareAndSet`. Both readings demand
 * a stop, and neither is served by keeping one value and dropping the other.
 */
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

/**
 * A compare-and-set quoted a revision that is no longer current.
 *
 * The message names what the writer expected and what it found, because the
 * only useful thing to tell a losing writer is how far behind it is. A writer
 * that learns only "you failed" retries against the same stale read.
 */
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

/**
 * Persisted state could not be read as what it claims to be.
 *
 * Raised INSTEAD of returning an empty result. That choice is the whole reason
 * this class exists: a store that answers an unreadable file with `[]` teaches
 * every caller above it that the absence of data is data, and this product's one
 * unsurvivable failure is exactly that substitution.
 */
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

/** ------------------------------------------------- canonical comparison */

/**
 * Stable JSON with sorted keys, so value equality does not depend on the order
 * a Map or an object literal happened to iterate.
 *
 * Without this, an idempotent re-put of a structurally identical aggregate whose
 * fields were built in a different order would raise `IdentityCollision`, and
 * the refusal that exists to catch a real defect would fire on a non-defect —
 * which is how a guard gets loosened and then stops catching anything.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * Decide an idempotent put against an existing value.
 *
 * Shared by BOTH implementations on purpose. A double whose semantics drift from
 * the durable store is worse than no double at all: it turns a green suite into
 * evidence for a claim the production path does not satisfy.
 */
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

/** ---------------------------------------------------------- repositories */

/**
 * An aggregate store: derived identity, idempotent creation, CAS mutation.
 *
 * There is deliberately no `update(id, value)` and no `delete`. Every mutation
 * goes through `compareAndSet`, and nothing is ever removed — the control plane's
 * questions are all of the form "what does this project still owe?", and an
 * answer assembled from a store that forgets is not an answer.
 */
export interface AggregateRepository<T> {
  /** The aggregate, or null when it genuinely is not there. Never null on a failed read. */
  read(id: string): Promise<Persisted<T> | null>;
  /**
   * The aggregate narrowed to `projection` by the store before it leaves the
   * store (the aggregate mirror of `readRecentWhere`'s projection), with its
   * revision and write time; null when it genuinely is not there. An EMPTY
   * projection keeps no field: the value is `{}`, and only the revision and the
   * write time are read. For a page that needs a few fields of a large
   * document row, or only whether it moved (measured 2026-09-25: the owner
   * snapshot is 449 KB and the research state 1.16 MB, and the Fleet · Now pulse
   * read both whole for two revision numbers, some counts and 782 bytes of lane
   * gauges). The value is narrowed, so it is `unknown`: a caller validates what
   * it reads, as it would a whole row.
   */
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
  /** Every aggregate of this kind, ordered by id so reports are diffable. */
  list(): Promise<readonly Persisted<T>[]>;
  /** Every row in the same id order, with only projected value fields crossing the wire. */
  listNarrowed(projection: RecordProjection): Promise<readonly Persisted<unknown>[]>;
  /**
   * The aggregates whose JSON value at `path` (a scalar `#>>` text extraction,
   * the same reading as `AppendOnlyRepository.readWhere`) equals `value`.
   *
   * EXACTLY `list()` FILTERED: the same rows, in the same id order, on every
   * provider. A caller moves from a full listing to this for cost, never for a
   * different answer. Postgres asks the database for the matching rows only
   * (bounded keyset pages, like `list()`); the file and memory providers filter
   * their own `list()`. An empty result means nothing matches; a failed read
   * THROWS and is never an empty list.
   */
  listWhere(path: readonly string[], value: string): Promise<readonly Persisted<T>[]>;
}

/**
 * An append-only history, partitioned by a key (usually a WorkItem or RouteTask
 * id) so a replay does not have to read the whole world to reconstruct one
 * obligation.
 */
export interface AppendOnlyRepository<T> {
  append(key: string, recordId: string, record: T, now: string): Promise<AppendOutcome<T>>;
  /** Records under one key, in append order. */
  read(key: string): Promise<readonly T[]>;
  /**
   * Records under one key whose JSON value at `path` (a scalar `#>>` text
   * extraction) equals `value`, in append order.
   *
   * A CONTENT filter, not a position lookup: it returns EVERY matching record
   * regardless of where it sits, so it is stable as the log grows and cannot
   * false-negative an existing record the way "give me position N" can. Reading
   * by what the caller is looking for is the point — `["runtimeOutcome","kind"]
   * = "METHOD_CANDIDATE_AUTHORITY_ADOPTION"` still finds the receipt after ten
   * thousand later rows shift its position. An empty result means the store
   * genuinely holds no such record; the CALLER decides whether that is a valid
   * absence or a failure (an empty where a record must exist is the caller's to
   * reject, loudly). A store/transport error THROWS and is never an empty list.
   */
  readWhere(key: string, path: readonly string[], value: string): Promise<readonly T[]>;
  /**
   * `readWhere`'s newest `limit` matches, newest first, each narrowed to
   * `projection` by the store before it leaves the store: neither older history
   * nor a dropped field crosses the wire. `limit` bounds the response. A caller
   * that needs a few fields of recent records reads them here rather than every
   * whole record the log has ever held. The records are narrowed, so they are
   * `unknown`: a caller validates what it reads, as it would a whole record.
   * Optional `recordedAtSince` filters the saved append clock inclusively
   * before limiting, so a time window need not transfer archived records.
   */
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
  /**
   * The newest record under each of `keys`, narrowed to `projection` by the
   * store as `readRecentWhere` narrows, by key. A key with no record is absent.
   * It is one batched read: one statement per page of keys, never one per key.
   * Only the newest record's kept fields cross the wire, so a caller that needs
   * a few fields of many governments' latest walks does not download the walks.
   * The records are narrowed, so they are `unknown`: a caller validates what it
   * reads.
   */
  readLatest(keys: readonly string[], projection: RecordProjection): Promise<ReadonlyMap<string, unknown>>;
  /** The keys this log holds. */
  keys(): Promise<readonly string[]>;
}

/**
 * The parts of a record a narrowed read returns: a top-level key kept whole
 * (`true`), or an object kept with only the named keys of its own. Every other
 * key is dropped. A kept key the record does not hold stays absent, and a kept
 * object that is not an object is returned as it is, so a caller validating the
 * record still sees exactly what was written there.
 */
export type RecordProjection = Readonly<Record<string, true | readonly string[]>>;

/**
 * `projection` applied in process: the file and memory providers' mirror of the
 * Postgres projection `pgAppendOnlyRepository.readRecentWhere` builds, so every
 * provider returns the same narrowed record.
 */
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

/**
 * `AggregateRepository.readNarrowed`'s value, in process: `projectRecord`, and
 * `{}` for an empty projection (the revision alone). The file and memory
 * providers' mirror of the Postgres read, so every provider narrows alike.
 */
export function projectAggregate(value: unknown, projection: RecordProjection): unknown {
  return Object.keys(projection).length === 0 ? {} : projectRecord(value, projection);
}

/**
 * The scalar text at `path` inside a record, or null — the in-process mirror of
 * Postgres `record #>> '{a,b}'`: null when the path does not resolve, and null
 * for a non-scalar leaf (no caller filters on an object/array leaf). Used by the
 * file and memory providers so `readWhere` filters identically to the pg one.
 */
export function jsonTextAtPath(record: unknown, path: readonly string[]): string | null {
  let cursor: unknown = record;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (cursor === null || cursor === undefined || typeof cursor === "object") return null;
  return String(cursor);
}

/**
 * The SHARED host / vendor / credential budget.
 *
 * This is a single aggregate, not one per worker, and that is the entire point:
 * `budget.ts` says a twelve-way fan-out must contend on ONE `HostBudget`, and a
 * per-worker copy of the ledger is arithmetically twelve budgets no matter what
 * the code calls it. `mutate` is the only write path so that read, decide and
 * write happen inside one exclusive section rather than as three racing steps.
 */
export interface BudgetRepository {
  read(): Promise<Persisted<BudgetLedger>>;
  /** Establish the ledger. Idempotent by the same rule as any derived-identity put. */
  install(ledger: BudgetLedger, now: string): Promise<PutOutcome<BudgetLedger>>;
  compareAndSet(
    expectedRevision: number,
    next: BudgetLedger,
    now: string,
  ): Promise<Persisted<BudgetLedger>>;
  /**
   * Read-modify-write the shared ledger under an exclusive lock.
   *
   * The mutator is a PURE function of the ledger — it is handed the persisted
   * state and returns the next state plus whatever the caller wanted to learn.
   * It must not itself write.
   */
  mutate<R>(
    mutator: (ledger: BudgetLedger) => { readonly ledger: BudgetLedger; readonly result: R },
    now: string,
  ): Promise<{ readonly result: R; readonly persisted: Persisted<BudgetLedger> }>;
}

/**
 * Exclusive sections for read-modify-write sequences.
 *
 * JavaScript in one process is single-threaded, so an `await` chain inside one
 * process is already serialized and this lock buys nothing there. It exists for
 * the case the file store is actually FOR: two operating-system processes over
 * one root directory, where nothing else stops two read-modify-writes from
 * interleaving. Held-lock is a NAMED refusal rather than a wait, because a
 * silent wait in a library that promised not to read a clock is a lie about
 * both.
 */
export interface LockManager {
  withLock<R>(name: string, fn: () => Promise<R>): Promise<R>;
}

/** ------------------------------------------------------ artifact metadata */

/**
 * EVIDENCE METADATA ONLY — never bytes.
 *
 * The bodies belong to `lib/control-plane/evidence/` and its `EvidenceStore`.
 * What the control plane needs durably is far narrower: which artifact ids
 * exist, which Attempt produced each one, and whether it was a complete or a
 * PARTIAL capture.
 *
 * `attemptId` is the load-bearing field and it is never rewritten. When a worker
 * dies mid-walk and a replacement finishes the route, the partial capture is
 * still the DEAD worker's evidence. Re-attributing it to whoever happened to
 * finish would erase the only record that the first walk got as far as it did,
 * and would make a later reader believe one clean execution produced everything.
 */
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
  /**
   * True when the capture was interrupted. A partial is kept and LABELLED: it is
   * real evidence of a real retrieval, and it is not a complete record of the
   * source. Storing it unlabelled would let a partial masquerade as a full walk.
   */
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

/** ------------------------------------------------- committed dispositions */

/**
 * THE COMMIT POINT of a route disposition.
 *
 * Disposing a route touches two aggregates: the RouteTask records the
 * disposition and the Attempt is closed. Two aggregate writes are two files, and
 * a process that dies between them leaves a half-write — a task that looks
 * disposed with an Attempt still open, or an Attempt closed against a route that
 * shows nothing. Either shape is a lie to the next reader.
 *
 * So the pair is committed as ONE append to an append-only log, and the two
 * aggregate writes are the APPLICATION of that commit. A commit present with its
 * aggregates unapplied is a recoverable state, and `reconcile()` in
 * `coordinator.ts` finishes it. A commit absent means nothing happened at all.
 * There is no third state, which is what "no half-write is observable by a later
 * reader" actually requires.
 */
export interface DispositionCommit {
  readonly commitId: string;
  readonly routeTaskId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly disposition: RouteDisposition;
  /**
   * The two aggregate VALUES to apply, already computed by the domain functions
   * that were entitled to compute them.
   *
   * A commit that carried only "what to do" would have to re-derive the result
   * at recovery time, under a `now` that is no longer the one the decision was
   * made under, with a method version that may have moved. Carrying the exact
   * values makes recovery a replay rather than a re-decision — and a replay
   * cannot reach a different answer than the one that was committed.
   */
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

/** ------------------------------------------------------------ the bundle */

/**
 * Everything the control-plane runtime persists, behind one neutral surface.
 *
 * A caller takes this, not a file path and not a connection. That is what lets
 * the crash-recovery suite run the identical sequence against the in-memory
 * double (fast, and it pins the semantics) and against the filesystem store
 * (slow, and it is the one that proves the process may die).
 */
export interface ControlPlaneRepositories {
  readonly workItems: AggregateRepository<WorkItem>;
  readonly routeTasks: AggregateRepository<RouteTask>;
  readonly attempts: AggregateRepository<Attempt>;
  /**
   * THE SCHEDULER'S OWN DURABLE STATE. (Session B resume, W3.C.)
   *
   * These three are what make a freshness failure survive the process that
   * suffered it. Before them, `FreshnessDebt` existed in the domain and in the
   * cycle's signature and in no store, so the runner passed `debts: []` on
   * every start and a route that failed today was not retried tomorrow.
   *
   * They are AggregateRepositories like any other — same CAS, same revisions,
   * same providers — because a second persistence mechanism beside the
   * repositories is the second control plane RULING 220 forbids.
   */
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
  /** Exact Admin original-byte copy requests, CAS-leased by the permanent runner. */
  readonly adminEvidenceCopyRequests: AggregateRepository<AdminEvidenceCopyRequest>;
  readonly costs: AppendOnlyRepository<CostEntry>;
  /**
   * THE OWNER CONTROL CENTRE'S DATA PLANE. (Session C final, ITEM H.)
   *
   * The admin host (`ADMIN_ORIGIN`) reads these SERVER-SIDE and reads nothing else.
   * The admin site may not depend on the always-on machine's filesystem, Drive
   * mirror, process table or agent scratch output — so anything the owner is
   * shown has to be something the runner durably WROTE. They are ordinary
   * repositories, with the same CAS and the same providers, because a second
   * persistence mechanism beside the repositories is the second control plane
   * RULING 220 forbids.
   *
   * Every record is aggregate-only, enforced by field name at write time by
   * `assertAggregateOnly` in `lib/control-plane/owner-surface.ts`. The owner is
   * not an exception to RULING 226 — his page is a rendering like any other.
   */
  readonly ownerSnapshots: AggregateRepository<OwnerSnapshot>;
  /** The readiness control panel's data plane — one snapshot per state, keyed by two-letter state code; derived, never authored. */
  readonly readinessSnapshots: AggregateRepository<ReadinessStateSnapshot>;
  /** The field manual — one aggregate, id "live": the growing store of learned discovery knowledge every model-driven worker reads (as a projection) and writes back to, no human step. */
  readonly fieldManual: AggregateRepository<FieldManualStore>;
  /** Keyed by runner id. "Alive" is DERIVED from this beat, never stored. */
  readonly runnerHeartbeat: AggregateRepository<RunnerHeartbeat>;
  /** The H1 waiver's standing check — a counter reaching first non-zero. */
  readonly cacheObservations: AggregateRepository<CacheObservationRecord>;
  /** Every digest the runner wrote: the latest one, and the history. */
  readonly ownerDigests: AppendOnlyRepository<OwnerDigestRecord>;
  /** What a decision button appended. Intent, never a direct edit of authority. */
  readonly ownerDecisions: AppendOnlyRepository<OwnerDecisionIntent>;
  /**
   * LEVEL 1 — RESEARCH. (Level 1 activation, 2026-09-01 — schema v4.)
   *
   *   researchState     one aggregate, id "level-1": what the standing runner
   *                     measured about the Scout lane on its last cycle. The
   *                     page DERIVES a verdict from it; it stores none
   *   researchIntents   the owner's pause/resume/run-now intents, and the
   *                     runner's HONORED records beside them. Append-only,
   *                     because an intent is a fact about a moment
   *   scoutResults      every typed Scout result, keyed by obligation id, so
   *                     the next Attempt resumes rather than restarts and the
   *                     page can list what the Scouts actually did
   */
  readonly researchState: AggregateRepository<ResearchState>;
  /** Canonical live method-candidate lifecycle. Git holds historical evidence only. */
  readonly methodCandidates: AggregateRepository<CandidateStore>;
  readonly researchIntents: AppendOnlyRepository<ResearchIntent>;
  readonly scoutResults: AppendOnlyRepository<ScoutResult>;
  readonly workerResults: AppendOnlyRepository<WorkerResultRecord>;
  /**
   * THE NIGHTLY DOOR. (RULING 242 — schema v5.)
   *
   *   promotionPipeline  every typed transition and refusal, keyed by item id;
   *                      the only path a finding may travel toward promotion
   *   windowRuns         one record per nightly window, keyed by local date
   *   windowIncidents    a stage failure, typed, keyed by window id
   *   windowIntents      explicit owner RUN_WINDOW_NOW requests and the runner's
   *                      HONORED record beside it
   */
  readonly promotionPipeline: AppendOnlyRepository<PromotionPipelineRecord>;
  readonly windowRuns: AppendOnlyRepository<WindowRunRecord>;
  readonly windowIncidents: AppendOnlyRepository<WindowIncident>;
  readonly windowIntents: AppendOnlyRepository<WindowIntent>;
  /**
   * SOFTWARE RELEASE REVIEW. (Admin Pass B, 2026-09-06 — schema v8.)
   *
   *   softwareReleaseReviews  the owner's decisions on a SOFTWARE BUILD, keyed
   *                           by the exact staging SHA each was made against.
   *                           Append-only: a later decision supersedes an
   *                           earlier one for gating and never deletes it; a
   *                           new SHA starts with no rows. Joins nothing civic.
   */
  readonly softwareReleaseReviews: AppendOnlyRepository<SoftwareReleaseReviewRecord>;
  /**
   * THE ACTION GATEWAY. (Admin Pass C, ADM-C6 — schema v9.)
   *
   *   adminReceipts  every action the console submitted and what came of it,
   *                  under one log key, with the record id derived from the
   *                  action type and the caller's idempotency key. Two jobs:
   *                  it is the durable proof §3.7 requires, and it is the
   *                  idempotency index the gateway consults BEFORE it does any
   *                  work — so a double-click, a retried fetch and a replayed
   *                  chat tool call return one receipt instead of making two
   *                  state changes. A refusal is appended too: a refusal that
   *                  left no record would be indistinguishable from a click
   *                  that never arrived
   *   agentJobs      the delegated-agent bridge's history, one append per state
   *                  a job reaches. The record shape is declared in
   *                  `lib/control-plane/gateway/agent-job.ts`; the bridge that
   *                  writes it lands beside it. Declared now so the storage is
   *                  one versioned move rather than two
   *   adminConfig    the owner's operational policy at id "current" — today,
   *                  whether paid API fallback is permitted (§9A.22). An
   *                  AGGREGATE because the executor's question is "what is the
   *                  policy now", and a policy folded out of a log is a policy
   *                  two readers can disagree about. Its absence reads as the
   *                  default, which is OFF, so no failure path turns it on
   */
  readonly adminReceipts: AppendOnlyRepository<ActionReceipt>;
  readonly agentJobs: AppendOnlyRepository<AgentJobRecord>;
  /**
   * Every walk of a government's own site for its meeting route, one append
   * per walk, keyed by jurisdiction id (v12, 2026-09-23). Written only by the
   * unpaid meetings-discovery executor; a walk is a reading taken at a time.
   */
  readonly discoveryAttempts: AppendOnlyRepository<MeetingsDiscoveryAttempt>;
  readonly adminConfig: AggregateRepository<AdminConfig>;
  /**
   * What readers were told Ask does not hold (v13, 2026-09-25; the owner's
   * decision of that day): one aggregate per body, gap code and UTC day,
   * `<body id>#<code>#<day>`, holding exactly the body, the code, its record
   * class, the day and a count — no question, no reader, no instant. Ask's
   * route adds to it after the answer has gone; the `ask-gaps` provider folds
   * the recent days into the work it creates and orders
   * (`lib/control-plane/ask-gap-observations.ts`).
   */
  readonly askGapObservations: AggregateRepository<AskGapObservation>;
  readonly budget: BudgetRepository;
  readonly locks: LockManager;
  /** What this store is, for a report that must say where the state lives. */
  readonly describe: () => string;
  /** True only for a store whose contents survive this process. */
  readonly durable: boolean;
}

/**
 * Refuse a store that cannot outlive the process, where durability is the point.
 *
 * `MemoryEvidenceStore` in `evidence/store.ts` carries the same guard for the
 * same reason. A test double reaching production is not a hypothetical; it is
 * what happens when the only difference between the two is which constructor
 * someone typed.
 */
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
