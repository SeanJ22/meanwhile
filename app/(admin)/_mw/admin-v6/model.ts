/**
 * **ADMIN v6 — THE SHAPES EVERY SCREEN READS.** (Claude Design v6 handoff, 2026-09-28.)
 *
 * One view model per data source. Each source arrives wrapped in `Sourced`, which
 * says where it came from: a real read (`live`), clearly labelled sample data
 * (`sample`), or nothing yet (`not-connected`, with the named dependency). A screen
 * never has to guess whether a number is real, and sample data cannot pass for
 * production because every sample section carries its own visible label.
 *
 * PURE: types and tiny helpers only. No fetch, no clock, no store.
 */

/* ------------------------------------------------------------ provenance */

export type SourceState = "live" | "sample" | "not-connected";
export type LoadState = "loading" | "ready" | "partial" | "failed";

/** A missing backend connection, named precisely enough to hand to its owner. */
export interface Dependency {
  /** Stable key for the acceptance ledger, e.g. `DEP-NATIONAL`. */
  readonly id: string;
  /** Who supplies it. */
  readonly owner: string;
  /** Plain words: what the screen needs and does not have. */
  readonly need: string;
}

export interface Sourced<T> {
  readonly state: SourceState;
  readonly load: LoadState;
  readonly data: T | null;
  /** When the data was read, ISO. Null when never read. */
  readonly asOf: string | null;
  /** Present whenever `state` is not `live`. */
  readonly dependency?: Dependency;
  /** Parts that did not arrive when `load` is `partial`, in plain words. */
  readonly missingParts?: readonly string[];
  /**
   * Why a real connection isn't showing live data right now:
   * waiting (backend doesn't offer it yet), denied (access), incompatible
   * (version), failed (temporary; last good data kept when there is any).
   */
  readonly problem?: "waiting" | "denied" | "incompatible" | "failed";
  /** Present for a bounded, indexed section read one window at a time. */
  readonly page?: { readonly total: number | null; readonly nextCursor: string | null; readonly prevCursor: string | null };
}

export function sample<T>(data: T, dependency: Dependency, asOf: string | null = null): Sourced<T> {
  return { state: "sample", load: "ready", data, asOf, dependency };
}
export function live<T>(data: T, asOf: string): Sourced<T> {
  return { state: "live", load: "ready", data, asOf };
}
export function notConnected<T>(dependency: Dependency): Sourced<T> {
  return { state: "not-connected", load: "ready", data: null, asOf: null, dependency };
}

/* ---------------------------------------------------------------- places */

export type PlaceKind = "Country" | "State" | "County" | "ZIP" | "Area" | "Body";

/**
 * A canonical place. `navParent` drives breadcrumbs only. `within` lists every
 * place this one is inside or overlaps for counting and ownership: a ZIP can
 * reach two counties and a governing body can serve several ZIPs, so the chain
 * of breadcrumbs is never used to decide what a count belongs to.
 */
export interface Place {
  readonly key: string;
  readonly name: string;
  readonly kind: PlaceKind;
  readonly navParent: string | null;
  readonly within: readonly string[];
  /** Two-letter code for a state or territory. */
  readonly code?: string;
  /** Whether the system tracks this state with registered coverage. */
  readonly tracked?: boolean;
}

export interface Hunt {
  readonly id: string;
  /** The place key the hunt was started on. */
  readonly placeKey: string;
  readonly name: string;
  readonly startedAt: string;
  /** Lifetime Anthropic limit in dollars. */
  readonly limitUsd: number;
  readonly limitSource: string;
  readonly spentUsd: number;
  readonly heldUsd: number;
  /** Charges saved without a price. Unknown, never zero dollars. */
  readonly unpricedEntries: number;
  /** `unreported`: the hunt is saved and not stopped, but whether paid work is running now is not published. */
  readonly status: "running" | "paused" | "stopped" | "unreported";
  /** Null when not reported. */
  readonly researchWorkers: number | null;
  /** The backend states the period: a hunt's figures are always its whole lifetime. */
  readonly basis?: "lifetime";
  /** Left to spend as the backend computed it; null when an unpriced charge makes it unknown. Absent: limit − spent − set aside. */
  readonly availableUsd?: number | null;
}

/** Left to spend, or null when unknown (never guessed from a lower-bound spend). */
export function huntLeftUsd(h: Hunt): number | null {
  return h.availableUsd !== undefined ? h.availableUsd : h.limitUsd - h.spentUsd - h.heldUsd;
}

