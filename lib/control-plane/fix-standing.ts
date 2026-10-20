
import { ADMIN_CONFIG_ID, defaultAdminConfig, isAdminConfig, type AdminConfig } from "./gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import { withUpdateAdded } from "./updates.ts";
import type { FixMapRepository } from "../method/fix-map.ts";
import { proofFromStatistics, nextStanding, readFixProofBar, readFixProofRecentDays, type MethodStanding, type StandingEvent, type StandingUpdate } from "../method/fix-status.ts";

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
  const next = { ...config, methodStandings: [...list.filter((s) => s.methodId !== standing.methodId), standing], updatedAt: update?.at ?? config.updatedAt };
  return update === null ? next : withUpdateAdded(next, { id: update.id, what: update.what, at: update.at, label: update.label, setback: update.setback,
    ...(update.claim ? { claim: update.claim } : {}) });
}

async function mutate(repos: Repos, methodId: string, at: string, change: (c: AdminConfig) => AdminConfig): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const held = await repos.adminConfig.read(ADMIN_CONFIG_ID, { methodStandings: { ids: [methodId] }, updates: { ids: [] } });
    const current = held && isAdminConfig(held.value) ? held.value : defaultAdminConfig(at);
    const next = change(current);
    if (next === current) return;
    try {
      await repos.adminConfig.save(held, next, at);
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


export async function noteMethodStandings(fixMap: Pick<FixMapRepository, "statistics">, repos: Repos, touched: readonly MethodTouch[], at: string,
  titleOf: (methodId: string) => string | null = () => null): Promise<readonly StandingUpdate[]> {
  if (touched.length === 0) return [];
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  const config = held && isAdminConfig(held.value) ? held.value : null;
  const bar = readFixProofBar(config);
  const recentDays = readFixProofRecentDays(config);
  const written: StandingUpdate[] = [];
  const merged = new Map<string, number>();
  for (const t of touched) merged.set(t.methodId, (merged.get(t.methodId) ?? 0) + (t.brokeIn ?? 0));
  for (const [methodId, brokeIn] of merged) {
    const stats = await fixMap.statistics(methodId, new Date(Date.parse(at) - recentDays * 86_400_000).toISOString());
    if (stats.total === 0) continue;
    const proof = proofFromStatistics(stats, bar);
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
export async function noteMethodLesson(fixMap: Pick<FixMapRepository, "statistics">, repos: Repos, methodId: string, lesson: string, at: string,
  title: string | null = null): Promise<StandingUpdate | null> {
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  const config = held && isAdminConfig(held.value) ? held.value : null;
  const stats = await fixMap.statistics(methodId, new Date(Date.parse(at) - readFixProofRecentDays(config) * 86_400_000).toISOString());
  const proof = proofFromStatistics(stats, readFixProofBar(config));
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


export async function recheckProvenFixes(fixMap: Pick<FixMapRepository, "statistics">, repos: Repos, now: string): Promise<readonly StandingUpdate[]> {
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID, { methodStandings: true });
  const proven = methodStandings(held && isAdminConfig(held.value) ? held.value : null).filter((s) => s.status === "PROVEN");
  return noteMethodStandings(fixMap, repos, proven.map((s) => ({ methodId: s.methodId })), now, (id) => proven.find((s) => s.methodId === id)?.title ?? null);
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
