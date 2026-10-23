import { EASTERN_ZONE } from "../../../../lib/control-plane/eastern-time.ts";
import type { LookView } from "../../../../lib/frontend/look-pass.ts";

export type {  LookView } from "../../../../lib/frontend/look-pass.ts";

export type SourceState = "live" | "sample" | "not-connected";
export type LoadState = "loading" | "ready" | "partial" | "failed";

export interface Dependency {
  readonly id: string;
  readonly owner: string;
  readonly need: string;
}

export interface Sourced<T> {
  readonly state: SourceState;
  readonly load: LoadState;
  readonly data: T | null;

  readonly asOf: string | null;

  readonly dependency?: Dependency;

  readonly missingParts?: readonly string[];
  readonly problem?: "waiting" | "denied" | "incompatible" | "failed";

  readonly page?: { readonly total: number | null; readonly nextCursor: string | null; readonly prevCursor: string | null };
}

export type PlaceKind = "Country" | "State" | "County" | "ZIP" | "Area" | "Body";

export interface Place {
  readonly key: string;
  readonly name: string;
  readonly kind: PlaceKind;
  readonly navParent: string | null;
  readonly within: readonly string[];
  readonly code?: string;
  readonly tracked?: boolean;
}

export interface Hunt {

  readonly reportedSpendUsd?: number | null;
  readonly id: string;
  readonly placeKey: string;
  readonly name: string;
  readonly startedAt: string;

  readonly limitUsd: number;
  readonly limitSource: string;
  readonly spentUsd: number;
  readonly heldUsd: number;

  readonly unpricedEntries: number;

  readonly status: "running" | "paused" | "stopped" | "unreported";

  readonly researchWorkers: number | null;

  readonly basis?: "lifetime";

  readonly availableUsd?: number | null;

  readonly pause?: { readonly kind: "paid-work" | "runner" | "budget"; readonly since: string | null; readonly note: string | null } | null;
}

export function huntLeftUsd(h: Hunt): number | null {
  return h.availableUsd !== undefined ? h.availableUsd : h.limitUsd - h.spentUsd - h.heldUsd;
}

export interface StateRow {
  readonly population?: import("@/lib/reference/population-facts.ts").PopulationFact | null;
  readonly placeKey: string;
  readonly code: string;
  readonly name: string;
  readonly hunts: number | null;
  readonly stuck: number | null;

  readonly checklistItems: number | null;
  readonly tracked: boolean;
  readonly kind?: "State" | "District" | "ZIP";
  readonly parentKey?: string;
  readonly zipsWorked?: number | null;
  readonly zipsTotal?: number | null;

  readonly score?: number | null;
}

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

  readonly publicLink?: { readonly url: string; readonly label: string; readonly seenAt: string | null };
  readonly technical?: readonly string[];
}

export interface ScoreboardFlowDay {
  readonly label: string;
  readonly findings: number | null;
  readonly built: number | null;
  readonly checked: number | null;
  readonly live: number | null;
}

export interface ReaderResult {
  readonly id: string;
  readonly title: string;
  readonly applies: readonly string[];

  readonly kind: ResultKind | null;
  readonly stages: readonly StageMark[];
  readonly readerSees: string;
  readonly problem: boolean;
  readonly trail: readonly TrailStage[];
}

export type Lane = "decision" | "auto" | "publisher" | "software";

export interface StuckItem {
  readonly technical?: readonly string[];
  readonly id: string;
  readonly title: string;
  readonly applies: readonly string[];
  readonly lane: Lane;
  readonly cause: string;
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

  readonly group?: string;
  readonly actions: readonly ActionRef[];
  readonly latest?: string;
  readonly decision?: DecisionSpec;
}

