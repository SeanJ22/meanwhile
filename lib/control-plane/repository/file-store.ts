import type { WorkerResultRecord } from "../workers/types.ts";
import type { AdminEvidenceCopyRequest } from "../evidence/admin-copy-request.ts";
import type { AskGapObservation } from "../ask-gap-observations.ts";
import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
import { unavailableActiveWorkClaims } from "./active-work-claims.ts";
/**
 * THE DURABLE FILESYSTEM STORE — where "the worker may die" stops being a
 * design intention.
 *
 * ============================================================================
 * WHY A FILESYSTEM AND NOT A DATABASE
 *
 * Restated here so the next session does not re-litigate it from the code:
 *
 *   - Postgres/Neon in this repository is the SERVING substrate for
 *     reader-facing data. Control-plane work state is not reader-facing, and
 *     campaign-finance filings are already kept out of Postgres where it does not
 *     belong. A Drizzle migration for it would additionally trip `pnpm db:gate`,
 *     which asks PRODUCTION whether the schema is applied — and would freeze a
 *     release for a reason unrelated to truth.
 *   - The repository's existing, governed durability substrate for canonical
 *     multi-session work state is the committed file store: `data/workstate/*.json`,
 *     `data/method/knowledge.json`, `docs/governance/ledger.jsonl`. That is an
 *     authorized substrate which already satisfies "survives process death".
 *
 * The store is therefore PROVIDER-NEUTRAL at the interface and a filesystem at
 * the implementation. Swapping it later is a new file in this directory, not a
 * change to a single domain rule.
 * ============================================================================
 *
 * THE RACES THIS FILE GUARDS, AND THE ONES THE SUITE CAN ACTUALLY OBSERVE —
 * stated plainly, because claiming a proof the tests do not deliver is worse
 * than claiming nothing:
 *
 *   OBSERVED IN-PROCESS. Compare-and-set. Two `await`ed writers that both read
 *   revision N and both write are genuinely serialized by the single-threaded
 *   event loop, so the second one really does find revision N+1 and really is
 *   refused by `ConcurrentModification`. That is a true observation of the CAS
 *   rule, and it is the rule the coordinator depends on.
 *
 *   OBSERVED IN-PROCESS. Lock exclusion. `withLock` re-entered while held really
 *   does raise `RepositoryLockHeld`, because the lock is an `wx` file create and
 *   the file really is there.
 *
 *   NOT OBSERVED IN-PROCESS. True simultaneity. One process cannot interleave
 *   two writes mid-`writeFile`, so the suite cannot demonstrate a torn read. The
 *   defences against it are structural rather than tested here: every aggregate
 *   write is `write to a temp file, then rename`, and `rename` over an existing
 *   path is atomic on both POSIX and Windows (`MoveFileEx` with
 *   `MOVEFILE_REPLACE_EXISTING`), so a concurrent reader sees either the whole
 *   old file or the whole new one and never a half-written one. Every history
 *   write is an `appendFile`, which opens with `O_APPEND` so two appenders
 *   cannot overwrite each other's offset. And every read-modify-write sequence
 *   is wrapped in an exclusive-create (`wx`) lock file, which is the primitive
 *   that actually holds across processes.
 *
 *   NOT OBSERVED ANYWHERE HERE. Crash-consistency of the filesystem itself
 *   (fsync, journal mode, network filesystems). We do not fsync, so a machine
 *   losing power mid-write can still lose the last write. What this store
 *   guarantees is that a lost write is a write that did not happen, never a
 *   half-write that a later reader mistakes for a whole one.
 *
 * Nothing here reads a clock.
 */