/* ------------------------------------------------------------- national */

export interface StateRow {
  readonly placeKey: string;
  readonly code: string;
  readonly name: string;
  readonly hunts: number | null;
  readonly stuck: number | null;
  /** Checklist items counted here, or null when coverage is unknown (never zero). */
  readonly checklistItems: number | null;
  readonly tracked: boolean;
}

/* ------------------------------------------------------ reader results */

/** Six stages from source to reader. */
export type StageMark = "done" | "not-yet" | "wrong" | "partial" | "reported" | "waiting";
export const STAGE_NAMES = ["Found", "Saved", "Facts pulled out", "Facts checked against sources", "Published", "Checked on the public page"] as const;

export type ResultKind = "New" | "Reused" | "Updated" | "Retained";

export interface SavedDoc {
  readonly id: string;
  readonly name: string;
  readonly meta: string;
  readonly sourceUrl: string;
  readonly access: "public" | "private" | "unavailable";
  readonly unavailableWhy?: string;
  readonly preview?: string;
}

export interface TrailStage {
  readonly name: string;
  readonly mark: StageMark;
  readonly when: string;
  readonly what: string;
  readonly missing?: string;
  readonly next?: string;
  readonly docs?: readonly SavedDoc[];
  readonly facts?: readonly { readonly field: string; readonly value: string; readonly note: string }[];
  /** `seenAt` is ISO; the screen spells it out in Arizona time. */
  readonly publicLink?: { readonly url: string; readonly label: string; readonly seenAt: string | null };
  readonly technical?: readonly string[];
}

export interface ReaderResult {
  readonly id: string;
  readonly title: string;
  readonly applies: readonly string[];
  readonly kind: ResultKind;
  readonly stages: readonly StageMark[];
  readonly readerSees: string;
  readonly problem: boolean;
  readonly trail: readonly TrailStage[];
}

/* ----------------------------------------------------------------- stuck */

export type Lane = "decision" | "auto" | "publisher" | "software";

export interface StuckItem {
  readonly id: string;
  readonly title: string;
  readonly applies: readonly string[];
  readonly lane: Lane;
  readonly cause: string;
  readonly age: string;
  readonly ageRank: number;
  readonly tried: string;
  readonly helped: string;
  readonly next: string;
  readonly owner: string;
  readonly resultId?: string;
  readonly readersAffected?: boolean;
  readonly fixId?: string;
  readonly unlocks?: number;
  /** Items with the same cause share a group. */
  readonly group?: string;
  readonly actions: readonly ActionRef[];
  readonly latest?: string;
  readonly decision?: DecisionSpec;
}

/** The choices behind a "Decide" control. The server re-checks every one. */
export interface DecisionSpec {
  readonly id: string;
  readonly question: string;
  readonly options: readonly {
    readonly id: string;
    readonly label: string;
    readonly note: string;
    /** Contacting someone on Meanwhile's behalf needs outreach permission. */
    readonly outreach?: boolean;
    /** "Something else": the owner's own words are required. */
    readonly ownWords?: boolean;
  }[];
}

/** A control attached to an item: which action, aimed at what. */
export interface ActionRef {
  readonly kind: ActionKind;
  readonly target: string;
  readonly label?: string;
  readonly payload?: Readonly<Record<string, string>>;
}

export interface SameCause {
  readonly key: string;
  readonly cause: string;
  readonly lane: Lane;
  readonly count: string;
  readonly itemIds: readonly string[];
  /** Absent when the group names no state the fleet could be sent to. */
  readonly action?: ActionRef;
}

/* ------------------------------------------------------------------ work */

export type WorkStage = "waiting" | "stuck" | "retrying" | "done" | "retired";

export interface WorkRow {
  readonly id: string;
  readonly stage: WorkStage;
  readonly title: string;
  readonly placeKey: string;
  readonly age: string;
  readonly link?: { readonly type: "stuck" | "result"; readonly id: string };
}

export interface WorkStageTotal {
  readonly stage: WorkStage;
  /** The full count held by the server for this stage, or null when not split for this scope. */
  readonly total: number | null;
}

/* ---------------------------------------------------------------- workers */

export type WorkerStage = "finding" | "collecting" | "extracting" | "checking" | "publishing";
export const WORKER_STAGE_WORDS: Readonly<Record<WorkerStage, string>> = {
  finding: "Finding sources",
  collecting: "Collecting",
  extracting: "Pulling out facts",
  checking: "Checking",
  publishing: "Publishing",
};

