import type { AuditCorrection } from "./admin-view/v6-audit-read.ts";
import { AUDIT_WEEK_DAYS } from "./admin-view/v6-audit-read.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import type { LiveAuditResult } from "./workers/live-audit.ts";
import type { TaskPass } from "../health/resident-tasks.ts";
import type { SpeedPass } from "../health/worst-case-speed.ts";
import type { ClaimPass } from "./workers/claim-audit.ts";
import type { LookPass } from "../frontend/look-pass.ts";

export interface LiveAuditPull {
  readonly workItemId: string;
  readonly parserResultId: string;
  readonly parserAttemptId: string;
  /** The extraction records to leave out of the next published version. */
  readonly recordIds: readonly string[];
  readonly factId: string;
  readonly at: string;
  readonly reason: string;
}

export type LiveAuditLogRow =
  | { readonly kind: "RESULT"; readonly result: LiveAuditResult }
  | { readonly kind: "CORRECTION"; readonly correction: AuditCorrection }
  | { readonly kind: "PULL"; readonly pull: LiveAuditPull }
  | { readonly kind: "SPEED"; readonly pass: SpeedPass }
  | { readonly kind: "TASKS"; readonly pass: TaskPass }
  | { readonly kind: "TASK_ZIP"; readonly zip: string; readonly at: string }
  | { readonly kind: "CLAIMS"; readonly pass: ClaimPass }
  | { readonly kind: "LOOK"; readonly pass: LookPass }
  | { readonly kind: "LOOKED"; readonly sha: string; readonly at: string; readonly verdict: LookPass["verdict"] };

export type LiveAuditRepos = Pick<ControlPlaneRepositories, "liveAudits">;

export const CORRECTIONS_KEY = "corrections";
export const dayKey = (iso: string): string => `day:${iso.slice(0, 10)}`;
export const PULLS_KEY = "pulls";
export const speedDayKey = (iso: string): string => `speed:${iso.slice(0, 10)}`;
export const tasksDayKey = (iso: string): string => `tasks:${iso.slice(0, 10)}`;
export const TASK_ZIPS_KEY = "task-zips";
export const claimsWeekKey = (week: string): string => `claims:${week}`;
export const lookKey = (sha: string): string => `look:${sha}`;
export const LOOKED_KEY = "looked";

export function weekDayKeys(now: string, days: number = AUDIT_WEEK_DAYS): string[] {
  const end = Date.parse(now);
  return Array.from({ length: days + 1 }, (_, i) => dayKey(new Date(end - i * 86_400_000).toISOString()));
}

export async function recordLiveAuditResult(repos: LiveAuditRepos, result: LiveAuditResult): Promise<void> {
  await repos.liveAudits.append(dayKey(result.checkedAt), `${result.factId}@${result.checkedAt}`, { kind: "RESULT", result }, result.checkedAt);
}

export async function recordAuditCorrection(repos: LiveAuditRepos, correction: AuditCorrection): Promise<void> {
  await repos.liveAudits.append(CORRECTIONS_KEY, `${correction.action}:${correction.factId}@${correction.at}`, { kind: "CORRECTION", correction }, correction.at);
}

export async function recordLiveAuditPull(repos: LiveAuditRepos, pull: LiveAuditPull): Promise<void> {
  await repos.liveAudits.append(PULLS_KEY, `${pull.workItemId}:${pull.factId}@${pull.at}`, { kind: "PULL", pull }, pull.at);
}

export async function readAllLiveAuditPulls(repos: LiveAuditRepos): Promise<readonly LiveAuditPull[]> {
  return (await repos.liveAudits.read(PULLS_KEY)).flatMap((row) => (row.kind === "PULL" ? [row.pull] : []));
}

export async function readLiveAuditPulls(repos: LiveAuditRepos, workItemId: string): Promise<readonly LiveAuditPull[]> {
  return (await readAllLiveAuditPulls(repos)).filter((pull) => pull.workItemId === workItemId);
}

export async function readAuditWeek(repos: LiveAuditRepos, now: string): Promise<{ results: LiveAuditResult[]; corrections: AuditCorrection[] }> {
  const [days, corrections] = await Promise.all([
    Promise.all(weekDayKeys(now).map((key) => repos.liveAudits.read(key))),
    repos.liveAudits.read(CORRECTIONS_KEY),
  ]);
  return {
    results: days.flat().flatMap((row) => (row.kind === "RESULT" ? [row.result] : [])),
    corrections: corrections.flatMap((row) => (row.kind === "CORRECTION" ? [row.correction] : [])),
  };
}

