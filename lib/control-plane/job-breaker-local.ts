import { storedKeyEnvironment } from "../core/keys-values.ts";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { protectedJob, type JobBreakerSnapshot } from "./job-transfer-breaker.ts";

export const JOB_BREAKER_PATH_ENV = "WTP_JOB_BREAKER_STATE_PATH";
const MINUTE = 60_000, HOUR = 3_600_000;
export const JOB_SLOWED_WORDS = "read far more than its normal, so its launches are spaced out; it launches again shortly and its work remains owed";
function saveJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, path);
}
export function saveBreakerSnapshot(path: string, snapshot: JobBreakerSnapshot): void { saveJson(path, snapshot); }

/** How many times further apart the job's launches are now. 1 at its ordinary pace, or when the snapshot is missing or over two hours old. */
export function jobSlowTimes(job: string, env: NodeJS.ProcessEnv = storedKeyEnvironment(), now = Date.now()): number {
  const path = storedKeyEnvironment(env)[JOB_BREAKER_PATH_ENV];
  if (!path || protectedJob(job)) return 1;
  try {
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as Partial<JobBreakerSnapshot>, times = snapshot.jobs?.[job]?.times;
    return now - Date.parse(String(snapshot.checkedAt)) < 2 * HOUR && Number.isSafeInteger(times) && times! > 1 ? times! : 1;
  } catch { return 1; }
}

/**
 * Launches read only local files: the breaker's snapshot and each job's last launch with its ordinary gap between launches
 * (clamped to one minute to one hour). A slowed job waits `times` gaps after its last launch, at most an hour more than one
 * gap, so it never stops. `reserve` false only asks; true records the launch it admits.
 */
export function admitJobLaunch(job: string, env: NodeJS.ProcessEnv = storedKeyEnvironment(), now = Date.now(), reserve = true): boolean {
  const path = storedKeyEnvironment(env)[JOB_BREAKER_PATH_ENV];
  if (!path || protectedJob(job)) return true;
  const file = join(`${path}.launches`, createHash("sha256").update(job).digest("hex")), times = jobSlowTimes(job, env, now);
  let last: { at: number; gap?: number } | null = null;
  try { last = JSON.parse(readFileSync(file, "utf8")); } catch { /* Its first launch here. */ }
  const observed = last ? Math.min(HOUR, Math.max(MINUTE, now - last.at)) : undefined;
  // At its ordinary pace each launch teaches the gap; a slowed job with no gap yet takes this first attempt's as its gap.
  const gap = observed === undefined ? last?.gap : times === 1 ? (last?.gap ? last.gap + (observed - last.gap) / 4 : observed) : last?.gap ?? observed;
  const due = times === 1 || !last || gap === undefined || now >=last.at + Math.min(gap * times, gap + HOUR);
  try { if (due ? reserve : gap !== last?.gap) saveJson(file, due ? { at: now, gap } : { ...last, gap }); }
  catch { /* The spacing record is best effort; a launch is never refused for it. */ }
  return due;
}