export interface WorkerJob {
  readonly id: string;
  readonly stage: WorkerStage;
  readonly title: string;
  readonly placeKey: string;
  readonly hunt: string;
  readonly requirement: string;
  readonly startedAt: string;
  readonly elapsed: string;
  readonly method: string;
  readonly model: string;
  readonly modelWhy: string;
  readonly cost: string;
  readonly latest: string;
  readonly next: string;
}

export interface WaitingItem {
  readonly kind: string;
  readonly title: string;
  readonly why: string;
  readonly nextTime: string;
  readonly owner: string;
  readonly applies: readonly string[];
  readonly actions: readonly ActionRef[];
}

export interface WorkerEvent {
  readonly at: string;
  readonly kind: string;
  readonly text: string;
  readonly applies: readonly string[];
  readonly tone: "good" | "info" | "warn";
}

export interface UpdateCard {
  readonly title: string;
  readonly checkedAt: string;
  readonly what: string;
  readonly impact: string;
  readonly owner: string;
  readonly next: string;
  readonly youNeedToAct: string;
  readonly fixId: string;
  readonly technical: readonly string[];
}

export interface WorkerStatus {
  /** Workers last checked in: only means they are switched on. */
  readonly lastCheckIn: string | null;
  /** Last meaningful progress, or null when nothing reports it. */
  readonly lastUsefulProgress: { readonly at: string; readonly what: string } | null;
  readonly roundStartedAt: string | null;
  readonly lastRoundFinishedAt: string | null;
  readonly nextRoundDueAt: string | null;
  readonly runnerState: string | null;
  /** Whole-system lane counts from the live pulse, when present. */
  readonly lanes: readonly { readonly name: string; readonly active: number | null; readonly waiting: number; readonly blockedBy: string | null }[] | null;
  readonly unread: readonly string[];
}

/* ------------------------------------------------------------- checklist */

export type ItemStatus = "checked" | "published" | "collected" | "can-do" | "needs-fix" | "unsure" | "absent";
export const ITEM_STATUS_ORDER: readonly ItemStatus[] = ["checked", "published", "collected", "can-do", "needs-fix", "unsure", "absent"];

export interface Definition {
  readonly id: string;
  readonly group: string;
  readonly requirement: string;
  readonly owner: string;
  readonly label: string;
}

export interface ChecklistGroupCount {
  readonly group: string;
  readonly name: string;
  /** Counts in ITEM_STATUS_ORDER. */
  readonly counts: readonly number[];
}

export interface ChecklistItem {
  readonly key: string;
  readonly definitionId: string;
  readonly name: string;
  readonly subject: string;
  readonly period: string;
  readonly status: ItemStatus;
  readonly missing: string;
  readonly appliesBecause: string;
  readonly owner: string;
  readonly next: string;
  readonly parts: readonly { readonly text: string; readonly status: string; readonly proof: string; readonly tone: "good" | "warn" | "muted" }[];
  readonly resultId?: string;
  /** The saved official page this fact came from, when we hold one. */
  readonly sourceUrl?: string | null;
  readonly actions: readonly ActionRef[];
}

/** One group of Sean’s capture score (server: place-scorecard.ts). */
export interface ScoreGroup {
  readonly group: string;
  readonly name: string;
  readonly published: number;
  readonly held: number;
  readonly unpublished: number;
  readonly stale: number;
  readonly missing: number;
  readonly total: number;
  readonly captured: number;
  readonly percent: number | null;
}

/** Sean’s checklist score for one place, overall and by group. It measures capture and never gates publishing. */
export interface PlaceScoreView {
  readonly placeKey: string;
  readonly placeLabel: string;
  readonly covers: string;
  readonly observedAt: string;
  readonly divisionCount: number;
  readonly overall: ScoreGroup;
  readonly groups: readonly ScoreGroup[];
}

export interface SystemGroup {
  readonly group: string;
  readonly name: string;
  /** Partly built, known gap, not checked yet, other. Null when audit statuses are not connected. */
  readonly counts: readonly number[] | null;
  readonly audit: Readonly<Record<string, string>> | null;
}

export interface ChecklistView {
  readonly profileVersion: string;
  readonly definitionCount: number;
  readonly definitions: readonly Definition[];
  readonly groupNames: Readonly<Record<string, string>>;
  readonly placeGroups: readonly ChecklistGroupCount[] | null;
  readonly items: readonly ChecklistItem[] | null;
  readonly systemGroups: readonly SystemGroup[];
  /** Present for a ZIP, county or state; null or absent where no owed list is measured. */
  readonly score?: PlaceScoreView | null;
}

