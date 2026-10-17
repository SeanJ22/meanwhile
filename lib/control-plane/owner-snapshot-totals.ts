import { clauseObligation, readAssignmentSubset, type AssignmentSubsetBase } from "./assignment-read.ts";
import {
  assignmentCandidates,
  assignmentCostTotals,
  deriveAssignmentEntries,
  pipelineLinked,
  type AssignmentClock,
  type AssignmentCostTotals,
  type AssignmentEntry,
  type AssignmentIndexRow,
  type AssignmentListRow,
  type AssignmentView,
  type BodyPublicationAttempt,
  foldAssignmentCost,
} from "./assignment-view.ts";
import { addMeasured, measuredSum, subtractMeasured, utcMonthWindow, type CostEntry, type MeasuredSum } from "./cost.ts";
import { SPEND_BY_DAY_MS, costLedgerTotals, foldCostLedger, foldCostMonth, foldSpendDay, utcMonthOf, type CostLedgerTotals, type DayTotals } from "./cost-panel.ts";
import type { ExactSum } from "./exact-sum.ts";
import type { ExpansionScopeDecision } from "./expansion/scopes.ts";
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
import { countsAsScoutAttempt } from "./research-metrics.ts";
import { INCREMENTAL_READS_SLACK_MS } from "./repository/incremental-reads.ts";
import { readByKeys, type AggregateRepository, type AppendOnlyRepository, type ChangedRecord, type ControlPlaneRepositories, type RecordProjection } from "./repository/types.ts";
import { isFundedHunt } from "./scheduler/hunt-continuation.ts";
import { servedWitness, type ServedReaderReadback } from "./served-reader.ts";
import type { WorkItem } from "./work-item.ts";

/** The totals row beside the published snapshot in `cp_owner_snapshots`. */
export const OWNER_SNAPSHOT_TOTALS_ID = "totals";
export const OWNER_SNAPSHOT_TOTALS_FORMAT = 1;

/** A charge whose stamp and whose row's `recorded_at` differ by more than this is carried by itself for the windows. */
const STAMP_MARGIN_MS = 10 * 60_000;
/** Longer than any whole read of a log takes. */
const WHOLE_READ_MS = 3_600_000;
/** Assignments read and derived together; their records are all a batch holds. */
const ASSIGNMENT_BATCH = 250;
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
  readonly horizon: string | null;
  readonly items: readonly string[];
  /** The Scout-result log keys its work items and attempts are recorded under. */
  readonly scoutKeys: readonly string[];
  readonly obligation: AssignmentClock | null;
  /** Its work items with a publication outcome, narrowed to what the public readbacks read. */
  readonly publications: readonly WorkItem[];
  /** For a created work item, the obligation its clause names, so the row joins that clock when it appears. */
  readonly clause: string | null;
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
  /** The snapshot whose published rows these totals pair with. */
  readonly publishedAt: string;
  readonly groups: Record<string, GroupTotals>;
  /** A work item joined through a parent (directory or repair), by the parent it names. */
  readonly links: Record<string, string>;
  /** A work item's upstream work items, for each one that waits on others. */
  readonly dependencies: Record<string, readonly string[]>;
  readonly pipeline: PipelineTotals;
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

/** An aggregate's rows changed since `since`, narrowed, page by page; answers the clock the read began at. */
async function eachChanged<R>(repo: AggregateRepository<unknown>, since: string | null, projection: RecordProjection, page: (rows: readonly R[]) => void | Promise<void>): Promise<string> {
  const read = await needs(repo.listChangedSince, "changed-since read")(since, [], { projection, page: (rows) => page(rows.map((row) => row.value as R)) });
  return read.through ?? iso(Date.now());
}

async function eachLogChanged<R>(log: AppendOnlyRepository<unknown>, since: string | null, projection: RecordProjection, page: (records: readonly ChangedRecord<R>[]) => void | Promise<void>): Promise<string> {
  const read = await log.readChangedSince(since, [], { projection, page: (records) => page(records as readonly ChangedRecord<R>[]) });
  return read.through ?? iso(Date.now());
}