export interface DecisionSpec {
  readonly id: string;
  readonly question: string;
  readonly options: readonly {
    readonly id: string;
    readonly label: string;
    readonly note: string;
    readonly outreach?: boolean;
    readonly ownWords?: boolean;
  }[];
}

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

  readonly action?: ActionRef;
}

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

  readonly total: number | null;
}

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

  readonly lastCheckIn: string | null;
  readonly lastUsefulProgress: { readonly at: string; readonly what: string } | null;
  readonly roundStartedAt: string | null;

  readonly noProgressSince?: string | null;
  readonly refused?: { readonly count: number; readonly why: string } | null;
  readonly lastRoundFinishedAt: string | null;
  readonly nextRoundDueAt: string | null;
  readonly runnerState: string | null;
  readonly lanes: readonly { readonly name: string; readonly active: number | null; readonly waiting: number; readonly blockedBy: string | null }[] | null;

  readonly databaseReads?: { readonly hour: string; readonly controlPlaneBytes: number; readonly readerBytes: number;
    readonly byCaller: readonly { readonly caller: string; readonly bytes: number }[] } | null;
  readonly unread: readonly string[];
}

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

  readonly costUsd: number | null;
  readonly costWords: string;
  readonly found: string;
  readonly source: { readonly url: string | null; readonly savedPages: number; readonly copy: { readonly path: string; readonly byteLength: number } | null } | null;
}

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
  readonly sourceUrl?: string | null;

  readonly nextCheckAt?: string | null;
  readonly addedAt?: string | null;
  readonly actions: readonly ActionRef[];
}

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

export interface MeasureView {
  readonly n: number;
  readonly of: number;
  readonly percent: number | null;
  readonly beside: Readonly<Record<string, number | null>>;
}

export interface PlaceMeasuresView {
  readonly completeness: MeasureView;
  readonly freshness: MeasureView;
  readonly delivery: MeasureView;
}

export interface PlaceScoreView {
  readonly placeKey: string;
  readonly placeLabel: string;
  readonly covers: string;
  readonly observedAt: string;
  readonly divisionCount: number;
  readonly sendWords: string | null;

  readonly target: { readonly goalPercent: number; readonly setAt: string } | null;

  readonly overall: ScoreGroup;
  readonly groups: readonly ScoreGroup[];

  readonly extension?: ScoreGroup | null;

  readonly summary?: ScoreGroup | null;
  readonly coverage?: { readonly words: readonly string[] };
  readonly measures?: PlaceMeasuresView;

  readonly trend?: { readonly direction: "up" | "down" | "same"; readonly previousPercent: number | null; readonly previousDay: string } | null;
  readonly notCaptured?: { readonly huntedNotFound: number; readonly nothingHunts: number };
  readonly familyNotCaptured?: readonly { readonly group: string; readonly huntedNotFound: number; readonly nothingHunts: number }[];

  readonly growth?: { readonly missionStart: string; readonly starting: { readonly n: number; readonly of: number; readonly percent: number | null }; readonly grown: { readonly n: number; readonly of: number; readonly percent: number | null }; readonly added: number } | null;
  readonly profiles?: { readonly words: string; readonly figures: { readonly fields: readonly { readonly key: string; readonly label: string; readonly applies: number; readonly held: number | null }[]; readonly notMeasured: readonly string[] } };
}

export interface SystemGroup {
  readonly group: string;
  readonly name: string;
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

  readonly score?: PlaceScoreView | null;
}

export interface AccountReading {
  readonly provider: string;
  readonly amountUsd: number | null;
  readonly how: string;
  readonly old?: boolean;
}

export interface SpendLimit {
  readonly name: string;
  readonly figure: string;

  readonly usedUsd: number | null;
  readonly limitUsd: number | null;
  readonly fraction: number | null;
  readonly note: string;
  readonly tone: "hunt" | "warn" | "neutral";
}

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

  readonly reconciliation: readonly {
    readonly provider: string; readonly periodStart: string; readonly periodEnd: string;

    readonly requestPriced: boolean;
    readonly huntUsd: number | null; readonly huntKnownUsd: number; readonly otherUsd: number | null; readonly otherKnownUsd: number;
    readonly providerUsd: number | null; readonly differenceUsd: number | null; readonly unpriced: number }[] | null;
  readonly readings: readonly {
    readonly provider: string; readonly status: string; readonly stale: boolean; readonly syncedAt: string | null; readonly attemptedAt: string;
    readonly periodStart: string; readonly periodEnd: string; readonly reportedUsd: number | null; readonly estimatedUsd: number | null;
    readonly error: string | null; readonly detail: string; readonly credits: string | null; readonly accounts: readonly string[]; readonly limits: readonly string[];
    readonly units: readonly { readonly label: string; readonly value: number; readonly unit: string }[] }[];
  readonly otherServices: string;

  readonly byDay: {
    readonly providers: readonly { readonly provider: string; readonly note: string | null }[];
    readonly days: readonly { readonly day: string; readonly cells: readonly ({ readonly usd: number | null; readonly usage: string | null } | null)[] }[];
    readonly technical: readonly string[];
  };
}

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

