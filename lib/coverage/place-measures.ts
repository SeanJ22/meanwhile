import { isCountedChecklistItem, percentOf } from "./place-percent.ts";
import type { RowStatuses } from "./place-statuses.ts";

/**
 * **THREE MEASURES, NEVER BLENDED.** Completeness (what we hold of what is
 * owed), freshness (how much of what we hold is current) and delivery (how much
 * of what is published a reader can be seen to get). Each carries the counts
 * behind its percentage, and none is averaged into another. They only count the
 * owed list; nothing here gates publishing. A count we do not have is null and
 * shows "—", never zero.
 *
 * PURE.
 */
export interface MeasureRow {
  readonly checklistId: string;
  readonly state: "published" | "held" | "unpublished" | "stale" | "missing";
  readonly statuses?: RowStatuses | null;
}

export interface Measure {
  /** Items counted in. */
  readonly n: number;
  /** The denominator the measure is counted against. */
  readonly of: number;
  /** Floored to one decimal; null when nothing is counted against. */
  readonly percent: number | null;
}

export interface Completeness extends Measure {
  /** Beside the figure; null where the count is not available yet. */
  readonly beside: {
    /** Due and owed but the hunt has been stopped by a named obstacle. Not recorded yet. */
    readonly blocked: number | null;
    /** Due and owed, and nothing has been tried yet. */
    readonly notChecked: number;
    /** Due, and the government has not posted it yet. Still owed. */
    readonly awaitingPublication: number;
    /** Due and owed, and no squad or door can fill it yet. */
    readonly noProducer: number;
    /** Applicability or due date cannot be told yet; held out of the figure, never dropped. */
    readonly unresolved: number;
    /** Not yet due, so not yet owed. */
    readonly notYetDue: number;
    /** The government verifiably does not publish it, so it cannot be owed. */
    readonly notPublishedByGovernment: number;
  };
}

export interface Freshness extends Measure { readonly beside: { readonly refreshDue: number } }
export interface Delivery extends Measure { readonly beside: { readonly notChecked: number; readonly notSeen: number } }

export interface PlaceMeasures {
  readonly completeness: Completeness;
  readonly freshness: Freshness;
  readonly delivery: Delivery;
}

const satisfied = (row: MeasureRow) => row.state === "published" || row.state === "held";

export function placeMeasures(rows: readonly MeasureRow[]): PlaceMeasures {
  const counted = rows.filter(row => isCountedChecklistItem(row.checklistId));
  const applies = (row: MeasureRow) => row.statuses?.applies ?? "applies";
  const due = (row: MeasureRow) => row.statuses?.due ?? "due";
  const unresolved = counted.filter(row => applies(row) === "unresolved" || due(row) === "unresolved");
  const resolved = counted.filter(row => !unresolved.includes(row));
  const notYetDue = resolved.filter(row => due(row) === "not-yet-due");
  const owed = resolved.filter(row => due(row) === "due");
  // A verified absence the government will not fix is not a requirement a hunt can meet.
  const notPublished = owed.filter(row => row.state === "unpublished" && row.statuses?.published !== "awaiting-publication");
  const applicable = owed.filter(row => !notPublished.includes(row));
  const done = applicable.filter(satisfied);
  const open = applicable.filter(row => !satisfied(row));
  const completeness: Completeness = { n: done.length, of: applicable.length, percent: percentOf(done.length, applicable.length), beside: {
    blocked: null,
    notChecked: open.filter(row => (row.statuses?.found ?? "nothing-yet") === "nothing-yet" && row.state === "missing").length,
    awaitingPublication: open.filter(row => row.statuses?.published === "awaiting-publication").length,
    noProducer: open.filter(row => row.statuses?.hasProducer === false).length,
    unresolved: unresolved.length, notYetDue: notYetDue.length, notPublishedByGovernment: notPublished.length } };
  const held = counted.filter(row => row.state === "published" || row.state === "held" || row.state === "stale");
  const current = held.filter(row => row.state !== "stale");
  const freshness: Freshness = { n: current.length, of: held.length, percent: percentOf(current.length, held.length),
    beside: { refreshDue: held.length - current.length } };
  const live = counted.filter(row => row.state === "published");
  const seen = live.filter(row => row.statuses?.seen === "seen");
  const delivery: Delivery = { n: seen.length, of: live.length, percent: percentOf(seen.length, live.length), beside: {
    notChecked: live.filter(row => (row.statuses?.seen ?? "not-checked") === "not-checked").length,
    notSeen: live.filter(row => row.statuses?.seen === "not-seen").length } };
  return { completeness, freshness, delivery };
}

/** What is not captured, split: the items with a producer that has not found them yet, and the items nothing hunts yet. */
export interface NotCaptured { readonly huntedNotFound: number; readonly nothingHunts: number }

export function notCapturedOf(rows: readonly MeasureRow[]): NotCaptured {
  const missing = rows.filter(row => isCountedChecklistItem(row.checklistId) && (row.state === "missing" || row.state === "stale"));
  const nothing = missing.filter(row => row.statuses?.hasProducer === false);
  return { huntedNotFound: missing.length - nothing.length, nothingHunts: nothing.length };
}

/** The same three measures for each family, in the order given. A family with nothing counted is left out. */
export function measuresByFamily(rows: readonly MeasureRow[], order: readonly string[]): { readonly group: string; readonly measures: PlaceMeasures }[] {
  const groupOf = (id: string) => id.slice(0, id.indexOf("-"));
  const groups = [...new Set(rows.map(row => groupOf(row.checklistId)))];
  const ordered = [...order.filter(group => groups.includes(group)), ...groups.filter(group => !order.includes(group)).sort()];
  return ordered.map(group => ({ group, measures: placeMeasures(rows.filter(row => groupOf(row.checklistId) === group)) }))
    .filter(entry => entry.measures.completeness.of + entry.measures.freshness.of + entry.measures.delivery.of > 0
      || entry.measures.completeness.beside.unresolved + entry.measures.completeness.beside.notYetDue > 0);
}

/** One-line labels for a figure and what sits beside it. */
export function measureWords(name: string, measure: Measure): string {
  return `${name}: ${measure.n} of ${measure.of}${measure.percent === null ? "" : ` · ${measure.percent.toFixed(1)}%`}`;
}

/** The place's completeness: the one number Admin's place card, the national list and the runner's order share. */
export function placePercent(rows: readonly MeasureRow[]): number | null {
  return placeMeasures(rows).completeness.percent;
}
