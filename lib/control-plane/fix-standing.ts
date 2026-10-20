/**
 * A fix shows once when it proves out, then goes quiet. After fix-map writes,
 * each touched method is measured against the proof bar in Admin settings; a
 * fix in Testing is a Queue row. Each status change writes one update together
 * with the standing, so a retried pass never tells it twice.
 */
import { ADMIN_CONFIG_ID, defaultAdminConfig, isAdminConfig, type AdminConfig } from "./gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import { withUpdateAdded } from "./updates.ts";
import type { FixMapRepository } from "../method/fix-map.ts";
import { capStandings, currentFixProof, nextStanding, readFixProofBar, readFixProofRecentDays, type MethodStanding, type StandingEvent, type StandingUpdate } from "../method/fix-status.ts";
import { withHistoryIndex } from "./workers/streamed-history.ts";

type Repos = Pick<ControlPlaneRepositories, "adminConfig">;

export function methodStandings(config: AdminConfig | null): readonly MethodStanding[] {
  return config?.methodStandings ?? [];
}

/** The fixes in Testing, newest first: the Queue's rows. */
export function fixesInTesting(config: AdminConfig | null): readonly MethodStanding[] {
  return methodStandings(config).filter((s) => s.status === "TESTING").sort((a, b) => b.since.localeCompare(a.since));
}

/** Applies one standing change and its update to the config. Unchanged config when nothing changed. */
export function withStanding(config: AdminConfig, standing: MethodStanding, update: StandingUpdate | null): AdminConfig {
  const list = methodStandings(config);
  const prior = list.find((s) => s.methodId === standing.methodId);
  if (prior && update === null && JSON.stringify(prior) === JSON.stringify(standing)) return config;
  const next = { ...config, methodStandings: capStandings([...list.filter((s) => s.methodId !== standing.methodId), standing]), updatedAt: update?.at ?? config.updatedAt };
  return update === null ? next : withUpdateAdded(next, { id: update.id, what: update.what, at: update.at, label: update.label, setback: update.setback,
    ...(update.claim ? { claim: update.claim } : {}) });
}

async function mutate(repos: Repos, methodId: string, at: string, change: (c: AdminConfig) => AdminConfig): Promise<void> {
  const read = repos.adminConfig.readArrayPage?.bind(repos.adminConfig);
  const write = repos.adminConfig.compareAndSetArrayItem?.bind(repos.adminConfig);
  if (!read || !write) throw new Error("METHOD_STANDING_SCOPED_ARRAY_STORE_REQUIRED");
  for (let attempt = 0; ; attempt++) {
    const held = await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, {apiFallback: true, updates: true, settings: true, updatedAt: true});
    if (!held) { await repos.adminConfig.put(ADMIN_CONFIG_ID, defaultAdminConfig(at), at); continue; }
    const page = await read(ADMIN_CONFIG_ID, "methodStandings", {match: {path: ["methodId"], value: methodId}, limit: 1});
    if (!page || page.revision !== held.revision) { if (attempt >= 1) throw new Error("METHOD_STANDING_READ_MOVED"); continue; }
    const current = {...(isAdminConfig(held.value) ? held.value : defaultAdminConfig(at)), methodStandings: page.values as MethodStanding[]};
    const next = change(current);
    if (next === current) return;
    try {
      await write(ADMIN_CONFIG_ID, held.revision, "methodStandings", ["methodId"], methodId,
        next.methodStandings?.find(row => row.methodId === methodId) ?? null, at,
        {limit: 1000, discardPath: ["status"], discardValue: "PROVEN", oldestPath: ["since"], discardAlso: {path: ["brokeAt"], value: null}},
        {updates: next.updates ?? [], updatedAt: next.updatedAt});
      return;
    } catch (error) {
      if (attempt >= 1) throw error;
    }
  }
}

export interface MethodTouch {
  readonly methodId: string;
  /** Places where it had worked and now failed, in this pass. */
  readonly brokeIn?: number;
}

/**
 * Re-measures each touched method and records any status change with its one
 * update. Returns the updates written. `titleOf` gives the plain name Admin
 * shows (the field-manual title); without one a neutral name is used.
 */
