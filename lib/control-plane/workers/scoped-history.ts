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
import type { ArtifactRecord, ControlPlaneRepositories } from "../repository/types.ts";
import { keysWhere } from "../repository/types.ts";
import { RESEARCH_BOUNDS } from "../scheduler/research-policy.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type { WorkItem } from "../work-item.ts";
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

/** The Scout logs that ever held a record about one of these subjects, or null when the store cannot say without a full read. */
async function scoutKeysFor(repos: ControlPlaneRepositories, subjectIds: readonly string[]): Promise<readonly string[] | null> {
  const keys = new Set<string>();
  for (const subject of new Set(subjectIds)) {
    const held = await keysWhere(repos.scoutResults, ["subjectId"], subject);
    if (held === null) return null;
    for (const key of held) keys.add(key);
  }
  return [...keys].sort();
}

/** Every Scout result in the logs that hold these subjects, in the whole log's key-then-append order; the whole log when not scoped. */
export async function readScoutResultsForSubjects(repos: ControlPlaneRepositories, subjectIds: readonly string[],
  scoped: boolean): Promise<readonly ScoutResult[]> {
  const keys = scoped ? await scoutKeysFor(repos, subjectIds) : null;
  if (keys === null) return repos.scoutResults.readAll();
  const out: ScoutResult[] = [];
  for (const key of keys) out.push(...await repos.scoutResults.read(key));
  return out;
}

/**
 * `readSubjectScoutHistory` over only the logs that ever held these subjects. It keeps a log whose NEWEST
 * record is about the subject, so a log with no record about the subject can never be kept, and narrowing
 * its key list first changes nothing it returns.
 */
export async function readSubjectScoutHistoryScoped(repos: ControlPlaneRepositories,
  subjects: readonly { subjectId: string; recordClass: string }[], scoped: boolean): Promise<ScoutResult[]> {
  const keys = scoped ? await scoutKeysFor(repos, subjects.map(row => row.subjectId)) : null;
  if (keys === null) return readSubjectScoutHistory(repos, subjects);
  const narrowed: ControlPlaneRepositories["scoutResults"] = Object.assign(Object.create(repos.scoutResults) as ControlPlaneRepositories["scoutResults"],
    { keys: async () => keys });
  return readSubjectScoutHistory({ ...repos, scoutResults: narrowed }, subjects);
}

/**
 * An audit's work items and captures (`generalizedIndependentContext`): the owner and every item about the
 * contract's subject, and every capture recorded for one of them, for a work item the owner's plan says it
 * inherited from, or under one of the audit's required artifact IDs. That is every row the audit reads; the
 * logs are read in the whole log's key order so "the first capture of an ID" is the same capture. Null when the
 * store cannot answer the filtered reads (the caller then reads every row as before).
 */
export async function readAuditHistory(repos: ControlPlaneRepositories, input: { readonly workItemId?: string;
  readonly subjectId: string; readonly requiredArtifactIds: readonly string[] }): Promise<{ readonly artifacts: readonly ArtifactRecord[]; readonly items: readonly WorkItem[] } | null> {
  if (!repos.artifacts.keysWhere) return null;
  const byId = new Map<string, WorkItem>();
  const owner = input.workItemId === undefined ? null : await repos.workItems.read(input.workItemId);
  if (owner) byId.set(owner.id, owner.value);
  for (const row of await repos.workItems.listWhere(["subject"], input.subjectId)) byId.set(row.id, row.value);
  const items = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const itemIds = new Set(items.map(item => item.id));
  for (const acquisition of owner?.value.autonomousPlan?.acquisition ?? []) for (const held of acquisition.held) if (held.inheritedFromWorkItemId) itemIds.add(held.inheritedFromWorkItemId);
  const keys = new Set<string>();
  for (const id of itemIds) for (const key of await repos.artifacts.keysWhere(["workItemId"], id)) keys.add(key);
  for (const id of new Set(input.requiredArtifactIds)) for (const key of await repos.artifacts.keysWhere(["artifactId"], id)) keys.add(key);
  const artifacts: ArtifactRecord[] = [];
  for (const key of [...keys].sort()) artifacts.push(...await repos.artifacts.read(key));
  return { artifacts, items };
}
