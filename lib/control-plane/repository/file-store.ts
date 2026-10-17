import type { HuntOrder } from "../hunt-orders.ts";
import { createDispatchState } from "./dispatch-state.ts";
import { ADMIN_SECTIONS, migrateStoredAdminConfig, storedAdminConfigRepository, type AdminSection, type StoredAdminSection } from "./admin-config.ts";
import { listedBoxRepository, type BoxFinding } from "../box.ts";
import type { WorkerResultRecord } from "../workers/types.ts";
import type { AdminEvidenceCopyRequest } from "../evidence/admin-copy-request.ts";
import type { AskGapObservation } from "../ask-gap-observations.ts";
import type { DoorRecord } from "../../doors/registry.ts";
import type { LeadOrder } from "../leads/order.ts";
import { memoryWebsitePacing } from "../website-pacing.ts";
import type { LiveAuditLogRow } from "../live-audit-log.ts";
import type { SoftwareReleaseReviewRecord } from "../software-release-review.ts";
import { unavailableActiveWorkClaims } from "./active-work-claims.ts";
import { appendFile, link, mkdir, open, opendir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { FreshnessDebt } from "../scheduler/debt.ts";
import type { FreshnessOccurrence, StandingObligation } from "../scheduler/durable.ts";
import type { ResearchIntent, ResearchState } from "../scheduler/research-policy.ts";
import { pricedModelCharge, type PricedCharge } from "../fleet-safety.ts";
import { costRecordId } from "../spend-window.ts";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { storedSpendRepository } from "./model-charges.ts";
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
import type { FieldManualEntry } from "../field-manual.ts";
import { fieldManualRows } from "./field-manual-rows.ts";
import { aggregateFixMap, type FixMapRow } from "../../method/fix-map.ts";
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

let tempCounter = 0;
function tempPath(target: string): string {
  tempCounter += 1;
  return `${target}.${process.pid}.${tempCounter}.tmp`;
}

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

export function fileAggregateRepository<T>(
  root: string,
  kind: string,
  folder: string,
): AggregateRepository<T> {
  const dir = path.join(root, "aggregates", folder);
  const baseFor = (id: string): string => fileNameFor(id);
  const fileForRevision = (id: string, revision: number): string =>
    path.join(dir, `${baseFor(id)}.r${revision}.json`);

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

      const winner = await read(id);
      throw new ConcurrentModification(kind, id, expectedRevision, winner?.revision ?? null);
    },

    list,
    listNarrowed: async (projection: RecordProjection): Promise<readonly Persisted<unknown>[]> =>
      (await list()).map(row => ({ ...row, value: projectAggregate(row.value, projection) })),

    listWhere: async (jsonPath: readonly string[], value: string): Promise<readonly Persisted<T>[]> =>
      (await list()).filter((row) => jsonTextAtPath(row.value, jsonPath) === value),
    listWhereNarrowed: async (jsonPath: readonly string[], value: string, projection: RecordProjection): Promise<readonly Persisted<unknown>[]> =>
      (await list()).filter((row) => jsonTextAtPath(row.value, jsonPath) === value).map(row => ({ ...row, value: projectAggregate(row.value, projection) })),
  };
}

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
      recordedAtSince?: string,
    ): Promise<readonly unknown[]> => {
      const since = recordedAtSince === undefined ? null : Date.parse(recordedAtSince);
      const matches = (await readLines(key))
        .filter(line => since === null || Date.parse(line.at) >= since)
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

    readAllNarrowed: async (projection) =>
      (await readEveryPartition()).map((line) => projectRecord(line.record, projection)),

    readSince: async (since: string): Promise<readonly T[]> =>
      (await readEveryPartition()).filter((line) => Date.parse(line.at) >= Date.parse(since)).map((line) => line.record),

    keys: async (): Promise<readonly string[]> => {
      const keys = new Set<string>((await readEveryPartition()).map((line) => line.key));
      return [...keys].sort();
    },

    keysWhere: async (jsonPath: readonly string[], value: string): Promise<readonly string[]> => {
      const keys = new Set<string>((await readEveryPartition())
        .filter((line) => jsonTextAtPath(line.record, jsonPath) === value).map((line) => line.key));
      return [...keys].sort();
    },
  };

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

