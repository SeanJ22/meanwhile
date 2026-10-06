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
import { EASTERN_ZONE } from "../../../../lib/control-plane/eastern-time.ts";

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

/**
 * One row of The country: a state at country scope, a congressional district at a
 * state, a ZIP at a district. Every figure is null when it is not known (never zero).
 */
export interface StateRow {
  readonly placeKey: string;
  readonly code: string;
  readonly name: string;
  readonly hunts: number | null;
  readonly stuck: number | null;
  /** Checklist items counted here, or null when coverage is unknown (never zero). */
  readonly checklistItems: number | null;
  readonly tracked: boolean;
  /** What the row is. A state when absent. */
  readonly kind?: "State" | "District" | "ZIP";
  /** The place the row sits directly inside: the scope the list belongs to. */
  readonly parentKey?: string;
  readonly zipsWorked?: number | null;
  readonly zipsTotal?: number | null;
  /** The place's completeness as a percentage, floored to one decimal. */
  readonly score?: number | null;
}

/* ------------------------------------------------------ reader results */

/** Six stages from source to reader. */
/** `unreported`: nothing records this stage for this result, which is not the same as not done. */
export type StageMark = "done" | "not-yet" | "wrong" | "partial" | "reported" | "waiting" | "unreported";
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
  /** Null when nothing records whether the result is new, reused, updated or retained. */
  readonly kind: ResultKind | null;
  readonly stages: readonly StageMark[];
  readonly readerSees: string;
  readonly problem: boolean;
  readonly trail: readonly TrailStage[];
}

/* ----------------------------------------------------------------- stuck */

export type Lane = "decision" | "auto" | "publisher" | "software";

