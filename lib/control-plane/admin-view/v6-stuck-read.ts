import { plainWords } from "./plain-words.ts";
import type { Sql } from "../repository/pg-store.ts";
import type { StuckSummary } from "./stuck-summary.ts";
import { readOwnerStuckSummary } from "../repository/owner-stuck-counts.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { ageOf, causeOf, NEED_WORDS, placeKeyOfRow, sendWordsFor, stateOfRow, type BlockerLane, type Cause, type StuckRowLike } from "./blocker-causes.ts";
import { parseV6PlaceKey, type V6PlaceScope } from "./v6-hunts-read.ts";

/** The work list holds one assignment per key; only its current stuck segments return. */
export const ADMIN_V6_STUCK_CONTRACT = "admin-v6/stuck@1" as const;
export const ADMIN_V6_SAME_CAUSE_CONTRACT = "admin-v6/sameCause@1" as const;
export const STUCK_ITEM_LIMIT = 300;

export interface StuckPopulation {
  readonly state: "READ";
  readonly rows: readonly StuckRowLike[];
  readonly publishedAt: string | null;
  readonly summary?: StuckSummary;
}

export async function readStuckPopulation(sql: Sql, scope = "us"): Promise<StuckPopulation> {
  const summary = await readOwnerStuckSummary(sql,STUCK_ITEM_LIMIT,scope);
  const raw = summary.rows as readonly Record<string,unknown>[];
  let publishedAt: string | null = summary.published_at instanceof Date ? summary.published_at.toISOString() : typeof summary.published_at==='string' ? summary.published_at : null;
  const rows = stuckRowsOf(raw);
  for (const r of raw) publishedAt = typeof r.published_at === "string" ? r.published_at : r.published_at instanceof Date ? r.published_at.toISOString() : publishedAt;
  return { state: "READ", rows, publishedAt, summary:{total:Number(summary.total),groups:summary.groups as StuckSummary['groups'],
    counts:{states:summary.states as Record<string,number>,places:summary.places as Record<string,number>}} };
}

export function stuckRowsOf(raw:readonly Record<string,unknown>[]):readonly StuckRowLike[] {
  return raw.map((r): StuckRowLike => {
    const text = (v: unknown) => (typeof v === "string" ? v : null);
    return { id: String(r.id), state: String(r.state), lane: text(r.lane), owner: text(r.owner), blocker: text(r.blocker), label: text(r.label),
      subjectName: text(r.subject_name), stateCode: text(r.state_code), overdue: typeof r.overdue === "boolean" ? r.overdue : null,
      band: typeof r.band === "number" ? r.band : null, waitingSince: text(r.waiting_since), eligibleAt: text(r.eligible_at),
      lastActivityAt: text(r.last_activity_at), nextAction: text(r.next_action),
      assignmentKeys: Array.isArray(r.assignment_keys) ? r.assignment_keys.filter((k): k is string => typeof k === "string") : [] };
  });
}

export interface StuckActionRef { readonly kind: "send-agents"; readonly target: string; readonly label: string; readonly payload: Readonly<Record<string, string>> }
/** Structurally `StuckItem` in app/(admin)/_mw/admin-v6/model.ts. */
export interface AdminV6StuckItem {
  readonly id: string; readonly title: string; readonly applies: readonly string[]; readonly lane: BlockerLane; readonly cause: string;
  readonly age: string; readonly ageRank: number; readonly tried: string; readonly helped: string; readonly next: string; readonly owner: string;
  readonly technical?: readonly string[];
  readonly readersAffected?: boolean; readonly group: string; readonly actions: readonly StuckActionRef[];
}
/** Structurally `SameCause` in model.ts. */
export interface AdminV6SameCause {
  readonly key: string; readonly cause: string; readonly lane: BlockerLane; readonly count: string;
  readonly itemIds: readonly string[]; readonly action?: StuckActionRef;
}

const stateNameOf = (code: string | null) => (code ? US_STATES.find((s) => s.code === code.toLowerCase())?.name ?? null : null);

export function relationOfRow(scope: V6PlaceScope | null, row: StuckRowLike): "local" | "shared" | null {
  if (scope === null || scope.kind === "country") return "local";
  const code = stateOfRow(row);
  if (scope.kind === "state") return code === scope.state ? "local" : null;
  const key = placeKeyOfRow(row);
  if (key === `geo:${scope.state}.${scope.type}.${scope.geoid}`) return "local";
  return code === scope.state ? "shared" : null;
}

