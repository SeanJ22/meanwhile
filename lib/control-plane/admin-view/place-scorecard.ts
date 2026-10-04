/**
 * **SEAN'S CHECKLIST SCORE FOR ONE PLACE — WHAT THE PLACE IS OWED, AND HOW MUCH OF IT IS CAPTURED.**
 *
 * Rulings §3: the State Run Checklist is Admin's capture scorecard. It measures
 * how much of what a place is owed has been captured, and it never gates
 * publishing. This module only counts. It reads the owed list S9 derives for a
 * place (`lib/coverage/place-owed.ts`: one row per subject and checklist
 * requirement, each `published`, `held`, `unpublished`, `stale` or `missing`)
 * and reports the counts overall and by checklist group, with the floored
 * percentage. Nothing here creates work, decides publication or adds a gate.
 *
 * Captured means the place has it: published, captured and waiting to publish,
 * or the government itself does not publish it. A field that was captured once
 * but whose freshness window has lapsed is owed again (`stale`); it is counted
 * apart from never-captured so Sean can see refresh work from discovery work.
 *
 * PURE.
 */

import { isCoreChecklistItem, isSummaryChecklistItem, percentOf } from "../../coverage/place-percent.ts";

export type OwedState = "published" | "held" | "unpublished" | "stale" | "missing";

/** The structural part of a place-owed row this module reads. */
export interface OwedRowLike {
  readonly id: string;
  readonly checklistId: string;
  readonly state: OwedState;
  readonly requirement: string;
  readonly subject: { readonly id: string; readonly kind: string; readonly label: string };
  readonly held: readonly { readonly sourceUrl: string; readonly checkedAt: string; readonly state: string }[];
}

export interface ScoreCounts {
  readonly published: number;
  readonly held: number;
  readonly unpublished: number;
  readonly stale: number;
  readonly missing: number;
}

export interface GroupScore extends ScoreCounts {
  readonly group: string;
  readonly name: string;
  readonly total: number;
  readonly captured: number;
  /** Floored to one decimal, so rounding can never produce an unearned 100%. Null when nothing is owed. */
  readonly percent: number | null;
}

export interface PlaceScore {
  /** Core items only; the family rows in `groups` add up to it. */
  readonly overall: GroupScore;
  readonly groups: readonly GroupScore[];
  /** Extension items, counted apart and never part of the headline. Null when the place owes none. */
  readonly extension: GroupScore | null;
  /** Summary items whose detail items carry the count: listed, but out of the denominator. Null when none. */
  readonly summary: GroupScore | null;
}

export const OWED_STATE_WORDS: Readonly<Record<OwedState, string>> = {
  published: "Published",
  held: "Captured, not published yet",
  unpublished: "The government doesn’t publish it",
  stale: "Captured earlier, refresh due",
  missing: "Not captured yet",
};

export const OWED_STATES: readonly OwedState[] = ["published", "held", "unpublished", "stale", "missing"];

export function groupOf(checklistId: string): string {
  const dash = checklistId.indexOf("-");
  return dash > 0 ? checklistId.slice(0, dash) : checklistId;
}

const EMPTY: ScoreCounts = { published: 0, held: 0, unpublished: 0, stale: 0, missing: 0 };

function scored(group: string, name: string, counts: ScoreCounts): GroupScore {
  const total = counts.published + counts.held + counts.unpublished + counts.stale + counts.missing;
  const captured = counts.published + counts.held + counts.unpublished;
  return { group, name, ...counts, total, captured, percent: percentOf(captured, total) };
}

