import { clauseObligation, readAssignmentSubset, type AssignmentSubsetBase } from "./assignment-read.ts";
import {
  assembleAssignmentView,
  assignmentCostSummaryOf,
  assignmentCostTotals,
  assignmentPartOf,
  assignmentStateRowsOf,
  deriveAssignmentEntries,
  mergeAssignmentParts,
  pipelineLinked,
  type AssignmentClock,
  type AssignmentCostTotals,
  type AssignmentEntry,
  type AssignmentListRow,
  type AssignmentPart,
  type AssignmentView,
  type BodyPublicationAttempt,
  type IndexSegment,
  foldAssignmentCost,
} from "./assignment-view.ts";
import { addMeasured, measuredSum, subtractMeasured, utcMonthWindow, type CostEntry, type MeasuredSum } from "./cost.ts";
import {
  SPEND_BY_DAY_MS,
  costLedgerTotals,
  foldCostLedger,
  foldCostMonth,
  foldPlace,
  foldSpendDay,
  mergePlaceTotals,
  placeRowsOf,
  placeSumOf,
  placeTotals,
  spendByPlaceOf,
  utcMonthOf,
  type CostLedgerTotals,
  type DayTotals,
  type PlaceLedger,
  type PlaceTotals,
  type SpendByPlaceView,
} from "./cost-panel.ts";
import type { ExactSum } from "./exact-sum.ts";
import type { ExpansionScopeDecision } from "./expansion/scopes.ts";
import type { AskGapCode } from "../ask/gap-codes.ts";
import { askGapObligationId } from "./ask-gap-id.ts";
import { assertAggregateOnly, ownerSnapshotStateId, type OwnerSnapshotState } from "./owner-surface.ts";
import { deriveItemState, isPipelineRecord } from "./promotion/pipeline.ts";
import type { PromotionPipelineRecord } from "./promotion/types.ts";
import type { ProviderReading } from "./provider-billing.ts";
import {
  BILLING_PROVIDERS,
  billingProviderOf,
  foldHunts,
  foldWindow,
  inReadingPeriod,
  windowTotals,
  type BillingContext,
  type HuntTotals,
  type WindowTotals,
} from "./provider-billing-attribution.ts";
import { foldSearch, type SearchLedger } from "./provider-billing-collector.ts";
import { US_STATES } from "./readiness/catalog.ts";
import { countsAsScoutAttempt } from "./research-metrics.ts";
import { INCREMENTAL_READS_SLACK_MS } from "./repository/incremental-reads.ts";
import { jsonTextAtPath, readByKeys, type AggregateRepository, type AppendOnlyRepository, type ChangedRecord, type ControlPlaneRepositories, type Persisted, type RecordProjection } from "./repository/types.ts";
import type { SnapshotStampedRead } from "./repository/pg-store.ts";
import { unitCarriesState } from "./scheduler/dispatch-target.ts";
import { isFundedHunt } from "./scheduler/hunt-continuation.ts";
import { servedWitness, type ServedReaderReadback } from "./served-reader.ts";
import { stateCodeOf } from "./unit-state.ts";
import type { WorkItem } from "./work-item.ts";

/** The national totals row beside the published snapshot in `cp_owner_snapshots`; each state's rows sit beside it. */
export const OWNER_SNAPSHOT_TOTALS_ID = "totals";
const OWNER_SNAPSHOT_TOTALS_FORMAT = 3;
const OTHER_STATE = "other";
const stateTotalsId = (state: string): string => `totals:${state}`;
const stateInboxId = (state: string): string => `inbox:${state}`;

/** A charge whose stamp and whose row's `recorded_at` differ by more than this is carried by itself for the windows. */
const STAMP_MARGIN_MS = 10 * 60_000;
/** Longer than any whole read of a log takes. */
const WHOLE_READ_MS = 3_600_000;
/** Assignments read and derived together; their records are all a batch holds. */
const ASSIGNMENT_BATCH = 250;
/** Routed rows held for states not folded yet before they are written to those states' inboxes. */
const INBOX_HELD = 200_000;
const DAY_MS = 86_400_000;

export interface OwnerSnapshotTotals {
  readonly formatVersion: number;
  readonly costs: CostTotals | null;
  readonly assignments: AssignmentTotals | null;
}

/** A log slot already folded, with the database clock it was appended at. */
type Slot = readonly [key: string, position: number, changedAt: string];

/** Where a log fold's next read starts (`through` less the slack) and the slots that read leaves out. */
interface LogCursor {
  readonly through: string;
  readonly held: readonly Slot[];
}

type WorkerRef = { readonly version: string; readonly provider: string };

/** The hunts and their saved member subjects a charge's attribution was folded against. */
interface BillingFrame {
  readonly scopes: readonly Pick<ExpansionScopeDecision, "key" | "receiptId" | "budgetStartedAt" | "budgetUsd">[];
  readonly members: Readonly<Record<string, readonly string[]>>;
}

interface CarriedCharge {
  readonly key: string;
  readonly position: number;
  readonly at: number;
  /** As stamped; a non-finite figure is kept as its name. */
  readonly usd: number | string | null;
  readonly scout: boolean;
}

export interface CostTotals {
  cursor: LogCursor;
  /** The clock the windows were last moved to. */
  foldedAt: string;
  billing: BillingFrame;
  readonly ledger: CostLedgerTotals;
  /** Charges stamped at or after `foldedAt` less a fortnight, by Eastern day. */
  readonly days: Record<string, DayTotals>;
  /** SCOUT Attempts stamped at or after `foldedAt` less a day. */
  readonly scouts: MeasuredSum;
  readonly assignments: AssignmentCostTotals;
  readonly hunts: Record<string, HuntTotals>;
  /** By UTC month and billing provider: what a reading made now covers. */
  providerMonths: Record<string, Record<string, WindowTotals>>;
  /** The periods of the readings last published, which a later publish can carry forward. */
  windows: Record<string, WindowTotals>;
  searches: Record<string, Record<string, SearchLedger>>;
  /** Charges stamped after the clock they were read at, held back from every window that ends at a clock. */
  ahead: { readonly entry: CostEntry; readonly worker: WorkerRef | null }[];
  /** Charges whose `recorded_at` is too far from their stamp to be found by it when they leave a window. */
  skewed: CarriedCharge[];
  /** Attempts not on record when their charges were folded, and work items no assignment held. */
  orphans: string[];
  unassigned: string[];
}

/** One assignment's carried figures beside its published rows. */
export interface GroupTotals {
  readonly members: readonly string[];
  readonly usd: ExactSum | null;
  readonly items: readonly string[];
  /** The Scout-result log keys its work items and attempts are recorded under. */
  readonly scoutKeys: readonly string[];
  readonly obligation: AssignmentClock | null;
  /** Its work items with a publication outcome, narrowed to what the public readbacks read. */
  readonly publications: readonly WorkItem[];
  /** For a created work item, the obligation its clause names, so the row joins that clock when it appears. */
  readonly clause: string | null;
}

/** One state's assignments and spend by jurisdiction between publishes, in `totals:<state>`. */
export interface StateTotals {
  readonly builtAt: string;
  readonly groups: Readonly<Record<string, GroupTotals>>;
  readonly places: Readonly<Record<string, PlaceTotals>>;
  /** The list rows of the state's ranked assignments, each until the instant it could next change on the clock alone. */
  readonly lists: Readonly<Record<string, TimedList>>;
}

interface TimedList {
  readonly row: AssignmentListRow;
  readonly until: string | null;
}

/** What a state adds to the national figures, kept so a publish that leaves the state alone need not read it. */
/** Its figures are as of `builtAt`, the last publish whose changed rows reached the state; its rows carry their own instants. */
export interface StatePart {
  readonly builtAt: string;
  readonly assignments: AssignmentPart;
  readonly publications: readonly WorkItem[];
  /** The subjects of the standing obligations each instruction marks, by `<assignment key>\n<receipt>`: the hunts' members. */
  readonly marks: Readonly<Record<string, readonly string[]>>;
  /** Standing obligations by the state name their id and subject carry, "other" for none. */
  readonly obligations: Readonly<Record<string, number>>;
  readonly spend: PlaceTotals;
}

interface PipelineTotals {
  cursor: LogCursor;
  items: number;
  verified: number;
  /** Items whose source names no attempt or work item an assignment holds, by what it does name. */
  readonly unlinked: Record<string, { readonly attempt?: string; readonly workItem?: string }>;
}

export interface AssignmentTotals {
  /** Where the next changed-row reads start, less the slack. */
  readonly through: string;
  /** Versions already folded inside each table's overlapping read window. */
  readonly cursors?: Readonly<Record<string, LogCursor>>;
  readonly states: Readonly<Record<string, StatePart>>;
  /** A work item held by an assignment in another state than its own clause or id names. */
  readonly crossings: Readonly<Record<string, string>>;
  /** A work item joined through a parent (directory or repair), by the parent it names. */
  readonly links: Readonly<Record<string, string>>;
  /** A work item's upstream work items, for each one that waits on others. */
  readonly dependencies: Readonly<Record<string, readonly string[]>>;
  /** The list rows of the assignments the selection rule ranks first. */
  readonly lists: Readonly<Record<string, AssignmentListRow>>;
  readonly pipeline: PipelineTotals;
}

/** Rows routed to a state before it is folded. */
export interface StateInbox {
  readonly groups: string[];
  readonly items: string[];
  /** Scout-result log keys and pipeline items by the work item or attempt they name. */
  readonly scouts: Record<string, string[]>;
  readonly pipeline: Record<string, string[]>;
  readonly places: Record<string, PlaceTotals>;
}

/** A state's inbox written out by one publish; another publish's is ignored. */
export interface SpilledInbox extends StateInbox {
  readonly run: string;
}

const unique = (ids: Iterable<string | null | undefined>): string[] => [...new Set([...ids].filter((id): id is string => typeof id === "string" && id !== ""))];
const slotKey = (key: string, position: number): string => `${key}\n${position}`;
const iso = (ms: number): string => new Date(ms).toISOString();

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

