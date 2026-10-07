/**
 * The fix list: the one list of broken things and their repairs.
 *
 * Items live on the Admin config row, written through the gateway or by code
 * through `addFixItem`, so an item added in Admin is still there after a reload
 * with nobody's PC on. Shut doors, look flags, slow pages and audit red flags
 * call `addFixItem` too: there is no second repair log.
 *
 * ```
 *   OPEN       added, nobody has started
 *   FIXING     being worked on
 *   FIXED      done: what broke, what changed, who or what changed it, before,
 *              after and, when a record or setting changed, how to undo it
 *   CAME_BACK  fixed and then seen broken again
 * ```
 * Pure functions over the config plus two small async writers that
 * compare-and-set the row (retried once on a concurrent write).
 */
import { ADMIN_CONFIG_ID, defaultAdminConfig, isAdminConfig, type AdminConfig } from "./gateway/admin-config.ts";
import { fixSubjectId } from "./fix-queue.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";

export type FixState = "OPEN" | "FIXING" | "FIXED" | "CAME_BACK";

export interface FixItem {
  /** Stable: the same gap reported twice is one item. */
  readonly id: string;
  readonly where: string;
  readonly says: string;
  /** "owner" for Admin, or the plain-words part of the factory that found it ("The shut-door check"). */
  readonly addedBy: string;
  readonly addedAt: string;
  readonly state: FixState;
  readonly startedAt?: string;
  readonly fixedAt?: string;
  /** What changed, in a sentence. */
  readonly whatChanged?: string;
  /** Who or what changed it, in plain words. */
  readonly changedBy?: string;
  readonly before?: string;
  readonly after?: string;
  /** The gateway action that undoes a record or setting change, when there is one. */
  readonly undo?: { readonly type: string; readonly input: Readonly<Record<string, unknown>> } | null;
  readonly cameBackAt?: string;
}

export const FIX_LIST_CAP = 500;

export function fixItems(config: AdminConfig): readonly FixItem[] {
  return config.fixList ?? [];
}

function cap(items: readonly FixItem[]): readonly FixItem[] {
  if (items.length <= FIX_LIST_CAP) return items;
  // Drop the oldest finished items first; open work is never dropped for room.
  const finished = items.filter((i) => i.state === "FIXED").sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  const drop = new Set(finished.slice(0, items.length - FIX_LIST_CAP).map((i) => i.id));
  return items.filter((i) => !drop.has(i.id));
}

function put(config: AdminConfig, items: readonly FixItem[], at: string): AdminConfig {
  return { ...config, fixList: cap(items), updatedAt: at };
}

/** Add an item. A gap already on the list that is not finished is left alone; a FIXED one that is reported again CAME_BACK. */
export function withFixAdded(config: AdminConfig, add: { where: string; says: string; addedBy: string; at: string }): AdminConfig {
  const id = fixSubjectId(add.where, add.says);
  const items = fixItems(config);
  const held = items.find((i) => i.id === id);
  if (held) {
    if (held.state !== "FIXED") return config;
    return put(config, items.map((i) => (i.id === id ? { ...i, state: "CAME_BACK" as const, cameBackAt: add.at } : i)), add.at);
  }
  return put(config, [...items, { id, where: add.where.trim(), says: add.says.trim(), addedBy: add.addedBy, addedAt: add.at, state: "OPEN" }], add.at);
}

export function withFixStarted(config: AdminConfig, id: string, at: string): AdminConfig {
  const items = fixItems(config);
  const held = items.find((i) => i.id === id);
  if (!held || held.state === "FIXING" || held.state === "FIXED") return config;
  return put(config, items.map((i) => (i.id === id ? { ...i, state: "FIXING" as const, startedAt: at } : i)), at);
}

export interface FixCompletion {
  readonly whatChanged: string;
  readonly changedBy: string;
  readonly before: string;
  readonly after: string;
  readonly undo?: FixItem["undo"];
}

export function withFixCompleted(config: AdminConfig, id: string, done: FixCompletion, at: string): AdminConfig {
  const items = fixItems(config);
  if (!items.some((i) => i.id === id)) return config;
  return put(config, items.map((i) => (i.id === id
    ? { ...i, state: "FIXED" as const, fixedAt: at, whatChanged: done.whatChanged, changedBy: done.changedBy, before: done.before, after: done.after, undo: done.undo ?? null }
    : i)), at);
}

type Repos = Pick<ControlPlaneRepositories, "adminConfig">;

async function mutate(repos: Repos, at: string, change: (c: AdminConfig) => AdminConfig): Promise<AdminConfig> {
  for (let attempt = 0; ; attempt++) {
    const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
    const current = held && isAdminConfig(held.value) ? held.value : defaultAdminConfig(at);
    const next = change(current);
    if (next === current) return current;
    try {
      if (held) await repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID, held.revision, next, at);
      else await repos.adminConfig.put(ADMIN_CONFIG_ID, next, at);
      return next;
    } catch (error) {
      if (attempt >= 1) throw error;
    }
  }
}

/**
 * The one way code adds a broken thing to the fix list. `by` names the part of
 * the factory in plain words. Returns the item id.
 */
export async function addFixItem(repos: Repos, add: { where: string; says: string; by: string; at: string }): Promise<string> {
  await mutate(repos, add.at, (c) => withFixAdded(c, { where: add.where, says: add.says, addedBy: add.by, at: add.at }));
  return fixSubjectId(add.where, add.says);
}

export async function startFixItem(repos: Repos, id: string, at: string): Promise<void> {
  await mutate(repos, at, (c) => withFixStarted(c, id, at));
}

export async function completeFixItem(repos: Repos, id: string, done: FixCompletion, at: string): Promise<void> {
  await mutate(repos, at, (c) => withFixCompleted(c, id, done, at));
}