/* ----------------------------------------------------------------- money */

export interface AccountReading {
  readonly provider: string;
  readonly amountUsd: number | null;
  readonly how: string;
  readonly old?: boolean;
}

export interface SpendLimit {
  readonly name: string;
  readonly figure: string;
  readonly fraction: number | null;
  readonly note: string;
  readonly tone: "hunt" | "warn" | "neutral";
}

export interface CostDrill {
  readonly work: string;
  readonly models: string;
  readonly tries: number;
  readonly costUsd: number | null;
  readonly movedUpWhy: string;
  readonly benefit: string;
  readonly applies: readonly string[];
  readonly link?: { readonly type: "stuck" | "result"; readonly id: string };
}

export interface MoneyView {
  readonly account: readonly AccountReading[];
  readonly accountMonth: string;
  readonly monthlyPlans: readonly { readonly name: string; readonly note: string }[];
  readonly limits: readonly SpendLimit[];
  /** Null when per-work costs are not connected (never "no costs"). */
  readonly drill: readonly CostDrill[] | null;
  readonly otherServices: string;
}

/* -------------------------------------------------------------- learning */

export interface TrendWeek {
  readonly week: string;
  /** One value per series, or null when there is no record that week. */
  readonly values: readonly number[] | null;
}

export interface Trend {
  readonly question: string;
  readonly big: string;
  readonly bigNote: string;
  readonly series: readonly { readonly name: string; readonly color: ChartColor }[];
  readonly weeks: readonly TrendWeek[];
  readonly format: "usd" | "pct";
  readonly max: number;
  readonly limits: string;
  readonly method: readonly { readonly k: string; readonly v: string }[];
}

export interface Reading {
  readonly question: string;
  readonly big: string;
  readonly bigNote: string;
  readonly body: string;
  readonly method: readonly { readonly k: string; readonly v: string }[];
}

export interface NotMeasured {
  readonly question: string;
  readonly why: string;
  readonly needs: string;
}

export interface LearningView {
  readonly trends: readonly Trend[];
  readonly readings: readonly Reading[];
  readonly notMeasured: readonly NotMeasured[];
}

/* ------------------------------------------------------------------ fixes */

export type FixTab = "attention" | "fixing" | "update" | "done" | "returned";

export const LEARNING_STATUSES = [
  "Fixed once",
  "Prevention saved",
  "Prevention tested",
  "Reused successfully on another job",
  "Problem returned",
  "Not checked yet",
] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

export const TASK_STAGES = ["Task created", "Engineer accepted", "Implemented", "Tested", "Released", "Workers using it", "Checked on the public page"] as const;

export interface OpenFix {
  readonly id: string;
  readonly title: string;
  readonly tab: "attention" | "fixing" | "update";
  readonly owner: string;
  readonly problem: string;
  readonly helps: string;
  readonly placeInLine: string;
  readonly resourcesNow: string;
  /** Index into TASK_STAGES reached, or null when no task is linked. */
  readonly taskStage: number | null;
  readonly taskId: string | null;
  readonly linkedStuck: readonly string[];
  readonly origin: "engineering" | "automatic";
  readonly technical: string;
}

export interface ClosedFix {
  readonly id: string;
  readonly title: string;
  readonly changed: string;
  readonly places: string;
  readonly fixedAt: string;
  readonly origin: "Engineering fix" | "Automatic repair";
  readonly learning: LearningStatus;
  readonly whatChanged: string;
  readonly readerRecheck: string;
  readonly since: string;
  readonly saved: string;
  readonly usedBy: string;
  readonly returnedDetail?: string;
  readonly technical: string;
}

export interface FixView {
  readonly open: readonly OpenFix[];
  readonly closed: readonly ClosedFix[];
  readonly returned: readonly ClosedFix[];
}

/* --------------------------------------------------------------- actions */

export type ActionKind =
  | "contain" | "uncontain" | "recheck" | "workfirst" | "fixfirst" | "stopmethod" | "scope-stop" | "stoprepeats"
  | "decide" | "hunt-start" | "hunt-pause" | "hunt-resume" | "hunt-limit" | "hunt-stop"
  | "global-paid" | "global-runner-pause" | "global-runner-resume"
  | "scope-first" | "scope-recheck" | "doc-request" | "use-url" | "reprocess" | "retry-method" | "resume-publish"
  | "eng-task" | "job-stop" | "focus" | "send-agents";