import { appendFile, link, mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
import path from "node:path";

import type { Attempt, ExecutionLease } from "../attempt.ts";
import type { BudgetLedger } from "../budget.ts";
import type { CostEntry } from "../cost.ts";
import { fingerprint } from "../ids.ts";
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
import { budgetRepositoryFrom } from "./shared.ts";
import {
  AppendOnlyViolation,
  ConcurrentModification,
  CorruptPersistedState,
  RepositoryLockHeld,
  UnknownAggregate,
  canonicalJson,
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

/** ------------------------------------------------------------ primitives */

/**
 * A temp-file suffix that is unique per write without being random.
 *
 * Randomness in a library is a replay hazard and this project treats it as one,
 * so the discriminator is the process id plus a per-process counter: unique
 * across concurrent writers, and reproducible in a way a random name is not.
 */
let tempCounter = 0;
function tempPath(target: string): string {
  tempCounter += 1;
  return `${target}.${process.pid}.${tempCounter}.tmp`;
}

/**
 * A filename that is safe on every filesystem and still traceable to its key.
 *
 * The readable prefix is for a human opening the directory; the `fingerprint`
 * suffix is what makes it injective. A sanitiser alone would map
 * `pima.legistar.com` and `pima_legistar_com` onto one file, and two hosts
 * sharing one budget file is exactly the failure the shared budget was built to
 * prevent — arriving through the storage layer instead of the arithmetic.
 */
function fileNameFor(key: string): string {
  const readable = key.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  return `${readable}-${fingerprint([key])}`;
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function isEexist(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "EEXIST";
}

/**
 * Create `target` with its FULL contents, or fail because it already exists.
 *
 * This is the primitive the whole compare-and-set rests on, and it has to be
 * genuinely all-or-nothing. Write-then-rename is atomic for a REPLACEMENT and
 * useless here: two writers that both rename both succeed, and the second one
 * silently destroys the first. So the sequence is write a complete temp file,
 * then `link` it into place — `link` fails with EEXIST when the target exists,
 * and when it succeeds the target has the whole content from the instant it is
 * visible. There is no window in which a reader can see a half-written file and
 * no window in which two writers can both believe they won.
 *
 * `link` is unavailable on a few filesystems. The fallback is an exclusive
 * `open(path, "wx")` followed by a write, which keeps the exclusivity but opens
 * a brief window where a concurrent reader sees an EMPTY file. That reader gets
 * `CorruptPersistedState` — noisy, and never a wrong answer, which is the right
 * way round for a fallback.
 *
 * Returns false when the target already existed.
 */
async function exclusiveCreate(target: string, contents: string): Promise<boolean> {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = tempPath(target);
  await writeFile(temp, contents, "utf8");
  try {
    await link(temp, target);
    return true;
  } catch (error) {
    if (isEexist(error)) return false;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "EPERM" && code !== "ENOSYS" && code !== "EXDEV" && code !== "EOPNOTSUPP") {
      throw error;
    }
    let handle;
    try {
      handle = await open(target, "wx");
    } catch (openError) {
      if (isEexist(openError)) return false;
      throw openError;
    }
    try {
      await handle.writeFile(contents, "utf8");
    } finally {
      await handle.close();
    }
    return true;
  } finally {
    await rm(temp, { force: true });
  }
}

/**
 * Read and parse one JSON file, or refuse by name.
 *
 * ENOENT is the ONLY absence this function admits, and it means the record was
 * never written. Everything else — a truncated file, a permissions failure, a
 * JSON syntax error, an envelope missing its revision — is a FAILED READ and is
 * raised. Returning `null` for any of those would teach every caller above that
 * unreadable state and absent state are the same thing, which is the exact
 * substitution this product cannot survive.
 */
async function readJsonFile<T>(file: string, validate: (parsed: unknown) => T): Promise<T | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (isEnoent(error)) return null;
    throw new CorruptPersistedState(file, `read failed: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CorruptPersistedState(
      file,
      `${(error as Error).message} (${raw.length} byte(s) on disk, not valid JSON)`,
    );
  }
  return validate(parsed);
}

/** The on-disk shape of an aggregate. Validated on every read, never assumed. */
function validateEnvelope<T>(file: string, kind: string, parsed: unknown): Persisted<T> {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CorruptPersistedState(file, `expected a ${kind} envelope object, found ${typeof parsed}`);
  }
  const row = parsed as Partial<Persisted<T>>;
  if (typeof row.id !== "string") {
    throw new CorruptPersistedState(file, `${kind} envelope has no string id`);
  }
  if (typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 1) {
    throw new CorruptPersistedState(
      file,
      `${kind} envelope has revision ${String(row.revision)}, which cannot order a ` +
        "compare-and-set. A revision that is not a positive integer makes every CAS unsound.",
    );
  }
  if (typeof row.updatedAt !== "string") {
    throw new CorruptPersistedState(file, `${kind} envelope has no string updatedAt`);
  }
  if (row.value === undefined) {
    throw new CorruptPersistedState(file, `${kind} envelope has no value`);
  }
  return { id: row.id, revision: row.revision, updatedAt: row.updatedAt, value: row.value as T };
}

/**
 * List a directory that may legitimately not exist yet.
 *
 * A missing KIND directory means nothing of that kind has ever been written, and
 * the store root — which the factory created — proves we are looking in the
 * right place. A missing ROOT is different and is corruption: it means the
 * directory we were handed and wrote into is gone, and answering "no records"
 * there would be a check that could not reach its subject printing like a
 * passing one.
 */
async function listDirectory(root: string, dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (!isEnoent(error)) {
      throw new CorruptPersistedState(dir, `directory listing failed: ${(error as Error).message}`);
    }
  }
  try {
    await stat(root);
  } catch {
    throw new CorruptPersistedState(
      root,
      "the store root itself is absent. This is not an empty store; it is a store we can no " +
        "longer reach, and the two must never return the same answer",
    );
  }
  return [];
}

/** ---------------------------------------------------------- aggregates */

/**
 * ONE FILE PER REVISION, and the current state is the highest one present.
 *
 * The obvious layout — one file per aggregate, rewritten in place — cannot
 * implement compare-and-set. Two writers that both read revision 3 both write
 * revision 4, both `rename` over the same path, and both succeed; the second
 * silently destroys the first, which is the exact lost update the revision
 * number was introduced to prevent. Rename is atomic for a REPLACEMENT and
 * therefore no help at all when the whole point is not to replace.
 *
 * So a write is the EXCLUSIVE CREATION of `<id>.r<n>.json`. Taking revision 4 is
 * winning a race to create one specific filename, which the filesystem
 * arbitrates in a single operation. Whoever loses gets EEXIST, re-reads, and is
 * refused by `ConcurrentModification` naming the revision that actually landed.
 *
 * That the aggregate's whole history stays on disk is a deliberate side effect
 * rather than a cost. Nothing in the control plane's questions is served by
 * forgetting.
 */
export function fileAggregateRepository<T>(
  root: string,
  kind: string,
  folder: string,
): AggregateRepository<T> {
  const dir = path.join(root, "aggregates", folder);
  const baseFor = (id: string): string => fileNameFor(id);
  const fileForRevision = (id: string, revision: number): string =>
    path.join(dir, `${baseFor(id)}.r${revision}.json`);

  /** Revisions present for one id, ascending. */
  const revisionsOf = async (id: string): Promise<number[]> => {
    const prefix = `${baseFor(id)}.r`;
    const names = await listDirectory(root, dir);
    const revisions: number[] = [];
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
      const middle = name.slice(prefix.length, name.length - ".json".length);
      if (!/^\d+$/.test(middle)) continue;
      revisions.push(Number(middle));
    }
    return revisions.sort((a, b) => a - b);
  };

  const readRevision = async (id: string, revision: number): Promise<Persisted<T> | null> => {
    const file = fileForRevision(id, revision);
    return readJsonFile<Persisted<T>>(file, (parsed) => validateEnvelope<T>(file, kind, parsed));
  };

  const read = async (id: string): Promise<Persisted<T> | null> => {
    const revisions = await revisionsOf(id);
    if (revisions.length === 0) return null;
    const latest = revisions[revisions.length - 1];
    const row = await readRevision(id, latest);
    if (row === null) {
      // The directory listing named this file and the read did not find it.
      // That is not an absence; it is a store changing underneath us, and
      // answering "no record" would be a check that could not reach its subject
      // reporting like a passing one.
      throw new CorruptPersistedState(
        fileForRevision(id, latest),
        `revision ${latest} was listed in ${dir} and then could not be read`,
      );
    }
    return row;
  };

  const list = async (): Promise<readonly Persisted<T>[]> => {
    const names = (await listDirectory(root, dir)).filter((n) => n.endsWith(".json"));
    const latestByBase = new Map<string, number>();
    for (const name of names) {
      const match = /^(.*)\.r(\d+)\.json$/.exec(name);
      if (match === null) continue;
      const [, base, revision] = match;
      const current = latestByBase.get(base);
      if (current === undefined || Number(revision) > current) {
        latestByBase.set(base, Number(revision));
      }
    }
    const rows: Persisted<T>[] = [];
    for (const [base, revision] of [...latestByBase.entries()].sort()) {
      const file = path.join(dir, `${base}.r${revision}.json`);
      const row = await readJsonFile<Persisted<T>>(file, (parsed) =>
        validateEnvelope<T>(file, kind, parsed),
      );
      if (row === null) {
        throw new CorruptPersistedState(
          file,
          "the file was listed in this directory and then could not be read",
        );
      }
      rows.push(row);
    }
    return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };

  return {
    read,

    /* A file holds the whole row, so this reads it and narrows it in process, exactly as the Postgres read narrows it in the database. */
    readNarrowed: async (id: string, projection: RecordProjection): Promise<Persisted<unknown> | null> => {
      const row = await read(id);
      return row === null ? null : { ...row, value: projectAggregate(row.value, projection) };
    },

    mustRead: async (id: string): Promise<Persisted<T>> => {
      const row = await read(id);
      if (row === null) throw new UnknownAggregate(kind, id);
      return row;
    },

    /**
     * Idempotent CREATE.
     *
     * The comparison is against revision 1 — the creation — not against the
     * latest state. Identity here is derived from the inputs that CREATED the
     * aggregate, so "is this the same obligation?" is a question about how it
     * began. Comparing against the latest would refuse a perfectly legitimate
     * re-registration of a task that has since been claimed, and a guard that
     * fires on correct behaviour is a guard on its way to being deleted.
     */
    put: async (id: string, value: T, now: string): Promise<PutOutcome<T>> => {
      const row: Persisted<T> = { id, revision: 1, updatedAt: now, value };
      const created = await exclusiveCreate(
        fileForRevision(id, 1),
        `${JSON.stringify(row, null, 2)}\n`,
      );
      if (created) return { created: true, persisted: row };
      const origin = await readRevision(id, 1);
      if (origin === null) {
        throw new CorruptPersistedState(
          fileForRevision(id, 1),
          `${kind} ${id} refused an exclusive create and then had no revision 1 to compare against`,
        );
      }
      reconcileIdempotentPut(kind, id, origin.value, value);
      const latest = await read(id);
      return { created: false, persisted: latest ?? origin };
    },

    compareAndSet: async (
      id: string,
      expectedRevision: number,
      next: T,
      now: string,
    ): Promise<Persisted<T>> => {
      const existing = await read(id);
      if (existing === null) {
        throw new ConcurrentModification(kind, id, expectedRevision, null);
      }
      if (existing.revision !== expectedRevision) {
        throw new ConcurrentModification(kind, id, expectedRevision, existing.revision);
      }
      const row: Persisted<T> = { id, revision: expectedRevision + 1, updatedAt: now, value: next };
      const won = await exclusiveCreate(
        fileForRevision(id, row.revision),
        `${JSON.stringify(row, null, 2)}\n`,
      );
      if (won) return row;
      // Another writer created this exact revision between our read and our
      // write. It won; we are stale, and we say so with the revision that landed.
      const winner = await read(id);
      throw new ConcurrentModification(kind, id, expectedRevision, winner?.revision ?? null);
    },

    list,
    listNarrowed: async (projection: RecordProjection): Promise<readonly Persisted<unknown>[]> =>
      (await list()).map(row => ({ ...row, value: projectAggregate(row.value, projection) })),

    /* `list()` filtered, so the two can never disagree on rows or order. A
       directory has no index to ask, so this reads what `list()` reads. */
    listWhere: async (jsonPath: readonly string[], value: string): Promise<readonly Persisted<T>[]> =>
      (await list()).filter((row) => jsonTextAtPath(row.value, jsonPath) === value),
  };
}

/** -------------------------------------------------------- append-only logs */

interface LogLine<T> {
  readonly key: string;
  readonly recordId: string;
  readonly at: string;
  readonly record: T;
}

function parseLogLine<T>(file: string, line: string, lineNumber: number): LogLine<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new CorruptPersistedState(
      `${file}:${lineNumber}`,
      `${(error as Error).message}. A history line that cannot be parsed is a history we cannot ` +
        "replay, and skipping it would silently shorten the record",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CorruptPersistedState(`${file}:${lineNumber}`, "expected a log-line object");
  }
  const row = parsed as Partial<LogLine<T>>;
  if (typeof row.key !== "string" || typeof row.recordId !== "string" || row.record === undefined) {
    throw new CorruptPersistedState(
      `${file}:${lineNumber}`,
      "log line is missing key, recordId or record",
    );
  }
  return { key: row.key, recordId: row.recordId, at: String(row.at ?? ""), record: row.record as T };
}

/**
 * Collapse identical retries and REFUSE divergent ones, at read time.
 *
 * `appendFile` opens with `O_APPEND`, so two concurrent appenders can never
 * overwrite each other — but they can both have checked for a record id, both
 * found nothing, and both written. The check in `append` is therefore
 * best-effort against a truly simultaneous appender, and this is where that gap
 * is closed: two lines sharing one record id with DIFFERENT content is a history
 * that cannot be replayed, and it is raised the moment anyone reads it rather
 * than resolved by preferring whichever line came first. Two lines with
 * identical content are one retried write and collapse to one record.
 */
function dedupeHistory<T>(log: string, file: string, lines: readonly LogLine<T>[]): LogLine<T>[] {
  const seen = new Map<string, LogLine<T>>();
  const out: LogLine<T>[] = [];
  for (const line of lines) {
    const previous = seen.get(line.recordId);
    if (previous === undefined) {
      seen.set(line.recordId, line);
      out.push(line);
      continue;
    }
    const a = canonicalJson(previous.record);
    const b = canonicalJson(line.record);
    if (a !== b) throw new AppendOnlyViolation(`${log} (${file})`, line.recordId, a, b);
  }
  return out;
}

export function fileAppendOnlyRepository<T>(
  root: string,
  log: string,
): AppendOnlyRepository<T> {
  const dir = path.join(root, "logs", log);
  const fileFor = (key: string): string => path.join(dir, `${fileNameFor(key)}.jsonl`);

  const readLines = async (key: string): Promise<LogLine<T>[]> => {
    const file = fileFor(key);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error) {
      if (isEnoent(error)) return [];
      throw new CorruptPersistedState(file, `read failed: ${(error as Error).message}`);
    }
    const lines = raw
      .split("\n")
      .map((line, index) => ({ line: line.trim(), index }))
      .filter((entry) => entry.line.length > 0)
      .map((entry) => parseLogLine<T>(file, entry.line, entry.index + 1));
    return dedupeHistory(log, file, lines);
  };

  return {
    append: async (
      key: string,
      recordId: string,
      record: T,
      now: string,
    ): Promise<AppendOutcome<T>> => {
      const lines = await readLines(key);
      const existingIndex = lines.findIndex((line) => line.recordId === recordId);
      if (existingIndex >= 0) {
        reconcileIdempotentAppend(log, recordId, lines[existingIndex].record, record);
        return {
          appended: false,
          recordId,
          record: lines[existingIndex].record,
          position: existingIndex,
        };
      }
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      const entry: LogLine<T> = { key, recordId, at: now, record };
      // `appendFile` opens with O_APPEND, so two concurrent appenders cannot
      // land on the same offset and clobber one another. A whole-file rewrite
      // here would make history the one thing a race can shorten.
      await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
      return { appended: true, recordId, record, position: lines.length };
    },

    read: async (key: string): Promise<readonly T[]> =>
      (await readLines(key)).map((line) => line.record),

    readWhere: async (
      key: string,
      jsonPath: readonly string[],
      value: string,
    ): Promise<readonly T[]> =>
      (await readLines(key))
        .map((line) => line.record)
        .filter((record) => jsonTextAtPath(record, jsonPath) === value),

    readRecent: async (key: string, limit: number): Promise<readonly T[]> => {
      const records = (await readLines(key)).map((line) => line.record);
      const bounded = Math.max(0, Math.trunc(limit));
      return records.slice(Math.max(0, records.length - bounded)).reverse();
    },

    readRecentWhere: async (
      key: string,
      jsonPath: readonly string[],
      value: string,
      limit: number,
      projection: RecordProjection,
    ): Promise<readonly unknown[]> => {
      const matches = (await readLines(key))
        .map((line) => line.record)
        .filter((record) => jsonTextAtPath(record, jsonPath) === value);
      const bounded = Math.max(0, Math.trunc(limit));
      return matches
        .slice(Math.max(0, matches.length - bounded))
        .reverse()
        .map((record) => projectRecord(record, projection));
    },

    readLatest: async (keys: readonly string[], projection: RecordProjection): Promise<ReadonlyMap<string, unknown>> => {
      const out = new Map<string, unknown>();
      for (const key of new Set(keys)) {
        const lines = await readLines(key);
        const newest = lines[lines.length - 1];
        if (newest !== undefined) out.set(key, projectRecord(newest.record, projection));
      }
      return out;
    },

    readAll: async (): Promise<readonly T[]> =>
      (await readEveryPartition()).map((line) => line.record),

    readSince: async (since: string): Promise<readonly T[]> =>
      (await readEveryPartition()).filter((line) => Date.parse(line.at) >= Date.parse(since)).map((line) => line.record),

    keys: async (): Promise<readonly string[]> => {
      const keys = new Set<string>((await readEveryPartition()).map((line) => line.key));
      return [...keys].sort();
    },
  };

  /** Every line in every partition, in filename then append order. */
  async function readEveryPartition(): Promise<LogLine<T>[]> {
    const names = (await listDirectory(root, dir)).filter((n) => n.endsWith(".jsonl")).sort();
    const out: LogLine<T>[] = [];
    for (const name of names) {
      const file = path.join(dir, name);
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch (error) {
        if (isEnoent(error)) continue;
        throw new CorruptPersistedState(file, `read failed: ${(error as Error).message}`);
      }
      const lines = raw
        .split("\n")
        .map((line, index) => ({ line: line.trim(), index }))
        .filter((entry) => entry.line.length > 0)
        .map((entry) => parseLogLine<T>(file, entry.line, entry.index + 1));
      out.push(...dedupeHistory(log, file, lines));
    }
    return out;
  }
}

/** ------------------------------------------------------------------ locks */

/**
 * Cross-process exclusion via exclusive-create.
 *
 * `open(path, "wx")` fails with EEXIST when the file already exists, and that
 * check-and-create is a single filesystem operation — which is what makes it a
 * lock rather than a race with extra steps. It REFUSES when held; it does not
 * wait. A library that promised not to read a clock cannot honestly implement a
 * timeout, and a wait without a timeout is a hang.
 */
export function fileLockManager(root: string): LockManager {
  const dir = path.join(root, "locks");
  return {
    withLock: async <R>(name: string, fn: () => Promise<R>): Promise<R> => {
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${fileNameFor(name)}.lock`);
      let handle;
      try {
        handle = await open(file, "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
          const owner = await readFile(file, "utf8").catch(() => "an unrecorded holder");
          throw new RepositoryLockHeld(name, `lock file ${file} exists, written by ${owner.trim()}`);
        }
        throw error;
      }
      try {
        await handle.writeFile(`pid ${process.pid}`, "utf8");
        await handle.close();
        handle = undefined;
        return await fn();
      } finally {
        if (handle !== undefined) await handle.close().catch(() => undefined);
        await rm(file, { force: true });
      }
    },
  };
}

