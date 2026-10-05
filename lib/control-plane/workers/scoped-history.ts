/**
 * **EACH TASK READS ONLY ITS OWN HISTORY (CH-26).**
 *
 * The reads a task makes about its own work item, subject and lineage, scoped
 * to them instead of listing whole tables (rulings §5: nothing loads the whole
 * country). Each returns exactly what the whole-table read returned once the
 * caller's own filter is applied; the version-20 indexes make them cheap in
 * Postgres. A runtime opts in with `scopedReads` (the lease worker sets it from
 * the runner switch `WTP_SCOPED_TASK_READS=1`); without it every read is the
 * old whole-table one, until the scoped path is checked live.
 */
import type { CostEntry } from "../cost.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { keysWhere } from "../repository/types.ts";
import { RESEARCH_BOUNDS } from "../scheduler/research-policy.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import { readSubjectScoutHistory } from "./detective.ts";

/**
 * A cost row is stored when it is appended, at or after the time it records.
 * Reading from this much before the window's start keeps any row whose own time
 * falls in the window, even when its writer's clock ran ahead of the store's.
 */
export const SPEND_WINDOW_READ_SLACK_HOURS = 6;

/** The cost rows the rolling spend window can count: since its start (with slack) when scoped, every row otherwise. */
export async function readSpendWindowCosts(repos: ControlPlaneRepositories, nowIso: string, scoped: boolean,
  windowHours: number = RESEARCH_BOUNDS.windowHours): Promise<readonly CostEntry[]> {
  if (!scoped) return repos.costs.readAll();
  const since = new Date(Date.parse(nowIso) - (windowHours + SPEND_WINDOW_READ_SLACK_HOURS) * 3_600_000).toISOString();
  return repos.costs.readSince(since);
}

/** Every Scout result recorded for these subjects, in the whole log's key-then-append order; the whole log when not scoped. */
export async function readScoutResultsForSubjects(repos: ControlPlaneRepositories, subjectIds: readonly string[],
  scoped: boolean): Promise<readonly ScoutResult[]> {
  if (!scoped) return repos.scoutResults.readAll();
  const keys = new Set<string>();
  for (const subject of new Set(subjectIds)) {
    for (const key of await keysWhere(repos.scoutResults, result => result.obligationId, ["subjectId"], subject)) keys.add(key);
  }
  const out: ScoutResult[] = [];
  for (const key of [...keys].sort()) out.push(...await repos.scoutResults.read(key));
  return out;
}

/**
 * `readSubjectScoutHistory` over only the logs that ever held these subjects. It keeps a log whose NEWEST
 * record is about the subject, so a log with no record about the subject can never be kept, and narrowing
 * its key list first changes nothing it returns.
 */
export async function readSubjectScoutHistoryScoped(repos: ControlPlaneRepositories,
  subjects: readonly { subjectId: string; recordClass: string }[], scoped: boolean): Promise<ScoutResult[]> {
  if (!scoped) return readSubjectScoutHistory(repos, subjects);
  const keys = new Set<string>();
  for (const subject of new Set(subjects.map(row => row.subjectId))) {
    for (const key of await keysWhere(repos.scoutResults, result => result.obligationId, ["subjectId"], subject)) keys.add(key);
  }
  const narrowed: ControlPlaneRepositories["scoutResults"] = Object.assign(Object.create(repos.scoutResults) as ControlPlaneRepositories["scoutResults"],
    { keys: async () => [...keys].sort() });
  return readSubjectScoutHistory({ ...repos, scoutResults: narrowed }, subjects);
}
