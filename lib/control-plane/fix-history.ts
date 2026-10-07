/**
 * Every door and fix keeps its history: the fix-list items for a door or
 * method, in order. Each time a fixed gap comes back, the finished episode is
 * kept on the item (`earlier`) before it reopens. Also here: the item a
 * reusable method gets when it goes from working to failing in a place.
 */
import { addFixItem, completeFixItem, fixItems, type FixItem } from "./fix-list.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "./gateway/admin-config.ts";
import { formatEastern } from "./eastern-time.ts";
import { fixSubjectId } from "./fix-queue.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import { applyFixResult, type FixMapRepository, type FixMapRow } from "../method/fix-map.ts";
import { fixResultsFromAttempt, type MethodAttempt, type RecordedAttempts } from "../method/fix-map-record.ts";
import { noteMethodStandings, type MethodTouch } from "./fix-standing.ts";

/** A finished episode kept on its item when the gap came back. */
export interface FixEpisodeRecord {
  /** When this episode broke. */
  readonly brokeAt: string;
  readonly fixedAt: string | null;
  readonly whatChanged: string | null;
  readonly changedBy: string | null;
  /** When it broke again, which ended the fix's hold. */
  readonly cameBackAt: string;
}

/** The fix list item as it is stored, with the episodes kept on it. */
export type FixItemWithHistory = FixItem & { readonly earlier?: readonly FixEpisodeRecord[] };

/** How many finished episodes an item keeps; the oldest drop first. */
export const FIX_EPISODES_KEPT = 20;

/**
 * The item as it should be stored when a FIXED gap is reported again: the
 * finished episode is kept, then the item reads CAME_BACK. The fix list's
 * `withFixAdded` calls this for its came-back branch.
 */
export function withEpisodeKept(item: FixItemWithHistory, at: string): FixItemWithHistory {
  const episode: FixEpisodeRecord = {
    brokeAt: item.cameBackAt ?? item.addedAt,
    fixedAt: item.fixedAt ?? null,
    whatChanged: item.whatChanged ?? null,
    changedBy: item.changedBy ?? null,
    cameBackAt: at,
  };
  return { ...item, earlier: [...(item.earlier ?? []), episode].slice(-FIX_EPISODES_KEPT), state: "CAME_BACK", cameBackAt: at };
}

export interface FixEpisode {
  readonly brokeAt: string;
  readonly fixedAt: string | null;
  readonly whatChanged: string | null;
  readonly changedBy: string | null;
  /** When it broke again; null while the fix holds or the break is still open. */
  readonly brokeAgainAt: string | null;
  /** Hours the fix held: to the next break, or to now while it still holds. Null when never fixed. */
  readonly heldHours: number | null;
  readonly stillHolding: boolean;
}

const hours = (from: string, to: string): number | null => {
  const a = Date.parse(from), b = Date.parse(to);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round(((b - a) / 3_600_000) * 10) / 10 : null;
};

/** Every episode of one item, oldest first. */
export function fixEpisodes(item: FixItemWithHistory, now: string): FixEpisode[] {
  const past: FixEpisode[] = (item.earlier ?? []).map((e) => ({
    brokeAt: e.brokeAt, fixedAt: e.fixedAt, whatChanged: e.whatChanged, changedBy: e.changedBy,
    brokeAgainAt: e.cameBackAt, heldHours: e.fixedAt === null ? null : hours(e.fixedAt, e.cameBackAt), stillHolding: false,
  }));
  const fixed = item.state === "FIXED" && item.fixedAt !== undefined;
  const current: FixEpisode = {
    brokeAt: item.cameBackAt ?? item.addedAt,
    fixedAt: fixed ? item.fixedAt! : null,
    whatChanged: fixed ? item.whatChanged ?? null : null,
    changedBy: fixed ? item.changedBy ?? null : null,
    brokeAgainAt: null,
    heldHours: fixed ? hours(item.fixedAt!, now) : null,
    stillHolding: fixed,
  };
  return [...past, current];
}