async function* streamedSpendCharges(file: string): AsyncGenerator<PricedCharge> {
  let prefix = "", suffix = "", entry = "";
  let phase: "prefix" | "entries" | "suffix" = "prefix";
  let depth = 0, quoted = false, escaped = false, comma = false, count = 0;
  for await (const chunk of createReadStream(file, { encoding: "utf8" })) {
    let text = String(chunk);
    if (phase === "prefix") {
      prefix += text;
      const start = /"charges"\s*:\s*\[/.exec(prefix);
      if (!start) continue;
      const end = start.index + start[0].length;
      text = prefix.slice(end);
      prefix = prefix.slice(0, end);
      phase = "entries";
    }
    if (phase === "suffix") { suffix += text; continue; }
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (depth === 0) {
        if (/\s/.test(char)) continue;
        if (char === "]" && !comma) { suffix = text.slice(i); phase = "suffix"; break; }
        if (char === "," && count > 0 && !comma) { comma = true; continue; }
        if (char !== "{" || (count > 0 && !comma)) throw new CorruptPersistedState(file, "invalid spend charge array");
        entry = "{"; depth = 1; quoted = false; escaped = false; comma = false;
        continue;
      }
      entry += char;
      if (escaped) { escaped = false; continue; }
      if (quoted && char === "\\") { escaped = true; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (char === "{" || char === "[") depth++;
      if (char === "}" || char === "]") depth--;
      if (depth === 0) {
        const charge = JSON.parse(entry) as PricedCharge;
        if (typeof charge.id !== "string" || typeof charge.at !== "string" || !charge.metered) throw new CorruptPersistedState(file, "invalid priced charge");
        yield charge;
        entry = ""; count++;
      }
    }
  }
  if (phase !== "suffix") throw new CorruptPersistedState(file, "incomplete spend charge array");
  validateEnvelope(file, "SpendWindow", JSON.parse(prefix + suffix));
}

async function migrateFileSpend(root: string, locks: LockManager): Promise<void> {
  const source = path.join(root, "aggregates", "spend-window");
  try { await stat(source); } catch (error) { if (isEnoent(error)) return; throw error; }
  await locks.withLock("cp01-spend-migration", async () => {
    try { await stat(source); } catch (error) { if (isEnoent(error)) return; throw error; }
    const target = path.join(root, "aggregates", "model-charges");
    await mkdir(target, { recursive: true });
    const insert = async (charge: PricedCharge) => {
      await exclusiveCreate(path.join(target, `${fileNameFor(charge.id)}.r1.json`), canonicalJson({
        id: charge.id, revision: 1, updatedAt: charge.at, value: charge,
      }));
    };
    const prefix = `${fileNameFor("model-charges")}.r`;
    let latest = 0;
    for await (const file of await opendir(source)) {
      if (!file.name.startsWith(prefix) || !file.name.endsWith(".json")) continue;
      const revision = file.name.slice(prefix.length, -5);
      if (/^\d+$/.test(revision)) latest = Math.max(latest, Number(revision));
    }
    if (latest > 0) for await (const charge of streamedSpendCharges(path.join(source, `${prefix}${latest}.json`))) await insert(charge);
    const logs = path.join(root, "logs", "costs");
    let directory;
    try { directory = await opendir(logs); } catch (error) { if (!isEnoent(error)) throw error; }
    if (directory) for await (const file of directory) {
      if (!file.name.endsWith(".jsonl")) continue;
      const sourceFile = path.join(logs, file.name);
      const lines = createInterface({ input: createReadStream(sourceFile, { encoding: "utf8" }), crlfDelay: Infinity });
      let lineNumber = 0;
      for await (const line of lines) {
        lineNumber++;
        if (!line.trim()) continue;
        const row = parseLogLine<CostEntry>(sourceFile, line, lineNumber);
        const charge = pricedModelCharge(row.record, costRecordId(row.record));
        if (charge) await insert(charge);
      }
    }
    await rm(source, { recursive: true });
  });
}

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
  const scoutResults = fileAppendOnlyRepository<ScoutResult>(resolved, "scout-results");
  const adminBase = fileAggregateRepository<AdminConfig>(resolved, "AdminConfig", "admin-config");

  const repositories: ControlPlaneRepositories = {
    dispatchState: createDispatchState(() => repositories),
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
    capturedCanonicalUrls: async (urls) => {
      const wanted = new Set(urls);
      return new Set((await artifacts.readAll()).map(record => record.canonicalUrl).filter(url => wanted.has(url)));
    },
    adminEvidenceCopyRequests: fileAggregateRepository<AdminEvidenceCopyRequest>(resolved, "AdminEvidenceCopyRequest", "admin-evidence-copy-requests"),
    costs: fileAppendOnlyRepository<CostEntry>(resolved, "costs"),
    ownerSnapshots: fileAggregateRepository<OwnerSnapshot>(
      resolved,
      "OwnerSnapshot",
      "owner-snapshots",
    ),
    fieldManual: fieldManualRows(fileAggregateRepository<FieldManualEntry>(resolved, "FieldManualEntry", "field-manual-entries"),()=>repositories.fixMap),
    fixMap: aggregateFixMap(fileAggregateRepository<FixMapRow>(resolved, "FixMapRow", "fix-map")),
    websitePacing: memoryWebsitePacing(),
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
    huntOrders: (() => { const base=fileAggregateRepository<HuntOrder>(resolved,"HuntOrder","hunt-orders"); return {...base,request:async(orders:readonly HuntOrder[],at:string)=>{for(const order of orders)await base.put(order.id,order,at);},latestStop:async(state:string)=>(await base.listWhere(["state"],state)).filter(row=>row.value.scopeKey===null).sort((a,b)=>b.value.requestedAt.localeCompare(a.value.requestedAt))[0]??null,pending:async (state:string)=>(await base.listWhere(["state"],state)).filter(row=>row.value.confirmedAt===null)}; })(),
    researchState: fileAggregateRepository<ResearchState>(resolved, "ResearchState", "research-state"),
    spend: storedSpendRepository(fileAggregateRepository<PricedCharge>(resolved, "ModelCharge", "model-charges"), scoutResults),
    methodCandidates: fileAggregateRepository<CandidateStore>(resolved, "MethodCandidateStore", "method-candidates"),
    researchIntents: fileAppendOnlyRepository<ResearchIntent>(resolved, "research-intents"),
    boxFindings: listedBoxRepository(fileAggregateRepository<BoxFinding>(resolved, "BoxFinding", "box-findings")),
    scoutResults,
    workerResults: fileAppendOnlyRepository<WorkerResultRecord>(resolved, "worker-results"),
    promotionPipeline: fileAppendOnlyRepository<PromotionPipelineRecord>(resolved, "promotion-pipeline"),
    windowRuns: fileAppendOnlyRepository<WindowRunRecord>(resolved, "window-runs"),
    windowIncidents: fileAppendOnlyRepository<WindowIncident>(resolved, "window-incidents"),
    windowIntents: fileAppendOnlyRepository<WindowIntent>(resolved, "window-intents"),
    softwareReleaseReviews: fileAppendOnlyRepository<SoftwareReleaseReviewRecord>(resolved, "software-release-reviews"),
    adminReceipts: fileAppendOnlyRepository<ActionReceipt>(resolved, "admin-receipts"),
    agentJobs: fileAppendOnlyRepository<AgentJobRecord>(resolved, "agent-jobs"),
    discoveryAttempts: fileAppendOnlyRepository<MeetingsDiscoveryAttempt>(resolved, "discovery-attempts"),
    liveAudits: fileAppendOnlyRepository<LiveAuditLogRow>(resolved, "live-audits"),
    adminConfig: storedAdminConfigRepository(adminBase, Object.fromEntries(Object.entries(ADMIN_SECTIONS).map(([key, table]) => [key, fileAggregateRepository<StoredAdminSection>(resolved, key, `admin-${table}`)])) as Record<AdminSection, AggregateRepository<StoredAdminSection>>, locks),
    askGapObservations: fileAggregateRepository<AskGapObservation>(resolved, "AskGapObservation", "ask-gap-observations"),
    doors: fileAggregateRepository<DoorRecord>(resolved, "Door", "doors"),
    leadOrders: fileAggregateRepository<LeadOrder>(resolved, "LeadOrder", "lead-orders"),
    budget: budgetRepositoryFrom(
      fileAggregateRepository<BudgetLedger>(resolved, "BudgetLedger", "budget"),
      locks,
    ),
    locks,
    describe: () => `durable control-plane repositories rooted at ${resolved}`,
    durable: true,
  };
  await migrateFileSpend(resolved, locks);
  await migrateStoredAdminConfig(adminBase, repositories.adminConfig);
  return repositories;
}