export interface PublicationRow {
  readonly contract: string;
  readonly verdict: "READER_VISIBLE" | "READBACK_FAILED" | "PUBLISHED_NOT_READ_BACK" | "PUBLISHED_NO_READER_SURFACE" | "NOT_PUBLISHED";
  readonly words: string;
  readonly publishedAt: string | null;
  readonly readback: { readonly status: "PASS" | "FAIL"; readonly at: string } | null;
  readonly attempt: { readonly state: string; readonly at: string; readonly failureCode: string | null } | null;
}
interface PublicationView {
  readonly ballotPublications?: Readonly<Record<string, import("@/lib/civic-data/ballot-publication").BallotPublicationResult |
    import("@/lib/civic-data/ballot-publication").BallotPublicationSummary>>;
  readonly total: number;
  readonly counts: readonly { readonly verdict: PublicationRow["verdict"]; readonly words: string; readonly count: number }[];
  readonly latestAttemptFailing: number;
  readonly notVisible: readonly PublicationRow[];
  readonly notVisibleHidden: number;
}

export interface SentInstruction {
  readonly id: string;
  readonly words: string;
  readonly sentAt: string;
  readonly state: "waiting" | "carried" | "finished" | "cancel-requested" | "cancelled";
  readonly stateWords: string;
  readonly ranAs: string | null;
  readonly canCancel: boolean;
}

export interface TrailEvent {
  readonly id: string;
  readonly stage: "SOURCE" | "ATTEMPT" | "SAVED" | "EXTRACTED" | "CHECKED" | "PUBLISHED" | "READER";
  readonly at: string | null;
  readonly title: string;
  readonly says: string;
  readonly nextAction: string | null;
  readonly sourceUrl: string | null;
  readonly publicUrl: string | null;
  readonly privateCopy: { readonly path: string; readonly byteLength: number } | null;
  readonly references: readonly (readonly [string, string])[];
}
export interface TrailView {
  readonly events: readonly TrailEvent[];
  readonly eventsHidden: number;
  readonly gaps: readonly string[];
}
export interface ReachedView {
  readonly total: number;
  readonly rows: readonly { readonly id: string; readonly label: string; readonly relation: "created" | "reordered" | "other"; readonly at: string }[];
}

export interface SpendView {
  readonly modelSpend?: import("../../../../lib/control-plane/admin-view/model-spend.ts").ModelSpendView | null;
  readonly huntCost?: import("../../../../lib/hunt/cost-per-fact.ts").HuntCostView | null;
  readonly windowDays: number;
  readonly byTier: readonly { readonly key: string; readonly tier: "haiku" | "sonnet" | "opus" | "older" | "unrecorded"; readonly name: string; readonly usd: number; readonly requests: number }[];
  readonly byDay: readonly { readonly day: string; readonly anthropicUsd: number; readonly searchUsd: number; readonly byModel: readonly { readonly name: string; readonly usd: number }[]; readonly rows: number }[];

  readonly byMonth: readonly { readonly month: string; readonly anthropicUsd: number; readonly searchUsd: number; readonly byTier: readonly { readonly name: string; readonly usd: number }[]; readonly rows: number }[];
  readonly work: readonly WorkCost[];
  readonly anthropicUsd: number;
  readonly searchUsd: number;

