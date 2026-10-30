import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Query } from "../facts/publish.ts";
import type { WorkList } from "./work.ts";

/** What can unlock a dead end: a reader for a kind of website, a tool, a source or API, a key, or a method that worked somewhere similar. */
export const CAPABILITY_KINDS = ["parser", "tool", "source", "key", "method"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

/** Where a capability or a need applies. Lower case; a dead end names at least one. */
export interface Scope {
  readonly name?: string;
  readonly state?: string;
  readonly platform?: string;
  readonly govKind?: string;
}
/** What a dead end is waiting for: a kind of capability, and where it applies. */
export interface Need extends Scope { readonly kind: CapabilityKind }
/** A need with the words Admin shows. */
export interface Unlock extends Need { readonly text: string }
/** Something new the system can do. `version` makes one announcement count once. */
export interface Capability extends Scope { readonly kind: CapabilityKind; readonly because: string; readonly version?: string }

const SCOPE_KEYS = ["name", "state", "platform", "govKind"] as const;
const clean = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim().toLowerCase().slice(0, 120) : undefined;
const scopeOf = (input: Record<string, unknown>): Scope => Object.fromEntries(SCOPE_KEYS.flatMap(key => clean(input[key]) ? [[key, clean(input[key])]] : []));

/** A need as a detective states it, or null when it names no kind of capability or no place it applies. */
export function needsOf(input: unknown): Need | null {
  const raw = (input ?? {}) as Record<string, unknown>, scope = scopeOf(raw);
  const kind = CAPABILITY_KINDS.find(known => known === raw.kind);
  return kind && Object.keys(scope).length ? { kind, ...scope } : null;
}
export const unlockOf = (input: unknown, text: string): Unlock | null => {
  const need = needsOf(input);
  return need ? { ...need, text: text.trim().slice(0, 300) } : null;
};

/** What a hunt's list of unfilled blanks says would unlock it: its first blank that names a capability. */
export function deadEndOf(unfilled: unknown): Unlock | undefined {
  for (const blank of Array.isArray(unfilled) ? unfilled as Record<string, unknown>[] : []) {
    const unlock = unlockOf(blank.needs, `${blank.field}: ${blank.unlock}`);
    if (unlock) return unlock;
  }
  return undefined;
}

export const CAPABILITY_DDL = [
  `CREATE TABLE IF NOT EXISTS capability (
    id bigserial PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN (${CAPABILITY_KINDS.map(kind => `'${kind}'`).join(",")})),
    name text, state text, platform text, gov_kind text,
    because text NOT NULL,
    version text,
    at timestamptz NOT NULL DEFAULT now(),
    applied_at timestamptz,
    CHECK (num_nonnulls(name, state, platform, gov_kind) > 0)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS capability_once ON capability (kind, coalesce(name,''), version) WHERE version IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS capability_new ON capability (id) WHERE applied_at IS NULL`,
] as const;

export interface StoredCapability extends Capability { readonly id: number; readonly at: string }

/** The events: one small row each time something new can be done. */
export function capabilityLog(query: Query) {
  return {
    /** An announcement with a version is stored once, whoever repeats it. */
    async record(capabilities: readonly Capability[], at: string): Promise<void> {
      const rows = capabilities.map(({ kind, because, version, ...scope }) => ({ kind, because, version: version ?? null, ...scopeOf(scope) }));
      if (rows.length) await query(`INSERT INTO capability (kind,name,state,platform,gov_kind,because,version,at)
        SELECT r.kind,r.name,r.state,r.platform,r."govKind",r.because,r.version,$2::timestamptz
        FROM jsonb_to_recordset($1::jsonb) AS r(kind text,name text,state text,platform text,"govKind" text,because text,version text) ON CONFLICT DO NOTHING`,
      [JSON.stringify(rows), at]);
    },
    /** The events no pass has finished with, oldest first. */
    async pending(limit: number): Promise<readonly StoredCapability[]> {
      return (await query("SELECT id,kind,name,state,platform,gov_kind,because,at FROM capability WHERE applied_at IS NULL ORDER BY id LIMIT $1", [limit])).map(row => ({
        id: Number(row.id), kind: row.kind as CapabilityKind, because: String(row.because), at: new Date(row.at as string).toISOString(),
        ...scopeOf({ name: row.name, state: row.state, platform: row.platform, govKind: row.gov_kind }) }));
    },
    async applied(id: number, at: string): Promise<void> { await query("UPDATE capability SET applied_at = $2::timestamptz WHERE id = $1", [id, at]); },
  };
}
export type CapabilityLog = ReturnType<typeof capabilityLog>;

/** Dead ends put back on the list per turn; an event with more to reopen than this is finished on the next turn. */
export const REOPEN_BATCH = 500;

/**
 * The list's own clock: every dead end an event unlocks goes back on the list with the reason, reading only the
 * events nobody has finished with; then every dead end that has waited out its free-try time does too.
 */
export async function reopenDeadEnds(list: WorkList, log: CapabilityLog, maxWaitMs: number, at: string): Promise<number> {
  let reopened = 0;
  for (const event of await log.pending(20)) {
    const moved = await list.reopen({ at, because: `unlocked by ${event.because}`, limit: REOPEN_BATCH, capability: event });
    reopened += moved;
    if (moved < REOPEN_BATCH) await log.applied(event.id, at); else return reopened;
  }
  const days = +(maxWaitMs / 86_400_000).toFixed(2);
  return reopened + await list.reopen({ at, because: `its free try came due after ${days} day${days === 1 ? "" : "s"}`, limit: REOPEN_BATCH,
    waitingSince: new Date(Date.parse(at) - maxWaitMs).toISOString() });
}

const SOURCES = new URL("../sources/", import.meta.url);
async function codeIn(path: URL): Promise<URL[]> {
  const found: URL[] = [];
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) found.push(...await codeIn(new URL(`${entry.name}/`, path)));
    else if (/\.(ts|mjs)$/.test(entry.name) && !entry.name.includes(".test.")) found.push(new URL(entry.name, path));
  }
  return found;
}

