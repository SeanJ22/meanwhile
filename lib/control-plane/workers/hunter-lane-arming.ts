import { readRuntimeAdminConfig } from "../runtime-admin-config.ts";
/**
 * The standing hunter lane's guards. One standing lane admits paid model requests and holds each to the round's
 * own guards: the owner's controls read live every refresh (any unreadable one closes paid work by name), the
 * round's budget reading from a host-local file (missing, stale or unreadable holds paid work), each task's own
 * Send marks (an unknown Send waits for the next reading), and the Fleet ceiling, with the lane's own requests
 * counted from its own book so none is lost or counted twice between controllers. Nothing here changes a limit.
 */
import { ZERO_COST } from "../attempt.ts";
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import { dirname, join } from "node:path";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { FleetSafetyController, FleetPreSendRefusal, modelRequestWorstCaseUsd, modelResponseUsd, resolveRollingCeiling, type PricedCharge, type ProviderCircuit } from "../fleet-safety.ts";
import { readSpendWindow } from "../spend-window.ts";
import { adminConfigForPaidWork, discoverySearchEnabled, fleetSpendCeilingOverrideUsd, type AdminConfigRead } from "../gateway/admin-config.ts";
import {
  ASSIGNMENT_BUDGET_CODE,
  AssignmentBudgetGate,
  assignmentBudgetsOf,
  assignmentMembership,
  malformedAssignmentBudgetsOf,
  type AssignmentBudgetSpec,
  type AssignmentRefusal,
  type AssignmentSpend,
  type MalformedAssignmentBudget,
} from "../expansion/assignment-budget.ts";
import { ScopeBudgetGate, type BudgetScope, type IndexedMembership } from "../expansion/membership.ts";
import { DurableSpendHolds, SendBudgetRefusal, SETTLED_HOLD_RETENTION_MS, type BudgetLine } from "../expansion/spend-holds.ts";
import { modelLaneClosure, type ModelProviderQueue } from "../scheduler/model-lane.ts";
import { RESEARCH_BOUNDS, RESEARCH_INTENT_LOG_KEY, ceilingPermits, readIntents, researchSpendInWindow } from "../scheduler/research-policy.ts";
import type { ModelTransport } from "../scheduler/scout-executor.ts";
import type { backgroundBatchTransport } from "../model-batch.ts";
import type { ResearchIntent } from "../scheduler/research-policy.ts";
import { paidWorkGuards } from "./paid-work-guards.ts";
import { DiskRows } from "../scheduler/disk-rows.ts";
import type { FreshnessDetailReference } from "../owner-surface.ts";

export const HUNTER_LANE_ARMING_FORMAT = 2;
const openArmingSnapshots = new Set<() => void>();
const armingDatabases = new WeakMap<HunterLaneArmingSnapshot, DatabaseSync>();
process.once("exit", () => { for (const close of openArmingSnapshots) close(); });
/** How old the round's budget reading may be: well inside SETTLED_HOLD_RETENTION_MS, since a line counts settled holds newer than its reading. */
export const HUNTER_LANE_ARMING_MAX_AGE_MS = 3_600_000;
/** The lane re-reads the owner's controls and the round's reading this often. */
export const HUNTER_LANE_REFRESH_MS = 5 * 60_000;
/** Only old single-document handoffs use JSON1; their compatibility parsing stays inside one fixed bound. */
export const HUNTER_LANE_LEGACY_BYTES = 1024 * 1024;

if (HUNTER_LANE_ARMING_MAX_AGE_MS >= SETTLED_HOLD_RETENTION_MS) throw new Error("the lane's reading must be younger than the settled-hold retention");

/** Where the round writes its reading and the lane reads it: one host-local file, shared across staged release checkouts. */
export function hunterLaneArmingPath(root: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const named = env.WTP_HUNTER_LANE_ARMING?.trim();
  return named ? named : join(root, ".runtime", "hunter-lane", "arming.sqlite");
}

function indexedMetadata(db: DatabaseSync): boolean {
  for (const column of db.prepare("PRAGMA table_info(metadata)").iterate()) if (column.name === "key") return true;
  return false;
}
function armingHeaderBytes(db: DatabaseSync, indexed: boolean): number {
  // SQLite's column octet_length uses cell metadata, without reading its overflow payload.
  return Number(db.prepare(`SELECT octet_length(body) AS bytes FROM metadata${indexed ? " WHERE key='header'" : ""} LIMIT 1`).get()?.bytes ?? 0);
}

/** A derived wake condition for the existing freshness cycle, never a new owner control. */
export function armingNeedsRebuild(path: string): boolean {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA cache_size=-1024; PRAGMA mmap_size=0");
    return armingHeaderBytes(db, indexedMetadata(db)) > HUNTER_LANE_LEGACY_BYTES;
  } catch { return false; }
  finally { db?.close(); }
}