function sendAction(target: string, label: string, words: string): StuckActionRef {
  return { kind: "send-agents", target, label, payload: { words } };
}

export function stuckViews(rows: readonly StuckRowLike[], scopeKey: string, nowIso: string, shutDoors: readonly AdminV6StuckItem[] = [], summary?: StuckSummary, shutDoorCount = shutDoors.length): {
  readonly items: readonly AdminV6StuckItem[]; readonly sameCause: readonly AdminV6SameCause[]; readonly total: number;
} {
  const scope = parseV6PlaceKey(scopeKey);
  const inScope = rows.filter((row) => relationOfRow(scope, row) !== null);
  const scored = inScope.map((row) => {
    const cause = causeOf(row);
    const age = ageOf(row, nowIso);
    const urgency = row.overdue === true ? 3 : row.state === "BLOCKED" || row.state === "FAILED" ? 2 : 1;
    const harm = row.band === null ? 0 : 4 - row.band;
    return { row, cause, age, score: urgency * 100 + harm * 30 + Math.min(age.rank, 60) };
  }).sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  const place = (row: StuckRowLike) => placeKeyOfRow(row);
  const shownDoors = shutDoors.slice(0, STUCK_ITEM_LIMIT);
  const items = [...shownDoors, ...scored.slice(0, STUCK_ITEM_LIMIT - shownDoors.length).map(({ row, cause, age }): AdminV6StuckItem => {
    const at = place(row);
    const title = plainWords([row.label, row.subjectName && row.label && !row.label.includes(row.subjectName) ? row.subjectName : null].filter(Boolean).join(" — ") || "Work waiting for repair", "Work waiting for repair");
    const state = stateNameOf(stateOfRow(row));
    const words = sendWordsFor({ stateNames: state ? [state] : [], subject: row.subjectName, label: row.label, zip: /^geo:[a-z]{2}.zcta.(\d{5})$/.exec(at)?.[1] ?? null });
    return { id: row.id, title, applies: [at], lane: cause.lane, cause: cause.needs ? `${NEED_WORDS[cause.needs]}: ${cause.words}` : cause.words, ...(cause.needs ? { needs: cause.needs } : {}), age: age.words, ageRank: age.rank,
      tried: row.blocker === null ? "—" : cause.words, helped: "—", next: row.nextAction ? plainWords(row.nextAction, cause.next) : cause.next,
      technical: [row.id, ...(row.blocker ? [row.blocker] : []), ...(row.nextAction ? [row.nextAction] : [])],
      owner: cause.owner, readersAffected: row.band === 1 ? true : undefined, group: cause.key,
      actions: words === null ? [] : [sendAction(at, "Send agents", words)] };
  })];
  const groups = new Map<string, { cause: Cause; rows: StuckRowLike[]; states: Set<string>; count:number }>();
  for (const { row, cause } of scored) {
    const g = groups.get(cause.key) ?? { cause, rows: [], states: new Set<string>(), count:0 };
    g.rows.push(row);
    g.count += 1;
    const st = stateOfRow(row);
    if (st) g.states.add(st);
    groups.set(cause.key, g);
  }
  if(summary) for(const group of summary.groups) {
    const cause=causeOf(group.sample);
    groups.set(cause.key,{cause,rows:groups.get(cause.key)?.rows??[],states:new Set(group.states),count:group.count});
  }
  const shownIds = new Set(items.map((i) => i.id));
  const sameCause = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([key, g]): AdminV6SameCause => {
      // A group is sent to the state(s) it sits in; the words name those states so the runner's target reading finds them.
      const states = [...g.states].sort();
      const target = states.length === 1 ? `st:${states[0]}` : "us";
      const names = states.map((s) => stateNameOf(s)).filter((n): n is string => n !== null);
      const words = sendWordsFor({ stateNames: names, zip: null, subject: null, label: null });
      return { key, cause: g.cause.words, lane: g.cause.lane, count: String(g.count),
        itemIds: g.rows.filter((r) => shownIds.has(r.id)).map((r) => r.id),
        ...(words === null ? {} : { action: sendAction(target, `Send agents to all ${g.count}`, words) }) } as AdminV6SameCause;
    });
  return { items, sameCause, total: (summary?.total ?? scored.length) + shutDoorCount };
}