/** Each reader of a kind of website installed here, versioned by its code, so a changed reader is a new event and an unchanged one is not. */
export async function installedParsers(): Promise<readonly Capability[]> {
  const found: Capability[] = [];
  const add = async (name: string, files: readonly URL[]) => {
    const hash = createHash("sha256");
    for (const file of files) hash.update(file.pathname).update(await readFile(file));
    found.push({ kind: "parser", name, platform: name, because: `a new reader for ${name}`, version: hash.digest("hex").slice(0, 16) });
  };
  for (const entry of await readdir(SOURCES, { withFileTypes: true }))
    if (entry.isDirectory() && entry.name !== "platform-adapters") await add(entry.name, await codeIn(new URL(`${entry.name}/`, SOURCES)));
  const adapters = new URL("platform-adapters/", SOURCES);
  for (const entry of await readdir(adapters, { withFileTypes: true }).catch(() => []))
    if (entry.isDirectory()) await add(entry.name, await codeIn(new URL(`${entry.name}/`, adapters)));
    else if (/\.(ts|mjs)$/.test(entry.name) && !entry.name.includes(".test.")) await add(entry.name.replace(/\.(ts|mjs)$/, ""), [new URL(entry.name, adapters)]);
  return found;
}

/** What a batch of Knowledge Bank entries says can now be done: a reader installed, a method that worked, a source added. One event per thing per day. */
export function capabilitiesOfEntries(entries: readonly { readonly id: string; readonly kind: string; readonly outcome: string; readonly url: string | null; readonly title: string;
  readonly states: readonly string[]; readonly platforms: readonly string[]; readonly observedAt: string | null; readonly reach?: { readonly method?: boolean } }[]): Capability[] {
  return entries.flatMap((entry): Capability[] => {
    if (entry.outcome !== "YIELDED") return [];
    const state = entry.states[0], platform = entry.platforms[0], day = (entry.observedAt ?? "").slice(0, 10);
    const host = (() => { try { return new URL(entry.url ?? "").host; } catch { return undefined; } })();
    if (entry.kind === "PLATFORM_ADAPTER" || entry.kind === "ENGINEER_ADAPTER_PR")
      return platform ? [{ kind: "parser", name: platform, platform, state, because: `a new reader for ${platform}`, version: `${entry.id}@${day}` }] : [];
    if (entry.kind === "SOURCE_REGISTER" && host) return [{ kind: "source", name: host, state, platform, because: `the source ${host} was added`, version: host }];
    if (entry.kind === "METHOD" || entry.kind === "ROUTE" || entry.reach?.method === true)
      return state || platform ? [{ kind: "method", state, platform, because: `a method that worked for ${[platform, state?.toUpperCase()].filter(Boolean).join(" in ")}: ${entry.title}`.slice(0, 200), version: `${entry.id}@${day}` }] : [];
    return [];
  });
}