  readonly unpricedRows: number;
  readonly neon: { readonly kind: "recorded" | "not-recorded"; readonly detail: string | null;
    readonly readerReads?: readonly { readonly day: string; readonly route: string; readonly read: string;
      readonly requests: number; readonly requestBytes: number; readonly responseBytes: number }[];
    readonly days: readonly { readonly day: string; readonly responseBytes: number; readonly requestBytes: number; readonly requests: number }[] };

  readonly last24h?: { readonly modelUsd: number; readonly unpricedRows: number } | null;
  readonly readAt?: string;
  readonly scoutOutcomes?: readonly { readonly recordClass: string; readonly found: number; readonly route: number; readonly total: number }[] | null;

  readonly setAsideUsd?: number | null;

  readonly dailyLimitUsd?: number | null;

  readonly huntersNow?: number | null;

  readonly worstCaseCharges?: number | null;
}

export interface TrendWeek {
  readonly week: string;

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

export interface ScoreboardRow {
  readonly id: string;
  readonly name: string;
  readonly value: string | null;

  readonly counts: string | null;
  readonly says: string;
  readonly notMeasured: string | null;
  readonly items?: readonly string[];
  readonly technical?: readonly string[];

  readonly trend?: readonly { readonly label: string; readonly value: number | null }[];
  readonly images?: readonly { readonly label: string; readonly src: string }[];
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

export interface ScoreboardFraction { readonly n: number; readonly of: number }

export interface ScoreboardPlaceRow {
  readonly label: string;
  readonly completeness: ScoreboardFraction;
  readonly freshness: ScoreboardFraction;
  readonly delivery: ScoreboardFraction;
  readonly trend: string;
}

export interface ScoreboardFamilyRow { readonly name: string; readonly completeness: ScoreboardFraction }

export interface ScoreboardMissionRow {
  readonly label: string;
  readonly startedAt: string;
  readonly coreLive: string;
  readonly withinHour: boolean | null;
}

/** One full hour from the independent line keeper (Now). A number nobody recorded is null and shows "—". */
export interface ScoreboardVitalHour {
  readonly hour: string;
  readonly factsLive: number | null;
  readonly factsLiveConfirmed?:boolean;
  readonly costPerFactUsd: number | null;
  readonly neonGb: number | null;
  readonly neonAtLeast?:boolean;
  readonly overNeonTarget: boolean | null;
  readonly roundsFinished: number | null;
  readonly roundsKilled: number | null;
  readonly paidJobsEndedEmpty: number | null;
  readonly paidJobsEnded: number | null;
}

export interface ScoreboardView {
  readonly lineKeeper?: string;
  readonly rows: readonly ScoreboardRow[];
  readonly byPlace: readonly ScoreboardPlaceRow[];
  readonly byFamily: readonly ScoreboardFamilyRow[];
  readonly missions: readonly ScoreboardMissionRow[];
  readonly flow: readonly ScoreboardFlowDay[] | null;
  readonly vital: readonly ScoreboardVitalHour[] | null;

  readonly gates: { readonly rows: readonly ScoreboardGateRow[]; readonly pass: number; readonly attention: number; readonly notMeasured: number } | null;
  readonly readiness: readonly ScoreboardReadinessRow[];
  readonly learning: LearningView;
}

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