/** What the round read that the lane cannot read cheaply. Written once per round. */
export interface HunterLaneArming {
  readonly format: typeof HUNTER_LANE_ARMING_FORMAT;
  /** The round's instant: when the Send and area history was read. */
  readonly readAt: string;
  readonly sends: {
    /** Every budgeted Send the round armed, SCOPE and DISPATCH. */
    readonly specs: Iterable<AssignmentBudgetSpec>;
    /** Each Send's spend at `readAt`; null when a charge on it reported no dollar figure. Absent: the ledger was unreadable. */
    readonly historical: Iterable<{ readonly key: string; readonly usd: number | null }> | null;
    /** Every Send key the round saw on any obligation, budgeted or not; a mark outside it is newer than the reading. */
    readonly knownKeys: Iterable<string>;
    /** Sends the round reached an obligation under whose mark it had not seen written (the fail-closed rule). */
    readonly reached: ReadonlyMap<string, readonly string[]>;
  };
  /** The area budgets, or null when no expansion scope is selected. */
  readonly areas: { readonly scopes: readonly BudgetScope[]; readonly malformedScopes: number } | null;
  /** Subjects covered by a funded hunt's lifetime allowance. */
  readonly lifetimeHuntSubjects: Iterable<string>;
  /** The owner's place order, for the queue. */
  readonly placeOrder: Iterable<string>;
  /** The provider circuits the round ended with; the lane starts from them. */
  readonly circuits: readonly ProviderCircuit[];
  readonly worstCaseUsd: number;
}

/** The round's reading, from the gates it armed. */
export function laneArmingOf(input: {
  readonly readAt: string;
  readonly specs: Iterable<AssignmentBudgetSpec>;
  readonly historical: ReadonlyMap<string, AssignmentSpend> | null;
  readonly knownKeys: Iterable<string>;
  readonly reached: ReadonlyMap<string, readonly string[]>;
  readonly areas: { readonly scopes: readonly BudgetScope[]; readonly malformedScopes: number } | null;
  readonly lifetimeHuntSubjects: Iterable<string>;
  readonly placeOrder: Iterable<string>;
  readonly circuits: readonly ProviderCircuit[];
  readonly worstCaseUsd: number;
}): HunterLaneArming {
  return {
    format: HUNTER_LANE_ARMING_FORMAT,
    readAt: input.readAt,
    sends: {
      specs: input.specs,
      historical: input.historical === null ? null : { *[Symbol.iterator]() {
        for (const [key, spend] of input.historical!) yield { key, usd: spend.usd };
      } },
      knownKeys: input.knownKeys,
      reached: input.reached,
    },
    areas: input.areas,
    lifetimeHuntSubjects: input.lifetimeHuntSubjects,
    placeOrder: input.placeOrder,
    circuits: input.circuits,
    worstCaseUsd: input.worstCaseUsd,
  };
}

export interface HunterLaneArmingSnapshot extends Omit<HunterLaneArming, "sends" | "lifetimeHuntSubjects" | "placeOrder"> {
  readonly sends: Omit<HunterLaneArming["sends"], "knownKeys" | "specs" | "historical"> & {
    readonly specs: DiskRows<AssignmentBudgetSpec>;
    readonly specFor: (key: string) => AssignmentBudgetSpec | undefined;
    readonly historical: ReadonlyMap<string, AssignmentSpend> | null;
    readonly knownKeys: IndexedMembership;
  };
  readonly placeOrder: DiskRows<string>;
  readonly lifetimeHuntSubjects: IndexedMembership;
  /** A request can finish against its original reading after the lane re-arms. */
  readonly retain: () => () => void;
  readonly close: () => void;
}

const DETAIL_ROWS = 32;
const DETAIL_BYTES = 1024 * 1024;
type ArmingSection = "send-specs" | "send-history" | "place-order";
type HistoricalSend = { readonly key: string; readonly usd: number | null };
type ArmingHeader = Omit<HunterLaneArming, "sends" | "placeOrder"> & {
  readonly sends: { readonly specs: FreshnessDetailReference; readonly historical: FreshnessDetailReference | null };
  readonly placeOrder: FreshnessDetailReference;
};
const detailKey = (cycleId: string, section: ArmingSection): string => `hunter-arming:${cycleId}:${section}`;
const indexKey = (section: ArmingSection, key: string): string => `index:${section}:${key}`;

/** Existing arming metadata stores the same bounded detail envelopes as owner history, locally. */
function writeArmingDetails<T>(db: DatabaseSync, cycleId: string, section: ArmingSection, rows: Iterable<T>, keyOf?: (row: T) => string): FreshnessDetailReference {
  const logKey = detailKey(cycleId, section), put = db.prepare("INSERT OR REPLACE INTO metadata(key,body) VALUES (?,?)");
  let page = 0, count = 0, pending: T[] = [], bytes = 0;
  const flush = () => {
    put.run(`${logKey}:${page}`, JSON.stringify({ freshnessDetails: { cycleId, section, page, rows: pending } }));
    if (keyOf) for (let offset = 0; offset < pending.length; offset++) put.run(indexKey(section, keyOf(pending[offset])), JSON.stringify({ page, offset }));
    page++; pending = []; bytes = 0;
  };
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row) ?? "null");
    if (pending.length && bytes + size > DETAIL_BYTES) flush();
    pending.push(row); count++; bytes += size;
    if (pending.length === DETAIL_ROWS) flush();
  }
  if (pending.length) flush();
  return { cycleId, section, logKey, rows: count, pages: page };
}

function validArmingDetails(value: unknown, cycleId: string, section: ArmingSection): value is FreshnessDetailReference {
  const ref = value as Partial<FreshnessDetailReference> | null;
  return ref !== null && typeof ref === "object" && ref.cycleId === cycleId && ref.section === section && ref.logKey === detailKey(cycleId, section) &&
    Number.isSafeInteger(ref.rows) && Number.isSafeInteger(ref.pages) && ref.rows! >= 0 && ref.pages! >= 0 &&
    (ref.rows === 0 ? ref.pages === 0 : ref.pages! > 0 && ref.rows! >= ref.pages! && ref.rows! <= ref.pages! * DETAIL_ROWS);
}

