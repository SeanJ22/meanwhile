import type { Sql } from "../repository/pg-store.ts";
import type { CountProblem } from "../../counts/hour.ts";
import { addFixItem } from "../fix-list.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { formatEastern } from "../eastern-time.ts";
import { query } from "./read.ts";
import { HOUR } from "./model.ts";
import { silentFor } from "./jobs.ts";

const KEEPER_SILENT_KEY = "line-keeper-silent";
/** The runner looks at the keeper this often, so a keeper that has missed two hourly runs is seen within one of its own intervals. */
export const KEEPER_WATCH_MS = 10 * 60_000;
export const KEEPER_WATCH_JOB = "line-keeper-watch";
const WHERE = "The line keeper";
const OWNER = "the runner workers";

type KeeperProblem = Omit<CountProblem, "kind" | "state" | "items">;

/**
 * The keeper runs hourly. Two intervals without a saved run is a problem; the keeper and the runner raise the same one, so it is one item.
 * A database that has never held a run is a new one, not a silent one: Admin's own status line already says the report is unavailable.
 */
export function keeperSilentProblem(lastRunAt: string | null, at: string): KeeperProblem | null {
  const next = "Find why the hourly line keeper is not finishing, fix that cause, and check that its next run is saved.";
  if (lastRunAt === null) return null;
  const quiet = Date.parse(at) - Date.parse(lastRunAt);
  return quiet > 2 * HOUR ? { key: KEEPER_SILENT_KEY, where: WHERE, owner: OWNER, next,
    says: `The line keeper went ${silentFor(quiet)} without a saved run, from ${formatEastern(lastRunAt)}.` } : null;
}

/** When the keeper last saved a run, or null when it never has. */
export async function readKeeperLastRun(sql: Sql): Promise<string | null> {
  const [row] = await query(sql, "last-run", "SELECT max(checked_at) AS checked_at FROM line_keeper_run");
  const at = row?.checked_at;
  return at === null || at === undefined ? null : (at instanceof Date ? at : new Date(String(at))).toISOString();
}

/**
 * The runner's side of the watch. The keeper runs on Netlify apart from everything it watches, so when it stops it cannot say so itself;
 * the runner, on another host, files the repair. Returns whether it filed one.
 */
export async function watchLineKeeper(sql: Sql, repos: Pick<ControlPlaneRepositories, "adminConfig">, at: string): Promise<boolean> {
  const problem = keeperSilentProblem(await readKeeperLastRun(sql), at);
  if (!problem) return false;
  await addFixItem(repos, { where: problem.where, says: problem.says, by: "The runner", at, owner: problem.owner,
    sourceKey: `line-keeper:${problem.key}`, technical: [`line-keeper:${problem.key}`] });
  return true;
}