export type ReceiptStatus = "queued" | "read" | "running" | "done" | "partial" | "refused" | "failed" | "unknown";
export const PENDING_STATUSES: readonly ReceiptStatus[] = ["queued", "read", "running", "unknown"];

/** The seven lifecycle facts, kept separate. Null means not reached or not reported. */
export interface Lifecycle {
  readonly saved: string | null;
  readonly workersReceived: string | null;
  readonly workStarted: string | null;
  readonly workFinished: string | null;
  readonly factsChecked: string | null;
  readonly published: string | null;
  readonly checkedOnPublicPage: string | null;
}

export const LIFECYCLE_WORDS: readonly (readonly [keyof Lifecycle, string])[] = [
  ["saved", "Instruction saved"],
  ["workersReceived", "Workers received it"],
  ["workStarted", "Work started"],
  ["workFinished", "Work finished"],
  ["factsChecked", "Facts checked against sources"],
  ["published", "Published"],
  ["checkedOnPublicPage", "Checked on the public page"],
];

export interface ReceiptItem {
  readonly name: string;
  readonly status: ReceiptStatus;
  readonly note: string;
}

export interface UiReceipt {
  /** The idempotency key: one per deliberate send, reused by a retried fetch. */
  readonly key: string;
  readonly kind: ActionKind;
  readonly target: string;
  readonly targetName: string;
  readonly label: string;
  readonly scopeKey: string;
  readonly scopeName: string;
  readonly level: "local" | "global";
  readonly status: ReceiptStatus;
  /** Plain words shown on the chip for this status (e.g. "Decision saved — change pending"). */
  readonly statusWords: string;
  readonly steps: readonly { readonly label: string; readonly at: string }[];
  readonly says: string;
  readonly items: readonly ReceiptItem[];
  readonly lifecycle: Lifecycle;
  /** True for anything produced by the sample executor. Never true for a real receipt. */
  readonly simulated: boolean;
  /** The registry action type it was sent as; with `key` it is the durable receipt identity. */
  readonly gatewayType: string | null;
  readonly gatewayReceiptId: string | null;
  readonly readBackAt: string | null;
  readonly replayed: boolean;
  readonly sentAt: string;
  readonly words?: string;
}

/* ---------------------------------------------------------------- charts */

export type ChartColor = "teal" | "blue" | "amber" | "gray" | "coral" | "violet" | "dark";

/* ------------------------------------------------------------ the bundle */

export interface AdminV6Data {
  readonly places: Sourced<readonly Place[]>;
  readonly hunts: Sourced<readonly Hunt[]>;
  readonly national: Sourced<readonly StateRow[]>;
  readonly results: Sourced<readonly ReaderResult[]>;
  readonly stuck: Sourced<readonly StuckItem[]>;
  readonly sameCause: Sourced<readonly SameCause[]>;
  readonly workRows: Sourced<{ readonly rows: readonly WorkRow[]; readonly totals: readonly WorkStageTotal[] }>;
  readonly history: Sourced<readonly UiReceipt[]>;
  readonly workers: Sourced<{ readonly status: WorkerStatus; readonly jobs: readonly WorkerJob[] | null; readonly waiting: readonly WaitingItem[] | null; readonly events: readonly WorkerEvent[] | null; readonly update: UpdateCard | null; readonly next: readonly string[] | null }>;
  readonly checklist: Sourced<ChecklistView>;
  readonly money: Sourced<MoneyView>;
  readonly learning: Sourced<LearningView>;
  readonly fixes: Sourced<FixView>;
  readonly decided: Sourced<readonly { readonly title: string; readonly state: string }[]>;
}

/* ------------------------------------------------------------ small words */

export function usd(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Percentages round down, so rounding can never produce an unearned 100%. */
export function pctDown(part: number, whole: number): string {
  if (!whole) return "—";
  return (Math.floor((part / whole) * 1000) / 10).toFixed(1) + "%";
}

/** A calendar day in Arizona time, for dates without a meaningful clock time. */
export function mstDay(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "not reported";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric" }).format(new Date(iso));
}

export function count(n: number): string {
  return n.toLocaleString("en-US");
}

/** Arizona time, as the owner reads schedules. */
export function mst(iso: string | null, withDay = true): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "not reported";
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    ...(withDay ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
  return `${f.format(new Date(iso))} MST`;
}