export interface StuckItem {
  readonly technical?: readonly string[];
  readonly id: string;
  readonly title: string;
  readonly applies: readonly string[];
  readonly lane: Lane;
  readonly cause: string;
  /** Why it needs Sean (BR-09): set on every decision-lane item. */
  readonly needs?: "money" | "platform" | "credentials" | "contract" | "broken";
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

/** Workers running now: in the place in view, in the whole system, and whether the read stopped at its row limit (both counts are then lower bounds). */
export interface WorkersRunning {
  readonly count: number;
  readonly system: number;
  readonly lowerBound: boolean;
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
  readonly fixId: string | null;
  readonly status?: "SUCCEEDED" | "REFUSED" | "FAILED";
  readonly technical: readonly string[];
}

export interface WorkerStatus {
  readonly cycle?: { readonly startedAt: string; readonly finishedAt: string | null;
    readonly exitCode: number | null; readonly signal: string | null; readonly lastError: string | null } | null;
  /** Workers last checked in: only means they are switched on. */
  readonly lastCheckIn: string | null;
  /** Last meaningful progress, or null when nothing reports it. */
  readonly lastUsefulProgress: { readonly at: string; readonly what: string } | null;
  readonly roundStartedAt: string | null;
  /** Set when a round is open and nothing has started or reported since this time, for ten minutes or more. */
  readonly noProgressSince?: string | null;
  /** Paid jobs the safety checks refused before they reached the AI, and why in plain words; null when none. */
  readonly refused?: { readonly count: number; readonly why: string } | null;
  readonly lastRoundFinishedAt: string | null;
  readonly nextRoundDueAt: string | null;
  readonly runnerState: string | null;
  /** Whole-system lane counts from the live pulse, when present. */
  readonly lanes: readonly { readonly name: string; readonly active: number | null; readonly waiting: number; readonly blockedBy: string | null }[] | null;
  readonly unread: readonly string[];
}

/* ----------------------------------------------------------------- agents */

/** One agent run (server: v6-agents-read.ts). Newest first; a run still open past the runner's wall is "did-not-finish", never "running". */
export interface AgentRun {
  readonly id: string;
  readonly role: string;
  readonly state: "running" | "done" | "stopped" | "did-not-finish";
  readonly stateWords: string;
  readonly title: string;
  readonly placeKey: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly model: { readonly tier: "haiku" | "sonnet" | "opus" | "plain-code" | "older"; readonly name: string };
  /** Dollars for this run, or null when the ledger has no price for it (never $0). */
  readonly costUsd: number | null;
  readonly costWords: string;
  readonly found: string;
  readonly source: { readonly url: string | null; readonly savedPages: number; readonly copy: { readonly path: string; readonly byteLength: number } | null } | null;
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
  /** When the next check is due, for an item awaiting publication or due for a refresh. */
  readonly nextCheckAt?: string | null;
  /** When it started being owed, for a blank added after the mission started (SC-10). */
  readonly addedAt?: string | null;
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

/** One of the three measures: what is counted, what it is counted against, and the counts beside it. A count we do not have is null. */
export interface MeasureView {
  readonly n: number;
  readonly of: number;
  readonly percent: number | null;
  readonly beside: Readonly<Record<string, number | null>>;
}
/** Completeness, freshness and delivery, each with its counts and never blended into one number. */
export interface PlaceMeasuresView {
  readonly completeness: MeasureView;
  readonly freshness: MeasureView;
  readonly delivery: MeasureView;
}

/** Sean’s checklist score for one place, overall and by group. It measures capture and never gates publishing. */
export interface PlaceScoreView {
  readonly placeKey: string;
  readonly placeLabel: string;
  readonly covers: string;
  readonly observedAt: string;
  readonly divisionCount: number;
  /** The words a Send to fill this place's blanks carries, or null when the place cannot be named to the fleet. */
  readonly sendWords: string | null;
  /** The target Sean set for this place, or null. Nothing here gates publishing. */
  readonly target: { readonly goalPercent: number; readonly setAt: string } | null;
  /** Core items only. The family rows below add up to it. */
  readonly overall: ScoreGroup;
  readonly groups: readonly ScoreGroup[];
  /** Extension items, counted apart from the headline. Null when the place owes none. */
  readonly extension?: ScoreGroup | null;
  /** Summary items whose detail items carry the count: listed, out of the denominator. Null when none. */
  readonly summary?: ScoreGroup | null;
  /** Governments, bodies, seats and people accounted for against what is expected. */
  readonly coverage?: { readonly words: readonly string[] };
  /** Completeness, freshness and delivery, each with its counts. */
  readonly measures?: PlaceMeasuresView;
  /** Up, down or same against the last earlier day's completeness. Null with no earlier point. */
  readonly trend?: { readonly direction: "up" | "down" | "same"; readonly previousPercent: number | null; readonly previousDay: string } | null;
  /** What is not captured, split into "hunted, not found" and "nothing hunts this yet", overall and by family. */
  readonly notCaptured?: { readonly huntedNotFound: number; readonly nothingHunts: number };
  readonly familyNotCaptured?: readonly { readonly group: string; readonly huntedNotFound: number; readonly nothingHunts: number }[];
  /** Completeness on the starting list and the grown list, side by side. Null until the place has a mission start. */
  readonly growth?: { readonly missionStart: string; readonly starting: { readonly n: number; readonly of: number; readonly percent: number | null }; readonly grown: { readonly n: number; readonly of: number; readonly percent: number | null }; readonly added: number } | null;
  /** Officials and candidates with a full profile, with the count behind each field. */
  readonly profiles?: { readonly words: string; readonly figures: { readonly fields: readonly { readonly key: string; readonly label: string; readonly applies: number; readonly held: number | null }[]; readonly notMeasured: readonly string[] } };
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
  /** The dollars in that figure: spent so far (null when not reported) and the limit (null when none stands). */
  readonly usedUsd: number | null;
  readonly limitUsd: number | null;
  readonly fraction: number | null;
  readonly note: string;
  readonly tone: "hunt" | "warn" | "neutral";
}

/** One piece of work and what its paid tries cost, from the cost ledger (server: v6-spend-read.ts). */
export interface WorkCost {
  readonly work: string;
  readonly models: string;
  readonly tries: number;
  readonly costUsd: number | null;
  readonly movedUpWhy: string;
  readonly benefit: string;
  readonly applies: readonly string[];
}

export interface MoneyView {
  readonly account: readonly AccountReading[];
  readonly accountMonth: string;
  readonly monthlyPlans: readonly { readonly name: string; readonly note: string }[];
  readonly limits: readonly SpendLimit[];
  /** Our recorded request costs against each provider's own report, for that report's period. Null when the attribution was not read. */
  readonly reconciliation: readonly {
    readonly provider: string; readonly periodStart: string; readonly periodEnd: string;
    /** False for a shared platform cost (hosting, database, GitHub): no request is priced in our ledger, so nothing is compared. */
    readonly requestPriced: boolean;
    readonly huntUsd: number | null; readonly huntKnownUsd: number; readonly otherUsd: number | null; readonly otherKnownUsd: number;
    readonly providerUsd: number | null; readonly differenceUsd: number | null; readonly unpriced: number }[] | null;
  readonly readings: readonly {
    readonly provider: string; readonly status: string; readonly stale: boolean; readonly syncedAt: string | null; readonly attemptedAt: string;
    readonly periodStart: string; readonly periodEnd: string; readonly reportedUsd: number | null; readonly estimatedUsd: number | null;
    readonly error: string | null; readonly detail: string; readonly credits: string | null; readonly accounts: readonly string[]; readonly limits: readonly string[];
    readonly units: readonly { readonly label: string; readonly value: number; readonly unit: string }[] }[];
  readonly otherServices: string;
}

/* ------------------------------------------------------------ reliability */

/** One source's record from the workers' own results (server: v6-reliability-read.ts, the dispatcher's own reducer). */
export interface SourceReliabilityRow {
  readonly source: string;
  readonly state: "failing" | "recovering" | "healthy";
  readonly successes: number;
  readonly failures: number;
  readonly consecutiveFailures: number;
  readonly lastAttemptAt: string;
  readonly retryAt: string | null;
  readonly detail: string;
}

/* ------------------------------------------------------------ publication */

/** One routine contract a reader cannot see yet (server: v6-publication-read.ts). */
export interface PublicationRow {
  readonly contract: string;
  readonly verdict: "READER_VISIBLE" | "READBACK_FAILED" | "PUBLISHED_NOT_READ_BACK" | "PUBLISHED_NO_READER_SURFACE" | "NOT_PUBLISHED";
  readonly words: string;
  readonly publishedAt: string | null;
  readonly readback: { readonly status: "PASS" | "FAIL"; readonly at: string } | null;
  readonly attempt: { readonly state: string; readonly at: string; readonly failureCode: string | null } | null;
}
export interface PublicationView {
  readonly total: number;
  readonly counts: readonly { readonly verdict: PublicationRow["verdict"]; readonly words: string; readonly count: number }[];
  readonly latestAttemptFailing: number;
  readonly notVisible: readonly PublicationRow[];
  readonly notVisibleHidden: number;
}

/* ----------------------------------------------------------------- sends */

/** An instruction the owner sent the fleet with "Deploy fleet here", and where it stands (server: v6-sends-read.ts). */
export interface SentInstruction {
  readonly id: string;
  readonly words: string;
  readonly sentAt: string;
  readonly state: "waiting" | "carried" | "finished" | "cancel-requested" | "cancelled";
  readonly stateWords: string;
  /** What the runner recorded when it read it. */
  readonly ranAs: string | null;
  readonly canCancel: boolean;
}

/* ----------------------------------------------------------------- trail */

/** One step of a piece of work's source-to-public-result trail (server: v6-trail-read.ts). */
export interface TrailEvent {
  readonly id: string;
  readonly stage: "SOURCE" | "ATTEMPT" | "SAVED" | "EXTRACTED" | "CHECKED" | "PUBLISHED" | "READER";
  readonly at: string | null;
  readonly title: string;
  readonly says: string;
  readonly nextAction: string | null;
  readonly sourceUrl: string | null;
  readonly publicUrl: string | null;
  /** Only an exact RAW capture on this work has one: the private original-copy control. */
  readonly privateCopy: { readonly path: string; readonly byteLength: number } | null;
  readonly references: readonly (readonly [string, string])[];
}
export interface TrailView {
  readonly events: readonly TrailEvent[];
  readonly eventsHidden: number;
  readonly gaps: readonly string[];
}
/** The standing work an instruction marked when the runner created or reordered it. */
export interface ReachedView {
  readonly total: number;
  readonly rows: readonly { readonly id: string; readonly label: string; readonly relation: "created" | "reordered" | "other"; readonly at: string }[];
}

/* ----------------------------------------------------------------- spend */

/** What the agents cost by model tier and day, and what the database sent (server: v6-spend-read.ts). Whole-system. */
export interface SpendView {
  readonly windowDays: number;
  readonly byTier: readonly { readonly key: string; readonly tier: "haiku" | "sonnet" | "opus" | "older" | "unrecorded"; readonly name: string; readonly usd: number; readonly requests: number }[];
  readonly byDay: readonly { readonly day: string; readonly anthropicUsd: number; readonly searchUsd: number; readonly byModel: readonly { readonly name: string; readonly usd: number }[]; readonly rows: number }[];
  /** Newest first; the first row is the month in progress. Eastern months. */
  readonly byMonth: readonly { readonly month: string; readonly anthropicUsd: number; readonly searchUsd: number; readonly byTier: readonly { readonly name: string; readonly usd: number }[]; readonly rows: number }[];
  /** The costliest work over the same days, costliest first. */
  readonly work: readonly WorkCost[];
  readonly anthropicUsd: number;
  readonly searchUsd: number;
  /** Ledger rows with no price. Counted beside the dollars, never as $0. */
  readonly unpricedRows: number;
  readonly neon: { readonly kind: "recorded" | "not-recorded"; readonly detail: string | null;
    readonly days: readonly { readonly day: string; readonly responseBytes: number; readonly requestBytes: number; readonly requests: number }[] };
  /** Paid model money settled in the last 24 hours, from the cost ledger; null when that read failed. */
  readonly last24h?: { readonly modelUsd: number; readonly unpricedRows: number } | null;
  /** When the ledger was read. */
  readonly readAt?: string;
  /** What Scouts reported in the last 24 hours, by kind of work; null when that read failed. */
  readonly scoutOutcomes?: readonly { readonly recordClass: string; readonly found: number; readonly route: number; readonly total: number }[] | null;
  /** Open reservations right now over every hunt; null when not read. */
  readonly setAsideUsd?: number | null;
  /** The daily spending limit in force; null when not read. */
  readonly dailyLimitUsd?: number | null;
  /** How many paid hunters the daily limit buys at once right now; null when unread. */
  readonly huntersNow?: number | null;
  /** Charges in the last 24 hours counted at their worst case; null when unread. */
  readonly worstCaseCharges?: number | null;
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

/* ------------------------------------------------------------ scoreboard */

/** One Scoreboard number. A number we do not have has `value: null` (shown "—") and says why in `notMeasured`. Never blended with another row. */
export interface ScoreboardRow {
  /** The design's name for the number; shown only behind Technical details. */
  readonly id: string;
  readonly name: string;
  readonly value: string | null;
  /** The counts behind the value, e.g. "412 of 480". Null when none are held. */
  readonly counts: string | null;
  readonly says: string;
  readonly notMeasured: string | null;
  /** A short plain list under the row, e.g. the facts an audit led us to fix. */
  readonly items?: readonly string[];
  /** Detail kept behind Technical details, e.g. the fixed facts' IDs. */
  readonly technical?: readonly string[];
}

export interface ScoreboardGateRow {
  readonly name: string;
  readonly state: "pass" | "attention" | "not_measured";
  readonly sentence: string;
}

export interface ScoreboardReadinessRow {
  readonly name: string;
  readonly witnessed: number;
  readonly failing: number;
  readonly notMeasured: number;
  readonly of: number;
}

/** A count behind a share, for a table row: "3 of 4". */
export interface ScoreboardFraction { readonly n: number; readonly of: number }

export interface ScoreboardPlaceRow {
  readonly label: string;
  readonly completeness: ScoreboardFraction;
  readonly freshness: ScoreboardFraction;
  readonly delivery: ScoreboardFraction;
  /** "Up from 31% on Oct 4 · good", or why there is no trend. */
  readonly trend: string;
}

export interface ScoreboardFamilyRow { readonly name: string; readonly completeness: ScoreboardFraction }

export interface ScoreboardMissionRow {
  readonly label: string;
  readonly startedAt: string;
  /** "42 minutes", "Already held when it started", or "Not yet: 3 of 5 core items held". */
  readonly coreLive: string;
  readonly withinHour: boolean | null;
}

export interface ScoreboardView {
  readonly rows: readonly ScoreboardRow[];
  /** Completeness by place and by family, with the counts behind each; empty until a place has been sent. */
  readonly byPlace: readonly ScoreboardPlaceRow[];
  readonly byFamily: readonly ScoreboardFamilyRow[];
  /** Time from each recent mission's start to its core information live (SC-19). */
  readonly missions: readonly ScoreboardMissionRow[];
  /** Launch gates as health checks; they never hold anything back. Null when the readings could not be taken. */
  readonly gates: { readonly rows: readonly ScoreboardGateRow[]; readonly pass: number; readonly attention: number; readonly notMeasured: number } | null;
  /** Operational readiness, counted apart from what any place is owed. */
  readonly readiness: readonly ScoreboardReadinessRow[];
  /** The weekly series that used to be "Is it learning". */
  readonly learning: LearningView;
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
  /** DP-30: every time it broke, how it was fixed and how long each fix held, oldest first. */
  readonly history?: string;
  readonly technical: string;
}

export interface FixView {
  readonly open: readonly OpenFix[];
  readonly closed: readonly ClosedFix[];
  readonly returned: readonly ClosedFix[];
}

/* --------------------------------------------------------------- actions */

export type ActionKind =
  "decide" | "hunt-start" | "hunt-start-many" | "hunt-pause" | "hunt-resume" | "hunt-limit" | "hunt-stop" | "global-paid" | "global-paid-resume" | "global-runner-pause" | "global-runner-resume" | "global-ceiling" | "global-search-on" | "global-search-off" | "send-agents" | "cancel-send" | "order-schedule" | "order-unschedule" | "target-set" | "target-clear" | "data-switch-on" | "data-switch-off" | "setting-set" | "setting-undo" | "owed-add" | "owed-decline" | "owed-undo";

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
  /** BR-12: the plan the order was accepted with, and its one progress bar. */
  /** BR-02: saved, overdue and not taken by the runner. Shown red with the reason and three options. */
  readonly notPickedUp?: boolean;
  readonly finishBy?: string | null;
  readonly scheduledParentId?: string;
  /** BR-13: before and after, shown beside Done. */
  readonly change?: { readonly before: string; readonly after: string };
  readonly plan?: import("../../../../lib/control-plane/gateway/confirmation.ts").OrderPlan;
  readonly progress?: import("../../../../lib/control-plane/gateway/confirmation.ts").OrderProgress;
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
  readonly history: Sourced<readonly UiReceipt[]>;
  readonly workers: Sourced<{ readonly status: WorkerStatus; readonly jobs: readonly WorkerJob[] | null; readonly running?: WorkersRunning | null; readonly waiting: readonly WaitingItem[] | null; readonly events: readonly WorkerEvent[] | null; readonly update: UpdateCard | null; readonly next: readonly string[] | null }>;
  readonly checklist: Sourced<ChecklistView>;
  readonly agents: Sourced<readonly AgentRun[]>;
  readonly spend: Sourced<SpendView>;
  readonly sends: Sourced<readonly SentInstruction[]>;
  readonly reliability: Sourced<readonly SourceReliabilityRow[]>;
  readonly publication: Sourced<PublicationView>;
  readonly money: Sourced<MoneyView>;
  readonly scoreboard: Sourced<ScoreboardView>;
  readonly fixes: Sourced<FixView>;
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

/**
 * A calendar day in Eastern time, for dates without a meaningful clock time.
 * (Admin shows Eastern time, rulings §10. The name is older than that ruling
 * and is kept so the screen files that import it keep compiling.)
 */
export function mstDay(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "not reported";
  return new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_ZONE, month: "short", day: "numeric" }).format(new Date(iso));
}

export function count(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Eastern time, as Admin shows every time (rulings §10). "ET" covers EST and
 * EDT; the hour printed is already the local one. The name predates the
 * Eastern ruling and is kept so the screen files that import it keep compiling.
 */
export function mst(iso: string | null, withDay = true): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "not reported";
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_ZONE,
    ...(withDay ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
  return `${f.format(new Date(iso))} ET`;
}