/** Counts overall and by group. Groups come out in the checklist's own order (`groupOrder`), then any others. */
export function scorePlace(rows: readonly OwedRowLike[], groupNames: Readonly<Record<string, string>>, groupOrder: readonly string[]): PlaceScore {
  const by = new Map<string, { -readonly [K in keyof ScoreCounts]: number }>();
  const all = { ...EMPTY } as { -readonly [K in keyof ScoreCounts]: number };
  const extension = { ...EMPTY } as { -readonly [K in keyof ScoreCounts]: number };
  const summary = { ...EMPTY } as { -readonly [K in keyof ScoreCounts]: number };
  for (const row of rows) {
    if (!isCoreChecklistItem(row.checklistId)) { extension[row.state] += 1; continue; }
    if (isSummaryChecklistItem(row.checklistId)) { summary[row.state] += 1; continue; }
    const g = groupOf(row.checklistId);
    const counts = by.get(g) ?? { ...EMPTY };
    counts[row.state] += 1;
    all[row.state] += 1;
    by.set(g, counts);
  }
  const order = [...groupOrder.filter((g) => by.has(g)), ...[...by.keys()].filter((g) => !groupOrder.includes(g)).sort()];
  return {
    overall: scored("ALL", "Everything this place is owed", all),
    groups: order.map((g) => scored(g, groupNames[g] ?? g, by.get(g)!)),
    extension: Object.values(extension).some((n) => n > 0) ? scored("EXT", "Extra items beyond the core list", extension) : null,
    summary: Object.values(summary).some((n) => n > 0) ? scored("SUM", "Summary items counted through their detail items", summary) : null,
  };
}

/** One row in the paged owed list the checklist screen shows. */
export interface OwedListItem {
  readonly key: string;
  readonly checklistId: string;
  readonly group: string;
  readonly requirement: string;
  readonly subject: string;
  readonly subjectKind: string;
  readonly state: OwedState;
  readonly statusWords: string;
  /** The saved source page for this fact when we hold one. */
  readonly sourceUrl: string | null;
  readonly checkedAt: string | null;
}

export function owedListItem(row: OwedRowLike): OwedListItem {
  const held = [...row.held].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0] ?? null;
  return {
    key: row.id,
    checklistId: row.checklistId,
    group: groupOf(row.checklistId),
    requirement: row.requirement,
    subject: row.subject.label,
    subjectKind: row.subject.kind,
    state: row.state,
    statusWords: OWED_STATE_WORDS[row.state],
    sourceUrl: held?.sourceUrl ?? null,
    checkedAt: held?.checkedAt ?? null,
  };
}

/** Filter, order and window the owed list. Not-captured work comes first so the top of the list is the work. */
const STATE_RANK: Readonly<Record<OwedState, number>> = { missing: 0, stale: 1, held: 2, published: 3, unpublished: 4 };

export function pageOwed(rows: readonly OwedRowLike[], query: {
  readonly group: string | null;
  readonly states: readonly OwedState[] | null;
  readonly q: string | null;
  readonly offset: number;
  readonly limit: number;
}): { readonly items: readonly OwedListItem[]; readonly total: number; readonly nextOffset: number | null; readonly prevOffset: number | null } {
  const needle = query.q?.trim().toLowerCase() ?? "";
  const matching = rows.filter((row) => (query.group === null || groupOf(row.checklistId) === query.group) &&
    (query.states === null || query.states.includes(row.state)) &&
    (needle === "" || `${row.checklistId} ${row.requirement} ${row.subject.label}`.toLowerCase().includes(needle)))
    .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.checklistId.localeCompare(b.checklistId) || a.subject.label.localeCompare(b.subject.label));
  const items = matching.slice(query.offset, query.offset + query.limit).map(owedListItem);
  const next = query.offset + query.limit;
  return { items, total: matching.length, nextOffset: next < matching.length ? next : null, prevOffset: query.offset > 0 ? Math.max(0, query.offset - query.limit) : null };
}

/** The checklist screen names statuses its own way; the route accepts those names or the owed states themselves. */
export function owedStatesOf(status: string): readonly OwedState[] | null {
  switch (status) {
    case "published": return ["published"];
    case "collected": case "held": return ["held"];
    case "absent": case "unpublished": return ["unpublished"];
    case "can-do": return ["missing", "stale"];
    case "stale": return ["stale"];
    case "missing": return ["missing"];
    default: return null;
  }
}