function readArmingDetails<T>(db: DatabaseSync, ref: FreshnessDetailReference) {
  const one = db.prepare("SELECT body FROM metadata WHERE key=?");
  const page = (number: number): readonly T[] => {
    const details = JSON.parse(String(one.get(`${ref.logKey}:${number}`)?.body))?.freshnessDetails;
    if (!details || details.cycleId !== ref.cycleId || details.section !== ref.section || details.page !== number ||
        !Array.isArray(details.rows) || details.rows.length < 1 || details.rows.length > DETAIL_ROWS) throw new Error("HUNTER_ARMING_DETAIL_PAGE_INVALID");
    return details.rows as T[];
  };
  const rows = new DiskRows<T>(function* () {
    let count = 0;
    for (let number = 0; number < ref.pages; number++) for (const row of page(number)) { count++; yield row; }
    if (count !== ref.rows) throw new Error("HUNTER_ARMING_DETAIL_COUNT_INVALID");
  }, () => ref.rows);
  const read = (key: string): T | undefined => {
    const slot = one.get(indexKey(ref.section as ArmingSection, key));
    if (!slot) return undefined;
    const at = JSON.parse(String(slot.body)) as { page: number; offset: number };
    if (!Number.isSafeInteger(at.page) || at.page < 0 || at.page >= ref.pages || !Number.isSafeInteger(at.offset) || at.offset < 0 || at.offset >= DETAIL_ROWS)
      throw new Error("HUNTER_ARMING_DETAIL_INDEX_INVALID");
    const found = page(at.page)[at.offset];
    if (found === undefined || (found as { key?: unknown }).key !== key) throw new Error("HUNTER_ARMING_DETAIL_INDEX_INVALID");
    return found;
  };
  return { rows, read };
}

function historicalSends(db: DatabaseSync, ref: FreshnessDetailReference): ReadonlyMap<string, AssignmentSpend> {
  const details = readArmingDetails<HistoricalSend>(db, ref), prefix = indexKey("send-history", "");
  const keys = db.prepare("SELECT substr(key,?) AS value FROM metadata WHERE key>=? AND key<? ORDER BY key");
  const keyRows = function* () { for (const row of keys.iterate(prefix.length + 1, prefix, `${prefix}\uffff`)) yield String(row.value); };
  const entries = function* (): IterableIterator<[string, AssignmentSpend]> {
    for (const key of keyRows()) yield [key, { usd: details.read(key)!.usd } as AssignmentSpend];
  };
  const entryIterator = () => Iterator.from(entries());
  const view = {
    [Symbol.toStringTag]: "Map",
    get size() { return Number(db.prepare("SELECT count(*) AS n FROM metadata WHERE key>=? AND key<?").get(prefix, `${prefix}\uffff`)!.n); },
    get: (key: string) => { const row = details.read(key); return row === undefined ? undefined : { usd: row.usd } as AssignmentSpend; },
    has: (key: string) => details.read(key) !== undefined, entries: entryIterator, keys: () => Iterator.from(keyRows()),
    values: () => entryIterator().map(([, spend]) => spend), [Symbol.iterator]: entryIterator,
    forEach(visit: (value: AssignmentSpend, key: string, map: ReadonlyMap<string, AssignmentSpend>) => void, receiver?: unknown) {
      for (const [key, spend] of entries()) visit.call(receiver, spend, key, view);
    },
  };
  return view;
}

/** Written whole or not at all; memberships stream to disk without a country-sized serialization. */
export function writeLaneArming(path: string, arming: HunterLaneArming): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  rmSync(temporary, { force: true });
  const db = new DatabaseSync(temporary);
  try {
    db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-1024; PRAGMA mmap_size=0; CREATE TABLE metadata(key TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE known(value TEXT PRIMARY KEY); CREATE TABLE reached(obligation TEXT PRIMARY KEY,keys TEXT NOT NULL); CREATE TABLE members(scope TEXT,subject TEXT,PRIMARY KEY(scope,subject)); CREATE TABLE lifetime(value TEXT PRIMARY KEY); BEGIN; INSERT INTO metadata VALUES ('header','{}')");
    const header = { ...arming, lifetimeHuntSubjects: undefined,
      sends: { specs: writeArmingDetails(db, arming.readAt, "send-specs", arming.sends.specs, row => row.key),
        historical: arming.sends.historical === null ? null : writeArmingDetails(db, arming.readAt, "send-history", arming.sends.historical, row => row.key) },
      placeOrder: writeArmingDetails(db, arming.readAt, "place-order", arming.placeOrder),
      areas: arming.areas === null ? null : { ...arming.areas, scopes: arming.areas.scopes.map(({ members: _members, ...scope }) => scope) } };
    db.prepare("UPDATE metadata SET body=? WHERE key='header'").run(JSON.stringify(header));
    const known = db.prepare("INSERT OR IGNORE INTO known VALUES (?)");
    for (const key of arming.sends.knownKeys) known.run(key);
    const reached = db.prepare("INSERT OR REPLACE INTO reached VALUES (?,?)");
    for (const [obligation, keys] of arming.sends.reached) if (keys.length) reached.run(obligation, JSON.stringify(keys));
    const members = db.prepare("INSERT OR IGNORE INTO members VALUES (?,?)");
    for (const scope of arming.areas?.scopes ?? []) for (const subject of scope.members) members.run(scope.key, subject);
    const lifetime = db.prepare("INSERT OR IGNORE INTO lifetime VALUES (?)");
    for (const subject of arming.lifetimeHuntSubjects) lifetime.run(subject);
    db.exec("COMMIT");
  } catch (error) { db.close(); rmSync(temporary, { force: true }); throw error; }
  db.close(); renameSync(temporary, path);
}