  readonly taskStage: number | null;
  readonly taskId: string | null;
  readonly linkedStuck: readonly string[];
  readonly origin: "engineering" | "automatic";
  readonly technical: string;
  readonly shots?: readonly FixShot[];
}

export interface FixShot { readonly label: string; readonly image: string }

export interface ClosedFix {
  readonly id: string;
  readonly title: string;
  readonly changed: string;
  readonly places: string;
  readonly fixedAt: string;
  readonly origin: "Engineering fix" | "Automatic repair";
  readonly whatChanged: string;
  readonly readerRecheck: string;
  readonly since: string;
  readonly saved: string;
  readonly usedBy: string;
  readonly returnedDetail?: string;
  readonly history?: string;
  readonly technical: string;
  readonly shots?: readonly FixShot[];
}

export interface TestingFix {
  readonly id: string;
  readonly title: string;
  readonly works: number;
  readonly tried: number;
  readonly needPlaces: number;
  readonly next: string;
  readonly since: string;
  readonly brokeSince?: string | null;
}

export interface FixView {
  readonly open: readonly OpenFix[];
  readonly closed: readonly ClosedFix[];
  readonly returned: readonly ClosedFix[];
  readonly testing?: readonly TestingFix[];
  readonly look?: LookView | null;
}

export type ActionKind =
  "ballot-publish" |
  "officials-check" |
  "focus" |
  "decide" | "leads-send" | "hunt-start" | "hunt-start-many" | "hunt-pause" | "hunt-resume" | "hunt-limit" | "hunt-stop" | "hunt-stop-state" | "hunt-stop-all" | "global-paid" | "global-paid-resume" | "global-runner-pause" | "global-runner-resume" | "global-ceiling" | "global-search-on" | "global-search-off" | "send-agents" | "cancel-send" | "order-schedule" | "order-unschedule" | "target-set" | "target-clear" | "data-switch-on" | "data-switch-off" | "setting-set" | "setting-undo" | "owed-add" | "owed-decline" | "owed-undo";

export type ReceiptStatus = "queued" | "read" | "running" | "done" | "partial" | "refused" | "failed" | "unknown";
export const PENDING_STATUSES: readonly ReceiptStatus[] = ["queued", "read", "running", "unknown"];

export interface Lifecycle {
  readonly saved: string | null;
  readonly workersReceived: string | null;
  readonly workStarted: string | null;
  readonly workFinished: string | null;
  readonly factsChecked: string | null;
  readonly published: string | null;
  readonly checkedOnPublicPage: string | null;
}

export interface ReceiptItem {
  readonly name: string;
  readonly status: ReceiptStatus;
  readonly note: string;

  readonly label?: string;
}

export interface UiReceipt {

  readonly key: string;
  readonly kind: ActionKind;
  readonly target: string;
  readonly targetName: string;
  readonly label: string;
  readonly scopeKey: string;
  readonly scopeName: string;
  readonly level: "local" | "global";
  readonly status: ReceiptStatus;
  readonly statusWords: string;
  readonly steps: readonly { readonly label: string; readonly at: string }[];
  readonly says: string;
  readonly items: readonly ReceiptItem[];
  readonly lifecycle: Lifecycle;

  readonly simulated: boolean;

  readonly gatewayType: string | null;
  readonly gatewayReceiptId: string | null;
  readonly readBackAt: string | null;
  readonly notPickedUp?: boolean;
  readonly finishBy?: string | null;
  readonly scheduledParentId?: string;

  readonly change?: { readonly before: string; readonly after: string };
  readonly plan?: import("../../../../lib/control-plane/gateway/confirmation.ts").OrderPlan;
  readonly progress?: import("../../../../lib/control-plane/gateway/confirmation.ts").OrderProgress;
  readonly replayed: boolean;
  readonly sentAt: string;
  readonly words?: string;
}

export type ChartColor = "teal" | "blue" | "amber" | "gray" | "coral" | "violet" | "dark";

export interface AdminV6Data {
  readonly places: Sourced<readonly Place[]>;
  readonly hunts: Sourced<readonly Hunt[]>;
  readonly national: Sourced<readonly StateRow[]>;
  readonly results: Sourced<readonly ReaderResult[]>;
  readonly officials?: Sourced<import("@/lib/control-plane/admin-view/officials-results.ts").OfficialsResults>;
  readonly stuck: Sourced<readonly StuckItem[]>;
  readonly sameCause: Sourced<readonly SameCause[]>;
  readonly workRows: Sourced<{ readonly rows: readonly WorkRow[]; readonly totals: readonly WorkStageTotal[] }>;
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

export function usd(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pctDown(part: number, whole: number): string {
  if (!whole) return "—";
  return (Math.floor((part / whole) * 1000) / 10).toFixed(1) + "%";
}

export function mstDay(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "not reported";
  return new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_ZONE, month: "short", day: "numeric" }).format(new Date(iso));
}

export function count(n: number): string {
  return n.toLocaleString("en-US");
}

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