/** ------------------------------------------------------------ the bundle */

/**
 * Open the durable store rooted at `root`.
 *
 * NO ENV MAGIC AND NO DEFAULT. The caller names the directory, always. A default
 * would eventually write control-plane state into the repository tree from a
 * test run, and a store that can be created by accident is a store whose
 * contents nobody can account for.
 *
 * The factory is async because it creates the root: after this call, a MISSING
 * root is corruption rather than emptiness, and every read below can rely on
 * that distinction.
 */
export async function createFileRepositories(root: string): Promise<ControlPlaneRepositories> {
  if (typeof root !== "string" || root.trim().length === 0) {
    throw new Error(
      "createFileRepositories requires an explicit root directory. There is deliberately no " +
        "default: a store that can be created by accident is a store whose contents nobody can " +
        "account for.",
    );
  }
  const resolved = path.resolve(root);
  await mkdir(resolved, { recursive: true });
  const locks = fileLockManager(resolved);
  const artifacts = fileAppendOnlyRepository<ArtifactRecord>(resolved, "artifacts");

  return {
    workItems: fileAggregateRepository<WorkItem>(resolved, "WorkItem", "work-items"),
    routeTasks: fileAggregateRepository<RouteTask>(resolved, "RouteTask", "route-tasks"),
    attempts: fileAggregateRepository<Attempt>(resolved, "Attempt", "attempts"),
    obligations: fileAggregateRepository<StandingObligation>(
      resolved,
      "StandingObligation",
      "obligations",
    ),
    occurrences: fileAggregateRepository<FreshnessOccurrence>(
      resolved,
      "FreshnessOccurrence",
      "occurrences",
    ),
    debts: fileAggregateRepository<FreshnessDebt>(resolved, "FreshnessDebt", "debts"),
    leases: fileAggregateRepository<ExecutionLease>(resolved, "ExecutionLease", "leases"),
    activeWorkClaims: unavailableActiveWorkClaims(),
    transitions: fileAppendOnlyRepository<RecordedTransition>(resolved, "transitions"),
    escalations: fileAppendOnlyRepository<Escalation>(resolved, "escalations"),
    dispositions: fileAppendOnlyRepository<DispositionCommit>(resolved, "dispositions"),
    artifacts,
    artifactsByCanonicalUrl: async (url, limit) =>
      (await artifacts.readAll()).filter(record => record.canonicalUrl === url)
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || a.artifactId.localeCompare(b.artifactId))
        .slice(0, Math.max(0, Math.trunc(limit))),
    adminEvidenceCopyRequests: fileAggregateRepository<AdminEvidenceCopyRequest>(resolved, "AdminEvidenceCopyRequest", "admin-evidence-copy-requests"),
    costs: fileAppendOnlyRepository<CostEntry>(resolved, "costs"),
    /* The owner control centre's data plane (ITEM H). */
    ownerSnapshots: fileAggregateRepository<OwnerSnapshot>(
      resolved,
      "OwnerSnapshot",
      "owner-snapshots",
    ),
    fieldManual: fileAggregateRepository<FieldManualStore>(
      resolved,
      "FieldManual",
      "field-manual",
    ),
    runnerHeartbeat: fileAggregateRepository<RunnerHeartbeat>(
      resolved,
      "RunnerHeartbeat",
      "runner-heartbeat",
    ),
    cacheObservations: fileAggregateRepository<CacheObservationRecord>(
      resolved,
      "CacheObservationRecord",
      "cache-observations",
    ),
    ownerDigests: fileAppendOnlyRepository<OwnerDigestRecord>(resolved, "owner-digests"),
    ownerDecisions: fileAppendOnlyRepository<OwnerDecisionIntent>(resolved, "owner-decisions"),
    /* Level 1 — Research (schema v4). */
    researchState: fileAggregateRepository<ResearchState>(resolved, "ResearchState", "research-state"),
    methodCandidates: fileAggregateRepository<CandidateStore>(resolved, "MethodCandidateStore", "method-candidates"),
    researchIntents: fileAppendOnlyRepository<ResearchIntent>(resolved, "research-intents"),
    scoutResults: fileAppendOnlyRepository<ScoutResult>(resolved, "scout-results"),
    workerResults: fileAppendOnlyRepository<WorkerResultRecord>(resolved, "worker-results"),
    /* The nightly door (RULING 242, schema v5). */
    promotionPipeline: fileAppendOnlyRepository<PromotionPipelineRecord>(resolved, "promotion-pipeline"),
    windowRuns: fileAppendOnlyRepository<WindowRunRecord>(resolved, "window-runs"),
    windowIncidents: fileAppendOnlyRepository<WindowIncident>(resolved, "window-incidents"),
    windowIntents: fileAppendOnlyRepository<WindowIntent>(resolved, "window-intents"),
    /* Software release review (Admin Pass B, schema v8). */
    softwareReleaseReviews: fileAppendOnlyRepository<SoftwareReleaseReviewRecord>(resolved, "software-release-reviews"),
    /* The Action Gateway (Admin Pass C, ADM-C6, schema v9). */
    adminReceipts: fileAppendOnlyRepository<ActionReceipt>(resolved, "admin-receipts"),
    agentJobs: fileAppendOnlyRepository<AgentJobRecord>(resolved, "agent-jobs"),
    discoveryAttempts: fileAppendOnlyRepository<MeetingsDiscoveryAttempt>(resolved, "discovery-attempts"),
    adminConfig: fileAggregateRepository<AdminConfig>(resolved, "AdminConfig", "admin-config"),
    /* What readers were told Ask does not hold (schema v13). */
    askGapObservations: fileAggregateRepository<AskGapObservation>(resolved, "AskGapObservation", "ask-gap-observations"),
    budget: budgetRepositoryFrom(
      fileAggregateRepository<BudgetLedger>(resolved, "BudgetLedger", "budget"),
      locks,
    ),
    locks,
    describe: () => `durable control-plane repositories rooted at ${resolved}`,
    durable: true,
  };
}
