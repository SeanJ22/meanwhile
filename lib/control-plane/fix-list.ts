/**
 * **THE FIX LIST (BR-03) — the one list of broken things and their repairs.**
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
import { RESEARCH_INTENT_LOG_KEY } from "./scheduler/research-policy.ts";
import { fixSubjectId } from "./fix-queue.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";

export type FixState = "OPEN" | "FIXING" | "FIXED" | "CAME_BACK";

export interface FixItem {
  /** Stable: the same gap reported twice is one item. */
  readonly id: string;
  readonly technical?: readonly string[];
  readonly where: string;
  readonly says: string;
  /** "owner" for Admin, or the plain-words part of the factory that found it ("The shut-door check"). */
  readonly addedBy: string;
  readonly addedAt: string;
  readonly state: FixState;
  readonly startedAt?: string;
  readonly dispatch?: { readonly intentId: string; readonly note: string; readonly at: string; readonly honoredAt?: string; readonly honoredDetail?: string };
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
export function withFixAdded(config: AdminConfig, add: { where: string; says: string; addedBy: string; at: string; sourceKey?: string; technical?: readonly string[] }): AdminConfig {
  const id = fixSubjectId(add.where, add.sourceKey ?? add.says);
  const items = fixItems(config);
  const held = items.find((i) => i.id === id);
  if (held) {
    if (held.state !== "FIXED") return config;
    return put(config, items.map((i) => (i.id === id ? { ...i, state: "CAME_BACK" as const, cameBackAt: add.at, dispatch: undefined } : i)), add.at);
  }
  return put(config, [...items, { id, where: add.where.trim(), says: add.says.trim(), addedBy: add.addedBy, addedAt: add.at, state: "OPEN", ...(add.technical ? { technical: add.technical } : {}) }], add.at);
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
export async function addFixItem(repos: Repos, add: { where: string; says: string; by: string; at: string; sourceKey?: string; technical?: readonly string[] }): Promise<string> {
  await mutate(repos, add.at, (c) => withFixAdded(c, { where: add.where, says: add.says, addedBy: add.by, at: add.at, sourceKey: add.sourceKey, technical: add.technical }));
  return fixSubjectId(add.where, add.sourceKey ?? add.says);
}

export async function startFixItem(repos: Repos, id: string, at: string): Promise<void> {
  await mutate(repos, at, (c) => withFixStarted(c, id, at));
}

export async function completeFixItem(repos: Repos, id: string, done: FixCompletion, at: string): Promise<void> {
  await mutate(repos, at, (c) => withFixCompleted(c, id, done, at));
}

/** Attach the fleet's durable dispatch to a data repair; engineering stays owned by the team. */
export async function recordFixDispatch(repos: Repos, id: string, dispatch: NonNullable<FixItem["dispatch"]>): Promise<void> {
  await mutate(repos, dispatch.at, c => put(c, fixItems(c).map(item => item.id === id
    ? { ...item, state: "FIXING" as const, startedAt: dispatch.at, dispatch } : item), dispatch.at));
}

export function fixDispatchNote(where: string, says: string, kind?: unknown, place?: unknown): string | null {
  if (kind === "engineering" || /layout|wording|button|font|colour|color|software|code|slow|spend|budget|hosting/i.test(says)) return null;
  const target = typeof place === "string" && place.trim() ? place.trim() : where.trim();
  if (!target || /^(?:the control cent(?:re|er)|pages?|admin)$/i.test(target)) return null;
  if (kind !== "data" && !/missing|not (?:found|covered|shown|captured|available)|haven.t (?:found|captured)|no (?:agenda|minutes|meeting|official|candidate|contact|funding)|gap/i.test(says)) return null;
  const key = /^(?:geo|st):([a-z]{2})(?:\.[a-z_]+\.(\d+))?$/.exec(target);
  return key ? [key[1].toUpperCase(), key[2]].filter(Boolean).join(" ") : target;
}

export async function markFixQueueImported(repos: Repos, at: string): Promise<void> {
  await mutate(repos, at, c => ({ ...c, legacyFixQueueImportedAt: at, updatedAt: at }));
}

let honorCursor = 0;
/** BR-04: the standing timer reads a bounded part of pending dispatches on each tick. */
export async function refreshFixDispatchHonors(repos: Pick<ControlPlaneRepositories,"adminConfig"|"researchIntents">, at: string): Promise<void> {
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  const pending = held && isAdminConfig(held.value) ? fixItems(held.value).filter(i=>i.dispatch && !i.dispatch.honoredAt) : [];
  if (!pending.length) { honorCursor=0; return; }
  const changes = new Map<string, { intentId:string; honoredAt:string; honoredDetail:string }>();
  for (let n=0;n<Math.min(16,pending.length);n++) {
    const item=pending[(honorCursor+n)%pending.length];
    const rows=await repos.researchIntents.readRecentWhere(RESEARCH_INTENT_LOG_KEY,["honors"],item.dispatch!.intentId,1,{kind:true,honoredAt:true,detail:true});
    const honored=rows[0] as {kind?:unknown;honoredAt?:unknown;detail?:unknown}|undefined;
    if (honored?.kind === "HONORED" && typeof honored.honoredAt === "string") changes.set(item.id,{intentId:item.dispatch!.intentId,honoredAt:honored.honoredAt,honoredDetail:typeof honored.detail === "string" ? honored.detail : ""});
  }
  honorCursor=(honorCursor+16)%pending.length;
  if (changes.size) await mutate(repos,at,c=>put(c,fixItems(c).map(item=>item.dispatch && changes.get(item.id)?.intentId === item.dispatch.intentId
    ? {...item,dispatch:{...item.dispatch,...changes.get(item.id)!}} : item),at));
}