function held(h: number | null): string {
  if (h === null) return "—";
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

/** The item's history in plain words, one sentence per episode, oldest first. Eastern time. */
export function fixHistoryLine(item: FixItemWithHistory, now: string): string {
  const episodes = fixEpisodes(item, now);
  return episodes.map((e, i) => {
    const broke = `${i === 0 ? "Broke" : "Broke again"} ${formatEastern(e.brokeAt)}`;
    if (e.fixedAt === null) return `${broke}; not fixed yet.`;
    const how = e.whatChanged ? ` (${e.whatChanged.replace(/\.$/, "")})` : "";
    return e.stillHolding
      ? `${broke}; fixed ${formatEastern(e.fixedAt)}${how}; holding for ${held(e.heldHours)}.`
      : `${broke}; fixed ${formatEastern(e.fixedAt)}${how}; held ${held(e.heldHours)}.`;
  }).join(" ");
}

/** Every item for one door or method (its `where`), with its episodes, in the order they broke. */
export function historyFor(items: readonly FixItemWithHistory[], where: string, now: string): FixEpisode[] {
  return items.filter((i) => i.where === where.trim())
    .flatMap((i) => fixEpisodes(i, now))
    .sort((a, b) => a.brokeAt.localeCompare(b.brokeAt));
}

/* ------------------------------------------------- a method stops working */

export const METHOD_BREAK_FIX_BY = "The fix map";

/** Stable per method and place, so the same break is one item and a later break comes back on it. */
export function methodBreakFixWords(methodId: string, placeId: string): { where: string; says: string } {
  return { where: `Method ${methodId} in ${placeId}`, says: `A way in that worked here stopped working.` };
}

type FixRepos = Pick<ControlPlaneRepositories, "adminConfig">;

/**
 * What a fix-map change means for the fix list: working to failing opens (or
 * reopens) the item; failing to working completes it. Anything else writes
 * nothing.
 */
export async function noteMethodTransition(repos: FixRepos, prior: FixMapRow | null, next: FixMapRow): Promise<"BROKE" | "FIXED" | null> {
  if (prior === null || next === prior) return null;
  const at = next.triedAt ?? next.updatedAt;
  const { where, says } = methodBreakFixWords(next.methodId, next.placeId);
  if (prior.state === "WORKS" && next.state === "FAILS") {
    await addFixItem(repos, { where, says, by: METHOD_BREAK_FIX_BY, at });
    return "BROKE";
  }
  if (prior.state === "FAILS" && next.state === "WORKS") {
    const id = fixSubjectId(where, says);
    const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
    const item = held && isAdminConfig(held.value) ? fixItems(held.value).find((i) => i.id === id) : undefined;
    if (!item || item.state === "FIXED") return null;
    await completeFixItem(repos, id, {
      whatChanged: "The way in worked again.",
      changedBy: METHOD_BREAK_FIX_BY,
      before: `Failing since ${prior.triedAt ?? prior.updatedAt}: ${prior.cause ?? "it stopped working"}.`,
      after: `Worked on ${at}.`,
    }, at);
    return "FIXED";
  }
  return null;
}

/**
 * `recordAttempts` that keeps history: each row is written to the fix map, and
 * a working-to-failing change (or the reverse) goes on the fix list. Reads are
 * scoped to the attempt's place. A failed write is counted, never thrown. Then
 * each touched method is measured against the proof bar and a status change
 * writes its one update.
 */
export async function recordAttemptsKeepingHistory(fixMap: Pick<FixMapRepository, "put" | "forPlace" | "forMethod">, repos: FixRepos,
  attempts: readonly MethodAttempt[], titleOf?: (methodId: string) => string | null,
): Promise<RecordedAttempts & { readonly broke: number; readonly fixed: number; readonly updates: number }> {
  let written = 0, skipped = 0, failed = 0, broke = 0, fixed = 0, updates = 0;
  const touched: MethodTouch[] = [];
  const known = new Map<string, Map<string, FixMapRow>>();
  for (const attempt of attempts) {
    const rows = fixResultsFromAttempt(attempt);
    if (rows.length === 0) { skipped += 1; continue; }
    for (const row of rows) {
      try {
        let place = known.get(row.placeId);
        if (!place) {
          place = new Map((await fixMap.forPlace(row.placeId, 1000)).map((r) => [r.methodId, r] as const));
          known.set(row.placeId, place);
        }
        const prior = place.get(row.methodId) ?? null;
        await fixMap.put(row);
        written += 1;
        const next = applyFixResult(prior, row);
        place.set(row.methodId, next);
        touched.push({ methodId: row.methodId, brokeIn: prior?.state === "WORKS" && next.state === "FAILS" ? 1 : 0 });
        const change = await noteMethodTransition(repos, prior, next);
        if (change === "BROKE") broke += 1;
        if (change === "FIXED") fixed += 1;
      } catch {
        failed += 1;
      }
    }
  }
  const at = attempts.map((a) => a.at).filter((t) => Number.isFinite(Date.parse(t))).sort().at(-1);
  if (at !== undefined) {
    try { updates = (await noteMethodStandings(fixMap, repos, touched, at, titleOf)).length; } catch { failed += 1; }
  }
  return { written, skipped, failed, broke, fixed, updates };
}