type Refs = Map<string, Set<string>>;
const addRef = (refs: Refs, ref: string | null | undefined, key: string) => { if (ref) refs.set(ref, (refs.get(ref) ?? new Set()).add(key)); };
const lookup = (refs: Refs, ...ids: readonly (readonly string[])[]): string[] => unique(ids.flat().flatMap((id) => [...(refs.get(id) ?? [])]));
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

export interface CostFoldInput {
  readonly nowIso: string;
  readonly slackMs?: number;
  /** Whether an assignment holds a work item. */
  readonly assigned: (workItemId: string) => boolean;
  /** The current hunts, or null when they could not be read: the last frame then stands. */
  readonly scopes: readonly ExpansionScopeDecision[] | null;
  readonly scopeMembers: ReadonlyMap<string, ReadonlySet<string>>;
  /** The periods of the readings the last snapshot published, which this publish may carry forward. */
  readonly carried: readonly ReadingPeriod[];
  /** Attempts changed since the last publish. */
  readonly changedAttempts: ReadonlySet<string>;
}

/** The ledger's totals with every charge appended since `prior` folded in; when a folded charge's context has changed (its Attempt
 * or work item appearing, the hunts or their members changing) the whole ledger is refolded page by page, as on a first publish. */
export async function foldCosts(repos: ControlPlaneRepositories, prior: CostTotals | null, input: CostFoldInput): Promise<CostTotals> {
  const slackMs = input.slackMs ?? INCREMENTAL_READS_SLACK_MS;
  const now = Date.parse(input.nowIso);
  const frame = input.scopes === null && prior !== null ? prior.billing : billingFrame(input.scopes ?? [], input.scopeMembers);
  const carried = input.carried.filter(billed);
  const rebuild = prior === null || JSON.stringify(prior.billing) !== JSON.stringify(frame) || now < Date.parse(prior.foldedAt) ||
    prior.orphans.some((id) => input.changedAttempts.has(id)) || prior.unassigned.some(input.assigned) ||
    carried.some((r) => !(periodKey(r) in prior.windows));
  const t = rebuild ? emptyCosts(frame, carried) : prior;
  t.windows = Object.fromEntries(carried.map((r) => [periodKey(r), t.windows[periodKey(r)]!]));
  const ctx = contextOf(frame);
  const from = rebuild ? now : Date.parse(t.foldedAt);
  const orphans = new Set(t.orphans);
  const unassigned = new Set(t.unassigned);
  const ahead = t.ahead;
  t.ahead = [];
  for (const charge of ahead) {
    if (Date.parse(charge.entry.recordedAt) <= now) foldUpToClock(t, charge.entry, charge.worker, ctx);
    else t.ahead.push(charge);
  }
  const readWorkers = needs(repos.attempts.readManyNarrowed, "attempt read by id");
  const { next, folded } = await readLogChanges(repos.costs, rebuild ? null : t.cursor, slackMs, async (records) => {
    const workers = new Map((await readWorkers(unique(records.map((r) => r.record.attemptId)), { id: true, worker: ["version", "provider"] }))
      .map((row) => [row.id, (row.value as { worker: WorkerRef }).worker] as const));
    for (const r of records) {
      const e = r.record;
      const worker = workers.get(e.attemptId) ?? null;
      if (worker === null) orphans.add(e.attemptId);
      const assigned = input.assigned(e.workItemId);
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
  });
  if (now > from) {
    /* Charges leave the fortnight and the day as the clock moves; a charge folded this publish was folded against `from`. */
    const skewed = new Set(t.skewed.map((c) => slotKey(c.key, c.position)));
    const leave = async (lo: number, hi: number, out: (e: Pick<CostEntry, "recordedAt" | "cost" | "role" | "routeId">) => void) => {
      await needs(repos.costs.readStampedBetween, "read by stamp")(iso(lo - STAMP_MARGIN_MS), iso(hi + STAMP_MARGIN_MS), (records) => {
        for (const r of records) {
          const at = Date.parse(r.record.recordedAt);
          if (at >= lo && at < hi && folded(r) && !skewed.has(slotKey(r.key, r.position))) out(r.record);
        }
      });
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

/* ------------------------------------------------------------ assignments */

const CHANGE_PROJECTIONS = {
  workItem: { id: true, obligation: true, directoryParent: true, planRepair: true, dependencies: true },
  byWorkItem: { workItemId: true },
} satisfies Record<string, RecordProjection>;

const narrowPublication = (w: WorkItem): WorkItem => ({ id: w.id, autonomousPlan: w.autonomousPlan && {
  publication: w.autonomousPlan.publication, contract: { recordClass: w.autonomousPlan.contract?.recordClass } },
  publicationOutcome: w.publicationOutcome && { status: w.publicationOutcome.status, versionId: w.publicationOutcome.versionId,
    workerResultId: w.publicationOutcome.workerResultId, acceptedRecordIds: w.publicationOutcome.acceptedRecordIds } } as unknown as WorkItem);

export interface AssignmentFoldInput {
  readonly nowIso: string;
  readonly slackMs?: number;
  /** The public readbacks the published rows were derived with. */
  readonly servedReader: ServedReaderReadback | null;
  readonly askGapObservations: AssignmentSubsetBase["askGapObservations"];
  readonly log: (line: string) => void;
}

/** The assignments as this publish holds them: the carried totals joined to the published rows. */
export class AssignmentFold {
  readonly #repos: ControlPlaneRepositories;
  readonly #input: AssignmentFoldInput;
  #servedReader: ServedReaderReadback | null;
  readonly #groups = new Map<string, GroupTotals>();
  readonly #index = new Map<string, AssignmentIndexRow>();
  readonly #lists = new Map<string, AssignmentListRow>();
  readonly #bodies = new Map<string, readonly BodyPublicationAttempt[]>();
  readonly #groupOf = new Map<string, string>();
  #links: Record<string, string> = {};
  /** Scout-result log keys and pipeline items by the work item or attempt they name. */
  readonly #scouts: Refs = new Map();
  readonly #pipelineItems: Refs = new Map();
  #dependencies: Record<string, readonly string[]> = {};
  #pipeline: PipelineTotals = { cursor: { through: iso(0), held: [] }, items: 0, verified: 0, unlinked: {} };
  #through = iso(0);
  /** False while every assignment is derived from scratch: only the ranked candidates' list rows are kept, and they are derived last. */
  #keepLists = true;
  /** Attempts changed since the last publish. */
  readonly changedAttempts = new Set<string>();

  private constructor(repos: ControlPlaneRepositories, input: AssignmentFoldInput) {
    this.#repos = repos;
    this.#input = input;
    this.#servedReader = input.servedReader;
  }

  /** The assignments with every row changed since `prior` folded in; with no usable prior, every assignment is derived batch by batch. */
  static async fold(repos: ControlPlaneRepositories, prior: AssignmentTotals | null, published: AssignmentView | null, input: AssignmentFoldInput): Promise<AssignmentFold> {
    const fold = new AssignmentFold(repos, input);
    const usable = prior !== null && published !== null && prior.publishedAt === published.builtAt && published.allRowsIndex !== undefined &&
      published.allRowsIndex.length === Object.keys(prior.groups).length && published.allRowsIndex.every((row) => row.id in prior.groups);
    if (usable) await fold.#carry(prior, published);
    else await fold.#rebuild();
    return fold;
  }

  get askGapObservations(): AssignmentSubsetBase["askGapObservations"] { return this.#input.askGapObservations; }

  /** Whether an assignment holds the work item. */
  readonly assigned = (workItemId: string): boolean => this.#groupOf.has(workItemId);

  /** Every standing obligation's clock, with its id. */
  clocks(): { readonly id: string; readonly clock: AssignmentClock }[] {
    return [...this.#groups.entries()].flatMap(([id, g]) => (g.obligation === null ? [] : [{ id, clock: g.obligation }]));
  }

  /** Every work item with a publication outcome, as the public readbacks read it. */
  publications(): WorkItem[] {
    return [...this.#groups.values()].flatMap((g) => g.publications);
  }

  get pipeline(): { readonly items: number; readonly linked: number; readonly verified: number } {
    return { items: this.#pipeline.items, linked: this.#pipeline.items - Object.keys(this.#pipeline.unlinked).length, verified: this.#pipeline.verified };
  }

  entries(): Map<string, AssignmentEntry> {
    return new Map([...this.#groups.entries()].map(([id, g]) => [id, { ...g, index: this.#index.get(id)!, list: this.#lists.get(id),
      bodyAttempts: this.#bodies.get(id) ?? [] }]));
  }

  /** Re-derives the assignments whose public readback changed between the carried readback and `next`. */
  async readBack(next: ServedReaderReadback | null): Promise<void> {
    const previous = this.#servedReader;
    this.#servedReader = next;
    const valid = (read: ServedReaderReadback | null) => new Set((read?.witnesses ?? [])
      .filter((w) => servedWitness(read, w.itemId, w.approvalId, this.#input.nowIso) !== null).map((w) => `${w.itemId}\n${w.approvalId}`));
    const before = valid(previous);
    const after = valid(next);
    const items = new Set([...before].filter((k) => !after.has(k)).concat([...after].filter((k) => !before.has(k))).map((k) => k.split("\n")[0]!));
    if (items.size === 0) return;
    const byItem = new Map<string, string>();
    for (const [id, g] of this.#groups) for (const item of g.items) byItem.set(item, id);
    await this.#derive(unique([...items].map((item) => byItem.get(item) ?? this.#groupOf.get(item))), []);
  }

  /** Derives the ranked candidates the published list needs and does not carry yet. */
  async fillCandidates(perGroup?: number): Promise<void> {
    const wanted = assignmentCandidates(this.entries(), this.#input.nowIso, perGroup).flat().filter((id) => !this.#lists.has(id));
    await this.#derive(wanted, []);
  }

  /** Keeps a list row only for the assignments the view published. */
  keepPublished(view: AssignmentView): void {
    const kept = new Set(view.rows.map((r) => r.id));
    for (const id of [...this.#lists.keys()]) if (!kept.has(id)) this.#lists.delete(id);
  }

  totals(publishedAt: string): AssignmentTotals {
    return { through: this.#through, publishedAt, groups: Object.fromEntries(this.#groups), links: this.#links, dependencies: this.#dependencies,
      pipeline: this.#pipeline };
  }

  #base(): AssignmentSubsetBase {
    return { nowIso: this.#input.nowIso, activation: null, pilotZips: [], servedReader: this.#servedReader,
      askGapObservations: this.#input.askGapObservations, pipeline: true };
  }

  async #carry(prior: AssignmentTotals, published: AssignmentView): Promise<void> {
    for (const [id, g] of Object.entries(prior.groups)) this.#setGroup(id, g);
    for (const row of published.allRowsIndex ?? []) this.#index.set(row.id, row);
    for (const row of published.rows) this.#lists.set(row.id, row);
    const bodies = new Map<string, BodyPublicationAttempt[]>();
    for (const body of published.bodyAttempts ?? []) {
      const id = this.#groupOf.get(body.workItemId);
      if (id !== undefined) bodies.set(id, [...(bodies.get(id) ?? []), body]);
    }
    for (const [id, list] of bodies) this.#bodies.set(id, list);
    this.#links = { ...prior.links };
    this.#dependencies = { ...prior.dependencies };
    this.#pipeline = structuredClone(prior.pipeline);
    const touched = await this.#readChanges(iso(Date.parse(prior.through) - (this.#input.slackMs ?? INCREMENTAL_READS_SLACK_MS)));
    for (const [id, g] of this.#groups) if (g.horizon !== null && Date.parse(g.horizon) <= Date.parse(this.#input.nowIso)) touched.groups.add(id);
    this.#input.log(`assignments: ${touched.groups.size} touched by changed rows or the clock, ${touched.probes.size} new work item(s)`);
    await this.#derive([...touched.groups], [...touched.probes]);
    await this.#foldPipeline(false);
  }

  async #rebuild(): Promise<void> {
    const repos = this.#repos;
    this.#keepLists = false;
    const throughs: string[] = [];
    /* Links and dependencies first, so each batch reads its parents and dependency neighbours. */
    throughs.push(await eachChanged<WorkItem>(repos.workItems, null, CHANGE_PROJECTIONS.workItem, (rows) => { for (const w of rows) this.#noteWorkItem(w); }));
    throughs.push(await eachLogChanged<{ workItemId: string; attemptId: string }>(repos.scoutResults as AppendOnlyRepository<unknown>, null, { workItemId: true, attemptId: true },
      (records) => { for (const r of records) { addRef(this.#scouts, r.record.workItemId, r.key); addRef(this.#scouts, r.record.attemptId, r.key); } }));
    throughs.push(await eachLogChanged<PipelineSource>(repos.promotionPipeline as AppendOnlyRepository<unknown>, null, { source: true },
      (records) => { for (const r of records) { addRef(this.#pipelineItems, r.record.source?.workItemId, r.key); addRef(this.#pipelineItems, r.record.source?.attemptId, r.key); } }));
    let batch: string[] = [];
    let done = 0;
    const flush = async () => {
      await this.#derive(batch, []);
      done += batch.length;
      batch = [];
      this.#input.log(`assignments: ${done} standing obligations derived`);
    };
    throughs.push(await eachChanged<{ id: string }>(repos.obligations, null, { id: true }, async (rows) => {
      batch.push(...rows.map((o) => o.id));
      if (batch.length >= ASSIGNMENT_BATCH) await flush();
    }));
    if (batch.length > 0) await flush();
    const orphans = new Set<string>();
    const note = (ids: Iterable<string>) => { for (const id of ids) if (!this.#groupOf.has(id)) orphans.add(id); };
    throughs.push(await eachChanged<{ id: string }>(repos.workItems, null, { id: true }, (rows) => note(rows.map((w) => w.id))));
    for (const repo of [repos.routeTasks, repos.attempts, repos.occurrences] as AggregateRepository<unknown>[]) {
      throughs.push(await eachChanged<{ workItemId: string }>(repo, null, CHANGE_PROJECTIONS.byWorkItem, (rows) => note(rows.map((r) => r.workItemId))));
    }
    throughs.push(await eachLogChanged<{ workItemId: string }>(repos.workerResults as AppendOnlyRepository<unknown>, null, CHANGE_PROJECTIONS.byWorkItem, (rows) => note(rows.map((r) => r.record.workItemId))));
    for (const batch of chunks([...orphans].sort(), ASSIGNMENT_BATCH)) await this.#derive([], batch);
    this.#keepLists = true;
    this.#input.log(`assignments: ${this.#groups.size} derived from scratch (${orphans.size} without a standing obligation)`);
    this.#through = throughs.sort()[0]!;
    await this.#foldPipeline(true);
  }

  #noteWorkItem(w: Pick<WorkItem, "id" | "directoryParent" | "dependencies"> & { readonly planRepair?: { readonly parentWorkItemId: string } }): void {
    const parent = w.directoryParent?.workItemId ?? w.planRepair?.parentWorkItemId;
    if (parent) this.#links[w.id] = parent;
    else delete this.#links[w.id];
    if (w.dependencies?.length) this.#dependencies[w.id] = w.dependencies.map((d) => d.upstreamId);
    else delete this.#dependencies[w.id];
  }

  /** The assignments a changed row reaches, and the work items no assignment held yet. */
  async #readChanges(since: string): Promise<{ readonly groups: Set<string>; readonly probes: Set<string> }> {
    const repos = this.#repos;
    const groups = new Set<string>();
    const probes = new Set<string>();
    const workItem = (id: string | undefined) => {
      if (!id) return;
      const group = this.#groupOf.get(id);
      if (group === undefined) probes.add(id);
      else groups.add(group);
    };
    const changedItems = new Set<string>();
    const throughs = await Promise.all([
      eachChanged<{ id: string }>(repos.obligations, since, { id: true }, (rows) => { for (const o of rows) groups.add(o.id); }),
      eachChanged<{ obligationId: string; workItemId: string }>(repos.occurrences, since, { obligationId: true, workItemId: true }, (rows) => {
        for (const o of rows) { groups.add(o.obligationId); workItem(o.workItemId); }
      }),
      eachChanged<{ obligationId: string }>(repos.debts, since, { obligationId: true }, (rows) => { for (const d of rows) groups.add(d.obligationId); }),
      eachChanged<WorkItem>(repos.workItems, since, CHANGE_PROJECTIONS.workItem, (rows) => {
        for (const w of rows) { this.#noteWorkItem(w); changedItems.add(w.id); workItem(w.id); }
      }),
      eachChanged<{ workItemId: string }>(repos.routeTasks, since, CHANGE_PROJECTIONS.byWorkItem, (rows) => { for (const r of rows) workItem(r.workItemId); }),
      eachChanged<{ id: string; workItemId: string }>(repos.attempts, since, { id: true, workItemId: true }, (rows) => {
        for (const a of rows) { this.changedAttempts.add(a.id); workItem(a.workItemId); }
      }),
      eachChanged<{ routeTaskId: string }>(repos.leases, since, { routeTaskId: true }, async (rows) => {
        const tasks = await needs(repos.routeTasks.readManyNarrowed, "route-task read by id")(unique(rows.map((l) => l.routeTaskId)), CHANGE_PROJECTIONS.byWorkItem);
        for (const t of tasks) workItem((t.value as { workItemId: string }).workItemId);
      }),
      ...[repos.artifacts, repos.costs, repos.workerResults].map((log) =>
        eachLogChanged<{ workItemId: string }>(log as AppendOnlyRepository<unknown>, since, CHANGE_PROJECTIONS.byWorkItem, (records) => { for (const r of records) workItem(r.record.workItemId); })),
      eachLogChanged<{ workItemId: string; attemptId: string }>(repos.scoutResults as AppendOnlyRepository<unknown>, since, { workItemId: true, attemptId: true }, (records) => {
        for (const r of records) { addRef(this.#scouts, r.record.workItemId, r.key); addRef(this.#scouts, r.record.attemptId, r.key); workItem(r.record.workItemId); }
      }),
      eachLogChanged<PipelineSource>(repos.promotionPipeline as AppendOnlyRepository<unknown>, since, { source: true }, async (records) => {
        for (const r of records) { addRef(this.#pipelineItems, r.record.source?.workItemId, r.key); addRef(this.#pipelineItems, r.record.source?.attemptId, r.key); workItem(r.record.source?.workItemId); }
        const attempts = await needs(repos.attempts.readManyNarrowed, "attempt read by id")(unique(records.map((r) => r.record.source?.attemptId)), CHANGE_PROJECTIONS.byWorkItem);
        for (const a of attempts) workItem((a.value as { workItemId: string }).workItemId);
      }),
    ]);
    this.#through = throughs.sort()[0]!;
    /* A new obligation takes in the created work items whose clause names it. */
    for (const [id, g] of this.#groups) if (g.clause !== null && groups.has(g.clause) && !this.#groups.has(g.clause)) groups.add(id);
    /* A parent's change can move its children; a work item's state reaches the rows of every work item its dependents wait on. */
    for (const [child, parent] of Object.entries(this.#links)) if (changedItems.has(parent)) workItem(child);
    for (const [dependent, upstreams] of Object.entries(this.#dependencies)) {
      if (changedItems.has(dependent) || upstreams.some((u) => changedItems.has(u))) for (const u of upstreams) workItem(u);
    }
    return { groups, probes };
  }

  /** Every record the seeded assignments join, read and derived together until membership settles, then carried. */
  async #derive(targets: readonly string[], probes: readonly string[]): Promise<void> {
    const pending = [...new Set(targets)];
    for (const batch of chunks(pending, ASSIGNMENT_BATCH)) await this.#deriveBatch(batch, []);
    for (const batch of chunks([...new Set(probes)], ASSIGNMENT_BATCH)) await this.#deriveBatch([], batch);
  }

  async #deriveBatch(targets: readonly string[], probes: readonly string[]): Promise<void> {
    const ids = new Set(targets);
    const extra = new Set(probes);
    for (let round = 0; ; round += 1) {
      if (round > 16) throw new Error(`assignment membership did not settle for ${[...ids].slice(0, 5).join(", ")}`);
      const members = new Set(extra);
      for (const id of ids) for (const m of this.#groups.get(id)?.members ?? [id]) members.add(m);
      const src = await readAssignmentSubset(this.#repos, this.#base(), { obligations: [...ids], workItems: [...members], context: (owned) => this.#contextOf(owned),
        scoutKeys: (owned, attempts) => lookup(this.#scouts, owned, attempts), pipelineItems: (owned, attempts) => lookup(this.#pipelineItems, owned, attempts) });
      const produced = deriveAssignmentEntries(src);
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
      const items = new Map(src.workItems.map((w) => [w.id, w] as const));
      for (const w of src.workItems) this.#noteWorkItem(w);
      for (const id of ids) {
        const entry = produced.get(id);
        this.#dropGroup(id);
        if (entry === undefined) continue;
        const own = entry.members.map((m) => items.get(m)).filter((w): w is WorkItem => w !== undefined);
        const memberSet = new Set(entry.members);
        const attempts = src.attempts.filter((a) => memberSet.has(a.workItemId)).map((a) => a.id);
        this.#setGroup(id, { members: entry.members, usd: entry.usd, horizon: entry.horizon, items: entry.items,
          scoutKeys: lookup(this.#scouts, entry.members, attempts), obligation: entry.obligation,
          publications: own.filter((w) => w.publicationOutcome).map(narrowPublication),
          clause: entry.index.kind === "WORK_ITEM" ? clauseObligation(items.get(id)?.obligation ?? "") : null });
        this.#index.set(id, entry.index);
        if (entry.list && this.#keepLists) this.#lists.set(id, entry.list);
        this.#bodies.set(id, entry.bodyAttempts);
      }
      return;
    }
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

  #setGroup(id: string, g: GroupTotals): void {
    this.#groups.set(id, g);
    for (const m of g.members) {
      this.#groupOf.set(m, id);
      for (const key of g.scoutKeys) addRef(this.#scouts, m, key);
      for (const item of g.items) addRef(this.#pipelineItems, m, item);
    }
  }

  #dropGroup(id: string): void {
    for (const m of this.#groups.get(id)?.members ?? []) if (this.#groupOf.get(m) === id) this.#groupOf.delete(m);
    this.#groups.delete(id);
    this.#index.delete(id);
    this.#lists.delete(id);
    this.#bodies.delete(id);
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
      const attempts = await attemptHeld(unique(states.map(({ after }) => {
        const source = after.byStage.SCOUTED?.source;
        return source && source.kind !== "PROMOTED_CANDIDACY" && source.kind !== "FLEET_EXTRACTION" ? source.attemptId : null;
      })));
      for (const { key, before, after } of states) {
        if (before === null) t.items += 1;
        t.verified += (after.stage === "VERIFIED" ? 1 : 0) - (before?.stage === "VERIFIED" ? 1 : 0);
        delete t.unlinked[key];
        if (pipelineLinked(after, this.assigned, (id) => attempts.has(id))) continue;
        const source = after.byStage.SCOUTED?.source;
        t.unlinked[key] = !source || source.kind === "PROMOTED_CANDIDACY" ? {} : source.kind === "FLEET_EXTRACTION" ? { workItem: source.workItemId } : { attempt: source.attemptId };
      }
    };
    const fresh = new Map<string, Set<string>>();
    /* A whole read arrives item by item in key order, so each item is accounted as its last record passes. */
    let open: { key: string; all: PromotionPipelineRecord[] } | null = null;
    const pending: { key: string; before: readonly PromotionPipelineRecord[]; all: PromotionPipelineRecord[] }[] = [];
    const { next } = await readLogChanges(log, whole ? null : t.cursor, this.#input.slackMs ?? INCREMENTAL_READS_SLACK_MS, async (records) => {
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
    const appeared = await attemptHeld(unique(waiting.map(([, ref]) => (ref.attempt && this.changedAttempts.has(ref.attempt) ? ref.attempt : null))));
    for (const [key, ref] of waiting) if ((ref.workItem && this.assigned(ref.workItem)) || (ref.attempt && appeared.has(ref.attempt))) delete t.unlinked[key];
    t.cursor = next;
    this.#pipeline = t;
  }
}
