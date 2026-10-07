/**
 * A job is running only when its Attempt is open and its own lease is unreleased and unexpired at read time. A heartbeat
 * or lease renewal is only "switched on", never progress. A job is placed only through its exact Send or declared scope
 * divisions; a read that reached its row limit gives lower bounds.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { openControlPlane, readAdminConfig, RUNNER_ID } from "../admin-data.ts";
import { EASTERN_ZONE } from "../eastern-time.ts";
import type { Attempt, ExecutionLease } from "../attempt.ts";
import { expansionScopesOf, type ExpansionScopeDecision } from "../expansion/scopes.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { HUNT_SOURCE_PROGRESS_LOG_KEY, livenessOf, type HuntSourceProgress } from "../owner-surface.ts";
import { recordClassWords } from "../plain-work.ts";
import type { RunningJobRow } from "../repository/running-jobs.ts";
import type { StateProgress } from "../repository/state-progress.ts";
import type { ControlPlaneRepositories, RecordProjection } from "../repository/types.ts";
import { laneGauges, queueLanesOf } from "../scheduler/lane-reading.ts";
import type { ObligationAssignment } from "../scheduler/obligation.ts";
import { RESEARCH_STATE_ID, type RunningScout } from "../scheduler/research-policy.ts";
import { RUNNER_PROGRESS_HEARTBEAT_FIELDS } from "./runner-progress-read.ts";
import { ROLE_WORDS } from "./v6-agents-read.ts";
import { migrationOutcomeOf, PRODUCTION_MIGRATION_HEADLINE } from "../../db/migration-phases.ts";
import type { UpdateCard } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import { runnerCycleOf, type CycleHeartbeat, type RunnerCycle } from "../runner-standing.ts";
import { MODELS, canonicalModelId, modelTierFor } from "../../models.ts";
import { readAreaZips } from "./v6-national-geography.ts";
import { huntName, scopedHunts, sectionRevision, validateV6Query, type AdminV6SectionEnvelope, type V6PlaceScope, type V6Refusal } from "./v6-hunts-read.ts";

export const ADMIN_V6_WORKERS_CONTRACT = "admin-v6/workers@1" as const;
export const WORKERS_RUNNING_MAX = 16;
export const WORKERS_SOURCE_EVENT_LIMIT = 25;
export const WORKERS_EVENT_LIMIT = 20;
const ASSIGNMENT_READING_MAX = 64;

export const WORKERS_RESEARCH_FIELDS = {
  beatAt: true, cycleStartedAt: true, cycleFinishedAt: true, pausedByOwner: true,
  queue: ["lanes"], running: true, fleetSafety: ["deferred"], researchProgression: ["windowId", "since", "through", "promoted", "readerVisible"],
  assignments: true,
} as const satisfies RecordProjection;
const ATTEMPT_FIELDS = { id: true, routeTaskId: true, workItemId: true, worker: true, leaseId: true, startedAt: true,
  endedAt: true, outcome: true } as const satisfies RecordProjection;
const OBLIGATION_FIELDS = { id: true, recordClass: true, assignments: true } as const satisfies RecordProjection;

export const DEP_WORKER_ACTIVE_INDEX = "DEP-WORKER-ACTIVE-INDEX";
export const NO_PROGRESS_MS = 10 * 60_000;
const REFUSAL_WORDS: Readonly<Record<string, string>> = {
  UNMEASURED_MODEL_SPEND: "the spending total is unknown",
  CEILING: "the spending limit is reached",
  DISPATCH_CEILING: "the limit on jobs per round is reached",
  WALL_CLOCK_CEILING: "the round ran out of time",
  PROVIDER_REQUEST_CEILING: "the request limit is reached",
  PAYLOAD_BYTE_CEILING: "the data limit is reached",
  WEBSITE_REQUEST_CAP: "the limit on requests to one website is reached",
  OWNER_PAUSED: "paid research is paused",
  MODEL_LANE_CLOSED: "that model is turned off",
  PROVIDER_CIRCUIT_BROKEN: "the provider is failing",
};

/** Structurally `WorkerStatus` in app/(admin)/_mw/admin-v6/model.ts. */
export interface V6WorkerStatus {
  readonly lastCheckIn: string | null;
  readonly lastUsefulProgress: { readonly at: string; readonly what: string } | null;
  readonly roundStartedAt: string | null;
  readonly noProgressSince?: string | null;
  readonly refused?: { readonly count: number; readonly why: string } | null;
  readonly lastRoundFinishedAt: string | null;
  readonly nextRoundDueAt: string | null;
  readonly runnerState: string | null;
  readonly cycle?: RunnerCycle | null;
  readonly lanes: readonly { readonly name: string; readonly active: number | null; readonly waiting: number; readonly blockedBy: string | null }[] | null;
  readonly unread: readonly string[];
}
export interface V6WaitingItem {
  readonly kind: string; readonly title: string; readonly why: string; readonly nextTime: string; readonly owner: string;
  readonly applies: readonly string[]; readonly actions: readonly never[];
}
export interface V6WorkerEvent {
  readonly at: string; readonly kind: string; readonly text: string; readonly applies: readonly string[];
  readonly tone: "good" | "info" | "warn";
}
export type V6WorkerStage = "finding" | "collecting" | "extracting" | "checking" | "publishing";
/** Structurally `WorkerJob` in model.ts. A figure the lease and attempt do not carry is "—". */
export interface V6WorkerJob {
  readonly id: string;
  readonly stage: V6WorkerStage;
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
export interface V6WorkersRunning {
  readonly count: number;
  readonly system: number;
  /** True when the read reached its row limit: both counts are then lower bounds. */
  readonly lowerBound: boolean;
}
export interface AdminV6WorkersView {
  readonly status: V6WorkerStatus;
  readonly jobs: readonly V6WorkerJob[] | null;
  readonly running: V6WorkersRunning | null;
  readonly waiting: readonly V6WaitingItem[] | null;
  readonly events: readonly V6WorkerEvent[] | null;
  readonly update: UpdateCard | null;
  readonly next: readonly string[] | null;
}

type Read<T> = { readonly state: "READ"; readonly value: T; readonly revision: number } | { readonly state: "MISSING" } | { readonly state: "UNREAD" };

export interface ScoutEvidence {
  readonly scout: RunningScout;
  readonly attempt: Read<Partial<Attempt>>;
  readonly lease: Read<Partial<ExecutionLease>>;
  readonly obligation: Read<{ readonly recordClass?: unknown; readonly assignments?: unknown }>;
}

export interface V6WorkersSources {
  readonly readAt: string;
  readonly config: { readonly state: "READ"; readonly scopes: readonly ExpansionScopeDecision[]; readonly malformed: number }
    | { readonly state: "UNREAD"; readonly detail: string };
  readonly heartbeat: Read<Partial<CycleHeartbeat>>;
  readonly research: Read<Record<string, unknown>>;
  readonly sourceEvents: { readonly state: "READ"; readonly records: readonly unknown[] } | { readonly state: "UNREAD" };
  readonly scouts: readonly ScoutEvidence[] | null;
  readonly jobs: { readonly state: "READ"; readonly rows: readonly RunningJobRow[]; readonly truncated: boolean } | { readonly state: "UNREAD" };
  readonly stateProgress: { readonly state: "READ"; readonly value: StateProgress | null } | { readonly state: "UNREAD" } | { readonly state: "NOT_ASKED" };
  readonly migration?: unknown;
  readonly scopeZips?: ReadonlySet<string> | null;
}

const clock = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const text = (value: unknown, max = 200): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

async function point<T>(read: () => Promise<{ readonly revision: number; readonly value: unknown } | null>): Promise<Read<T>> {
  try {
    const row = await read();
    return row === null ? { state: "MISSING" } : { state: "READ", value: row.value as T, revision: row.revision };
  } catch { return { state: "UNREAD" }; }
}

export function runningScoutsOf(research: unknown): readonly RunningScout[] | null {
  const running = (research as { running?: unknown } | null)?.running;
  if (!Array.isArray(running) || running.length > WORKERS_RUNNING_MAX) return null;
  const ok = running.every((row: Partial<RunningScout>) => row !== null && typeof row === "object" && text(row.attemptId) &&
    text(row.obligationId) && clock(row.startedAt) && (row.assignmentKeys === undefined ||
      Array.isArray(row.assignmentKeys) && row.assignmentKeys.length <= 16 && row.assignmentKeys.every(key => text(key))));
  return ok ? running as RunningScout[] : null;
}

export async function readV6WorkersSources(repos: ControlPlaneRepositories, readAt: string, scope: V6PlaceScope | null = null): Promise<V6WorkersSources> {
  const [config, heartbeat, research, sourceEvents, jobs, stateProgress, migration, scopeZips] = await Promise.all([
    readAdminConfig(repos),
    point<Partial<CycleHeartbeat>>(() => repos.runnerHeartbeat.readNarrowed(RUNNER_ID, RUNNER_PROGRESS_HEARTBEAT_FIELDS)),
    point<Record<string, unknown>>(() => repos.researchState.readNarrowed(RESEARCH_STATE_ID, WORKERS_RESEARCH_FIELDS)),
    repos.ownerDigests.readRecent(HUNT_SOURCE_PROGRESS_LOG_KEY, WORKERS_SOURCE_EVENT_LIMIT)
      .then(records => ({ state: "READ" as const, records }), () => ({ state: "UNREAD" as const })),
    repos.activeWorkClaims.readRunningJobs({ nowIso: readAt })
      .then((page): V6WorkersSources["jobs"] => page.available ? { state: "READ", rows: page.rows, truncated: page.truncated } : { state: "UNREAD" },
        (): V6WorkersSources["jobs"] => ({ state: "UNREAD" })),
    scope?.kind !== "state" ? Promise.resolve<V6WorkersSources["stateProgress"]>({ state: "NOT_ASKED" })
      : repos.activeWorkClaims.readLatestStateProgress({ state: scope.state })
        .then((page): V6WorkersSources["stateProgress"] => page.available ? { state: "READ", value: page.progress } : { state: "UNREAD" },
          (): V6WorkersSources["stateProgress"] => ({ state: "UNREAD" })),
    Promise.all([
      repos.ownerDigests.readRecentWhere("owner-digest", ["headline"], PRODUCTION_MIGRATION_HEADLINE, 1,
        { headline: true, writtenAt: true, migration: ["phase", "state", "summary", "targetHost"] }),
      ...(["expand", "contract"] as const).map(phase =>
        repos.ownerDigests.readRecentWhere("owner-digest", ["migration", "phase"], phase, 1,
          { headline: true, writtenAt: true, migration: ["phase", "state", "summary", "targetHost"] })),
    ])
      .then(rows => rows.flat().filter((row): row is { headline: string; writtenAt: string; migration: unknown } =>
        row !== null && typeof row === "object" && "headline" in row && row.headline === PRODUCTION_MIGRATION_HEADLINE &&
        "writtenAt" in row && clock(row.writtenAt) && "migration" in row && migrationOutcomeOf(row.migration) !== null)
        .sort((a, b) => Date.parse(b.writtenAt) - Date.parse(a.writtenAt))
        .filter((row, index, rows) => rows.findIndex(other => other.writtenAt === row.writtenAt &&
          migrationOutcomeOf(other.migration)?.phase === migrationOutcomeOf(row.migration)?.phase) === index), () => ({ unread: true })),
    readAreaZips(scope),
  ]);
  const running = research.state === "READ" ? runningScoutsOf(research.value) : null;
  const scouts = running === null ? null : await Promise.all(running.map(async (scout): Promise<ScoutEvidence> => {
    const [attempt, obligation] = await Promise.all([
      point<Partial<Attempt>>(() => repos.attempts.readNarrowed(scout.attemptId, ATTEMPT_FIELDS)),
      point<{ recordClass?: unknown; assignments?: unknown }>(() => repos.obligations.readNarrowed(scout.obligationId, OBLIGATION_FIELDS)),
    ]);
    const taskId = attempt.state === "READ" ? attempt.value.routeTaskId : undefined;
    const lease: Read<Partial<ExecutionLease>> = !text(taskId) ? { state: attempt.state === "UNREAD" ? "UNREAD" : "MISSING" }
      : await point<Partial<ExecutionLease>>(() => repos.leases.read(taskId));
    return { scout, attempt, lease, obligation };
  }));
  const parsed = config.kind === "HELD" ? expansionScopesOf(config.value) : null;
  return {
    readAt,
    config: config.kind === "STORE_UNREACHABLE" ? { state: "UNREAD", detail: config.detail }
      : { state: "READ", scopes: parsed?.scopes ?? [], malformed: parsed?.malformed ?? 0 },
    heartbeat, research, sourceEvents, scouts, jobs, stateProgress, migration, scopeZips,
  };
}

const EASTERN = new Intl.DateTimeFormat("en-US", { timeZone: EASTERN_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** Eastern time, despite the name. */
const mstWords = (iso: string) => `${EASTERN.format(new Date(iso))} ET`;

function modelWords(version: unknown): string {
  if (!text(version)) return "Not recorded";
  const tier = modelTierFor(canonicalModelId(version));
  return tier ? `${MODELS[tier].plainRole} (${MODELS[tier].name})` : version;
}

const SOURCE_STAGE: Readonly<Record<HuntSourceProgress["stage"], { kind: string; says: string; tone: V6WorkerEvent["tone"] }>> = {
  QUEUED: { kind: "Queued", says: "was put in line to run", tone: "info" },
  COLLECTING_AND_VERIFYING: { kind: "Collecting", says: "started collecting and checking", tone: "info" },
  PUBLISHED: { kind: "Published", says: "was checked and published", tone: "good" },
  REUSED: { kind: "Reused", says: "was already current", tone: "good" },
  HELD: { kind: "Held", says: "was held back", tone: "warn" },
  FAILED: { kind: "Failed", says: "stopped before publishing", tone: "warn" },
};

const FAILURE_WORDS: Readonly<Record<string, string>> = {
  RECEIPT_COUNT_INVALID: "No receipt was saved.",
};
function failureWords(detail: unknown): string {
  const code = typeof detail === "string" ? /^([A-Z][A-Z0-9_]{2,63})\b/.exec(detail)?.[1] ?? null : null;
  if (code === null) return "Stopped before publishing.";
  return `${FAILURE_WORDS[code] ?? "Stopped before publishing."} Code: ${code}.`;
}

const sourceName = (sourceId: string) => `The ${sourceId.replaceAll(/[-_]/g, " ")} source`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

type Relation = "member" | "outside" | "unresolved";

interface Binding {
  readonly all: boolean;
  readonly members: readonly ExpansionScopeDecision[];
  readonly saved: readonly ExpansionScopeDecision[];
}

function sendRelation(binding: Binding, key: string, ref: string): Relation {
  if (binding.all) return "member";
  if (binding.members.some(d => d.key === key && d.receiptId === ref)) return "member";
  return binding.saved.some(d => d.key === key && d.receiptId === ref) ? "outside" : "unresolved";
}

function sendsRelation(binding: Binding, sends: readonly { readonly key: string; readonly ref: string }[]): Relation {
  if (binding.all) return "member";
  const each = sends.map(s => sendRelation(binding, s.key, s.ref));
  if (each.includes("member")) return "member";
  return each.length > 0 && each.every(r => r === "outside") ? "outside" : "unresolved";
}

function scoutSends(evidence: ScoutEvidence): readonly { key: string; ref: string }[] | null {
  if (evidence.obligation.state !== "READ") return null;
  const marks = evidence.obligation.value.assignments;
  if (marks === undefined) return [];
  if (!Array.isArray(marks)) return null;
  const started = Date.parse(evidence.scout.startedAt);
  return (marks as Partial<ObligationAssignment>[]).filter(m => text(m.assignmentKey) && text(m.ref) && clock(m.at) && Date.parse(m.at) <= started &&
    (evidence.scout.assignmentKeys === undefined || evidence.scout.assignmentKeys.includes(m.assignmentKey)))
    .map(m => ({ key: m.assignmentKey!, ref: m.ref! }));
}

function namesOf(binding: Binding, sends: readonly { key: string; ref: string }[]): string {
  const names = [...new Set(sends.flatMap(s => binding.saved.filter(d => d.key === s.key && d.receiptId === s.ref).map(huntName)))];
  return names.length === 0 ? "work not tied to a current hunt" : names.length === 1 ? `the ${names[0]}` : `${names.length} hunts (${names.join(", ")})`;
}

type ScoutState = "RUNNING" | "EXPIRED" | "ENDED" | "UNKNOWN";

/** Running only with an open Attempt and its own unreleased, unexpired lease at `now`. */
export function scoutState(evidence: ScoutEvidence, now: string): ScoutState {
  if (evidence.attempt.state !== "READ") return "UNKNOWN";
  const a = evidence.attempt.value;
  if (a.outcome !== null && a.outcome !== undefined) return "ENDED";
  if (evidence.lease.state === "UNREAD") return "UNKNOWN";
  const lease = evidence.lease.state === "READ" ? evidence.lease.value : null;
  const live = lease !== null && lease.id === a.leaseId && lease.released === false && clock(lease.expiresAt) &&
    Date.parse(lease.expiresAt) > Date.parse(now);
  return live ? "RUNNING" : "EXPIRED";
}

export interface RunningJob {
  readonly row: RunningJobRow & { readonly attempt: NonNullable<RunningJobRow["attempt"]> };
  readonly hunts: readonly ExpansionScopeDecision[];
  readonly sends: readonly { readonly key: string; readonly ref: string }[];
  readonly national: boolean;
  readonly states: readonly { readonly state: string; readonly exact: boolean }[];
}

const NATIONAL_DIVISION = "ocd-division/country:us";
const STATE_DIVISION = /^ocd-division\/country:us\/state:([a-z]{2})(\/|$)/;

export function runningJobsOf(rows: readonly RunningJobRow[], now: string, binding: Binding): RunningJob[] {
  const at = Date.parse(now);
  const out: RunningJob[] = [];
  for (const row of rows) {
    const a = row.attempt;
    if (a === null || a.endedAt !== null || a.outcome !== null || a.leaseId !== row.leaseId) continue;
    if (row.released || !(Date.parse(row.expiresAt) > at)) continue;
    const started = Date.parse(a.startedAt);
    const marks = (row.obligation?.assignments ?? []).filter(m => clock(m.at) && Date.parse(m.at) <= started);
    const sends = marks.map(m => ({ key: m.assignmentKey, ref: m.ref }));
    const hunts = [...new Map(binding.saved.filter(d => sends.some(x => x.key === d.key && x.ref === d.receiptId)).map(d => [d.key + "\n" + d.receiptId, d])).values()];
    const divisions = row.obligation?.scopeDivisions ?? [];
    out.push({ row: row as RunningJob["row"], hunts, sends,
      national: divisions.includes(NATIONAL_DIVISION),
      states: divisions.flatMap(id => { const m = STATE_DIVISION.exec(id); return m ? [{ state: m[1], exact: m[2] === "" }] : []; }) });
  }
  return out;
}

export function jobInScope(job: RunningJob, binding: Binding, scope: V6PlaceScope): boolean {
  if (binding.all) return true;
  if (sendsRelation(binding, job.sends) === "member") return true;
  if (job.national) return true;
  if (scope.kind === "state") return job.states.some(x => x.state === scope.state);
  if (scope.kind === "geo") return job.states.some(x => x.exact && x.state === scope.state);
  return false;
}

const STAGE_OF_ROLE: Readonly<Record<string, V6WorkerStage>> = {
  SCOUT: "finding", DETECTIVE: "finding", DISCOVERY_SEARCH: "finding", ACQUIRER: "collecting", PARSER: "extracting",
  VALIDATOR: "checking", ADVERSARIAL_AUDITOR: "checking", ENGINEERING: "checking", RELEASE_ORCHESTRATOR: "publishing",
};

function sinceWords(startedAt: string, now: string): string {
  const min = Math.max(0, Math.floor((Date.parse(now) - Date.parse(startedAt)) / 60_000));
  return min < 1 ? "just started" : min < 60 ? `${min} min so far` : `${Math.floor(min / 60)} h ${min % 60} min so far`;
}

function jobView(job: RunningJob, scopeKey: string, now: string): V6WorkerJob {
  const a = job.row.attempt, o = job.row.obligation;
  const role = ROLE_WORDS[a.role] ?? a.role.toLowerCase().replaceAll("_", " ");
  return {
    id: a.id, stage: STAGE_OF_ROLE[a.role] ?? "collecting",
    title: `${role} · ${o?.subjectId ?? "—"}`, placeKey: scopeKey,
    hunt: job.hunts.length > 0 ? job.hunts.map(huntName).join("; ") : job.national ? "Shared national" : job.states.length > 0 ? "Shared statewide" : "—",
    requirement: o === null ? "—" : recordClassWords(o.recordClass), startedAt: a.startedAt, elapsed: sinceWords(a.startedAt, now),
    method: role,
    model: a.role === "ACQUIRER" ? "No AI (plain code)" : a.version !== null && /haiku|sonnet|opus|fable/i.test(a.version) ? modelWords(a.version) : "—",
    modelWhy: "—", cost: "—", latest: "—", next: "—",
  };
}

function stateProgressWords(p: StateProgress): string {
  return p.kind === "PROMOTION" ? `Approved for promotion · ${recordClassWords(p.detail)} · ${p.subject}`
    : `${p.detail === "ADVERSARIAL_AUDITOR" ? "Auditor could not break it" : "Validator passed"} · ${p.subject}`;
}

interface SourceRow { readonly at: string; readonly p: HuntSourceProgress }

function sourceRows(records: readonly unknown[]): { rows: SourceRow[]; invalid: number } {
  const rows: SourceRow[] = [];
  let invalid = 0;
  for (const record of records) {
    const p = (record as { huntSourceProgress?: Partial<HuntSourceProgress> } | null)?.huntSourceProgress;
    if (!p || !clock(p.at) || !p.stage || !(p.stage in SOURCE_STAGE) || !text(p.taskId) || !text(p.sourceId) ||
      !Array.isArray(p.instructionIds) || p.instructionIds.length > 16 || !p.instructionIds.every(id => text(id))) { invalid++; continue; }
    rows.push({ at: p.at, p: p as HuntSourceProgress });
  }
  return { rows, invalid };
}

function sourceSends(binding: Binding, p: HuntSourceProgress): { key: string; ref: string }[] {
  return p.instructionIds.flatMap(id => {
    const d = binding.saved.filter(s => s.receiptId === id);
    return d.length === 1 ? [{ key: d[0].key, ref: id }] : [{ key: `?${id}`, ref: id }];
  });
}

export function unboundScope(scopeKey: string): V6Refusal {
  return { kind: "refused", status: 409, code: "SCOPE_BINDING_NOT_CONNECTED",
    says: `${scopeKey} is not a place this section can bind yet; governing-body identities and overlaps are not proven.`, dependency: "DEP-SCOPE-IDENTITIES" };
}

/** A list is empty only when every read that would fill it succeeded and found nothing here. */
export function v6WorkersSection(input: { readonly scopeKey: string; readonly scope: V6PlaceScope | null; readonly sources: V6WorkersSources }):
  AdminV6SectionEnvelope<AdminV6WorkersView> | V6Refusal {
  const { scopeKey, scope, sources } = input;
  const now = sources.readAt;
  if (scope === null) return unboundScope(scopeKey);
  if (sources.research.state === "UNREAD") return { kind: "refused", status: 503, code: "WORKER_STATE_UNREAD",
    says: "The saved research state could not be read, so what the workers are doing is unknown." };
  const saved = sources.config.state === "READ" ? sources.config.scopes : [];
  let binding: Binding;
  if (scope.kind === "country") binding = { all: true, members: saved, saved };
  else {
    const scoped = scopedHunts(scope, scopeKey, { scopes: sources.config.state === "READ" ? sources.config.scopes : null,
      malformedScopes: sources.config.state === "READ" ? sources.config.malformed : 0,
      configGap: sources.config.state === "UNREAD" ? sources.config.detail : null, attribution: undefined, snapshotGap: null, readAt: now,
      scopeZips: sources.scopeZips ?? null });
    if ("kind" in scoped) return scoped;
    binding = { all: false, members: [...scoped.lifetime, ...scoped.rolling], saved };
  }
  const applies = [scopeKey];
  const missing: string[] = [];
  const unread: string[] = [];

  /* status: the heartbeat says "switched on", never "made progress" */
  const hb = sources.heartbeat.state === "READ" && clock(sources.heartbeat.value.beatAt) ? sources.heartbeat.value as CycleHeartbeat : null;
  const cycle = runnerCycleOf(hb?.cycle);
  if (sources.heartbeat.state === "UNREAD" || (sources.heartbeat.state === "READ" && hb === null)) unread.push("the workers' last check-in");
  const research = sources.research.state === "READ" ? sources.research.value : null;
  const lanes = research === null ? null : queueLanesOf(research);
  const gauges = laneGauges(lanes);
  if (research !== null && gauges === null) unread.push("the queue counts");
  if (sources.sourceEvents.state === "UNREAD") unread.push("the recent source receipts");
  const started = hb && clock(hb.lastCycleStartedAt) ? hb.lastCycleStartedAt : null;
  const finished = hb && clock(hb.lastCycleFinishedAt) ? hb.lastCycleFinishedAt : null;
  const nextDue = hb && clock(hb.nextCycleDueAt) ? hb.nextCycleDueAt : null;

  const scoutRows = (sources.scouts ?? []).map(evidence => {
    const sends = scoutSends(evidence);
    return { evidence, state: scoutState(evidence, now), sends, relation: sends === null ? "unresolved" as Relation : sendsRelation(binding, sends) };
  });
  if (research !== null && sources.scouts === null) missing.push("The saved list of running paid research jobs is not a valid bounded list, so which of them are running is unknown.");
  const scoutUnknown = scoutRows.filter(r => r.state === "UNKNOWN").length;
  if (scoutUnknown > 0) missing.push(`${plural(scoutUnknown, "listed paid research job")} could not be checked against ${scoutUnknown === 1 ? "its" : "their"} saved attempt and work claim.`);
  const scoutUnplaced = scoutRows.filter(r => r.relation === "unresolved").length;
  if (scoutUnplaced > 0) missing.push(`${plural(scoutUnplaced, "listed paid research job")} could not be placed: ${scoutUnplaced === 1 ? "its" : "their"} saved task names no hunt that settles whether it is in ${scopeKey}.`);

  const read = sources.sourceEvents.state === "READ" ? sourceRows(sources.sourceEvents.records) : null;
  if (read && read.invalid > 0) missing.push(`${plural(read.invalid, "recent source receipt")} had an unreadable shape and ${read.invalid === 1 ? "was" : "were"} left out.`);
  const placed = (read?.rows ?? []).map(row => ({ row, sends: sourceSends(binding, row.p) }))
    .map(x => ({ ...x, relation: sendsRelation(binding, x.sends) }));
  const sourceUnplaced = placed.filter(x => x.relation === "unresolved").length;
  if (sourceUnplaced > 0) missing.push(`${plural(sourceUnplaced, "recent source receipt")} named an instruction that is not a saved hunt, so ${sourceUnplaced === 1 ? "it" : "they"} could not be placed.`);
  const inScope = placed.filter(x => x.relation === "member");
  if (read && read.rows.length === WORKERS_SOURCE_EVENT_LIMIT) {
    const oldest = read.rows[read.rows.length - 1].at;
    missing.push(`Only the newest ${WORKERS_SOURCE_EVENT_LIMIT} source receipts are read (back to ${mstWords(oldest)}). Older changes are not shown here.`);
  }

  /* last useful progress: a publication or a promotion, never a check-in */
  const useful: { at: string; what: string }[] = [];
  for (const x of inScope) if (x.row.p.stage === "PUBLISHED" || x.row.p.stage === "REUSED") useful.push({ at: x.row.at,
    what: `${sourceName(x.row.p.sourceId)} for ${namesOf(binding, x.sends)} ${SOURCE_STAGE[x.row.p.stage].says}.` });
  const progression = research?.researchProgression as { since?: unknown; through?: unknown; promoted?: { count?: unknown }; readerVisible?: { count?: unknown } } | null | undefined;
  const window = progression && clock(progression.since) && clock(progression.through) ? {
    since: progression.since, through: progression.through,
    promoted: count(progression.promoted?.count) ? progression.promoted!.count as number : null,
    visible: count(progression.readerVisible?.count) ? progression.readerVisible!.count as number : null } : null;
  if (binding.all && window && window.promoted !== null && window.promoted > 0) useful.push({ at: window.through,
    what: `${plural(window.promoted, "record")} promoted in the round window ending ${mstWords(window.through)}.` });
  if (sources.stateProgress.state === "READ" && sources.stateProgress.value !== null) useful.push({ at: sources.stateProgress.value.at, what: stateProgressWords(sources.stateProgress.value) });
  if (sources.stateProgress.state === "UNREAD") unread.push("the latest verified result in this state");
  useful.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const roundOpen = started !== null && (finished === null || Date.parse(finished) < Date.parse(started));
  const nothingRunning = sources.jobs.state === "READ" && sources.jobs.rows.length === 0 && (sources.scouts ?? []).length === 0;
  const activity = roundOpen && nothingRunning
    ? [started!, ...(read?.rows ?? []).map(r => r.at)]
      .filter(at => Date.parse(at) >= Date.parse(started!)).sort((a, b) => Date.parse(b) - Date.parse(a))[0] : null;
  const noProgressSince = activity !== null && Date.parse(now) - Date.parse(activity) >= NO_PROGRESS_MS ? activity : null;
  const deferred = (research?.fleetSafety as { deferred?: unknown } | null | undefined)?.deferred;
  const refusedBy = Array.isArray(deferred) ? deferred.filter((d): d is { code: string } => d !== null && typeof d === "object" && typeof (d as { code?: unknown }).code === "string" && d.code in REFUSAL_WORDS) : [];
  const refused = refusedBy.length === 0 ? null : { count: refusedBy.length, why: [...new Set(refusedBy.map(d => REFUSAL_WORDS[d.code] ?? d.code.toLowerCase().replace(/_/g, " ")))].join("; ") };

  const status: V6WorkerStatus = {
    lastCheckIn: hb?.beatAt ?? null,
    lastUsefulProgress: useful[0] ?? null,
    roundStartedAt: roundOpen ? started : null,
    noProgressSince,
    refused,
    lastRoundFinishedAt: finished,
    nextRoundDueAt: nextDue,
    runnerState: hb ? livenessOf(hb, now).state : sources.heartbeat.state === "MISSING" ? "NEVER_BEAT" : null,
    cycle,
    lanes: gauges?.map(g => ({ name: g.name, active: g.active, waiting: g.waiting, blockedBy: g.blockedBy })) ?? null,
    unread,
  };

  const reading = research?.assignments as { at?: unknown; assignments?: unknown } | null | undefined;
  const sends = reading && clock(reading.at) && Array.isArray(reading.assignments) && reading.assignments.length <= ASSIGNMENT_READING_MAX
    ? (reading.assignments as Record<string, unknown>[]).filter(r => r && text(r.key) && (r.ref === null || text(r.ref))) : null;
  const memberSends = (sends ?? []).filter(r => r.kind !== "DISPATCH" && text(r.ref) && sendRelation(binding, r.key as string, r.ref as string) === "member");
  const waiting: V6WaitingItem[] = [];
  const next: string[] = [];
  const nextTime = !nextDue ? "—" : mstWords(nextDue);
  if (research?.pausedByOwner === true) next.push("Paid research is paused.");
  for (const r of memberSends) {
    const d = binding.saved.find(s => s.key === r.key && s.receiptId === r.ref);
    const name = d ? huntName(d) : typeof r.label === "string" ? `${r.label} hunt` : `The hunt sent as ${r.key as string}`;
    const c = r.completion as { kind?: unknown; members?: unknown; settled?: unknown; exceptions?: unknown; refusedCount?: unknown; unsettledCount?: unknown } | null | undefined;
    if (c?.kind === "NOT_COMPLETE" && count(c.members) && count(c.settled)) {
      const exceptions = Array.isArray(c.exceptions) ? c.exceptions as { kind?: unknown }[] : [];
      const refused = count(c.refusedCount) ? c.refusedCount : exceptions.filter(e => e.kind === "REFUSED").length;
      const unsettled = count(c.unsettledCount) ? c.unsettledCount : exceptions.filter(e => e.kind === "UNSETTLED").length;
      const open = c.members - c.settled;
      waiting.push({ kind: "Not finished", title: `${name}: ${open.toLocaleString("en-US")} of ${plural(c.members, "assigned task")} not finished`,
        why: `${plural(refused, "task")} stopped by a check · ${plural(unsettled, "task")} unfinished`,
        nextTime, owner: "Workers", applies, actions: [] });
      next.push(`${name}: ${plural(open, "assigned task")} to finish.`);
    } else if (c?.kind === "NO_MEMBERS") {
      waiting.push({ kind: "Not started", title: `${name}: no tasks are assigned yet`,
        why: "No tasks assigned", nextTime, owner: "Workers", applies, actions: [] });
    } else if (c?.kind === "COMPLETE" && count(c.members)) {
      next.push(`${name}: all ${plural(c.members, "assigned task")} passed their checks.`);
    } else missing.push(`Whether the ${name}'s tasks are finished was not counted in the latest saved reading.`);
    const b = r.budget as { refused?: unknown; leftUsd?: unknown; heldUsd?: unknown; budgetUsd?: unknown } | null | undefined;
    if (b && count(b.refused) && b.refused > 0) waiting.push({ kind: "Money limit",
      title: `${name}: paid research turned away ${plural(b.refused, "time")} by the money limit`,
      why: `${typeof b.leftUsd === "number" ? `$${b.leftUsd.toFixed(2)}` : "—"} left of the ${typeof b.budgetUsd === "number" ? `$${b.budgetUsd.toFixed(2)}` : "—"} limit${typeof b.heldUsd === "number" && b.heldUsd > 0 ? ` · $${b.heldUsd.toFixed(2)} held` : ""}`,
      nextTime: "—", owner: "You", applies, actions: [] });
  }
  const byTask = new Map<string, typeof inScope>();
  for (const x of inScope) byTask.set(x.row.p.taskId, [...(byTask.get(x.row.p.taskId) ?? []), x]);
  for (const [, rows] of byTask) {
    const latest = rows[0];
    if (latest.row.p.stage !== "FAILED" && latest.row.p.stage !== "HELD") continue;
    const failures = rows.filter(x => x.row.p.stage === latest.row.p.stage);
    const since = failures[failures.length - 1].row.at;
    waiting.push({ kind: latest.row.p.stage === "FAILED" ? "Keeps failing" : "Held",
      title: `${sourceName(latest.row.p.sourceId)} for ${namesOf(binding, latest.sends)}: ${failures.length === 1 ? (latest.row.p.stage === "FAILED" ? "failed" : "held") : `${failures.length} ${latest.row.p.stage === "FAILED" ? "failed tries" : "holds"} since ${mstWords(since)}`}`,
      why: latest.row.p.stage === "FAILED" ? failureWords(latest.row.p.detail) : "Held back",
      nextTime: "—",
      owner: failures.length > 1 ? "Engineering (the same failure keeps coming back)" : "Workers", applies, actions: [] });
  }
  if (binding.all && gauges) for (const g of gauges) if (g.waiting > 0) waiting.push({ kind: "In line",
    title: `${plural(g.waiting, "task")} waiting: ${g.name.toLowerCase()}`,
    why: g.blockedBy ? g.blockedBy : "—",
    nextTime: g.oldestWaitingDueAt ? `Oldest due ${mstWords(g.oldestWaitingDueAt)}` : nextTime, owner: "Workers", applies, actions: [] });
  // "Nothing is waiting" is provable only for the whole country, from the queue counts. In a place,
  // work not sent to a hunt cannot be placed, so an empty list there would be a guess.
  const waitingComplete = binding.all && gauges !== null && sources.sourceEvents.state === "READ";
  if (!binding.all) missing.push(`Only work sent to a hunt is split by place. Other queued work is counted for the whole system only, in the lane counts.`);
  if (!binding.all && sends === null) missing.push("The runner's per-hunt reading of finished and unfinished tasks could not be read.");

  const events: (V6WorkerEvent & { iso: string })[] = [];
  for (const [, rows] of byTask) {
    const newest = rows[0], p = newest.row.p, stage = SOURCE_STAGE[p.stage];
    const same = rows.filter(x => x.row.p.stage === p.stage);
    const times = same.length > 1 ? ` ${same.length} times since ${mstWords(same[same.length - 1].row.at)}` : "";
    events.push({ iso: newest.row.at, at: mstWords(newest.row.at), kind: stage.kind, tone: stage.tone, applies,
      text: `${sourceName(p.sourceId)} for ${namesOf(binding, newest.sends)} ${stage.says}${times}.${p.stage === "FAILED" ? ` ${failureWords(p.detail)}` : ""}` });
  }
  for (const r of scoutRows) {
    if (r.relation !== "member" || r.state === "UNKNOWN") continue;
    const a = r.evidence.attempt.state === "READ" ? r.evidence.attempt.value : {};
    const what = `Paid research on a ${r.evidence.obligation.state === "READ" ? recordClassWords(r.evidence.obligation.value.recordClass as string) : "public record"} task for ${namesOf(binding, r.sends ?? [])}`;
    const lease = r.evidence.lease.state === "READ" ? r.evidence.lease.value : null;
    if (r.state === "RUNNING") events.push({ iso: r.evidence.scout.startedAt, at: mstWords(r.evidence.scout.startedAt), kind: "Paid research started", tone: "info", applies,
      text: `${what} is running now with ${modelWords(a.worker?.version)}. Work claim holds until ${mstWords(lease!.expiresAt!)}.` });
    else if (r.state === "EXPIRED") events.push({ iso: r.evidence.scout.startedAt, at: mstWords(r.evidence.scout.startedAt), kind: "No live work claim", tone: "warn", applies,
      text: `${what} started ${mstWords(r.evidence.scout.startedAt)}; its work claim ${lease && clock(lease.expiresAt) ? `ran out ${mstWords(lease.expiresAt)}` : "is gone"}.` });
    else if (clock(a.endedAt)) events.push({ iso: a.endedAt, at: mstWords(a.endedAt), kind: "Paid research ended", tone: a.outcome === "COMPLETED" ? "info" : "warn", applies,
      text: `${what} ended (${String(a.outcome).toLowerCase().replaceAll("_", " ")}).` });
  }
  if (binding.all && window) events.push({ iso: window.through, at: mstWords(window.through), kind: "Round results", applies,
    tone: window.promoted !== null && window.promoted > 0 ? "good" : "info",
    text: `From ${mstWords(window.since)} to ${mstWords(window.through)}: ${window.promoted === null ? "— records promoted" : `${plural(window.promoted, "record")} promoted`}; ${window.visible === null ? "— records visible to readers" : `${plural(window.visible, "record")} visible to readers`}.` });
  events.sort((a, b) => Date.parse(b.iso) - Date.parse(a.iso) || a.text.localeCompare(b.text));
  // Plain-code jobs record no change this section can read, so no scope can claim "no recorded changes".

  if (nextDue) next.push(Date.parse(nextDue) > Date.parse(now) ? `Next round due ${mstWords(nextDue)}.` : `Next round was due ${mstWords(nextDue)}.`);
  let jobs: V6WorkerJob[] | null = null;
  let running: V6WorkersRunning | null = null;
  let runningIds: string[] | null = null;
  if (sources.jobs.state === "READ") {
    const all = runningJobsOf(sources.jobs.rows, now, binding);
    const mine = all.filter(job => jobInScope(job, binding, scope));
    mine.sort((a, b) => Date.parse(b.row.attempt.startedAt) - Date.parse(a.row.attempt.startedAt) || a.row.attempt.id.localeCompare(b.row.attempt.id));
    jobs = mine.map(job => jobView(job, scopeKey, now));
    running = { count: mine.length, system: all.length, lowerBound: sources.jobs.truncated };
    runningIds = all.map(job => job.row.attempt.id).sort();
  } else missing.push(`${DEP_WORKER_ACTIVE_INDEX}: —`);

  const migrationRecords = Array.isArray(sources.migration) ? sources.migration.slice(0, 3) : [];
  const migrationRecord = migrationRecords[0] as { writtenAt?: unknown; migration?: unknown } | undefined;
  const migration = migrationOutcomeOf(migrationRecord?.migration);
  const migrationFailure = migrationRecords.map(record => migrationOutcomeOf(record?.migration))
    .find(outcome => outcome && outcome.state !== "SUCCEEDED");
  const migrationAt = clock(migrationRecord?.writtenAt) ? migrationRecord.writtenAt : null;
  if (sources.migration && !Array.isArray(sources.migration)) missing.push("The production migration outcome could not be read.");
  const update: UpdateCard | null = migration && migrationAt ? {
    title: "Production migrations", checkedAt: migrationAt,
    what: migrationRecords.map(record => {
      const outcome = migrationOutcomeOf(record?.migration);
      return outcome ? `${outcome.phase}: ${outcome.state.toLowerCase()}. ${outcome.summary}` : "Unread migration outcome.";
    }).join("\n"),
    impact: "Expand runs before a deploy; contract runs after the matching code is serving.",
    owner: "Deployment and runner", next: migrationFailure
      ? `Engineering repairs the ${migrationFailure.phase} migration ${migrationFailure.state === "FAILED" ? "failure" : "refusal"}; that release step remains held.`
      : "The recorded migration phases succeeded; the runner follows deployed updates automatically.",
    youNeedToAct: "No action needed.", fixId: null, status: migrationFailure?.state ?? migration.state,
    technical: [`Approved endpoint: ${migration.targetHost}`],
  } : null;
  const data: AdminV6WorkersView = {
    status, jobs, running,
    waiting: waiting.length > 0 || waitingComplete ? waiting : null,
    events: events.length > 0 ? events.slice(0, WORKERS_EVENT_LIMIT).map(({ iso: _iso, ...e }) => e) : null,
    update,
    next: next.length > 0 ? next : null,
  };
  if (events.length > WORKERS_EVENT_LIMIT) missing.push(`Showing the newest ${WORKERS_EVENT_LIMIT} of ${events.length} changes read.`);
  const revision = sectionRevision("workers", {
    scopeKey, config: sources.config.state === "READ" ? sources.config.scopes.map(d => [d.key, d.receiptId]) : null,
    migration: sources.migration ?? null,
    heartbeat: sources.heartbeat.state === "READ" ? sources.heartbeat.revision : sources.heartbeat.state,
    research: sources.research.state === "READ" ? sources.research.revision : sources.research.state,
    sources: read?.rows.map(r => [r.p.taskId, r.p.stage, r.at]) ?? null,
    scouts: scoutRows.map(r => [r.evidence.scout.attemptId, r.state, r.evidence.attempt.state === "READ" ? r.evidence.attempt.revision : null]),
    jobs: runningIds, truncated: sources.jobs.state === "READ" ? sources.jobs.truncated : null,
    progress: sources.stateProgress.state === "READ" ? sources.stateProgress.value : sources.stateProgress.state,
  });
  return { contract: ADMIN_V6_WORKERS_CONTRACT, scope: scopeKey, revision, asOf: now, data, missingParts: missing };
}

const NO_STORE = { "cache-control": "private, no-store, no-cache, must-revalidate" };

export function validateWorkersQuery(params: URLSearchParams): ReturnType<typeof validateV6Query> {
  if ([...params.keys()].some(key => key !== "scope")) return { ok: false, code: "UNKNOWN_PARAMETER" };
  return validateV6Query(params);
}

export async function v6WorkersGet(request: NextRequest, seams: {
  readonly open?: () => ReturnType<typeof openControlPlane>;
  readonly now?: () => string;
} = {}): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404, headers: NO_STORE })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateWorkersQuery(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  if (query.scope === null) {
    const out = unboundScope(query.scopeKey);
    return NextResponse.json({ code: out.code, says: out.says, dependency: out.dependency }, { status: out.status, headers: NO_STORE });
  }
  const opened = await (seams.open ?? openControlPlane)();
  if (!opened.ok) return NextResponse.json({ state: "UNREAD", code: "CONTROL_PLANE_UNREAD", says: opened.detail }, { status: 503, headers: NO_STORE });
  const sources = await readV6WorkersSources(opened.repos, (seams.now ?? (() => new Date().toISOString()))(), query.scope);
  const out = v6WorkersSection({ scopeKey: query.scopeKey, scope: query.scope, sources });
  if ("kind" in out) return NextResponse.json({ code: out.code, says: out.says, ...(out.dependency ? { dependency: out.dependency } : {}) },
    { status: out.status, headers: NO_STORE });
  return NextResponse.json(out, { headers: NO_STORE });
}
