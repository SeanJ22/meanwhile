/**
 * Loading canonical state from disk — one implementation, shared.
 *
 * `stage1-cutover.mts` and `governance-accept.mts` each grew their own
 * `ws()` and `methodStore()`, and `tests/duplicate-implementations.test.ts`
 * caught them under RULING 103: fix at the shared code path, or record the
 * group with a reason it must stay separate. There is no such reason — two
 * gates reading the same two stores is exactly one job.
 *
 * The duplication mattered beyond tidiness. A gate that reads state slightly
 * differently from the gate beside it can pass while its neighbour fails on the
 * same repository, and the difference is invisible in either report.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { MethodKnowledge } from "../method/knowledge.ts";
import type { Workstream } from "./workstream.ts";

/** The three states the descent currently owes. */
export const DESCENT_STATES = ["nj", "az", "nh"] as const;
export type DescentState = (typeof DESCENT_STATES)[number];

export function workstreamPath(root: string, state: string): string {
  return join(root, "data", "workstate", `${state}.json`);
}

/** One workstream, or null when that state has no canonical state yet. */
export function loadWorkstreamFor(root: string, state: string): Workstream | null {
  const p = workstreamPath(root, state);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Workstream) : null;
}

/** Every workstream on disk, in a stable order. */
export function loadAllWorkstreams(root: string): Workstream[] {
  const dir = join(root, "data", "workstate");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "migration-summary.json")
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Workstream);
}

export function methodStorePath(root: string): string {
  return join(root, "data", "method", "knowledge.json");
}

/** The cumulative method store, or null when it has not been ingested. */
export function loadMethodStore(root: string): MethodKnowledge | null {
  const p = methodStorePath(root);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as MethodKnowledge) : null;
}