export async function noteMethodStandings(fixMap: Pick<FixMapRepository, "forMethod">, repos: Repos, touched: readonly MethodTouch[], at: string,
  titleOf: (methodId: string) => string | null = () => null): Promise<readonly StandingUpdate[]> {
  if (touched.length === 0) return [];
  const held = await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, {apiFallback: true, settings: true});
  const config = held && isAdminConfig(held.value) ? held.value : null;
  const bar = readFixProofBar(config);
  const recentDays = readFixProofRecentDays(config);
  const written: StandingUpdate[] = [];
  const merged = new Map<string, number>();
  for (const t of touched) merged.set(t.methodId, (merged.get(t.methodId) ?? 0) + (t.brokeIn ?? 0));
  for (const [methodId, brokeIn] of merged) {
    const map = await fixMap.forMethod(methodId, 1000);
    if (map.length === 0) continue;
    const proof = currentFixProof(map, bar, at, recentDays);
    let told: StandingUpdate | null = null;
    await mutate(repos, methodId, at, (c) => {
      const prior = methodStandings(c).find((s) => s.methodId === methodId) ?? null;
      const { standing, update } = nextStanding(methodId, prior, proof, titleOf(methodId) ?? "", at, { brokeIn });
      told = update;
      return withStanding(c, standing, update);
    });
    if (told) written.push(told);
  }
  return written;
}

/** A loss study changed a method: it goes back into Testing and says so once. */
export async function noteMethodLesson(fixMap: Pick<FixMapRepository, "forMethod">, repos: Repos, methodId: string, lesson: string, at: string,
  title: string | null = null): Promise<StandingUpdate | null> {
  const held = await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, {apiFallback: true, settings: true});
  const config = held && isAdminConfig(held.value) ? held.value : null;
  const proof = currentFixProof(await fixMap.forMethod(methodId, 1000), readFixProofBar(config), at, readFixProofRecentDays(config));
  let told: StandingUpdate | null = null;
  const event: StandingEvent = { lesson };
  await mutate(repos, methodId, at, (c) => {
    const prior = methodStandings(c).find((s) => s.methodId === methodId) ?? null;
    const { standing, update } = nextStanding(methodId, prior, proof, title ?? "", at, event);
    told = update;
    return withStanding(c, standing, update);
  });
  return told;
}

/**
 * Re-measure each Proven label on today's results. One that no longer holds says "Proven, broke since", writes
 * its one update, and is back in the Queue. Run daily.
 */
export async function recheckProvenFixes(fixMap: Pick<FixMapRepository, "forMethod">, repos: Repos, now: string): Promise<number> {
  const read = repos.adminConfig.readArrayPage?.bind(repos.adminConfig);
  if (!read) throw new Error("METHOD_STANDING_SCOPED_ARRAY_STORE_REQUIRED");
  return withHistoryIndex(async db => {
    db.exec("CREATE TABLE methods(sequence INTEGER PRIMARY KEY,id TEXT NOT NULL,title TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO methods VALUES(?,?,?)"); let after = 0, sequence = 0;
    for (;;) {
      const page = await read(ADMIN_CONFIG_ID, "methodStandings", {after, match: {path: ["status"], value: "PROVEN"}, projection: {methodId: true, title: true}});
      if (!page) break;
      for (const method of page.values as MethodStanding[]) insert.run(sequence++, method.methodId, method.title);
      if (page.next === null) break; after = page.next;
    }
    let changed = 0;
    for (const method of db.prepare("SELECT * FROM methods ORDER BY sequence").iterate())
      changed += (await noteMethodStandings(fixMap, repos, [{methodId: method.id}], now, () => method.title)).length;
    return changed;
  });
}

/** "Proven, broke since <day>" for a fix that was proven and no longer is; null otherwise. */
export function brokeSince(s: MethodStanding): string | null {
  return s.status === "TESTING" && s.provenAt !== null && s.brokeAt !== null && s.brokeAt >= s.provenAt ? s.brokeAt : null;
}

/** The Scoreboard's "Proven fixes" reading. */
export interface ProvenFixesReading {
  readonly proven: number;
  readonly testing: number;
  /** Proven fixes that broke in the last 30 days, newest first. */
  readonly broke: readonly { readonly title: string; readonly at: string; readonly stillProven: boolean }[];
}

const BROKE_SHOWN_MS = 30 * 86_400_000;

export function provenFixesReading(config: AdminConfig | null, now: string): ProvenFixesReading {
  const list = methodStandings(config);
  const after = Date.parse(now) - BROKE_SHOWN_MS;
  return {
    proven: list.filter((s) => s.status === "PROVEN").length,
    testing: list.filter((s) => s.status === "TESTING").length,
    broke: list.filter((s) => s.brokeAt !== null && Date.parse(s.brokeAt) >= after).sort((a, b) => b.brokeAt!.localeCompare(a.brokeAt!))
      .map((s) => ({ title: s.title, at: s.brokeAt!, stillProven: s.status === "PROVEN" })),
  };
}
