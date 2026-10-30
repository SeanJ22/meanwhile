import { passDeadlineFromEnv } from "../ops/independent-runtime-pass.ts";
import { ASSIGNMENT_LOG_FIELDS, clauseObligation } from "./assignment-read.ts";
import {
  assembleAssignmentView,
  assignmentCostSummaryOf,
  assignmentCostTotals,
  assignmentPartOf,
  deriveAssignmentEntriesFromHeads,
  type AssignmentHead,
  type AssignmentHeadEntry,
  type AssignmentSources,
  mergeAssignmentParts,
  pipelineLinked,
  type AssignmentClock,
  type AssignmentCostTotals,
  type AssignmentPart,
  type AssignmentView,
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
import { ownerReadbackItem, type OwnerAssignmentHead, type OwnerAssignmentRow } from "./repository/owner-assignment-rows.ts";
import type { ExpansionScopeDecision } from "./expansion/scopes.ts";
import type { AskGapCode } from "../ask/gap-codes.ts";
import { askGapObligationId } from "./ask-gap-id.ts";
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
const SNAPSHOT_CLOCK_OVERLAP_MS = 120_000;
import { type AggregateRepository, type AppendOnlyRepository, type ChangedRecord, type ControlPlaneRepositories, type Persisted, type RecordProjection } from "./repository/types.ts";
import type { SnapshotStampedRead } from "./repository/pg-store.ts";
import { unitCarriesState } from "./scheduler/dispatch-target.ts";
import { isFundedHunt } from "./scheduler/hunt-continuation.ts";
import type { ServedReaderReadback } from "./served-reader.ts";
import { stateCodeOf } from "./unit-state.ts";
import type { WorkItem } from "./work-item.ts";

/** The national totals row beside the published snapshot in `cp_owner_snapshots`; each state's rows sit beside it. */
export const OWNER_SNAPSHOT_TOTALS_ID = "totals";
const OWNER_SNAPSHOT_TOTALS_FORMAT = 4;
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
  readonly initializing?: boolean;
  readonly initialization?: OwnerSnapshotInitialization;
  readonly ownerWorkListReady?: boolean;
}

/** A log slot already folded, with the database clock it was appended at. */
type Slot = readonly [key: string, position: number, changedAt: string];

/** Where a log fold's next read starts (`through` less the slack) and the slots that read leaves out. */
export interface LogCursor {
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
}

/** One assignment's carried figures beside its published rows. */
export interface GroupTotals {
  readonly members: readonly string[];
  readonly obligation: AssignmentClock | null;
  /** Its work items with a publication outcome, narrowed to what the public readbacks read. */
  readonly publications: readonly WorkItem[];
  /** For a created work item, the obligation its clause names, so the row joins that clock when it appears. */
  readonly clause: string | null;
}

/** One state's running counts and spend by jurisdiction, in `totals:<state>`. */
export interface StateTotals {
  readonly builtAt: string;
  readonly places: Readonly<Record<string, PlaceTotals>>;
  readonly part: StatePart;
  readonly inboxRun?: string;
}

/** What a state adds to the national figures; changed assignments update these counts by subtraction and addition. */
export interface StatePart {
  readonly builtAt: string;
  readonly assignments: AssignmentPart;
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
  /** Counts live in their state's keyed row; the national cursor keeps only its small clock pointer. */
  readonly states: Readonly<Record<string, Pick<StatePart, "builtAt"> | StatePart>>;
  /** A work item joined through a parent (directory or repair), by the parent it names. */
  readonly links: Readonly<Record<string, string>>;
  readonly pipeline: PipelineTotals;
}

