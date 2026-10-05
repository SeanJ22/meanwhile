/**
 * **WHERE LIVE-AUDIT RESULTS LIVE.** (DP-13, DP-14, DP-18; control-plane schema v21.)
 *
 * One append-only log, `live_audits`, holding three kinds of row:
 *
 * ```
 *   RESULT      one LiveAuditResult: a published fact re-read on its page,
 *               green, red or not judged. Keyed by the UTC day it was checked.
 *   CORRECTION  what a red flag led to: PULLED at once, FIXED when the corrected
 *               value audits green again. Keyed "corrections".
 *   PULL        the records a red flag takes off the live page, by the work
 *               item and extraction that published them. Keyed "pulls": red
 *               flags are rare, so one read answers every publisher.
 *   SPEED       one worst-case speed pass over the live site (FE-02): each
 *               surface and sampled ZIP, phone and desktop, PASS or FAIL
 *               against three seconds. Keyed by the UTC day it ran.
 * ```
 *
 * Append-only because an audit is a reading taken at a time; a later pass never
 * rewrites what an earlier one saw. Admin's "audited this week" and the
 * Scoreboard's accuracy row read the last seven day keys and the corrections.
 */
import type { AuditCorrection } from "./admin-view/v6-audit-read.ts";
import { AUDIT_WEEK_DAYS } from "./admin-view/v6-audit-read.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import type { LiveAuditResult } from "./workers/live-audit.ts";
import type { SpeedPass } from "../health/worst-case-speed.ts";

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
  | { readonly kind: "SPEED"; readonly pass: SpeedPass };

export type LiveAuditRepos = Pick<ControlPlaneRepositories, "liveAudits">;

export const CORRECTIONS_KEY = "corrections";
export const dayKey = (iso: string): string => `day:${iso.slice(0, 10)}`;
export const PULLS_KEY = "pulls";
export const speedDayKey = (iso: string): string => `speed:${iso.slice(0, 10)}`;

/** The day keys a week back from `now`, plus today: what a weekly reading and "last audited" need. */
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

/** Every pull red flags wrote; what each publisher leaves out of its next version. */
export async function readAllLiveAuditPulls(repos: LiveAuditRepos): Promise<readonly LiveAuditPull[]> {
  return (await repos.liveAudits.read(PULLS_KEY)).flatMap((row) => (row.kind === "PULL" ? [row.pull] : []));
}

/** The pulls against one work item. */
export async function readLiveAuditPulls(repos: LiveAuditRepos, workItemId: string): Promise<readonly LiveAuditPull[]> {
  return (await readAllLiveAuditPulls(repos)).filter((pull) => pull.workItemId === workItemId);
}

/** The week's results and every correction: the input to `weeklyAuditAccuracy` and to the pass's "last audited". */
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

/** FE-02: keep one worst-case speed pass, by the day it ran. */
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