function diskStringSet(db: DatabaseSync, select: string, exact: string, parameters: readonly string[] = []): IndexedMembership {
  const rows = db.prepare(select), one = db.prepare(exact), count = db.prepare(`SELECT count(*) AS n FROM (${select})`);
  const values = function* () { for (const row of rows.iterate(...parameters)) yield String(row.value); };
  return { get size() { return Number(count.get(...parameters)!.n); }, has: (value: string) => one.get(...parameters, value) !== undefined,
    [Symbol.iterator]: values };
}

function diskReached(db: DatabaseSync): ReadonlyMap<string, readonly string[]> {
  const rows = db.prepare("SELECT obligation,keys FROM reached ORDER BY obligation"), one = db.prepare("SELECT keys FROM reached WHERE obligation=?");
  const entries = function* (): IterableIterator<[string, readonly string[]]> { for (const row of rows.iterate()) yield [String(row.obligation), JSON.parse(String(row.keys)) as string[]]; };
  const map = { get size() { return Number(db.prepare("SELECT count(*) AS n FROM reached").get()!.n); },
    has: (key: string) => one.get(key) !== undefined,
    get: (key: string) => { const row = one.get(key); return row === undefined ? undefined : JSON.parse(String(row.keys)) as string[]; },
    entries, *keys() { for (const [key] of entries()) yield key; }, *values() { for (const [, value] of entries()) yield value; }, [Symbol.iterator]: entries,
    forEach(callback: (value: readonly string[], key: string, map: ReadonlyMap<string, readonly string[]>) => void, thisArg?: unknown) { for (const [key, value] of entries()) callback.call(thisArg, value, key, map as unknown as ReadonlyMap<string, readonly string[]>); } };
  return map as unknown as ReadonlyMap<string, readonly string[]>;
}

export type LaneArmingRead = { readonly arming: HunterLaneArmingSnapshot } | { readonly held: string };