function needs<T>(method: T | undefined, what: string): T {
  if (method === undefined) throw new Error(`the control-plane store has no ${what}, so the owner snapshot cannot read only what changed`);
  return method;
}

/** One log's changes since `cursor`, each page handed to `page`; `folded` says whether a record was folded by this or an earlier read. */
async function readLogChanges<T>(log: AppendOnlyRepository<T>, cursor: LogCursor | null, slackMs: number,
  page: (records: readonly ChangedRecord<T>[]) => Promise<void>): Promise<{ readonly next: LogCursor; readonly folded: (r: ChangedRecord<T>) => boolean }> {
  const since = cursor === null ? null : iso(Date.parse(cursor.through) - slackMs);
  const held = cursor === null ? [] : cursor.held.filter(([, , at]) => Date.parse(at) >= Date.parse(since!));
  let taken: Slot[] = [];
  let newest = Number.NEGATIVE_INFINITY;
  const read = await log.readChangedSince(since, held.map(([key, position]) => [key, position] as const), { page: async (records) => {
    for (const r of records) {
      const changed = Date.parse(r.changedAt!);
      newest = Math.max(newest, changed);
      if (since === null ? changed >= newest - slackMs - WHOLE_READ_MS : changed >= Date.parse(since)) taken.push([r.key, r.position, r.changedAt!]);
    }
    /* A whole read keeps only the slots near its newest row: the read's clock, known at its end, is no earlier than that less the read's length. */
    if (since === null && taken.length > 10_000) taken = taken.filter(([, , changed]) => Date.parse(changed) >= newest - slackMs - WHOLE_READ_MS);
    await page(records);
  } });
  const through = read.through!;
  const all = [...held, ...taken];
  const slots = new Set(all.map(([key, position]) => slotKey(key, position)));
  return {
    next: { through, held: all.filter(([, , changed]) => Date.parse(changed) >= Date.parse(through) - slackMs) },
    folded: (r) => (since !== null && Date.parse(r.changedAt!) < Date.parse(since)) || slots.has(slotKey(r.key, r.position)),
  };
}

/** Whether an earlier read from `cursor` folded a record. */
function foldedBefore(cursor: LogCursor | null, slackMs: number): (r: ChangedRecord<unknown>) => boolean {
  if (cursor === null) return () => false;
  const since = Date.parse(cursor.through) - slackMs;
  const held = new Set(cursor.held.filter(([, , at]) => Date.parse(at) >= since).map(([key, position]) => slotKey(key, position)));
  return (r) => Date.parse(r.changedAt!) < since || held.has(slotKey(r.key, r.position));
}

/** An aggregate's rows changed since `since`, narrowed, page by page; answers the clock the read began at. */
async function eachChanged<R>(repo: AggregateRepository<unknown>, since: string | null, projection: RecordProjection, page: (rows: readonly R[]) => void | Promise<void>,
  remember: { readonly cursors: Record<string, LogCursor>; readonly name: string; readonly slackMs: number }): Promise<string> {
  const prior = remember.cursors[remember.name];
  if (since !== null && prior) since = iso(Date.parse(prior.through) - remember.slackMs);
  const held = (prior?.held ?? []).filter(([, , at]) => since === null || at >= since);
  const taken: Slot[] = [];
  const read = await needs(repo.listChangedSince, "changed-since read")(since, held.map(([id, revision]) => [id, revision]), { projection, page: (rows) => {
    for (const row of rows) taken.push([row.id, row.revision, "changedAt" in row && typeof row.changedAt === "string" ? row.changedAt : ""]);
    return page(rows.map((row) => row.value as R));
  } });
  const through = read.through ?? iso(Date.now());
  remember.cursors[remember.name] = { through, held: [...held, ...taken.map(([id, revision, at]) => [id, revision, at || through] as const)]
    .filter(([, , at]) => Date.parse(at) >= Date.parse(through) - remember.slackMs) };
  return through;
}

async function eachLogChanged<R>(log: AppendOnlyRepository<unknown>, since: string | null, projection: RecordProjection, page: (records: readonly ChangedRecord<R>[]) => void | Promise<void>,
  remember: { readonly cursors: Record<string, LogCursor>; readonly name: string; readonly slackMs: number }): Promise<string> {
  const prior = remember.cursors[remember.name];
  if (since !== null && prior) since = iso(Date.parse(prior.through) - remember.slackMs);
  const held = (prior?.held ?? []).filter(([, , at]) => since === null || at >= since);
  const taken: Slot[] = [];
  const read = await log.readChangedSince(since, held.map(([key, position]) => [key, position]), { projection, page: (records) => {
    for (const row of records) taken.push([row.key, row.position, row.changedAt ?? ""]);
    return page(records as readonly ChangedRecord<R>[]);
  } });
  const through = read.through ?? iso(Date.now());
  remember.cursors[remember.name] = { through, held: [...held, ...taken.map(([key, position, at]) => [key, position, at || through] as const)]
    .filter(([, , at]) => Date.parse(at) >= Date.parse(through) - remember.slackMs) };
  return through;
}

/** The work items an assignment holds: those on record, and those a round, task, attempt or worker result names. */
async function heldWorkItems(repos: ControlPlaneRepositories, ids: Iterable<string>): Promise<Set<string>> {
  const out = new Set<string>();
  for (const chunk of chunks(unique(ids), ASSIGNMENT_BATCH)) {
    for (const row of await needs(repos.workItems.readManyNarrowed, "work-item read by id")(chunk, { id: true })) out.add(row.id);
    for (const repo of [repos.occurrences, repos.routeTasks, repos.attempts] as AggregateRepository<unknown>[]) {
      const rest = chunk.filter((id) => !out.has(id));
      if (rest.length === 0) break;
      for (const row of await needs(repo.listWhereIn, "read by work item")(["workItemId"], rest, { workItemId: true })) out.add((row.value as { workItemId: string }).workItemId);
    }
    const rest = chunk.filter((id) => !out.has(id));
    if (rest.length > 0) for (const [key, records] of await readByKeys(repos.workerResults, rest)) if (records.length > 0) out.add(key);
  }
  return out;
}

type Refs = Map<string, Set<string>>;
const addRef = (refs: Refs, ref: string | null | undefined, key: string) => { if (ref) refs.set(ref, (refs.get(ref) ?? new Set()).add(key)); };
type PipelineSource = { readonly source?: { readonly kind?: string; readonly attemptId?: string; readonly workItemId?: string } };

/* ------------------------------------------------------------------ costs */