/** Keep one worst-case speed pass, by the day it ran. */
export async function recordSpeedPass(repos: LiveAuditRepos, pass: SpeedPass): Promise<void> {
  await repos.liveAudits.append(speedDayKey(pass.at), `speed@${pass.at}`, { kind: "SPEED", pass }, pass.at);
}

/** The newest speed pass from today or yesterday (two day keys, never the whole log); null when none ran. */
export async function readLatestSpeedPass(repos: LiveAuditRepos, now: string): Promise<SpeedPass | null> {
  const end = Date.parse(now);
  const keys = [0, 1].map((d) => speedDayKey(new Date(end - d * 86_400_000).toISOString()));
  const rows = (await Promise.all(keys.map((k) => repos.liveAudits.read(k)))).flat();
  const passes = rows.flatMap((row) => (row.kind === "SPEED" ? [row.pass] : [])).sort((a, b) => a.at.localeCompare(b.at));
  return passes.at(-1) ?? null;
}

/** Keep one resident-task pass by the day it ran, and note each ZIP it reached so it is not queued again. */
export async function recordTaskPass(repos: LiveAuditRepos, pass: TaskPass): Promise<void> {
  await repos.liveAudits.append(tasksDayKey(pass.at), `tasks@${pass.at}`, { kind: "TASKS", pass }, pass.at);
  for (const zip of pass.zips) await repos.liveAudits.append(TASK_ZIPS_KEY, `${zip}@${pass.at}`, { kind: "TASK_ZIP", zip, at: pass.at }, pass.at);
}

export async function readTaskZips(repos: LiveAuditRepos): Promise<Set<string>> {
  return new Set((await repos.liveAudits.read(TASK_ZIPS_KEY)).flatMap((row) => (row.kind === "TASK_ZIP" ? [row.zip] : [])));
}

export async function readLatestTaskPass(repos: LiveAuditRepos, now: string): Promise<TaskPass | null> {
  const end = Date.parse(now);
  const keys = [0, 1].map((d) => tasksDayKey(new Date(end - d * 86_400_000).toISOString()));
  const rows = (await Promise.all(keys.map((k) => repos.liveAudits.read(k)))).flat();
  const passes = rows.flatMap((row) => (row.kind === "TASKS" ? [row.pass] : [])).sort((a, b) => a.at.localeCompare(b.at));
  return passes.at(-1) ?? null;
}

/** Keep one weekly claim check. A controlled run is refused here, so it can never be read as real. */
export async function recordClaimPass(repos: LiveAuditRepos, pass: ClaimPass): Promise<void> {
  if (pass.synthetic) throw new Error("A controlled claim check is never recorded");
  await repos.liveAudits.append(claimsWeekKey(pass.week), `claims@${pass.at}`, { kind: "CLAIMS", pass }, pass.at);
}

/** This week's and last week's claim checks (two keys, never the whole log). */
export async function readRecentClaimPasses(repos: LiveAuditRepos, weeks: readonly string[]): Promise<ClaimPass[]> {
  const rows = (await Promise.all(weeks.map((w) => repos.liveAudits.read(claimsWeekKey(w))))).flat();
  return rows.flatMap((row) => (row.kind === "CLAIMS" && !row.pass.synthetic ? [row.pass] : []));
}

/** Keep one deploy's look pass, then note the commit so it is looked at once. */
export async function recordLookPass(repos: LiveAuditRepos, pass: LookPass): Promise<void> {
  await repos.liveAudits.append(lookKey(pass.sha), `look@${pass.at}`, { kind: "LOOK", pass }, pass.at);
  await repos.liveAudits.append(LOOKED_KEY, `${pass.sha}@${pass.at}`, { kind: "LOOKED", sha: pass.sha, at: pass.at, verdict: pass.verdict }, pass.at);
}

export async function readLookedCommits(repos: LiveAuditRepos): Promise<readonly { sha: string; at: string; verdict: LookPass["verdict"] }[]> {
  return (await repos.liveAudits.read(LOOKED_KEY)).flatMap((row) => (row.kind === "LOOKED" ? [{ sha: row.sha, at: row.at, verdict: row.verdict }] : []));
}

export async function readLatestLookPasses(repos: LiveAuditRepos, count = 1): Promise<LookPass[]> {
  const looked = [...(await readLookedCommits(repos))].sort((a, b) => b.at.localeCompare(a.at));
  const shas = [...new Set(looked.map((l) => l.sha))].slice(0, count);
  const rows = (await Promise.all(shas.map((sha) => repos.liveAudits.read(lookKey(sha))))).flat();
  return rows.flatMap((row) => (row.kind === "LOOK" ? [row.pass] : [])).sort((a, b) => b.at.localeCompare(a.at));
}