/** Rows routed to a state before it is folded. */
export interface StateInbox {
  readonly groups: string[];
  readonly items: string[];
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
async function readLogChanges<T>(log: AppendOnlyRepository<T>, cursor: LogCursor | null, slackMs: number, projection: RecordProjection,
  page: (records: readonly ChangedRecord<T>[]) => Promise<void>): Promise<{ readonly next: LogCursor; readonly folded: (r: ChangedRecord<T>) => boolean }> {
  const since = cursor === null ? null : iso(Date.parse(cursor.through) - slackMs);
  const held = cursor === null ? [] : cursor.held.filter(([, , at]) => Date.parse(at) >= Date.parse(since!));
  let taken: Slot[] = [];
  let newest = Number.NEGATIVE_INFINITY;
  const read = await log.readChangedSince(since, held.map(([key, position]) => [key, position] as const), { projection, page: async (records) => {
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

/** The work items an assignment holds: those on record, and those a round, task, attempt or worker result names. */
export async function heldWorkItems(repos: ControlPlaneRepositories, ids: Iterable<string>): Promise<Set<string>> {
  const out = new Set<string>();
  for (const chunk of chunks(unique(ids), ASSIGNMENT_BATCH)) {
    for (const row of await needs(repos.workItems.readManyNarrowed, "work-item read by id")(chunk, { id: true })) out.add(row.id);
    for (const repo of [repos.occurrences, repos.routeTasks, repos.attempts] as AggregateRepository<unknown>[]) {
      const rest = chunk.filter((id) => !out.has(id));
      if (rest.length === 0) break;
      for (const row of await needs(repo.listWhereIn, "read by work item")(["workItemId"], rest, { workItemId: true })) out.add((row.value as { workItemId: string }).workItemId);
    }
    const rest = chunk.filter((id) => !out.has(id));
    if (rest.length > 0) for (const key of (await repos.workerResults.readLatest(rest, { id: true })).keys()) out.add(key);
  }
  return out;
}


/* ------------------------------------------------------------------ costs */

type CostRefUpdate={readonly replace:boolean;readonly orphans:readonly string[];readonly unassigned:readonly string[]};
const costRefUpdates=new WeakMap<CostTotals,CostRefUpdate>();
const COST_FOLD_FIELDS = { attemptId:true,workItemId:true,routeId:true,role:true,recordedAt:true,source:true,jurisdiction:true,
  model:true,byModel:true,assignmentKeys:true,assignmentRefs:true,
  cost:["usd","requestCount","bytesFetched","durationMs","inputTokens","outputTokens","cacheReadInputTokens","cacheCreationInputTokens",
    "cacheCreation5mInputTokens","cacheCreation1hInputTokens","uncachedInputTokens","batch"] } satisfies RecordProjection;

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
    searches: {}, ahead: [], skewed: [] };
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
  const slackMs = input.slackMs ?? SNAPSHOT_CLOCK_OVERLAP_MS;
  const now = Date.parse(input.nowIso);
  const frame = input.scopes === null && prior !== null ? prior.billing : billingFrame(input.scopes ?? [], input.scopeMembers);
  const carried = input.carried.filter(billed);
  const readWorkers = needs(repos.attempts.readManyNarrowed, "attempt read by id");
  const orphanAttempts = await repos.ownerCostRefs.matching("orphan",[...input.changed.attempts]);
  const unassignedItems = await repos.ownerCostRefs.matching("unassigned",[...input.changed.workItems]);
  const rebuild = prior === null || JSON.stringify(prior.billing) !== JSON.stringify(frame) || now < Date.parse(prior.foldedAt) ||
    carried.some((r) => !(periodKey(r) in prior.windows)) || orphanAttempts.length > 0 ||
    (await heldWorkItems(repos,unassignedItems)).size > 0;
  const t = rebuild ? emptyCosts(frame, carried) : prior;
  t.windows = Object.fromEntries(carried.map((r) => [periodKey(r), t.windows[periodKey(r)]!]));
  const ctx = contextOf(frame);
  const from = rebuild ? now : Date.parse(t.foldedAt);
  const orphans = new Set<string>();
  const unassigned = new Set<string>();
  const placed = rebuild ? foldedBefore(prior?.cursor ?? null, slackMs) : () => false;
  const ahead = t.ahead;
  t.ahead = [];
  for (const charge of ahead) {
    if (Date.parse(charge.entry.recordedAt) <= now) foldUpToClock(t, charge.entry, charge.worker, ctx);
    else t.ahead.push(charge);
  }
  const { next, folded } = await readLogChanges(repos.costs, rebuild ? null : t.cursor, slackMs, COST_FOLD_FIELDS, async (records) => {
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
  const staged=costRefUpdates.get(t);
  costRefUpdates.set(t,{replace:rebuild||staged?.replace===true,
    orphans:unique([...(rebuild?[]:staged?.orphans??[]),...orphans]),unassigned:unique([...(rebuild?[]:staged?.unassigned??[]),...unassigned])});
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
  t.windows = { ...t.windows, ...windows };
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

const emptyInbox = (): StateInbox => ({ groups: [], items: [], places: {} });

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

  resume(states: readonly string[]): void { for (const state of states) this.#spilled.add(state); }

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
  place(state: string, place: string, totals: PlaceTotals): void { mergePlaceTotals(this.#of(state).places[place] ??= placeTotals(), totals); }

  async settle(force=false): Promise<void> {
    if (!this.write || !force && this.#size < this.bound) return;
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
  async take(state: string, retain=false): Promise<StateInbox|null> {
    const local=this.#held.get(state);
    let inbox = local ?? emptyInbox();
    this.#held.delete(state);
    if (this.#spilled.delete(state)) {
      const row = await this.repos.ownerSnapshotInboxes.read(stateInboxId(state));
      if(row?.value.run===this.run)inbox=mergeInbox(row.value,inbox);
      else if(local===undefined)return null;
      if (!retain && row?.value.run === this.run) await this.repos.ownerSnapshotInboxes.compareAndSet(stateInboxId(state), row.revision, { run: "", ...emptyInbox() }, this.nowIso);
    }
    return inbox;
  }

  async ack(state:string):Promise<void>{
    const row=await this.repos.ownerSnapshotInboxes.read(stateInboxId(state));
    if(row?.value.run===this.run)await this.repos.ownerSnapshotInboxes.compareAndSet(stateInboxId(state),row.revision,{run:"",...emptyInbox()},this.nowIso);
  }
}

function mergeInbox(a: StateInbox, b: StateInbox): StateInbox {
  const places: Record<string, PlaceTotals> = structuredClone(a.places);
  for (const [place, totals] of Object.entries(b.places)) mergePlaceTotals(places[place] ??= placeTotals(), totals);
  return { groups: unique([...a.groups, ...b.groups]), items: unique([...a.items, ...b.items]), places };
}

interface Loaded {
  readonly totals: Persisted<StateTotals> | null;
  readonly groups: Set<string>;
  places: Record<string, PlaceTotals>;
  inboxRun?: string;
}


/** Subtract the replaced entries and add their new contributions; every other count stays in its small row. */
export function updateAssignmentPart(prior: AssignmentPart, before: readonly AssignmentPart[], after: readonly AssignmentPart[]): AssignmentPart {
  const out = structuredClone(prior) as { -readonly [K in keyof AssignmentPart]: AssignmentPart[K] };
  const add = (into: Record<string, number>, from: Readonly<Record<string, number>>, sign: number) => {
    for (const [key, n] of Object.entries(from)) { into[key] = (into[key] ?? 0) + sign * n; if (into[key] === 0) delete into[key]; }
  };
  const states = (into: Record<string, Readonly<Record<string, number>>>, from: Record<string, Readonly<Record<string, number>>>, sign: number) => {
    for (const [key, counts] of Object.entries(from)) {
      const target = into[key] = { ...into[key] };
      for (const [state, n] of Object.entries(counts)) (target as Record<string, number>)[state] = (target[state] ?? 0) + sign * n;
      if (Object.values(target).every(n => n === 0)) delete into[key];
    }
  };
  const open = [...out.askGaps.open];
  let askRows = out.askGaps.rows;
  for (const [sign, parts] of [[-1, before], [1, after]] as const) for (const part of parts) {
    out.total += sign * part.total;
    add(out.groups as Record<string, number>, part.groups, sign);
    states(out.geographic, part.geographic, sign);
    states(out.instruction, part.instruction, sign);
    states(out.instructionByReceipt, part.instructionByReceipt, sign);
    for (const key of ["active", "eligible", "overdue", "backoff"] as const) (out.clocks as Record<string, number>)[key] += sign * part.clocks[key];
    askRows += sign * part.askGaps.rows;
    for (const gap of part.askGaps.open) {
      if (sign === 1) open.push(gap);
      else { const index = open.findIndex(row => row.bodyId === gap.bodyId && row.code === gap.code); if (index >= 0) open.splice(index, 1); }
    }
  }
  out.usd = null;
  out.askGaps = { rows: askRows, open };
  return out;
}

/** The segment of an assignment's index row that holds at `at`. */
const segmentAt = (segments: readonly IndexSegment[], at: string): IndexSegment =>
  segments.find((s) => (s.from === null || s.from <= at) && (s.until === null || at < s.until)) ?? segments[segments.length - 1]!;

const narrowPublication = (w: WorkItem): WorkItem => ({ id: w.id, autonomousPlan: w.autonomousPlan && {
  publication: w.autonomousPlan.publication, contract: { recordClass: w.autonomousPlan.contract?.recordClass } },
  publicationOutcome: w.publicationOutcome && { status: w.publicationOutcome.status, versionId: w.publicationOutcome.versionId,
    workerResultId: w.publicationOutcome.workerResultId, acceptedRecordIds: w.publicationOutcome.acceptedRecordIds } } as unknown as WorkItem);

const obligationStateName = (id: string, subjectId: string): string => {
  const hay = `${id} ${subjectId}`.toLowerCase();
  return US_STATES.find((s) => unitCarriesState(hay, s.code))?.name ?? "other";
};

export interface OwnerSnapshotInitialization {
  readonly at:string;
  readonly run:string;
  readonly phase:"states"|"costs"|"finalStates"|"refresh";
  readonly pending:readonly string[];
}

export const readOwnerSnapshotTotals=async(repos:ControlPlaneRepositories)=>await repos.ownerSnapshotTotals.readNarrowed(OWNER_SNAPSHOT_TOTALS_ID,{
  formatVersion:true,costs:true,assignments:true,ownerWorkListReady:true,initializing:true,initialization:true,
}) as Persisted<OwnerSnapshotTotals>|null;
export class OwnerSnapshotFoldPending extends Error {
  readonly code="OWNER_SNAPSHOT_CONTINUATION_PENDING";
  constructor(){super("OWNER_SNAPSHOT_CONTINUATION_PENDING: durable owner work remains for the next publisher attempt");}
}

export interface OwnerSnapshotFoldInput {
  readonly nowIso: string;
  readonly slackMs?: number;
  /** The public readbacks the published rows were derived with. */
  readonly servedReader: ServedReaderReadback | null;
  readonly askGapObservations: AssignmentSources["askGapObservations"];
  readonly scopes: readonly ExpansionScopeDecision[] | null;
  /** The periods of the readings the last snapshot published. */
  readonly carried: readonly ReadingPeriod[];
  /** False for a dry run: no state's rows are written. */
  readonly write: boolean;
  /** Routed rows held in memory before they are written to their states' inboxes. */
  readonly heldRows?: number;
  readonly log: (line: string) => void;
  readonly continuation?: { readonly deadline?:number;readonly maxStates?:number;readonly now?:()=>string;readonly allowInitialization?:boolean };
  /** Preserve each inbox until its rows and national cursor are durable. */
  readonly checkpoint?: {
    readonly run:string;
    readonly maxStates:number;
    readonly canContinue:()=>boolean;
    readonly save:(fold:OwnerSnapshotFold,progress:OwnerSnapshotInitialization|null)=>Promise<void>;
  };
}

/**
 * Fold changes into keyed work-list entries and their running state counts. A changed assignment never loads another assignment's history.
 */
export class OwnerSnapshotFold {
  readonly #repos: ControlPlaneRepositories;
  readonly #input: OwnerSnapshotFoldInput;
  #checkpoint:OwnerSnapshotFoldInput["checkpoint"];
  readonly #ready:boolean;
  #savedRevision:number|null|undefined;
  readonly #slackMs: number;
  readonly #rebuild: boolean;
  readonly #inboxes: Inboxes;
  readonly #priorCosts: CostTotals | null;
  costs!: CostTotals;
  readonly #states: Record<string, StatePart>;
  readonly #stateHeads: string[];
  readonly #links: Record<string, string>;
  #pipeline: PipelineTotals;
  #through: string;
  readonly #cursors: Record<string, LogCursor>;
  /** The states loaded now, and every assignment they hold. */
  readonly #loaded = new Map<string, Loaded>();
  readonly #groups = new Map<string, GroupTotals>();
  readonly #priorRows = new Map<string, OwnerAssignmentHead>();
  readonly #replaced = new Set<string>();
  readonly #stateOfGroup = new Map<string, string>();
  /** Each assignment's index row, segment by segment over the instants the clock alone changes it at. */
  readonly #index = new Map<string, IndexSegment[]>();
  /** States whose rows this publish wrote. */
  readonly #written = new Set<string>();
  /** Attempts changed since the last publish. */
  readonly #changedAttempts = new Set<string>();
  #checkpointStates=0;
  #initialization:OwnerSnapshotInitialization|null=null;
  complete=true;
  get checkpointedStates():number{return this.#checkpointStates;}

  private constructor(repos: ControlPlaneRepositories, prior: OwnerSnapshotTotals | null, input: OwnerSnapshotFoldInput) {
    this.#repos = repos;
    this.#input = input;
    this.#checkpoint=input.checkpoint;
    this.#ready=prior?.ownerWorkListReady??!prior?.initializing;
    this.#slackMs = input.slackMs ?? SNAPSHOT_CLOCK_OVERLAP_MS;
    const a = prior?.formatVersion === OWNER_SNAPSHOT_TOTALS_FORMAT ? prior.assignments : null;
    this.#rebuild = a === null || prior?.costs === null;
    this.#initialization=prior?.initialization??null;
    const run=this.#initialization?.phase==="costs"?`${this.#initialization.run}:final:${crypto.randomUUID()}`:
      this.#initialization?.run??input.checkpoint?.run??`${input.nowIso} ${this.#rebuild ? "rebuild" : "fold"}`;
    this.#inboxes = new Inboxes(repos,input.nowIso,run,input.write,input.heldRows??INBOX_HELD);
    if(this.#initialization)this.#inboxes.resume(this.#initialization.pending);
    this.#priorCosts = this.#rebuild ? null : prior!.costs;
    this.#states = {};
    this.#stateHeads = [];
    if (!this.#rebuild) for (const [state, part] of Object.entries(a!.states)) {
      if ("assignments" in part) this.#states[state] = part;
      else this.#stateHeads.push(state);
    }
    for(const state of this.#initialization?.pending??[])if(!(state in this.#states)&&!this.#stateHeads.includes(state))this.#stateHeads.push(state);
    this.#links = this.#rebuild ? {} : { ...a!.links };
    this.#pipeline = this.#rebuild ? { cursor: { through: iso(0), held: [] }, items: 0, verified: 0, unlinked: {} } : structuredClone(a!.pipeline);
    this.#through = this.#rebuild ? iso(0) : a!.through;
    this.#cursors = this.#rebuild ? {} : structuredClone(a!.cursors ?? {});
  }

  /** Changed inputs are acknowledged durably before their keyed state rows are folded. */
  static async fold(repos:ControlPlaneRepositories,prior:OwnerSnapshotTotals|null,input:OwnerSnapshotFoldInput):Promise<OwnerSnapshotFold>{
    if(prior!==null&&(prior.formatVersion!==OWNER_SNAPSHOT_TOTALS_FORMAT||prior.initializing&&!prior.ownerWorkListReady&&!input.checkpoint&&!input.continuation?.allowInitialization))
      throw new Error("OWNER_WORK_LIST_MIGRATION_REQUIRED: finish the owner work-list contract before publishing counts");
    if(!input.write||input.checkpoint)return new OwnerSnapshotFold(repos,prior,input).#run(prior);
    let saved=await readOwnerSnapshotTotals(repos),value=saved?.value??prior,states=0,refreshed=false;
    const clock=input.continuation?.now??(()=>input.nowIso),canContinue=()=>Date.now()+90_000<(input.continuation?.deadline??passDeadlineFromEnv());
    while(canContinue()){
      const refreshing=value?.initialization?.phase==="refresh",preparing=refreshing||!value?.initialization,now=clock(),previousAt=value?.initialization?.at;
      const at=refreshing&&previousAt?Date.parse(now)>Date.parse(previousAt)?now:previousAt:previousAt??now,before=saved?.revision??0;
      const fold=await new OwnerSnapshotFold(repos,refreshing?{...value!,initialization:undefined}:value,{...input,nowIso:at,
        checkpoint:{run:refreshing?`${at}:refresh:${crypto.randomUUID()}`:value?.initialization?.run??`${at}:fold:${crypto.randomUUID()}`,
          maxStates:(input.continuation?.maxStates??Infinity)-states,canContinue,save:async(fold,progress)=>{
            if(progress===null&&!refreshed){const current=clock();progress={at:Date.parse(current)>Date.parse(at)?current:at,
              run:`${current}:refresh:${crypto.randomUUID()}`,phase:"refresh",pending:[]};}
            await fold.saveTotals(saved,progress);saved=await readOwnerSnapshotTotals(repos);
            if(!saved)throw new Error("Owner fold lost its national counts row");value=saved.value;
            input.log(`owner fold: ${progress?.phase??"complete"}; ${progress?.pending.length??0} states remain`);
          }}}).#run(value);
      states+=fold.checkpointedStates;if(preparing)refreshed=true;
      if(saved?.value.ownerWorkListReady&&!saved.value.initializing){fold.#checkpoint=undefined;fold.#savedRevision=saved.revision;return fold;}
      if((saved?.revision??0)===before)break;
    }
    throw new OwnerSnapshotFoldPending();
  }

  async #run(prior: OwnerSnapshotTotals | null): Promise<this> {
    if (this.#stateHeads.length) {
      const rows = await needs(this.#repos.ownerSnapshotStateTotals.readManyNarrowed,"state count rows by key")(
        this.#stateHeads.map(stateTotalsId),{part:true});
      const found = new Map(rows.map(row => [row.id,(row.value as Pick<StateTotals,"part">).part]));
      for (const state of this.#stateHeads) {
        const part = found.get(stateTotalsId(state));
        if(!part?.assignments){
          if(this.#initialization?.pending.includes(state)&&!(state in (prior?.assignments?.states??{})))continue;
          throw new Error(`OWNER_STATE_COUNTS_MISSING: ${state}`);
        }
        this.#states[state] = part;
      }
    }
    const checkpoint=this.#checkpoint;
    const costs=async(prior:CostTotals|null,changed:ReadonlySet<string>=new Set<string>())=>foldCosts(this.#repos,prior,{
      nowIso:this.#input.nowIso,slackMs:this.#slackMs,scopes:this.#input.scopes,scopeMembers:await this.#scopeMembers(),carried:this.#input.carried,
      changed:{attempts:this.#changedAttempts,workItems:changed},places:charges=>this.#place(charges)});
    if(checkpoint&&this.#initialization){
      this.costs=structuredClone(this.#priorCosts!);
      if(this.#initialization.phase==="costs"){
        // Recheck the billing frame after every changed state is durable.
        this.#inboxes.resume([]);
        this.costs=await costs(this.costs);
        await this.#inboxes.settle(true);
        this.#initialization={at:this.#initialization.at,run:this.#inboxes.run,phase:"finalStates",pending:this.#inboxes.states()};
        await checkpoint.save(this,this.#initialization);
        this.complete=false;return this;
      }
      if(!await this.#drain())return this;
      if(this.#initialization.phase==="states"&&JSON.stringify(this.costs.billing)!==JSON.stringify(
        this.#input.scopes===null?this.costs.billing:billingFrame(this.#input.scopes,await this.#scopeMembers()))){
        this.#initialization={at:this.#initialization.at,run:this.#initialization.run,phase:"costs",pending:[]};
        await checkpoint.save(this,this.#initialization);this.complete=false;return this;
      }
      this.#initialization=null;await checkpoint.save(this,null);return this;
    }
    if (this.#rebuild && this.#input.write) await this.#repos.ownerAssignmentRows.clear();
    const changed = await this.#routeChanges(this.#rebuild?null:this.#through);
    if (this.#rebuild) {
      for (const state of Object.keys(prior?.formatVersion === OWNER_SNAPSHOT_TOTALS_FORMAT ? prior.assignments?.states ?? {} : {})) this.#inboxes.touch(state);
    }
    this.costs=await costs(this.#priorCosts,changed);
    if(!this.#rebuild){
      await this.#loadRows(await this.#repos.ownerAssignmentRows.find({dueAt:this.#input.nowIso}));
      for (const [id,row] of this.#priorRows) this.#inboxes.group(row.state,id);
    }
    if(checkpoint){
      await this.#foldPipeline(this.#rebuild);
      await this.#inboxes.settle(true);
      this.#initialization={at:this.#input.nowIso,run:checkpoint.run,phase:"states",pending:this.#inboxes.states()};
      await checkpoint.save(this,this.#initialization);
      // Preparation is durable; the migration driver may continue while its deadline permits.
      this.complete=false;return this;
    }
    await this.#drain();
    this.costs=await costs(this.costs,changed);await this.#drain();
    await this.#foldPipeline(this.#rebuild);
    return this;
  }

  async #scopeMembers(): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
    const scopes = (this.#input.scopes ?? []).filter(isFundedHunt);
    const held = await this.#repos.ownerAssignmentRows.scopeMembers(scopes.map(scope => ({key:scope.key,ref:scope.receiptId})));
    return new Map(scopes.map(scope => [scope.key,new Set(held.get(`${scope.key}\n${scope.receiptId}`) ?? [])]));
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

  /** The national view from every state's part, as of each state's last fold. */
  async view(input: Omit<Parameters<typeof assembleAssignmentView>[0], "nowIso" | "part" | "lists" | "totals">): Promise<AssignmentView> {
    const pipeline = this.pipeline;
    const {geographicCounts:_geography,instructionCounts:_instructions,instructionCountsByReceipt:_receipts,...counts} = assembleAssignmentView({ ...input, nowIso: this.#input.nowIso,
      part: mergeAssignmentParts(Object.values(this.#states).map(state => state.assignments),this.#input.nowIso), lists: () => undefined,
      totals: { costs: assignmentCostSummaryOf(this.costs.assignments), pipeline: { items: pipeline.items, linked: pipeline.linked },
        askGapObservations: this.#input.askGapObservations } });
    return counts;
  }

  async saveTotals(prior:Persisted<OwnerSnapshotTotals>|null,initialization:OwnerSnapshotInitialization|null=null):Promise<void>{
    const value:OwnerSnapshotTotals={...this.totals(),...(initialization?{initializing:true,initialization,ownerWorkListReady:this.#ready}:{ownerWorkListReady:true})};
    const expectedRevision=this.#savedRevision===undefined?prior?.revision??null:this.#savedRevision;
    await this.#repos.ownerCostRefs.persist({expectedRevision,value,now:this.#input.nowIso},costRefUpdates.get(this.costs)??null);
    this.#savedRevision=(expectedRevision??0)+1;
    costRefUpdates.delete(this.costs);
  }

  totals(): OwnerSnapshotTotals {
    return { formatVersion: OWNER_SNAPSHOT_TOTALS_FORMAT, costs: this.costs, assignments: { through: this.#through, cursors: this.#cursors,
      states: Object.fromEntries(Object.entries(this.#states).map(([state,part])=>[state,{builtAt:part.builtAt}])),
      links: this.#links, pipeline: this.#pipeline } };
  }

  /* ---------------------------------------------------------- routing */

  /** Each work item to the state whose rows hold it. */
  async #routeItems(ids: Iterable<string>): Promise<void> {
    const pending = unique(ids);
    const rows = new Map<string, WorkItem>();
    for (const chunk of chunks(pending, ASSIGNMENT_BATCH)) {
      for (const row of await needs(this.#repos.workItems.readManyNarrowed, "work-item read by id")(chunk, { id: true, obligation: true, subject: true })) {
        rows.set(row.id, row.value as WorkItem);
      }
    }
    for (const id of pending) this.#inboxes.item(homeOf(id, rows.get(id)), id);
    await this.#inboxes.settle();
  }

  /** Source changes are deduplicated and joined to the work list beside their rows. */
  async #routeChanges(through:string|null):Promise<Set<string>>{
    const changes=await this.#repos.ownerAssignmentChanges.read({through,cursors:this.#cursors,slackMs:this.#slackMs});
    for(const group of changes.groups)this.#inboxes.group(group.state,group.id);
    const parents=new Set(changes.links.map(row=>row.id));
    await this.#routeItems(Object.entries(this.#links).filter(([,parent])=>parents.has(parent)).map(([child])=>child).concat(changes.items));
    for(const row of changes.links){if(row.parent)this.#links[row.id]=row.parent;else delete this.#links[row.id];}
    for(const id of changes.changedAttempts)this.#changedAttempts.add(id);
    for(const name of Object.keys(this.#cursors))delete this.#cursors[name];
    Object.assign(this.#cursors,changes.cursors);this.#through=changes.through;
    return new Set(changes.changedWorkItems);
  }

  /* ----------------------------------------------------------- states */

  /** Folds every state with rows routed to it, one at a time, until none is left. */
  async #drain(): Promise<boolean> {
    for (let states = this.#inboxes.states(); states.length > 0; states = this.#inboxes.states()) {
      for (const state of states) {
        const checkpoint=this.#checkpoint;
        if(checkpoint&&(this.#checkpointStates>=checkpoint.maxStates||!checkpoint.canContinue())){this.complete=false;return false;}
        const inbox=await this.#inboxes.take(state,!!checkpoint);
        if(inbox===null)continue;
        await this.#load(state);
        const loaded = this.#loaded.get(state)!;
        if(!checkpoint||loaded.inboxRun!==this.#inboxes.run){
          for(const[place,totals]of Object.entries(inbox.places))mergePlaceTotals(loaded.places[place]??=placeTotals(),totals);
          if(checkpoint)loaded.inboxRun=this.#inboxes.run;
        }
        const targets=unique([...inbox.groups,...await this.#repos.ownerAssignmentRows.find({members:inbox.items,clauses:inbox.groups})]);
        await this.#derive(targets,[]);
        const owned=new Set([...this.#groups.values()].flatMap(group=>group.members)),probes=inbox.items.filter(id=>!owned.has(id));
        await this.#derive([],probes);
        this.#input.log(`assignments: ${state} folded — ${targets.length} derived again, ${probes.length} work item(s) no assignment held`);
        await this.#emit();
        if(checkpoint){
          this.#checkpointStates+=1;
          this.#initialization={...this.#initialization!,pending:this.#inboxes.states()};
          await this.#inboxes.ack(state);
        }
      }
    }
    return true;
  }

  async #load(state: string): Promise<void> {
    if (this.#loaded.has(state)) return;
    const totals = await this.#repos.ownerSnapshotStateTotals.readNarrowed(stateTotalsId(state), { builtAt: true, places: true, part: true, inboxRun:true }) as Persisted<StateTotals> | null;
    const carried = !this.#rebuild || this.#written.has(state);
    if (carried && totals?.value.part) this.#states[state] = totals.value.part;
    this.#loaded.set(state, { totals, groups: new Set(), places: carried ? structuredClone(totals?.value.places ?? {}) : {},inboxRun:totals?.value.inboxRun });
  }

  async #loadRows(ids: readonly string[]): Promise<void> {
    for (const row of await this.#repos.ownerAssignmentRows.heads(unique(ids).filter(id => !this.#priorRows.has(id)))) {
      await this.#load(row.state);
      this.#priorRows.set(row.id,row);
      this.#setGroup(row.state,row.id,{members:row.members,clause:row.clause,obligation:null,publications:[]});
    }
  }

  /** Only replaced assignments contribute a subtraction; their counts are summed beside their rows. */
  async #emit(): Promise<void> {
    const now=this.#input.nowIso,saved:OwnerAssignmentRow[]=[];
    const before=await this.#repos.ownerAssignmentRows.contributions([...this.#replaced]);
    const removed=[...this.#replaced].filter(id=>!this.#groups.has(id));
    for(const [state,loaded]of this.#loaded){
      const after=[...loaded.groups].sort().filter(id=>this.#index.has(id)).map(id=>{
        const group=this.#groups.get(id)!,indexSegments=this.#index.get(id)!;
        const entry={...group,usd:null,index:segmentAt(indexSegments,now)};
        const part={...assignmentPartOf([[id,entry]],now),candidates:[]};
        const row:OwnerAssignmentRow={id,state,builtAt:now,group,indexSegments,part,
          nextAt:indexSegments.map(segment=>segment.until).filter((at):at is string=>at!==null&&at>now).sort()[0]??null};
        saved.push(row);return row;
      });
      const previous=this.#states[state],prior=before.get(state),obligations={...previous?.obligations};
      const mark=(id:string,subject:string,sign:number)=>{const name=obligationStateName(id,subject);obligations[name]=(obligations[name]??0)+sign;if(!obligations[name])delete obligations[name];};
      for(const row of this.#priorRows.values())if(row.state===state&&this.#replaced.has(row.id)&&row.subjectId!==null)mark(row.id,row.subjectId,-1);
      for(const row of after)if(row.group.obligation)mark(row.id,row.group.obligation.subjectId,1);
      this.#states[state]={builtAt:now,assignments:{...updateAssignmentPart(previous?.assignments??assignmentPartOf([],now),prior?[prior]:[],after.map(row=>row.part)),candidates:[]},
        obligations,spend:placeSumOf(loaded.places)};
    }
    if(this.#input.write){
      await this.#repos.ownerAssignmentRows.save(saved,removed,[...this.#loaded].map(([state,loaded])=>({id:stateTotalsId(state),expectedRevision:loaded.totals?.revision??null,
        value:{builtAt:now,places:loaded.places,part:this.#states[state]!,...(loaded.inboxRun?{inboxRun:loaded.inboxRun}:{})}})),[...this.#priorRows.values()]);
      for(const state of this.#loaded.keys())this.#written.add(state);
    }
    this.#unload();
  }

  #unload(): void {
    this.#loaded.clear();
    this.#groups.clear();
    this.#priorRows.clear();
    this.#stateOfGroup.clear();
    this.#index.clear();
    this.#replaced.clear();
  }

  #setGroup(state: string, id: string, g: GroupTotals): void {
    this.#groups.set(id, g);
    this.#stateOfGroup.set(id, state);
    this.#loaded.get(state)!.groups.add(id);
  }

  #dropGroup(id: string): void {
    this.#replaced.add(id);
    const state = this.#stateOfGroup.get(id);
    if (state !== undefined) this.#loaded.get(state)?.groups.delete(id);
    this.#groups.delete(id);
    this.#stateOfGroup.delete(id);
    this.#index.delete(id);
  }

  /* --------------------------------------------------------- deriving */

  /** Membership settles using current heads; old history never crosses the database connection. */
  async #derive(targets:readonly string[],probes:readonly string[]):Promise<void>{
    for(const batch of chunks(unique(targets),ASSIGNMENT_BATCH))await this.#deriveBatch(batch,[]);
    for(const batch of chunks(unique(probes),ASSIGNMENT_BATCH))await this.#deriveBatch([],batch);
  }

  async #deriveBatch(targets:readonly string[],probes:readonly string[]):Promise<void>{
    const ids=new Set(targets);
    await this.#loadRows(targets);
    const owners=await this.#repos.ownerAssignmentRows.find({members:probes});
    await this.#loadRows(owners);for(const id of owners)ids.add(id);
    for(let round=0;;round++){
      if(round>16)throw new Error(`assignment membership did not settle for ${[...ids].slice(0,5).join(", ")}`);
      const src=await this.#repos.ownerAssignmentHeads.read({groups:[...ids],workItems:probes},this.#input.nowIso);
      const derived=deriveAssignmentEntriesFromHeads(src.heads,this.#input.nowIso);
      const produced=new Map([...derived].map(([id,entry])=>[id,{...entry,members:src.members.get(id)??[]}]));
      const items=new Map(src.workItems.map(w=>[w.id,w]));
      const stateOfEntry=(id:string,entry:{index:{kind:string}})=>entry.index.kind==="WORK_ITEM"?homeOf(id,items.get(id)):stateOf(id);
      const owners=await this.#repos.ownerAssignmentRows.find({members:unique([...src.members.values()].flat())});
      await this.#loadRows(unique([...owners,...produced.keys()]));
      const added=unique([...owners,...produced.keys()]).filter(id=>!ids.has(id));
      if(added.length){for(const id of added)ids.add(id);continue;}
      for(const[id,entry]of produced)await this.#load(stateOfEntry(id,entry));
      for(const id of ids)this.#dropGroup(id);
      const heads=new Map(src.heads.map(head=>[head.id,head]));
      for(const id of ids){
        const entry=produced.get(id);if(!entry)continue;
        const state=stateOfEntry(id,entry),own=entry.members.flatMap(member=>items.get(member)?[items.get(member)!]:[]);
        this.#setGroup(state,id,{members:entry.members,obligation:entry.obligation,
          publications:own.filter(ownerReadbackItem).map(narrowPublication),clause:entry.index.kind==="WORK_ITEM"?clauseObligation(items.get(id)?.obligation??""):null});
        this.#index.set(id,this.#segments(heads.get(id)!));
      }
      return;
    }
  }

  /** Future clock changes reuse the small current outcome, while expiry itself rechecks the lease head. */
  #segments(head:AssignmentHead):IndexSegment[]{
    const out:IndexSegment[]=[];
    for(let at:string|null=this.#input.nowIso;at!==null;){
      if(out.length>64)throw new Error(`assignment ${head.id} names more than 64 instants its row changes at`);
      const entry:AssignmentHeadEntry=deriveAssignmentEntriesFromHeads([head],at).get(head.id)!;
      const last=out[out.length-1];
      if(last){const{from:_from,until:_until,...held}=last;if(JSON.stringify(held)===JSON.stringify(entry.index))out[out.length-1]={...last,until:entry.horizon};
        else out.push({...entry.index,from:at,until:entry.horizon});}
      else out.push({...entry.index,from:null,until:entry.horizon});
      if(entry.horizon!==null&&entry.horizon<=at)throw new Error(`assignment ${head.id} names ${entry.horizon} after ${at}`);
      at=entry.horizon;
    }
    return out;
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
    const { next } = await readLogChanges(log, whole ? null : t.cursor, this.#slackMs, ASSIGNMENT_LOG_FIELDS.promotionPipeline, async (records) => {
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
      const held = await needs(log.readKeys, "projected pipeline read")(keys, ASSIGNMENT_LOG_FIELDS.promotionPipeline);
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
