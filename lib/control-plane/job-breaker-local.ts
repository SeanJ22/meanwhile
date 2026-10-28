import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { protectedJob, type JobBreakerSnapshot } from "./job-transfer-breaker.ts";

export const JOB_BREAKER_PATH_ENV = "WTP_JOB_BREAKER_STATE_PATH";
export function saveBreakerSnapshot(path: string, snapshot: JobBreakerSnapshot): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(snapshot));
  renameSync(temporary, path);
}

/** Launches read the standing runner's local snapshot only; no launch reads Postgres. A paused job waits for the owner's release. */
export function admitJobLaunch(job: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const path = env[JOB_BREAKER_PATH_ENV];
  if (!path || protectedJob(job)) return true;
  let snapshot: JobBreakerSnapshot;
  try { snapshot = JSON.parse(readFileSync(path, "utf8")); }
  catch { return true; } // Check errors are reported by the parent; no new blanket pause is invented.
  return snapshot.states[job]?.mode !== "PAUSED";
}
