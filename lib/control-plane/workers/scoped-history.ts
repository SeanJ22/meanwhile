import type { ArtifactRecord, ControlPlaneRepositories } from "../repository/types.ts";
import { keysWhere } from "../repository/types.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type { WorkItem } from "../work-item.ts";
import type { Attempt } from "../attempt.ts";
import type { FreshnessOccurrence } from "../scheduler/durable.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import type { WorkerResultRecord } from "./types.ts";

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

// Include the subject's captures, inherited captures and required artifact IDs.
// Preserve log order so repeated artifact IDs resolve to the same first capture.
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

type LinkedWorkItem = WorkItem & { readonly planRepair?: { readonly parentWorkItemId?: string } };

// Include every occurrence and repair descendant so sibling ranking and capture reuse agree across tasks.
export async function readLineageHistory(repos: ControlPlaneRepositories, workItemId: string) {
  if (!repos.artifacts.keysWhere || !repos.scoutResults.keysWhere) return null;
  const items = new Map<string, WorkItem>();
  const readItem = async (id: string) => {
    if (!items.has(id)) { const row = await repos.workItems.read(id); if (row) items.set(id, row.value); }
    return items.get(id) ?? null;
  };
  const ancestors: string[] = [];
  for (let cursor = await readItem(workItemId); cursor && !ancestors.includes(cursor.id);) {
    ancestors.push(cursor.id);
    const parent = (cursor as LinkedWorkItem).planRepair?.parentWorkItemId;
    cursor = parent ? await readItem(parent) : null;
  }
  const obligationIds = new Set<string>();
  for (const id of ancestors) for (const row of await repos.occurrences.listWhere(["workItemId"], id)) obligationIds.add(row.value.obligationId);
  const occurrences = new Map<string, FreshnessOccurrence>();
  for (const id of obligationIds) for (const row of await repos.occurrences.listWhere(["obligationId"], id)) occurrences.set(row.id, row.value);
  // Every occurrence's item and its whole repair family, through the lineage index.
  const queue = [...new Set([...occurrences.values()].map(occurrence => occurrence.workItemId))];
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    await readItem(id);
    for (const child of await repos.workItems.listWhere(["planRepair", "parentWorkItemId"], id)) { items.set(child.id, child.value); queue.push(child.id); }
  }
  const byId = <T extends { readonly id: string }>(rows: Iterable<T>) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const artifactKeys = new Set<string>();
  const attempts = new Map<string, Attempt>();
  const workerResults: WorkerResultRecord[] = [];
  for (const id of [...items.keys()].sort()) {
    for (const key of await repos.artifacts.keysWhere(["workItemId"], id)) artifactKeys.add(key);
    for (const row of await repos.attempts.listWhere(["workItemId"], id)) attempts.set(row.id, row.value);
    workerResults.push(...await readCompletedWorkerResults(repos, id));
  }
  const artifacts: ArtifactRecord[] = [];
  for (const key of [...artifactKeys].sort()) artifacts.push(...await repos.artifacts.read(key));
  return {
    occurrences: [...occurrences.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, value]) => value),
    workItems: byId(items.values()), artifacts, attempts: byId(attempts.values()), workerResults,
    scouts: await readScoutResultsForSubjects(repos, [...new Set([...items.values()].map(item => item.subject))], true),
  };
}