/** Only policy metadata is read into memory; membership is looked up by exact subject/obligation. */
export function readLaneArming(path: string, now: string): LaneArmingRead {
  let db: DatabaseSync | undefined, directory: string | undefined;
  const failed = (): void => { try { db?.close(); } finally { if (directory) rmSync(temporaryPath(directory), { recursive: true, force: true }); } };
  try {
    directory = mkdtempSync(temporaryPath(join(tmpdir(), "meanwhile-hunter-arming-")));
    const snapshot = temporaryPath(join(directory, "arming.sqlite"));
    copyFileSync(path, temporaryPath(snapshot));
    db = new DatabaseSync(snapshot);
    db.exec("PRAGMA cache_size=-1024; PRAGMA mmap_size=0");
    const indexed = indexedMetadata(db);
    if (armingHeaderBytes(db, indexed) > HUNTER_LANE_LEGACY_BYTES) {
      failed(); return { held: "the legacy round's budget reading needs a bounded rebuild; the existing freshness cycle will rewrite it before paid requests use it" };
    }
    if (!indexed) db.exec("ALTER TABLE metadata ADD COLUMN key TEXT; UPDATE metadata SET key='header' WHERE rowid=(SELECT min(rowid) FROM metadata); CREATE UNIQUE INDEX metadata_keys ON metadata(key)");
    // The legacy header may contain the entire country's Sends. Remove those
    // arrays inside SQLite; only bounded references and scalar policy cross here.
    const header = db.prepare(`SELECT json_remove(body,'$.sends.specs','$.sends.historical','$.placeOrder') AS body,
      json_type(body,'$.sends.specs') AS specs_type,json_type(body,'$.sends.historical') AS history_type,
      json_type(body,'$.placeOrder') AS order_type,
      CASE WHEN json_type(body,'$.sends.specs')='object' THEN json_extract(body,'$.sends.specs') END AS specs_ref,
      CASE WHEN json_type(body,'$.sends.historical')='object' THEN json_extract(body,'$.sends.historical') END AS history_ref,
      CASE WHEN json_type(body,'$.placeOrder')='object' THEN json_extract(body,'$.placeOrder') END AS order_ref
      FROM metadata WHERE key='header'`).get();
    const a = JSON.parse(String(header?.body)) as Partial<ArmingHeader> | null;
    const specs = header?.specs_ref === null ? null : JSON.parse(String(header?.specs_ref)) as unknown;
    const historical = header?.history_ref === null ? null : JSON.parse(String(header?.history_ref)) as unknown;
    const order = header?.order_ref === null ? null : JSON.parse(String(header?.order_ref)) as unknown;
    if (a === null || typeof a !== "object" || a.format !== HUNTER_LANE_ARMING_FORMAT || typeof a.readAt !== "string" || !Number.isFinite(Date.parse(a.readAt)) ||
      !a.sends || !(header?.specs_type === "array" || validArmingDetails(specs, a.readAt, "send-specs")) ||
      !(header?.history_type === "null" || header?.history_type === "array" || validArmingDetails(historical, a.readAt, "send-history")) ||
      !(header?.order_type === "array" || validArmingDetails(order, a.readAt, "place-order")) ||
      !Array.isArray(a.circuits) || typeof a.worstCaseUsd !== "number" || !(a.areas === null || (typeof a.areas === "object" && Array.isArray(a.areas?.scopes)))) {
      failed(); return { held: "the round's budget reading is not in the expected form" };
    }
    const ageMs = Date.parse(now) - Date.parse(a.readAt);
    if (ageMs > HUNTER_LANE_ARMING_MAX_AGE_MS) {
      failed(); return { held: `the round's budget reading is ${Math.round(ageMs / 60_000)} minutes old (more than ${HUNTER_LANE_ARMING_MAX_AGE_MS / 60_000}), so no research round has read the Send and area budgets since` };
    }
    const held = db, ownedDirectory = directory;
    const legacySpecs = function* (): IterableIterator<AssignmentBudgetSpec> {
      const fields = "json_object('key',json_extract(j.value,'$.key'),'kind',json_extract(j.value,'$.kind'),'label',json_extract(j.value,'$.label'),'ref',json_extract(j.value,'$.ref'),'budgetUsd',json_extract(j.value,'$.budgetUsd'),'sentAt',json_extract(j.value,'$.sentAt'),'budgetStartedAt',json_extract(j.value,'$.budgetStartedAt'))";
      for (const row of held.prepare(`SELECT CASE WHEN json_type(j.value,'$.budgetStartedAt') IS NULL THEN json_remove(${fields},'$.budgetStartedAt') ELSE ${fields} END AS value
        FROM metadata m,json_each(m.body,'$.sends.specs') j WHERE m.key='header'`).iterate()) yield JSON.parse(String(row.value)) as AssignmentBudgetSpec;
    };
    const legacyHistory = function* (): IterableIterator<HistoricalSend> {
      for (const row of held.prepare("SELECT json_object('key',json_extract(j.value,'$.key'),'usd',json_extract(j.value,'$.usd')) AS value FROM metadata m,json_each(m.body,'$.sends.historical') j WHERE m.key='header'").iterate())
        yield JSON.parse(String(row.value)) as HistoricalSend;
    };
    const legacyOrder = function* (): IterableIterator<string> {
      for (const row of held.prepare("SELECT j.value FROM metadata m,json_each(m.body,'$.placeOrder') j WHERE m.key='header'").iterate()) yield String(row.value);
    };
    held.exec("BEGIN");
    const specRef = header!.specs_type === "array" ? writeArmingDetails(held, a.readAt, "send-specs", legacySpecs(), row => row.key) : specs as FreshnessDetailReference;
    const historyRef = header!.history_type === "null" ? null : header!.history_type === "array"
      ? writeArmingDetails(held, a.readAt, "send-history", legacyHistory(), row => row.key) : historical as FreshnessDetailReference;
    const orderRef = header!.order_type === "array" ? writeArmingDetails(held, a.readAt, "place-order", legacyOrder()) : order as FreshnessDetailReference;
    held.exec("COMMIT");
    const sendSpecs = readArmingDetails<AssignmentBudgetSpec>(held, specRef);
    let references = 1, retired = false, closed = false;
    const dispose = (): void => { if (closed) return; closed = true; openArmingSnapshots.delete(dispose); armingDatabases.delete(arming); try { held.close(); } finally { rmSync(temporaryPath(ownedDirectory), { recursive: true, force: true }); } };
    const release = (): void => { if (--references === 0) dispose(); };
    const arming: HunterLaneArmingSnapshot = { ...a as unknown as HunterLaneArming,
      sends: { specs: sendSpecs.rows, specFor: sendSpecs.read, historical: historyRef === null ? null : historicalSends(held, historyRef),
        knownKeys: diskStringSet(held, "SELECT value FROM known ORDER BY value", "SELECT 1 FROM known WHERE value=?"), reached: diskReached(held) },
      placeOrder: readArmingDetails<string>(held, orderRef).rows,
      areas: a.areas === null ? null : { ...a.areas!, scopes: a.areas!.scopes.map(scope => ({ ...scope,
        members: diskStringSet(held, "SELECT subject AS value FROM members WHERE scope=? ORDER BY subject", "SELECT 1 FROM members WHERE scope=? AND subject=?", [scope.key]) })) },
      lifetimeHuntSubjects: diskStringSet(held, "SELECT value FROM lifetime ORDER BY value", "SELECT 1 FROM lifetime WHERE value=?"),
      retain: () => { if (closed) throw new Error("HUNTER_ARMING_READING_CLOSED"); references++; let released = false; return () => { if (!released) { released = true; release(); } }; },
      close: () => { if (!retired) { retired = true; release(); } } };
    openArmingSnapshots.add(dispose);
    armingDatabases.set(arming, held);
    return { arming };
  } catch (error) {
    failed();
    return { held: (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "no research round has written its budget reading yet" : "the round's budget reading is not in the expected form" };
  }
}


interface OwnRequest { readonly taskId: string; readonly at: string; usd: number; pending: boolean }

/**
 * The lane's own model requests, which every Fleet controller it builds
 * counts in place of the ledger's rows for the same tasks. A request is
 * entered before it is sent (at its worst case) and settled at what it
 * measured; an unmeasured or failed send keeps its worst case. A request
 * refused before sending leaves the book. Entries older than the rolling day
 * leave it, and so do the ledger rows they stood for (the window ends).
 */
export class LaneOwnSpend {
  private readonly requests: OwnRequest[] = [];
  private readonly windowMs: number;
  constructor(windowMs = 24 * 3_600_000) { this.windowMs = windowMs; }

  begin(taskId: string, at: string, worstCaseUsd: number): OwnRequest {
    const entry: OwnRequest = { taskId, at, usd: worstCaseUsd, pending: true };
    this.requests.push(entry);
    return entry;
  }
  settle(entry: OwnRequest, measuredUsd: number | null): void {
    entry.pending = false;
    if (measuredUsd !== null) entry.usd = measuredUsd;
  }
  unsent(entry: OwnRequest): void {
    const at = this.requests.indexOf(entry);
    if (at >= 0) this.requests.splice(at, 1);
  }
  /**
   * Drops what has left the window, and returns each task the book stands
   * for with when this lane first sent for it. Only ledger rows from then on
   * are this lane's: a row recorded earlier is an earlier lane's or round's
   * work on the same task, and keeps counting.
   */
  tasks(now: string): ReadonlyMap<string, number> {
    const since = Date.parse(now) - this.windowMs;
    for (let i = this.requests.length - 1; i >= 0; i -= 1) if (Date.parse(this.requests[i].at) < since && !this.requests[i].pending) this.requests.splice(i, 1);
    const first = new Map<string, number>();
    for (const r of this.requests) first.set(r.taskId, Math.min(first.get(r.taskId) ?? Infinity, Date.parse(r.at)));
    return first;
  }
  /** The book as spend-window charges, so a new controller counts them the way it counts the ledger. */
  *asCharges(): IterableIterator<PricedCharge> {
    for (let i = 0; i < this.requests.length; i++) {
      const r = this.requests[i];
      yield { id: `hunter-lane:${r.taskId}:${i}`, at: r.at, jobId: `hunter-lane:${r.taskId}:${i}`,
      routeTaskId: r.taskId, obligationId: null, jurisdiction: null, usd: r.usd, knownUsd: r.usd, measured: true, bounded: false,
      metered: { attemptId: `hunter-lane:${r.taskId}:${i}`, role: "SCOUT", routeId: null, recordedAt: r.at, cost: { ...ZERO_COST, usd: r.usd, requestCount: 1 } } };
    }
  }
  /** Every request the book still counts, in dollars. */
  usd(): number { return this.requests.reduce((n, r) => n + r.usd, 0); }
}


export interface HunterLaneDeps {
  readonly repos: ControlPlaneRepositories;
  readonly now: () => string;
  readonly armingPath: string;
  readonly messages: ModelTransport;
  readonly batch: ReturnType<typeof backgroundBatchTransport>;
  readonly credentialConfigured: boolean;
  readonly credentialVar: string;
  readonly providerQueue: ModelProviderQueue;
  readonly ownSpend: LaneOwnSpend;
  /** The circuits the previous controller ended with; the lane's own latches outlive a refresh. */
  readonly circuits: readonly ProviderCircuit[] | null;
  readonly requestsPerMinute?: number;
  readonly onCondition: (sentence: string) => void;
}

export interface ArmedHunterLane {
  /** Null while paid work may run; otherwise the sentence that holds it. Free work is never this lane's. */
  readonly closed: { readonly code: string; readonly reason: string } | null;
  readonly armedAt: string;
  readonly fleetSafety: FleetSafetyController | null;
  readonly guards: ReturnType<typeof paidWorkGuards> | null;
  readonly arming: HunterLaneArmingSnapshot | null;
  readonly spendHolds: DurableSpendHolds;
  readonly ceilingUsd: number;
  /** The owner's paid-search switch, read from the same row (off when the row cannot be trusted). */
  readonly discoverySearchOn: boolean;
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Only the two current pause controls stay in RAM. Send budgets are indexed in this refresh's private snapshot. */
async function laneIntentReading(repos: ControlPlaneRepositories, arming: HunterLaneArmingSnapshot | null) {
  const db = arming === null ? undefined : armingDatabases.get(arming);
  const put = db?.prepare("INSERT OR REPLACE INTO metadata(key,body) VALUES (?,?)");
  let pause: Extract<ResearchIntent, { kind: "INTENT" }> | null = null;
  let runner: Extract<ResearchIntent, { kind: "INTENT" }> | null = null;
  db?.exec("BEGIN");
  try { await repos.researchIntents.readChangedSince(null, undefined, { keys: [RESEARCH_INTENT_LOG_KEY],
    projection: { kind: true, action: true, intentId: true, requestedAt: true, note: true, budgetUsd: true },
    page: rows => {
      for (const { record } of rows) {
        if (record.kind === "INTENT") {
          if ((record.action === "PAUSE" || record.action === "RESUME") && (!pause || record.requestedAt >= pause.requestedAt)) pause = record;
          if ((record.action === "PAUSE_RUNNER" || record.action === "RESUME_RUNNER") && (!runner || record.requestedAt >= runner.requestedAt)) runner = record;
        }
        if (!put) continue;
        for (const spec of assignmentBudgetsOf({ scopes: [], intents: [record] })) put.run(`live-budget:${spec.key}`, JSON.stringify(spec));
        for (const spec of malformedAssignmentBudgetsOf([record])) put.run(`live-malformed:${spec.key}`, JSON.stringify(spec));
      }
    } }); db?.exec("COMMIT"); }
  catch (error) { db?.exec("ROLLBACK"); throw error; }
  const controls: ResearchIntent[] = [];
  if (pause) controls.push(pause);
  if (runner) controls.push(runner);
  const one = db?.prepare("SELECT body FROM metadata WHERE key=?");
  const read = <T>(key: string): T | undefined => { const row = one?.get(key); return row ? JSON.parse(String(row.body)) as T : undefined; };
  return { intents: readIntents(controls), specFor: (key: string) => read<AssignmentBudgetSpec>(`live-budget:${key}`),
    malformedFor: (key: string) => read<MalformedAssignmentBudget>(`live-malformed:${key}`) };
}

/**
 * One refresh: read the owner's controls and the round's reading, and build
 * the guards every paid request of the next refresh period passes. Never
 * throws: an unreadable input closes paid work and says which.
 */
export async function armHunterLane(deps: HunterLaneDeps): Promise<ArmedHunterLane> {
  const now = deps.now();
  const spendHolds = new DurableSpendHolds({ budget: deps.repos.budget, now: deps.now });
  const unreadable: string[] = [];
  const read = readLaneArming(deps.armingPath, now);
  const arming = "arming" in read ? read.arming : null;
  let intentReading: Awaited<ReturnType<typeof laneIntentReading>> | null = null;
  let intentsReadable = true;
  try { intentReading = await laneIntentReading(deps.repos, arming); }
  catch (error) { intentsReadable = false; unreadable.push(`the owner's research intents could not be read (${message(error)})`); }
  const intents = intentReading?.intents ?? readIntents([]);
  let configRead: AdminConfigRead;
  try { configRead = { row: await readRuntimeAdminConfig(deps.repos, ["fleetSpendCeiling", "discoverySearch"]) }; }
  catch (error) { configRead = { unreadable: message(error) }; }
  const { config, holdPaidWork: configHold } = adminConfigForPaidWork(configRead);
  if (configHold !== null) unreadable.push(configHold);
  const ceilingOverride = fleetSpendCeilingOverrideUsd(config);
  const ceilingUsd = resolveRollingCeiling(ceilingOverride).rollingCeilingUsd;
  const discoverySearchOn = configHold === null && discoverySearchEnabled(config);

  /* As the round does: the spend window the ledger's writes keep. */
  const ownTasks = deps.ownSpend.tasks(now);
  let spendSnapshot: Awaited<ReturnType<typeof readSpendWindow>> | null = null;
  let counted: Iterable<PricedCharge> | null = null;
  let windowUsd: number | null = null;
  let ledgerUnreadable: string | null = null;
  try {
    const charges = spendSnapshot = await readSpendWindow(deps.repos, now);
    /* The lane's own requests count from its book, never twice. */
    counted = { *[Symbol.iterator]() {
      for (const row of charges) if (row.routeTaskId === null || !(Date.parse(row.at) >= (ownTasks.get(row.routeTaskId) ?? Infinity))) yield row;
      yield* deps.ownSpend.asCharges();
    } };
    windowUsd = researchSpendInWindow(counted, now, RESEARCH_BOUNDS.windowHours).windowUsd;
  } catch (error) {
    spendSnapshot?.close(); spendSnapshot = null;
    counted = null;
    ledgerUnreadable = message(error);
    deps.onCondition(`the cost ledger could not be read (${ledgerUnreadable}); paid model work waits`);
  }
  const spendHold = counted === null ? `the cost ledger could not be read (${ledgerUnreadable})`
    : !ceilingPermits(windowUsd, ceilingUsd).permits
      ? `the owner's $${ceilingUsd.toFixed(2)} model ceiling is reached` : null;

  const armingHold = "held" in read ? read.held : null;
  const closure = modelLaneClosure({
    dry: false, noModel: false, credentialConfigured: deps.credentialConfigured, credentialVar: deps.credentialVar,
    paused: intents.paused, pauseIntentId: intents.pauseIntentId ?? null,
    runnerPaused: intents.runnerPause.paused, runnerPauseIntentId: intents.runnerPause.intent?.intentId ?? null,
    spendHold: spendHold ?? armingHold, unreadableControls: unreadable,
  });

  let fleetSafety: FleetSafetyController | null;
  try {
    fleetSafety = counted === null ? null : new FleetSafetyController({
      now, charges: counted,
      costLedgerReadable: true, paused: intents.runnerPause.paused, modelHold: closure?.reason ?? null,
      circuits: deps.circuits ?? arming?.circuits ?? [], rollingCeilingUsd: ceilingOverride,
      lifetimeHuntWork: work => arming?.lifetimeHuntSubjects.has(work) ?? false,
    });
  } finally { spendSnapshot?.close(); }
  if (closure !== null || fleetSafety === null || arming === null) {
    return { closed: closure ?? { code: "LANE_DISABLED", reason: armingHold ?? `the cost ledger could not be read (${ledgerUnreadable})` },
      armedAt: now, fleetSafety, guards: null, arming, spendHolds, ceilingUsd, discoverySearchOn };
  }

  /* Every request selects its own Send lines from the round's local disk snapshot. */
  type PreparedGate = AssignmentBudgetGate | { refusal: AssignmentRefusal };
  const gates = new Map<string, PreparedGate[]>();
  const prepared = (id: string, gate: PreparedGate): void => { const waiting = gates.get(id) ?? []; waiting.push(gate); gates.set(id, waiting); };
  const held = (why: string): { refusal: AssignmentRefusal } => ({ refusal: { admit: false, code: ASSIGNMENT_BUDGET_CODE, why } });
  const prepareObligation = async (obligationId: string): Promise<void> => {
    let row;
    try { row = await deps.repos.obligations.readNarrowed(obligationId, { subjectId: true, assignments: true }) as { readonly value: { readonly subjectId: string; readonly assignments?: import("../scheduler/obligation.ts").ObligationAssignment[] } } | null; }
    catch (error) { prepared(obligationId, held(`the obligation's Send record could not be read (${message(error)}); paid work waits`)); return; }
    const marks = row?.value.assignments ?? [];
    const reached = arming.sends.reached.get(obligationId) ?? [];
    const needed = new Set([...marks.map(mark => mark.assignmentKey), ...reached]);
    const malformed: MalformedAssignmentBudget[] = [];
    for (const key of needed) { const spec = intentReading?.malformedFor(key); if (spec) malformed.push(spec); }
    const unknown = marks.map(mark => mark.assignmentKey).find(key => !arming.sends.knownKeys.has(key) && arming.sends.specFor(key) === undefined);
    const newerMark = marks.find(mark => intentReading?.specFor(mark.assignmentKey) !== undefined && arming.sends.specFor(mark.assignmentKey) === undefined);
    if (unknown !== undefined || newerMark) {
      prepared(obligationId, held(`this work belongs to Send ${unknown ?? newerMark!.assignmentKey}, which is newer than the round's budget reading; paid work waits for the next round to read its budget`));
      return;
    }
    const membership = assignmentMembership(row === null ? [] : [{ id: obligationId, subjectId: row.value.subjectId, assignments: marks }]);
    const specs: AssignmentBudgetSpec[] = [];
    for (const key of needed) { const spec = arming.sends.specFor(key); if (spec) specs.push(spec); }
    prepared(obligationId, new AssignmentBudgetGate({ specs, membership, historical: arming.sends.historical ?? new Map(),
      worstCaseUsd: arming.worstCaseUsd, costsReadable: arming.sends.historical !== null, intentsReadable,
      malformed, reachedThisCycle: new Map([[obligationId, reached]]), historyReadAt: arming.readAt }));
  };
  const assignmentBudget = {
    linesFor(obligationId: string): { readonly lines: readonly BudgetLine[] } | { readonly refusal: AssignmentRefusal } {
      const waiting = gates.get(obligationId);
      const gate = waiting?.shift();
      if (!waiting?.length) gates.delete(obligationId);
      if (gate === undefined) return held("the obligation's Send record was not read before its request; paid work waits");
      return "refusal" in gate ? { refusal: gate.refusal } : gate.linesFor(obligationId);
    },
  };
  const expansionBudget = arming.areas === null ? null : { gate: new ScopeBudgetGate({
    scopes: arming.areas.scopes,
    worstCaseUsd: arming.worstCaseUsd, malformedScopes: arming.areas.malformedScopes, historyReadAt: arming.readAt }) };
  const guards = paidWorkGuards({ repos: deps.repos, now: deps.now, armedAt: now, fleetSafety, providerQueue: deps.providerQueue,
    spendHolds, assignmentBudget, expansionBudget, beforeObligation: prepareObligation,
    messages: deps.messages, batch: deps.batch, modelLaneEnabled: true, ceilingUsd: () => ceilingUsd,
    ...(deps.requestsPerMinute === undefined ? {} : { requestsPerMinute: deps.requestsPerMinute }),
    onCondition: deps.onCondition });
  return { closed: null, armedAt: now, fleetSafety, guards, arming, spendHolds, ceilingUsd, discoverySearchOn };
}

/**
 * A worker's paid request through the lane: entered in the lane's own book
 * before it is sent, then passed to the guards armed for this refresh. A
 * refusal before sending leaves the book; a sent request keeps its worst case
 * until it measures.
 */
export function laneWorkerTransport(lane: () => ArmedHunterLane, ownSpend: LaneOwnSpend, now: () => string) {
  return (jurisdiction: Parameters<ReturnType<typeof paidWorkGuards>["workerTransportFor"]>[0], taskId: string): ModelTransport => async request => {
    const armed = lane();
    if (armed.guards === null) throw new SendBudgetRefusal(armed.closed?.code ?? "LANE_DISABLED", armed.closed?.reason ?? "the hunter lane is not armed");
    const releaseReading = armed.arming?.retain();
    const worst = modelRequestWorstCaseUsd(request);
    const entry = ownSpend.begin(taskId, now(), worst ?? 0);
    try {
      const response = await armed.guards.workerTransportFor(jurisdiction, taskId)(request);
      ownSpend.settle(entry, modelResponseUsd(response));
      return response;
    } catch (error) {
      if (error instanceof FleetPreSendRefusal || error instanceof SendBudgetRefusal) ownSpend.unsent(entry);
      else ownSpend.settle(entry, null);
      throw error;
    } finally { releaseReading?.(); }
  };
}