function billingFrame(scopes: readonly ExpansionScopeDecision[], members: ReadonlyMap<string, ReadonlySet<string>>): BillingFrame {
  const held = scopes.filter((s) => s.budgetStartedAt).map(({ key, receiptId, budgetStartedAt, budgetUsd }) => ({ key, receiptId, budgetStartedAt, budgetUsd }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.receiptId.localeCompare(b.receiptId));
  const funded = new Set(held.filter(isFundedHunt).map((s) => s.key));
  return { scopes: held, members: Object.fromEntries([...funded].sort().map((key) => [key, [...(members.get(key) ?? [])].sort()])) };
}

const contextOf = (frame: BillingFrame): BillingContext => ({ scopes: frame.scopes as readonly ExpansionScopeDecision[],
  scopeMembers: new Map(Object.entries(frame.members).map(([key, subjects]) => [key, new Set(subjects)])) });

type ReadingPeriod = Pick<ProviderReading, "provider" | "periodStart" | "periodEnd">;
const periodKey = (r: ReadingPeriod): string => `${r.provider}\n${r.periodStart}\n${r.periodEnd}`;
const billed = (r: ReadingPeriod): boolean => (BILLING_PROVIDERS as readonly string[]).includes(r.provider);

function emptyCosts(billing: BillingFrame, carried: readonly ReadingPeriod[]): CostTotals {
  return { cursor: { through: iso(0), held: [] }, foldedAt: iso(0), billing, ledger: costLedgerTotals(), days: {}, scouts: measuredSum(),
    assignments: assignmentCostTotals(), hunts: {}, providerMonths: {}, windows: Object.fromEntries(carried.map((r) => [periodKey(r), windowTotals()])),
    searches: {}, ahead: [], skewed: [], orphans: [], unassigned: [] };
}

/** Every figure that ends at a clock: the month, the readings made in it, and the month's search requests. */
function foldUpToClock(t: CostTotals, e: CostEntry, worker: WorkerRef | null, ctx: BillingContext): void {
  const at = Date.parse(e.recordedAt);
  if (!Number.isFinite(at)) return;
  foldCostMonth(t.ledger, e, worker);
  const month = utcMonthOf(at);
  const provider = billingProviderOf(e, worker);
  if (provider !== null) foldWindow(((t.providerMonths[month] ??= {})[provider] ??= windowTotals()), e, ctx);
  foldSearch((t.searches[month] ??= {}), e);
  for (const [key, window] of Object.entries(t.windows)) {
    const [p, periodStart, periodEnd] = key.split("\n");
    if (p === provider && inReadingPeriod(e, { periodStart: periodStart!, periodEnd: periodEnd! })) foldWindow(window, e, ctx);
  }
}

const usdOf = (value: unknown): number | string | null => typeof value === "number" ? (Number.isFinite(value) ? value : String(value)) : null;
const usdIn = (value: number | string | null): number | null => typeof value === "string" ? Number(value) : value;

interface CostFoldInput {
  readonly nowIso: string;
  readonly slackMs?: number;
  /** The current hunts, or null when they could not be read: the last frame then stands. */
  readonly scopes: readonly ExpansionScopeDecision[] | null;
  readonly scopeMembers: ReadonlyMap<string, ReadonlySet<string>>;
  /** The periods of the readings the last snapshot published, which this publish may carry forward. */
  readonly carried: readonly ReadingPeriod[];
  /** Attempts and work items with a row changed since the last publish: the ones a folded charge's context can have gained. */
  readonly changed: { readonly attempts: ReadonlySet<string>; readonly workItems: ReadonlySet<string> };
  /** Each page's charges that no earlier publish folded, for the places kept by state. */
  readonly places?: (charges: readonly CostEntry[]) => Promise<void>;
}

/** The ledger's totals with every charge appended since `prior` folded in; when a folded charge's context has changed (its Attempt
 * or work item appearing, the hunts or their members changing) the whole ledger is refolded page by page, as on a first publish. */
async function foldCosts(repos: ControlPlaneRepositories, prior: CostTotals | null, input: CostFoldInput): Promise<CostTotals> {
  const slackMs = input.slackMs ?? INCREMENTAL_READS_SLACK_MS;
  const now = Date.parse(input.nowIso);
  const frame = input.scopes === null && prior !== null ? prior.billing : billingFrame(input.scopes ?? [], input.scopeMembers);
  const carried = input.carried.filter(billed);
  const readWorkers = needs(repos.attempts.readManyNarrowed, "attempt read by id");
  const rebuild = prior === null || JSON.stringify(prior.billing) !== JSON.stringify(frame) || now < Date.parse(prior.foldedAt) ||
    carried.some((r) => !(periodKey(r) in prior.windows)) || prior.orphans.some((id) => input.changed.attempts.has(id)) ||
    (await heldWorkItems(repos, prior.unassigned.filter((id) => input.changed.workItems.has(id)))).size > 0;
  const t = rebuild ? emptyCosts(frame, carried) : prior;
  t.windows = Object.fromEntries(carried.map((r) => [periodKey(r), t.windows[periodKey(r)]!]));
  const ctx = contextOf(frame);
  const from = rebuild ? now : Date.parse(t.foldedAt);
  const orphans = new Set(t.orphans);
  const unassigned = new Set(t.unassigned);
  const placed = rebuild ? foldedBefore(prior?.cursor ?? null, slackMs) : () => false;
  const ahead = t.ahead;
  t.ahead = [];
  for (const charge of ahead) {
    if (Date.parse(charge.entry.recordedAt) <= now) foldUpToClock(t, charge.entry, charge.worker, ctx);
    else t.ahead.push(charge);
  }
  const { next, folded } = await readLogChanges(repos.costs, rebuild ? null : t.cursor, slackMs, async (records) => {
    const workers = new Map((await readWorkers(unique(records.map((r) => r.record.attemptId)), { id: true, worker: ["version", "provider"] }))
      .map((row) => [row.id, (row.value as { worker: WorkerRef }).worker] as const));
    const held = await heldWorkItems(repos, records.map((r) => r.record.workItemId));
    for (const r of records) {
      const e = r.record;
      const worker = workers.get(e.attemptId) ?? null;
      if (worker === null) orphans.add(e.attemptId);
      const assigned = held.has(e.workItemId);
      if (!assigned) unassigned.add(e.workItemId);
      foldCostLedger(t.ledger, e, worker);
      foldAssignmentCost(t.assignments, e, worker ?? undefined, assigned);
      foldHunts(t.hunts, e, worker, ctx);
      const at = Date.parse(e.recordedAt);
      if (at > now) t.ahead.push({ entry: e, worker });
      else foldUpToClock(t, e, worker, ctx);
      if (at >= from - SPEND_BY_DAY_MS) foldSpendDay(t.days, e);
      if (countsAsScoutAttempt(e) && !(at < from - DAY_MS)) addMeasured(t.scouts, e.cost.usd);
      if (Number.isFinite(at) && Math.abs(Date.parse(r.stampedAt ?? e.recordedAt) - at) > STAMP_MARGIN_MS) {
        t.skewed.push({ key: r.key, position: r.position, at, usd: usdOf(e.cost.usd), scout: countsAsScoutAttempt(e) });
      }
    }
    await input.places?.(records.filter((r) => !placed(r)).map((r) => r.record));
  });
  if (now > from) {
    /* Charges leave the fortnight and the day as the clock moves; a charge folded this publish was folded against `from`. */
    const skewed = new Set(t.skewed.map((c) => slotKey(c.key, c.position)));
    const leave = async (lo: number, hi: number, out: (e: Pick<CostEntry, "recordedAt" | "cost" | "role" | "routeId">) => void) => {
      const readStamped: SnapshotStampedRead<CostEntry> = needs(repos.costs.readStampedBetween, "read by stamp");
      await readStamped(iso(lo - STAMP_MARGIN_MS), iso(hi + STAMP_MARGIN_MS), (records) => {
        for (const r of records) {
          const at = Date.parse(r.record.recordedAt);
          if (at >= lo && at < hi && folded(r) && !skewed.has(slotKey(r.key, r.position))) out(r.record);
        }
      }, { projection: { recordedAt: true, cost: ["usd"], role: true, routeId: true },
        timeRange: { path: ["recordedAt"], from: iso(lo), until: iso(hi) } });
    };
    await leave(from - SPEND_BY_DAY_MS, now - SPEND_BY_DAY_MS, (e) => foldSpendDay(t.days, e as CostEntry, -1));
    await leave(from - DAY_MS, now - DAY_MS, (e) => { if (countsAsScoutAttempt(e)) subtractMeasured(t.scouts, e.cost.usd); });
    for (const c of t.skewed) {
      const charge = { recordedAt: iso(c.at), cost: { usd: usdIn(c.usd) } } as CostEntry;
      if (c.at >= from - SPEND_BY_DAY_MS && c.at < now - SPEND_BY_DAY_MS) foldSpendDay(t.days, charge, -1);
      if (c.scout && c.at >= from - DAY_MS && c.at < now - DAY_MS) subtractMeasured(t.scouts, usdIn(c.usd));
    }
  }
  const keptMonths = utcMonthWindow(input.nowIso, 2).since.slice(0, 7);
  for (const month of Object.keys(t.ledger.months)) if (month < keptMonths) delete t.ledger.months[month];
  const month = utcMonthOf(now);
  t.providerMonths = { [month]: t.providerMonths[month] ?? {} };
  t.searches = { [month]: t.searches[month] ?? {} };
  t.skewed = t.skewed.filter((c) => c.at >= now - SPEND_BY_DAY_MS);
  t.cursor = next;
  t.foldedAt = input.nowIso;
  t.billing = frame;
  t.orphans = [...orphans].sort();
  t.unassigned = [...unassigned].sort();
  return t;
}

/** Each reading's charges: a reading carried forward keeps its period's totals; one made now covers the month so far. */
export function readingWindows(t: CostTotals, readings: readonly ProviderReading[], nowIso: string): (reading: ProviderReading) => WindowTotals {
  const month = utcMonthWindow(nowIso);
  const windows: Record<string, WindowTotals> = {};
  for (const r of readings.filter(billed)) {
    const key = periodKey(r);
    if (key in t.windows) windows[key] = t.windows[key]!;
    else if (r.periodStart === month.since && r.periodEnd === nowIso) windows[key] = structuredClone(t.providerMonths[utcMonthOf(Date.parse(nowIso))]?.[r.provider] ?? windowTotals());
    else throw new Error(`the ${r.provider} reading for ${r.periodStart} to ${r.periodEnd} was neither carried forward nor made now, so its ledger total was never kept`);
  }
  t.windows = windows;
  return (r) => windows[periodKey(r)] ?? windowTotals();
}

/* ----------------------------------------------------------------- states */

/** The state a standing obligation's id names, or for a work item of its own, the one its id and subject name. */
const stateOf = (id: string, subject = ""): string => stateCodeOf(id, subject) ?? OTHER_STATE;

/** The state whose rows hold a work item's assignment unless a crossing says otherwise: its clause's obligation's, else its own. */
function homeOf(id: string, w: Pick<WorkItem, "obligation" | "subject"> | undefined): string {
  const clause = w === undefined ? null : clauseObligation(w.obligation);
  return clause === null ? stateOf(id, w?.subject ?? "") : stateOf(clause);
}

const emptyInbox = (): StateInbox => ({ groups: [], items: [], scouts: {}, pipeline: {}, places: {} });

/** Routed rows held for the states not folded yet; past a bound, written to each state's inbox row. */
class Inboxes {
  readonly #held = new Map<string, StateInbox>();
  readonly #spilled = new Set<string>();
  #size = 0;
  readonly repos: ControlPlaneRepositories;
  readonly nowIso: string;
  /** Names this fold's inbox rows apart from any other publish's, or an earlier attempt of this one. */
  readonly run: string;
  readonly write: boolean;
  readonly bound: number;

  constructor(repos: ControlPlaneRepositories, nowIso: string, run: string, write: boolean, bound: number) {
    this.repos = repos;
    this.nowIso = nowIso;
    this.run = run;
    this.write = write;
    this.bound = bound;
  }

  states(): string[] {
    return unique([...this.#held.keys(), ...this.#spilled]).sort();
  }

  #of(state: string): StateInbox {
    let inbox = this.#held.get(state);
    if (inbox === undefined) this.#held.set(state, inbox = emptyInbox());
    this.#size += 1;
    return inbox;
  }

  /** Folds the state even with nothing routed to it, so it is emptied. */
  touch(state: string): void { this.#of(state); }
  group(state: string, id: string): void { this.#of(state).groups.push(id); }
  item(state: string, id: string): void { this.#of(state).items.push(id); }
  scout(state: string, ref: string | undefined, key: string): void { if (ref) (this.#of(state).scouts[ref] ??= []).push(key); }
  pipeline(state: string, ref: string | undefined, key: string): void { if (ref) (this.#of(state).pipeline[ref] ??= []).push(key); }
  place(state: string, place: string, totals: PlaceTotals): void { mergePlaceTotals(this.#of(state).places[place] ??= placeTotals(), totals); }

  async settle(): Promise<void> {
    if (!this.write || this.#size < this.bound) return;
    for (const [state, inbox] of this.#held) {
      const row = await this.repos.ownerSnapshotInboxes.read(stateInboxId(state));
      const merged = mergeInbox(row?.value.run === this.run ? row.value : emptyInbox(), inbox);
      const value: SpilledInbox = { run: this.run, ...merged };
      if (row === null) await this.repos.ownerSnapshotInboxes.put(stateInboxId(state), value, this.nowIso);
      else await this.repos.ownerSnapshotInboxes.compareAndSet(stateInboxId(state), row.revision, value, this.nowIso);
      this.#spilled.add(state);
    }
    this.#held.clear();
    this.#size = 0;
  }

  /** Everything routed to the state, held and written out; it is then gone from both. */
  async take(state: string): Promise<StateInbox> {
    let inbox = this.#held.get(state) ?? emptyInbox();
    this.#held.delete(state);
    if (this.#spilled.delete(state)) {
      const row = await this.repos.ownerSnapshotInboxes.read(stateInboxId(state));
      if (row?.value.run === this.run) inbox = mergeInbox(row.value, inbox);
      await this.repos.ownerSnapshotInboxes.compareAndSet(stateInboxId(state), row!.revision, { run: "", ...emptyInbox() }, this.nowIso);
    }
    return inbox;
  }
}

function mergeInbox(a: StateInbox, b: StateInbox): StateInbox {
  const refs = (x: Record<string, string[]>, y: Record<string, string[]>) => {
    const out: Record<string, string[]> = { ...x };
    for (const [ref, keys] of Object.entries(y)) out[ref] = unique([...(out[ref] ?? []), ...keys]);
    return out;
  };
  const places: Record<string, PlaceTotals> = structuredClone(a.places);
  for (const [place, totals] of Object.entries(b.places)) mergePlaceTotals(places[place] ??= placeTotals(), totals);
  return { groups: unique([...a.groups, ...b.groups]), items: unique([...a.items, ...b.items]), scouts: refs(a.scouts, b.scouts), pipeline: refs(a.pipeline, b.pipeline), places };
}

/** A state's rows were not written by the publish whose national totals name them, so every state is derived again. */
class StaleState extends Error {}

interface Loaded {
  readonly totals: Persisted<StateTotals> | null;
  readonly snapshot: Persisted<Pick<OwnerSnapshotState, "builtAt" | "allRowsIndex" | "bodyAttempts">> | null;
  readonly groups: Set<string>;
  readonly lists: Map<string, TimedList>;
  places: Record<string, PlaceTotals>;
}

type StateEntry = readonly [string, GroupTotals & Pick<AssignmentEntry, "index" | "bodyAttempts">];

/** The segment of an assignment's index row that holds at `at`. */
const segmentAt = (segments: readonly IndexSegment[], at: string): IndexSegment =>
  segments.find((s) => (s.from === null || s.from <= at) && (s.until === null || at < s.until)) ?? segments[segments.length - 1]!;
const listAt = (list: TimedList | undefined, at: string): AssignmentListRow | undefined => list !== undefined && (list.until === null || at < list.until) ? list.row : undefined;

const AGGREGATES = ["obligations", "debts", "occurrences", "workItems", "routeTasks", "attempts", "leases"] as const;
const LOGS = ["artifacts", "costs", "workerResults", "scoutResults", "promotionPipeline"] as const;

/** The rows one batch's read returned, answering the same reads again for any one of its assignments without the database. */
class Replay {
  readonly #rows = new Map<string, Map<string, Persisted<unknown>>>();
  readonly #records = new Map<string, Map<string, readonly unknown[]>>();
  readonly #paths = new Map<string, Map<string, Persisted<unknown>[]>>();
  readonly #reads = new Map<string, Promise<unknown>>();

  /** `repos`, keeping every row its subset reads return. */
  recording(repos: ControlPlaneRepositories): ControlPlaneRepositories {
    const keep = (name: string, rows: readonly Persisted<unknown>[]) => {
      const held = this.#rows.get(name) ?? new Map<string, Persisted<unknown>>();
      this.#rows.set(name, held);
      for (const row of rows) held.set(row.id, row);
    };
    const wrap = <R extends object>(repo: R, name: string, record: (member: string, args: unknown[], out: unknown) => void): R => new Proxy(repo, { get: (target, member) => {
      const value = Reflect.get(target, member) as unknown;
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        const key = JSON.stringify([name, member, args]);
        let read = this.#reads.get(key);
        if (!read) {
          const run = (...selected: unknown[]) => (value as (...a: unknown[]) => Promise<unknown>).apply(target, selected);
          read = name === "artifacts" && member === "readKeys"
            ? run(...args, { workItemId: true, recordedAt: true, partial: true, byteLength: true })
            : run(...args);
          this.#reads.set(key, read);
        }
        const out = await read;
        record(String(member), args, out);
        return out;
      };
    } });
    return new Proxy(repos, { get: (target, name) => {
      const repo = Reflect.get(target, name) as object;
      if ((AGGREGATES as readonly unknown[]).includes(name)) return wrap(repo, String(name), (member, _args, out) => {
        if (member === "readManyNarrowed" || member === "listWhereIn" || member === "readMany") keep(String(name), out as Persisted<unknown>[]);
      });
      if ((LOGS as readonly unknown[]).includes(name)) return wrap(repo, String(name), (member, args, out) => {
        const held = this.#records.get(String(name)) ?? new Map<string, readonly unknown[]>();
        this.#records.set(String(name), held);
        if (member === "readKeys") for (const key of args[0] as string[]) held.set(key, (out as ReadonlyMap<string, readonly unknown[]>).get(key) ?? []);
        if (member === "read") held.set(args[0] as string, out as unknown[]);
      });
      return repo;
    } });
  }

  /** A store holding only the kept rows, for the reads `readAssignmentSubset` makes. */
  repos(): ControlPlaneRepositories {
    const byIds = (name: string) => async (ids: readonly string[]) =>
      [...new Set(ids)].sort().flatMap((id) => { const row = this.#rows.get(name)?.get(id); return row === undefined ? [] : [row]; });
    const where = (name: string) => async (path: readonly string[], values: readonly string[]) => {
      const key = `${name}\n${path.join(".")}`;
      let index = this.#paths.get(key);
      if (index === undefined) {
        this.#paths.set(key, index = new Map());
        for (const row of this.#rows.get(name)?.values() ?? []) { const at = jsonTextAtPath(row.value, path); if (at !== null) index.set(at, [...(index.get(at) ?? []), row]); }
      }
      return [...new Map([...new Set(values)].flatMap((v) => index!.get(v) ?? []).map((row) => [row.id, row] as const)).values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    };
    const keys = (name: string) => async (wanted: readonly string[]) =>
      new Map(wanted.flatMap((key) => { const records = this.#records.get(name)?.get(key) ?? []; return records.length === 0 ? [] : [[key, records] as const]; }));
    return Object.fromEntries([...AGGREGATES.map((name) => [name, { readManyNarrowed: byIds(name), readMany: byIds(name), listWhereIn: where(name) }]),
      ...LOGS.map((name) => [name, { readKeys: keys(name) }])]) as unknown as ControlPlaneRepositories;
  }
}

const CHANGE_PROJECTIONS = {
  workItem: { id: true, obligation: true, subject: true, directoryParent: true, planRepair: true, dependencies: true },
  byWorkItem: { workItemId: true },
} satisfies Record<string, RecordProjection>;

const narrowPublication = (w: WorkItem): WorkItem => ({ id: w.id, autonomousPlan: w.autonomousPlan && {
  publication: w.autonomousPlan.publication, contract: { recordClass: w.autonomousPlan.contract?.recordClass } },
  publicationOutcome: w.publicationOutcome && { status: w.publicationOutcome.status, versionId: w.publicationOutcome.versionId,
    workerResultId: w.publicationOutcome.workerResultId, acceptedRecordIds: w.publicationOutcome.acceptedRecordIds } } as unknown as WorkItem);

const obligationStateName = (id: string, subjectId: string): string => {
  const hay = `${id} ${subjectId}`.toLowerCase();
  return US_STATES.find((s) => unitCarriesState(hay, s.code))?.name ?? "other";
};

export interface OwnerSnapshotFoldInput {
  readonly nowIso: string;
  readonly slackMs?: number;
  /** The public readbacks the published rows were derived with. */
  readonly servedReader: ServedReaderReadback | null;
  readonly askGapObservations: AssignmentSubsetBase["askGapObservations"];
  readonly scopes: readonly ExpansionScopeDecision[] | null;
  /** The periods of the readings the last snapshot published. */
  readonly carried: readonly ReadingPeriod[];
  /** False for a dry run: no state's rows are written. */
  readonly write: boolean;
  /** Routed rows held in memory before they are written to their states' inboxes. */
  readonly heldRows?: number;
  readonly log: (line: string) => void;
}

/**
 * The snapshot's totals with every row changed since the last publish folded in, one state at a time: each state's assignments and
 * spend are read from its own rows, folded, written back and let go before the next, and only each state's part is held nationally.
 */
export class OwnerSnapshotFold {
  readonly #repos: ControlPlaneRepositories;
  readonly #input: OwnerSnapshotFoldInput;
  readonly #slackMs: number;
  readonly #rebuild: boolean;
  readonly #inboxes: Inboxes;
  #servedReader: ServedReaderReadback | null;
  readonly #priorCosts: CostTotals | null;
  costs!: CostTotals;
  readonly #states: Record<string, StatePart>;
  readonly #crossings: Record<string, string>;
  readonly #links: Record<string, string>;
  readonly #dependencies: Record<string, readonly string[]>;
  readonly #lists: Map<string, AssignmentListRow>;
  #pipeline: PipelineTotals;
  #through: string;
  readonly #cursors: Record<string, LogCursor>;
  /** The states loaded now, and every assignment they hold. */
  readonly #loaded = new Map<string, Loaded>();
  readonly #groups = new Map<string, GroupTotals>();
  readonly #stateOfGroup = new Map<string, string>();
  /** Each assignment's index row, segment by segment over the instants the clock alone changes it at. */
  readonly #index = new Map<string, IndexSegment[]>();
  readonly #bodies = new Map<string, readonly BodyPublicationAttempt[]>();
  readonly #groupOf = new Map<string, string>();
  readonly #scouts: Refs = new Map();
  readonly #pipelineItems: Refs = new Map();
  /** States whose rows this publish wrote. */
  readonly #written = new Set<string>();
  /** Attempts changed since the last publish. */
  readonly #changedAttempts = new Set<string>();

  private constructor(repos: ControlPlaneRepositories, prior: OwnerSnapshotTotals | null, input: OwnerSnapshotFoldInput) {
    this.#repos = repos;
    this.#input = input;
    this.#slackMs = input.slackMs ?? INCREMENTAL_READS_SLACK_MS;
    this.#servedReader = input.servedReader;
    const a = prior?.formatVersion === OWNER_SNAPSHOT_TOTALS_FORMAT ? prior.assignments : null;
    this.#rebuild = a === null || prior?.costs === null;
    this.#inboxes = new Inboxes(repos, input.nowIso, `${input.nowIso} ${this.#rebuild ? "rebuild" : "fold"}`, input.write, input.heldRows ?? INBOX_HELD);
    this.#priorCosts = this.#rebuild ? null : prior!.costs;
    this.#states = this.#rebuild ? {} : { ...a!.states };
    this.#crossings = this.#rebuild ? {} : { ...a!.crossings };
    this.#links = this.#rebuild ? {} : { ...a!.links };
    this.#dependencies = this.#rebuild ? {} : { ...a!.dependencies };
    this.#lists = new Map(this.#rebuild ? [] : Object.entries(a!.lists));
    this.#pipeline = this.#rebuild ? { cursor: { through: iso(0), held: [] }, items: 0, verified: 0, unlinked: {} } : structuredClone(a!.pipeline);
    this.#through = this.#rebuild ? iso(0) : a!.through;
    this.#cursors = this.#rebuild ? {} : structuredClone(a!.cursors ?? {});
  }

  /** The totals with every changed row folded in; with no usable prior, or a state whose rows do not pair with it, every state is derived from scratch. */
  static async fold(repos: ControlPlaneRepositories, prior: OwnerSnapshotTotals | null, input: OwnerSnapshotFoldInput): Promise<OwnerSnapshotFold> {
    try {
      return await new OwnerSnapshotFold(repos, prior, input).#run(prior);
    } catch (error) {
      if (!(error instanceof StaleState)) throw error;
      input.log(`assignments: ${error.message}; every state is derived again`);
      return await new OwnerSnapshotFold(repos, null, input).#run(prior);
    }
  }

  async #run(prior: OwnerSnapshotTotals | null): Promise<this> {
    const changed = this.#rebuild ? new Set<string>() : await this.#routeChanges();
    if (this.#rebuild) {
      await this.#routeEverything();
      for (const state of Object.keys(prior?.formatVersion === OWNER_SNAPSHOT_TOTALS_FORMAT ? prior.assignments?.states ?? {} : {})) this.#inboxes.touch(state);
    }
    const costs = (prior: CostTotals | null) => foldCosts(this.#repos, prior, { nowIso: this.#input.nowIso, slackMs: this.#slackMs, scopes: this.#input.scopes,
      scopeMembers: this.#scopeMembers(), carried: this.#input.carried, changed: { attempts: this.#changedAttempts, workItems: changed },
      places: (charges) => this.#place(charges) });
    const membersOf = () => JSON.stringify([...this.#scopeMembers()].map(([key, subjects]) => [key, [...subjects].sort()]));
    const members = membersOf();
    this.costs = await costs(this.#priorCosts);
    await this.#drain();
    /* Hunt members are read off the states' clocks, so a folded state can change the frame every charge was attributed against. */
    if (membersOf() !== members) {
      this.costs = await costs(this.costs);
      await this.#drain();
    }
    if (this.#rebuild) this.#cursors.costs = structuredClone(this.costs.cursor);
    await this.#foldPipeline(this.#rebuild);
    return this;
  }

  #scopeMembers(): ReadonlyMap<string, ReadonlySet<string>> {
    return new Map((this.#input.scopes ?? []).map((scope) => [scope.key,
      new Set(Object.values(this.#states).flatMap((s) => s.marks[`${scope.key}\n${scope.receiptId}`] ?? []))]));
  }

  async #place(charges: readonly CostEntry[]): Promise<void> {
    const places: PlaceLedger = {};
    for (const e of charges) foldPlace(places, e);
    for (const [state, rows] of Object.entries(places)) for (const [place, totals] of Object.entries(rows)) this.#inboxes.place(state, place, totals);
    await this.#inboxes.settle();
  }

  get pipeline(): { readonly items: number; readonly linked: number; readonly verified: number } {
    return { items: this.#pipeline.items, linked: this.#pipeline.items - Object.keys(this.#pipeline.unlinked).length, verified: this.#pipeline.verified };
  }

  /** Every work item with a publication outcome, as the public readbacks read it. */
  publications(): WorkItem[] {
    return Object.values(this.#states).flatMap((s) => s.publications);
  }

  /** Standing obligations by the state name each carries. */
  obligationsByState(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of Object.values(this.#states)) for (const [name, n] of Object.entries(s.obligations)) out[name] = (out[name] ?? 0) + n;
    return out;
  }

  /** Spend by state; each state's jurisdictions are on its own row. */
  spendByPlace(): SpendByPlaceView {
    return spendByPlaceOf(Object.fromEntries(Object.entries(this.#states).filter(([, s]) => s.spend.attempts > 0).map(([state, s]) => [state, s.spend])),
      this.costs.ledger.overhead);
  }

  /** Re-derives the assignments whose public readback changed between the carried readback and `next`. */
  async readBack(next: ServedReaderReadback | null): Promise<void> {
    const previous = this.#servedReader;
    this.#servedReader = next;
    const valid = (read: ServedReaderReadback | null) => new Set((read?.witnesses ?? [])
      .filter((w) => servedWitness(read, w.itemId, w.approvalId, this.#input.nowIso) !== null).map((w) => `${w.itemId}\n${w.approvalId}`));
    const before = valid(previous);
    const after = valid(next);
    const items = unique([...before].filter((k) => !after.has(k)).concat([...after].filter((k) => !before.has(k))).map((k) => k.split("\n")[0]!));
    if (items.length === 0) return;
    const sources = await readByKeys(this.#repos.promotionPipeline, items);
    const attempts: string[] = [];
    const workItems = [...items];
    for (const records of sources.values()) {
      for (const r of records.filter(isPipelineRecord) as PromotionPipelineRecord[]) {
        if (r.stage !== "SCOUTED") continue;
        if (r.source.kind === "FLEET_EXTRACTION") workItems.push(r.source.workItemId);
        else if (r.source.kind !== "PROMOTED_CANDIDACY") attempts.push(r.source.attemptId);
      }
    }
    for (const row of await needs(this.#repos.attempts.readManyNarrowed, "attempt read by id")(unique(attempts), CHANGE_PROJECTIONS.byWorkItem)) {
      workItems.push((row.value as { workItemId: string }).workItemId);
    }
    await this.#routeItems(await heldWorkItems(this.#repos, workItems));
    await this.#drain();
  }

  /** The national view from every state's part, as of each state's last fold. */
  async view(input: Omit<Parameters<typeof assembleAssignmentView>[0], "nowIso" | "part" | "lists" | "totals">): Promise<AssignmentView> {
    const part = this.#part();
    const kept = new Set(part.candidates.map((c) => c.id));
    for (const [state, s] of Object.entries(this.#states)) {
      const wanted = s.assignments.candidates.map((c) => c.id).filter((id) => kept.has(id) && !this.#lists.has(id));
      if (wanted.length === 0) continue;
      const row = await this.#repos.ownerSnapshotStateTotals.readNarrowed(stateTotalsId(state), { lists: true });
      const lists = (row?.value as Pick<StateTotals, "lists"> | undefined)?.lists ?? {};
      for (const id of wanted) if (lists[id] !== undefined) this.#lists.set(id, lists[id]!.row);
    }
    for (const id of [...this.#lists.keys()]) if (!kept.has(id)) this.#lists.delete(id);
    const pipeline = this.pipeline;
    return assembleAssignmentView({ ...input, nowIso: this.#input.nowIso, part, lists: (id) => this.#lists.get(id),
      totals: { costs: assignmentCostSummaryOf(this.costs.assignments), pipeline: { items: pipeline.items, linked: pipeline.linked },
        askGapObservations: this.#input.askGapObservations } });
  }

  totals(): OwnerSnapshotTotals {
    return { formatVersion: OWNER_SNAPSHOT_TOTALS_FORMAT, costs: this.costs, assignments: { through: this.#through, cursors: this.#cursors, states: this.#states,
      crossings: this.#crossings, links: this.#links, dependencies: this.#dependencies, lists: Object.fromEntries(this.#lists), pipeline: this.#pipeline } };
  }

  #part(): AssignmentPart {
    return mergeAssignmentParts(Object.values(this.#states).map((s) => s.assignments), this.#input.nowIso);
  }

  #base(): AssignmentSubsetBase {
    return { nowIso: this.#input.nowIso, activation: null, pilotZips: [], servedReader: this.#servedReader,
      askGapObservations: this.#input.askGapObservations, pipeline: true };
  }

  #remember(name: string) { return { cursors: this.#cursors, name, slackMs: this.#slackMs }; }

  /* ---------------------------------------------------------- routing */

  /** Each work item to the state whose rows hold it. */
  async #routeItems(ids: Iterable<string>): Promise<void> {
    const pending = unique(ids);
    const rows = new Map<string, WorkItem>();
    for (const chunk of chunks(pending.filter((id) => !(id in this.#crossings)), ASSIGNMENT_BATCH)) {
      for (const row of await needs(this.#repos.workItems.readManyNarrowed, "work-item read by id")(chunk, { id: true, obligation: true, subject: true })) {
        rows.set(row.id, row.value as WorkItem);
      }
    }
    for (const id of pending) this.#inboxes.item(this.#crossings[id] ?? homeOf(id, rows.get(id)), id);
    await this.#inboxes.settle();
  }

  /** The assignments a changed row reaches, each routed to its state; answers every work item a changed row names. */
  async #routeChanges(): Promise<Set<string>> {
    const repos = this.#repos;
    const since = iso(Date.parse(this.#through) - this.#slackMs);
    const items: string[] = [];
    const changedItems = new Set<string>();
    const scouts: { workItemId?: string; attemptId?: string; key: string }[] = [];
    const pipeline: { workItemId?: string; attemptId?: string; key: string }[] = [];
    const pipelineKeys = new Set<string>();
    const group = (id: string) => this.#inboxes.group(stateOf(id), id);
    const throughs = await Promise.all([
      eachChanged<{ id: string }>(repos.obligations, since, { id: true }, (rows) => { for (const o of rows) group(o.id); }, this.#remember("obligations")),
      eachChanged<{ obligationId: string; workItemId: string }>(repos.occurrences, since, { obligationId: true, workItemId: true }, (rows) => {
        for (const o of rows) { group(o.obligationId); items.push(o.workItemId); }
      }, this.#remember("occurrences")),
      eachChanged<{ obligationId: string }>(repos.debts, since, { obligationId: true }, (rows) => { for (const d of rows) group(d.obligationId); }, this.#remember("debts")),
      eachChanged<{ bodyId: string; code: AskGapCode }>(repos.askGapObservations, since, { bodyId: true, code: true }, (rows) => {
        for (const o of rows) group(askGapObligationId(o.bodyId, o.code));
      }, this.#remember("askGapObservations")),
      eachChanged<WorkItem>(repos.workItems, since, CHANGE_PROJECTIONS.workItem, (rows) => {
        for (const w of rows) { this.#noteWorkItem(w); changedItems.add(w.id); items.push(w.id); }
      }, this.#remember("workItems")),
      eachChanged<{ workItemId: string }>(repos.routeTasks, since, CHANGE_PROJECTIONS.byWorkItem, (rows) => { for (const r of rows) items.push(r.workItemId); }, this.#remember("routeTasks")),
      eachChanged<{ id: string; workItemId: string }>(repos.attempts, since, { id: true, workItemId: true }, (rows) => {
        for (const a of rows) { this.#changedAttempts.add(a.id); items.push(a.workItemId); }
      }, this.#remember("attempts")),
      eachChanged<{ routeTaskId: string }>(repos.leases, since, { routeTaskId: true }, async (rows) => {
        const tasks = await needs(repos.routeTasks.readManyNarrowed, "route-task read by id")(unique(rows.map((l) => l.routeTaskId)), CHANGE_PROJECTIONS.byWorkItem);
        for (const t of tasks) items.push((t.value as { workItemId: string }).workItemId);
      }, this.#remember("leases")),
      ...(["artifacts", "costs", "workerResults"] as const).map((name) =>
        eachLogChanged<{ workItemId: string }>(repos[name] as AppendOnlyRepository<unknown>, since, CHANGE_PROJECTIONS.byWorkItem, (records) => { for (const r of records) items.push(r.record.workItemId); }, this.#remember(name))),
      eachLogChanged<{ workItemId: string; attemptId: string }>(repos.scoutResults as AppendOnlyRepository<unknown>, since, { workItemId: true, attemptId: true }, (records) => {
        for (const r of records) { scouts.push({ ...r.record, key: r.key }); items.push(r.record.workItemId); }
      }, this.#remember("scoutResults")),
      eachLogChanged<PipelineSource>(repos.promotionPipeline as AppendOnlyRepository<unknown>, since, { source: true }, (records) => {
        for (const r of records) pipelineKeys.add(r.key);
      }, this.#remember("promotionPipeline")),
    ]);
    /* A later stage names no source; the item's assignment is the one its scouted record's source names. */
    for (const keys of chunks([...pipelineKeys].sort(), ASSIGNMENT_BATCH)) {
      for (const [key, records] of await readByKeys(repos.promotionPipeline, keys)) {
        const source = (records as readonly unknown[] as readonly PipelineSource[]).find((r) => r.source !== undefined)?.source;
        pipeline.push({ workItemId: source?.workItemId, attemptId: source?.attemptId, key });
      }
    }
    this.#through = throughs.sort()[0]!;
    await this.#routeRefs(scouts, pipeline);
    /* A parent's change can move its children; a work item's state reaches the rows of every work item its dependents wait on. */
    for (const [child, parent] of Object.entries(this.#links)) if (changedItems.has(parent)) items.push(child);
    for (const [dependent, upstreams] of Object.entries(this.#dependencies)) {
      if (changedItems.has(dependent) || upstreams.some((u) => changedItems.has(u))) items.push(...upstreams);
    }
    await this.#routeItems(items);
    for (const r of pipeline) items.push(r.workItemId ?? "");
    return new Set(unique(items));
  }

  /** Scout-result keys and pipeline items to the states of the work items they name, an attempt's through its work item. */
  async #routeRefs(scouts: readonly { workItemId?: string; attemptId?: string; key: string }[], pipeline: readonly { workItemId?: string; attemptId?: string; key: string }[]): Promise<void> {
    const attempts = new Map<string, string>();
    for (const chunk of chunks(unique([...scouts, ...pipeline].filter((r) => !r.workItemId).map((r) => r.attemptId)), ASSIGNMENT_BATCH)) {
      for (const row of await needs(this.#repos.attempts.readManyNarrowed, "attempt read by id")(chunk, CHANGE_PROJECTIONS.byWorkItem)) {
        attempts.set(row.id, (row.value as { workItemId: string }).workItemId);
      }
    }
    const items = unique([...scouts, ...pipeline].map((r) => r.workItemId ?? attempts.get(r.attemptId ?? "")));
    const rows = new Map<string, WorkItem>();
    for (const chunk of chunks(items.filter((id) => !(id in this.#crossings)), ASSIGNMENT_BATCH)) {
      for (const row of await needs(this.#repos.workItems.readManyNarrowed, "work-item read by id")(chunk, { id: true, obligation: true, subject: true })) {
        rows.set(row.id, row.value as WorkItem);
      }
    }
    const stateOfRef = (r: { workItemId?: string; attemptId?: string }): string | null => {
      const item = r.workItemId ?? attempts.get(r.attemptId ?? "");
      return item === undefined ? null : this.#crossings[item] ?? homeOf(item, rows.get(item));
    };
    for (const r of scouts) {
      const state = stateOfRef(r);
      if (state === null) continue;
      this.#inboxes.scout(state, r.workItemId, r.key);
      this.#inboxes.scout(state, r.attemptId, r.key);
    }
    for (const r of pipeline) {
      const state = stateOfRef(r);
      if (state === null) continue;
      this.#inboxes.pipeline(state, r.workItemId, r.key);
      this.#inboxes.pipeline(state, r.attemptId, r.key);
      this.#inboxes.item(state, r.workItemId ?? attempts.get(r.attemptId ?? "")!);
    }
    await this.#inboxes.settle();
  }

  /** Every standing obligation and every work item and orphaned execution record, each routed to its state, page by page. */
  async #routeEverything(): Promise<void> {
    const repos = this.#repos;
    const throughs: string[] = [];
    // These rows join the assignments below. Keep their versions too, so their
    // overlap cannot send an unchanged assignment through the next publish.
    for (const name of ["debts", "leases", "askGapObservations"] as const) {
      throughs.push(await eachChanged(repos[name] as AggregateRepository<unknown>, null, { id: true }, () => {}, this.#remember(name)));
    }
    throughs.push(await eachLogChanged(repos.artifacts, null, { workItemId: true }, () => {}, this.#remember("artifacts")));
    throughs.push(await eachChanged<{ id: string }>(repos.obligations, null, { id: true }, async (rows) => {
      for (const o of rows) this.#inboxes.group(stateOf(o.id), o.id);
      await this.#inboxes.settle();
    }, this.#remember("obligations")));
    throughs.push(await eachChanged<WorkItem>(repos.workItems, null, CHANGE_PROJECTIONS.workItem, async (rows) => {
      for (const w of rows) { this.#noteWorkItem(w); this.#inboxes.item(homeOf(w.id, w), w.id); }
      await this.#inboxes.settle();
    }, this.#remember("workItems")));
    const orphans = async (ids: readonly string[]) => {
      const wanted = unique(ids);
      const held = new Set((await needs(repos.workItems.readManyNarrowed, "work-item read by id")(wanted, { id: true })).map((row) => row.id));
      for (const id of wanted) if (!held.has(id)) this.#inboxes.item(homeOf(id, undefined), id);
      await this.#inboxes.settle();
    };
    for (const name of ["routeTasks", "attempts", "occurrences"] as const) {
      throughs.push(await eachChanged<{ workItemId: string }>(repos[name], null, CHANGE_PROJECTIONS.byWorkItem, (rows) => orphans(rows.map((r) => r.workItemId)), this.#remember(name)));
    }
    throughs.push(await eachLogChanged<{ workItemId: string }>(repos.workerResults as AppendOnlyRepository<unknown>, null, CHANGE_PROJECTIONS.byWorkItem,
      (records) => orphans(records.map((r) => r.record.workItemId)), this.#remember("workerResults")));
    throughs.push(await eachLogChanged<{ workItemId: string; attemptId: string }>(repos.scoutResults as AppendOnlyRepository<unknown>, null, { workItemId: true, attemptId: true },
      (records) => this.#routeRefs(records.map((r) => ({ ...r.record, key: r.key })), []), this.#remember("scoutResults")));
    throughs.push(await eachLogChanged<PipelineSource>(repos.promotionPipeline as AppendOnlyRepository<unknown>, null, { source: true },
      (records) => this.#routeRefs([], records.map((r) => ({ workItemId: r.record.source?.workItemId, attemptId: r.record.source?.attemptId, key: r.key }))), this.#remember("promotionPipeline")));
    this.#through = throughs.sort()[0]!;
  }

  /* ----------------------------------------------------------- states */

  /** Folds every state with rows routed to it, one at a time, until none is left. */
  async #drain(): Promise<void> {
    for (let states = this.#inboxes.states(); states.length > 0; states = this.#inboxes.states()) {
      for (const state of states) {
        await this.#load(state);
        const inbox = await this.#inboxes.take(state);
        const loaded = this.#loaded.get(state)!;
        for (const [ref, keys] of Object.entries(inbox.scouts)) for (const key of keys) addRef(this.#scouts, ref, key);
        for (const [ref, keys] of Object.entries(inbox.pipeline)) for (const key of keys) addRef(this.#pipelineItems, ref, key);
        for (const [place, totals] of Object.entries(inbox.places)) mergePlaceTotals(loaded.places[place] ??= placeTotals(), totals);
        const targets = new Set(inbox.groups);
        /* A new obligation takes in the created work items whose clause names it. */
        for (const id of loaded.groups) { const clause = this.#groups.get(id)!.clause; if (clause !== null && targets.has(clause) && !this.#groups.has(clause)) targets.add(id); }
        for (const item of inbox.items) { const held = this.#groupOf.get(item); if (held !== undefined) targets.add(held); }
        const touched = targets.size;
        await this.#derive([...targets], []);
        const probes = inbox.items.filter((item) => !this.#groupOf.has(item));
        await this.#derive([], probes);
        this.#input.log(`assignments: ${state} folded — ${touched} derived again, ${probes.length} work item(s) no assignment held`);
        await this.#emit();
      }
    }
  }

  async #load(state: string): Promise<void> {
    if (this.#loaded.has(state)) return;
    const [totals, snapshot] = await Promise.all([this.#repos.ownerSnapshotStateTotals.read(stateTotalsId(state)),
      this.#repos.ownerSnapshotStates.readNarrowed(ownerSnapshotStateId(state), { builtAt: true, allRowsIndex: true, bodyAttempts: true })
        .then(row => row as Loaded["snapshot"])]);
    const part = this.#states[state];
    const carried = part !== undefined && (!this.#rebuild || this.#written.has(state));
    if (carried && (totals?.value.builtAt !== part.builtAt || snapshot?.value.builtAt !== part.builtAt)) {
      throw new StaleState(`the rows of ${state} were not written by the publish that last folded it`);
    }
    const loaded: Loaded = { totals, snapshot, groups: new Set(), lists: new Map(), places: carried ? structuredClone(totals!.value.places) : {} };
    this.#loaded.set(state, loaded);
    if (!carried) return;
    for (const [id, g] of Object.entries(totals!.value.groups)) this.#setGroup(state, id, g);
    for (const row of snapshot!.value.allRowsIndex) this.#index.set(row.id, [...(this.#index.get(row.id) ?? []), row]);
    for (const [id, list] of Object.entries(totals!.value.lists)) loaded.lists.set(id, list);
    const bodies = new Map<string, BodyPublicationAttempt[]>();
    for (const body of snapshot!.value.bodyAttempts) {
      const id = this.#groupOf.get(body.workItemId);
      if (id !== undefined) bodies.set(id, [...(bodies.get(id) ?? []), body]);
    }
    for (const [id, list] of bodies) this.#bodies.set(id, list);
  }

  /** Each loaded state's assignments as they stand at this publish's clock. */
  #entriesAt(loaded: Loaded): StateEntry[] {
    return [...loaded.groups].sort().map((id) => [id, { ...this.#groups.get(id)!, index: segmentAt(this.#index.get(id)!, this.#input.nowIso),
      bodyAttempts: this.#bodies.get(id) ?? [] }] as const);
  }

  /** Writes every loaded state's rows and part, then lets them go. */
  async #emit(): Promise<void> {
    const now = this.#input.nowIso;
    /* Every ranked assignment of a state keeps a list row that holds now, so a later publish never reads the state for one. */
    for (let pass = 0; pass < 2; pass += 1) {
      const stale = [...this.#loaded.values()].flatMap((loaded) =>
        assignmentPartOf(this.#entriesAt(loaded), now).candidates.map((c) => c.id).filter((id) => listAt(loaded.lists.get(id), now) === undefined));
      if (stale.length === 0) break;
      await this.#derive(stale, []);
    }
    const rows = new Map<string, StateEntry[]>();
    for (const [state, loaded] of this.#loaded) {
      const entries = this.#entriesAt(loaded);
      rows.set(state, entries);
      const obligations: Record<string, number> = {};
      const marks: Record<string, string[]> = {};
      for (const [id, g] of entries) {
        if (g.obligation !== null) { const name = obligationStateName(id, g.obligation.subjectId); obligations[name] = (obligations[name] ?? 0) + 1; }
        for (const a of g.obligation?.assignments ?? []) (marks[`${a.assignmentKey}\n${a.ref}`] ??= []).push(g.obligation!.subjectId);
      }
      this.#states[state] = { builtAt: now, assignments: assignmentPartOf(entries, now), obligations, spend: placeSumOf(loaded.places),
        publications: entries.flatMap(([, g]) => g.publications), marks };
    }
    /* List rows are kept for the rows the national ranking reaches as far as the states folded so far show it. */
    const ranked = new Set(this.#part().candidates.map((c) => c.id));
    for (const [state, loaded] of this.#loaded) {
      const local = this.#states[state]!.assignments.candidates.map((c) => c.id);
      for (const id of local) { const row = listAt(loaded.lists.get(id), now); if (row !== undefined && (ranked.has(id) || this.#lists.has(id))) this.#lists.set(id, row); }
      if (!this.#input.write) continue;
      const entries = rows.get(state)!;
      const totals: StateTotals = { builtAt: now, groups: Object.fromEntries(entries.map(([id]) => [id, this.#groups.get(id)!])), places: loaded.places,
        lists: Object.fromEntries(local.map((id) => [id, loaded.lists.get(id)!])) };
      const snapshot: OwnerSnapshotState = { builtAt: now, allRowsIndex: entries.flatMap(([id]) => this.#index.get(id)!),
        bodyAttempts: assignmentStateRowsOf(entries).bodyAttempts, spendByPlace: placeRowsOf(state, loaded.places) };
      assertAggregateOnly(snapshot, `owner snapshot rows of ${state}`);
      await (loaded.totals === null ? this.#repos.ownerSnapshotStateTotals.put(stateTotalsId(state), totals, now)
        : this.#repos.ownerSnapshotStateTotals.compareAndSet(stateTotalsId(state), loaded.totals.revision, totals, now));
      await (loaded.snapshot === null ? this.#repos.ownerSnapshotStates.put(ownerSnapshotStateId(state), snapshot, now)
        : this.#repos.ownerSnapshotStates.compareAndSet(ownerSnapshotStateId(state), loaded.snapshot.revision, snapshot, now));
      this.#written.add(state);
    }
    this.#unload();
  }

  #unload(): void {
    this.#loaded.clear();
    this.#groups.clear();
    this.#stateOfGroup.clear();
    this.#index.clear();
    this.#bodies.clear();
    this.#groupOf.clear();
    this.#scouts.clear();
    this.#pipelineItems.clear();
  }

  #setGroup(state: string, id: string, g: GroupTotals): void {
    this.#groups.set(id, g);
    this.#stateOfGroup.set(id, state);
    this.#loaded.get(state)!.groups.add(id);
    for (const m of g.members) this.#groupOf.set(m, id);
  }

  #dropGroup(id: string): void {
    const state = this.#stateOfGroup.get(id);
    for (const m of this.#groups.get(id)?.members ?? []) {
      if (this.#groupOf.get(m) === id) this.#groupOf.delete(m);
      if (this.#crossings[m] === state) delete this.#crossings[m];
    }
    if (state !== undefined) {
      this.#loaded.get(state)?.groups.delete(id);
      this.#loaded.get(state)?.lists.delete(id);
    }
    this.#groups.delete(id);
    this.#stateOfGroup.delete(id);
    this.#index.delete(id);
    this.#bodies.delete(id);
  }

  /* --------------------------------------------------------- deriving */

  #noteWorkItem(w: Pick<WorkItem, "id" | "directoryParent" | "dependencies"> & { readonly planRepair?: { readonly parentWorkItemId: string } }): void {
    const parent = w.directoryParent?.workItemId ?? w.planRepair?.parentWorkItemId;
    if (parent) this.#links[w.id] = parent;
    else delete this.#links[w.id];
    if (w.dependencies?.length) this.#dependencies[w.id] = w.dependencies.map((d) => d.upstreamId);
    else delete this.#dependencies[w.id];
  }

  /** The scout-result keys or pipeline items the assignments holding `owned` carry, and those changed rows name for it or its attempts. */
  #refsFor(carried: (g: GroupTotals) => readonly string[], refs: Refs, owned: readonly string[], attempts: readonly string[]): string[] {
    const out = new Set<string>();
    for (const id of unique(owned.map((m) => this.#groupOf.get(m)))) for (const key of carried(this.#groups.get(id)!)) out.add(key);
    for (const ref of [...owned, ...attempts]) for (const key of refs.get(ref) ?? []) out.add(key);
    return [...out];
  }

  /** Every record the seeded assignments join, read and derived together until membership settles, then carried. */
  async #derive(targets: readonly string[], probes: readonly string[]): Promise<void> {
    for (const batch of chunks([...new Set(targets)], ASSIGNMENT_BATCH)) await this.#deriveBatch(batch, []);
    for (const batch of chunks([...new Set(probes)], ASSIGNMENT_BATCH)) await this.#deriveBatch([], batch);
  }

  async #deriveBatch(targets: readonly string[], probes: readonly string[]): Promise<void> {
    const ids = new Set(targets);
    const extra = new Set(probes);
    const replay = new Replay();
    const recording = replay.recording(this.#repos);
    for (let round = 0; ; round += 1) {
      if (round > 16) throw new Error(`assignment membership did not settle for ${[...ids].slice(0, 5).join(", ")}`);
      const members = new Set(extra);
      for (const id of ids) for (const m of this.#groups.get(id)?.members ?? [id]) members.add(m);
      const src = await readAssignmentSubset(recording, this.#base(), this.#seeds([...ids], [...members]));
      const produced = deriveAssignmentEntries(src);
      const items = new Map(src.workItems.map((w) => [w.id, w] as const));
      const stateOfEntry = (id: string, entry: AssignmentEntry) => entry.index.kind === "WORK_ITEM" ? homeOf(id, items.get(id)) : stateOf(id);
      /* Each state an assignment or a claimed work item sits in is loaded first, so a work item moving between states leaves its old row. */
      const needed = new Set([...produced].map(([id, entry]) => stateOfEntry(id, entry)));
      for (const m of members) if (!this.#groupOf.has(m)) needed.add(this.#crossings[m] ?? homeOf(m, items.get(m)));
      const unloaded = [...needed].filter((state) => !this.#loaded.has(state));
      if (unloaded.length > 0) {
        for (const state of unloaded) await this.#load(state);
        continue;
      }
      const owned = new Set([...members, ...src.occurrences.map((o) => o.workItemId)]);
      let grew = false;
      for (const [id, entry] of produced) {
        const claims = entry.members.filter((m) => members.has(m));
        if (claims.length > 0 && !ids.has(id)) { ids.add(id); grew = true; }
        for (const m of claims) {
          const old = this.#groupOf.get(m);
          if (old !== undefined && old !== id && !ids.has(old)) { ids.add(old); grew = true; }
        }
        if (ids.has(id)) for (const m of entry.members) if (!owned.has(m)) { extra.add(m); grew = true; }
      }
      if (grew) continue;
      for (const w of src.workItems) this.#noteWorkItem(w);
      /* Read before any old assignment is let go: a work item brings the keys its old assignment carried. */
      const scoutKeys = new Map([...ids].map((id) => {
        const members = new Set(produced.get(id)?.members ?? []);
        return [id, this.#refsFor((g) => g.scoutKeys, this.#scouts, [...members], src.attempts.filter((a) => members.has(a.workItemId)).map((a) => a.id))] as const;
      }));
      for (const id of ids) this.#dropGroup(id);
      for (const id of ids) {
        const entry = produced.get(id);
        if (entry === undefined) continue;
        const state = stateOfEntry(id, entry);
        const own = entry.members.map((m) => items.get(m)).filter((w): w is WorkItem => w !== undefined);
        this.#setGroup(state, id, { members: entry.members, usd: entry.usd, items: entry.items, scoutKeys: scoutKeys.get(id)!, obligation: entry.obligation,
          publications: own.filter((w) => w.publicationOutcome).map(narrowPublication),
          clause: entry.index.kind === "WORK_ITEM" ? clauseObligation(items.get(id)?.obligation ?? "") : null });
        for (const m of entry.members) {
          if (homeOf(m, items.get(m)) === state) delete this.#crossings[m];
          else this.#crossings[m] = state;
        }
        this.#index.set(id, await this.#segments(id, entry, replay));
        if (entry.list) this.#loaded.get(state)!.lists.set(id, { row: entry.list, until: entry.horizon });
        this.#bodies.set(id, entry.bodyAttempts);
      }
      return;
    }
  }

  #seeds(obligations: readonly string[], workItems: readonly string[]): Parameters<typeof readAssignmentSubset>[2] {
    return { obligations, workItems, context: (owned) => this.#contextOf(owned),
      scoutKeys: (owned, attempts) => this.#refsFor((g) => g.scoutKeys, this.#scouts, owned, attempts),
      pipelineItems: (owned, attempts) => this.#refsFor((g) => g.items, this.#pipelineItems, owned, attempts) };
  }

  /** The assignment's index row at each instant its horizon names, derived again from the batch's rows with the clock moved there. */
  async #segments(id: string, entry: AssignmentEntry, replay: Replay): Promise<IndexSegment[]> {
    const out: IndexSegment[] = [{ ...entry.index, from: null, until: entry.horizon }];
    const store = replay.repos();
    const seeds = this.#seeds(entry.index.kind === "WORK_ITEM" ? [] : [id], entry.members);
    for (let at = entry.horizon; at !== null;) {
      if (out.length > 64) throw new Error(`assignment ${id} names more than 64 instants its row changes at`);
      const next = deriveAssignmentEntries(await readAssignmentSubset(store, { ...this.#base(), nowIso: at }, seeds)).get(id);
      if (next === undefined) throw new Error(`assignment ${id} could not be derived again at ${at}`);
      const last = out[out.length - 1]!;
      const { from: _from, until: _until, ...held } = last;
      if (JSON.stringify(held) === JSON.stringify(next.index)) out[out.length - 1] = { ...last, until: next.horizon };
      else out.push({ ...next.index, from: at, until: next.horizon });
      if (next.horizon !== null && next.horizon <= at) throw new Error(`assignment ${id} names ${next.horizon} after ${at}`);
      at = next.horizon;
    }
    return out;
  }

  /** The parents of `owned` and, for each of its work items others wait on, those dependents and everything they wait on. */
  #contextOf(owned: readonly string[]): string[] {
    const upstreamOf = new Map<string, string[]>();
    for (const [dependent, upstreams] of Object.entries(this.#dependencies)) for (const u of upstreams) upstreamOf.set(u, [...(upstreamOf.get(u) ?? []), dependent]);
    const context = new Set<string>();
    for (const m of owned) {
      const parent = this.#links[m];
      if (parent) context.add(parent);
      for (const dependent of upstreamOf.get(m) ?? []) for (const id of [dependent, ...(this.#dependencies[dependent] ?? [])]) context.add(id);
    }
    for (const m of owned) context.delete(m);
    return [...context];
  }

  /** The pipeline's item and VERIFIED counts with every record appended since the last publish folded in, item by item. */
  async #foldPipeline(whole: boolean): Promise<void> {
    const log = this.#repos.promotionPipeline;
    const t: PipelineTotals = whole ? { cursor: { through: iso(0), held: [] }, items: 0, verified: 0, unlinked: {} } : this.#pipeline;
    const attemptHeld = async (ids: readonly string[]) =>
      new Set((await needs(this.#repos.attempts.readManyNarrowed, "attempt read by id")(ids, { id: true })).map((row) => row.id));
    const account = async (items: readonly { readonly key: string; readonly before: readonly PromotionPipelineRecord[]; readonly all: readonly PromotionPipelineRecord[] }[]) => {
      const states = items.filter((item) => item.all.length > 0).map((item) => ({ key: item.key,
        before: item.before.length === 0 ? null : deriveItemState(item.key, item.before), after: deriveItemState(item.key, item.all) }));
      const sources = states.map(({ after }) => after.byStage.SCOUTED?.source);
      const attempts = await attemptHeld(unique(sources.map((s) => (s && s.kind !== "PROMOTED_CANDIDACY" && s.kind !== "FLEET_EXTRACTION" ? s.attemptId : null))));
      const assigned = await heldWorkItems(this.#repos, unique(sources.map((s) => (s?.kind === "FLEET_EXTRACTION" ? s.workItemId : null))));
      for (const { key, before, after } of states) {
        if (before === null) t.items += 1;
        t.verified += (after.stage === "VERIFIED" ? 1 : 0) - (before?.stage === "VERIFIED" ? 1 : 0);
        delete t.unlinked[key];
        if (pipelineLinked(after, (id) => assigned.has(id), (id) => attempts.has(id))) continue;
        const source = after.byStage.SCOUTED?.source;
        t.unlinked[key] = !source || source.kind === "PROMOTED_CANDIDACY" ? {} : source.kind === "FLEET_EXTRACTION" ? { workItem: source.workItemId } : { attempt: source.attemptId };
      }
    };
    const fresh = new Map<string, Set<string>>();
    /* A whole read arrives item by item in key order, so each item is accounted as its last record passes. */
    let open: { key: string; all: PromotionPipelineRecord[] } | null = null;
    const pending: { key: string; before: readonly PromotionPipelineRecord[]; all: PromotionPipelineRecord[] }[] = [];
    const { next } = await readLogChanges(log, whole ? null : t.cursor, this.#slackMs, async (records) => {
      for (const r of records) {
        if (!isPipelineRecord(r.record)) continue;
        if (!whole) { fresh.set(r.key, (fresh.get(r.key) ?? new Set()).add(r.recordId)); continue; }
        if (open?.key !== r.key) {
          if (open !== null) pending.push({ key: open.key, before: [], all: open.all });
          open = { key: r.key, all: [] };
        }
        open.all.push(r.record);
      }
      if (pending.length >= ASSIGNMENT_BATCH) await account(pending.splice(0));
    });
    if (open !== null) pending.push({ key: (open as { key: string }).key, before: [], all: (open as { all: PromotionPipelineRecord[] }).all });
    await account(pending.splice(0));
    for (const keys of chunks([...fresh.keys()].sort(), ASSIGNMENT_BATCH)) {
      const held = await readByKeys(log, keys);
      await account(keys.map((key) => {
        const all = (held.get(key) ?? []).filter(isPipelineRecord) as PromotionPipelineRecord[];
        return { key, before: all.filter((r) => !fresh.get(key)!.has(r.recordId)), all };
      }));
    }
    /* An unlinked item links once the attempt or work item it names appears. */
    const waiting = Object.entries(t.unlinked);
    const appeared = await attemptHeld(unique(waiting.map(([, ref]) => (ref.attempt && this.#changedAttempts.has(ref.attempt) ? ref.attempt : null))));
    const assigned = await heldWorkItems(this.#repos, unique(waiting.map(([, ref]) => ref.workItem)));
    for (const [key, ref] of waiting) if ((ref.workItem && assigned.has(ref.workItem)) || (ref.attempt && appeared.has(ref.attempt))) delete t.unlinked[key];
    t.cursor = next;
    this.#pipeline = t;
  }
}
