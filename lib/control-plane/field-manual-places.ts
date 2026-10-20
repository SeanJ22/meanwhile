/**
 * What a method did in each place, kept apart. An entry's `outcome` is the
 * latest result anywhere; `placeResults` keeps one result per place, and a
 * newer result replaces only the same place's, recording what it superseded.
 *
 * Pure: no store, no clock.
 */

import type { FieldManualEntry, FieldManualOutcome } from "./field-manual.ts";

export interface PlaceResult {
  /** `ocd-division/...` exactly, `body:<id>`, `state:<xx>`, or `any` for an entry that names no place. */
  readonly place: string;
  readonly outcome: FieldManualOutcome;
  readonly observedAt: string | null;
  /** The observation time of the older result for this same place that this one replaced. */
  readonly supersedes?: string | null;
}

/** The places an entry speaks for, most specific first. */
export function placesOf(entry: Pick<FieldManualEntry, "ocdIds" | "bodyIds" | "states">): string[] {
  const specific = [...(entry.ocdIds ?? []), ...(entry.bodyIds ?? []).map((id) => `body:${id}`)];
  if (specific.length > 0) return [...new Set(specific)].sort();
  if (entry.states.length > 0) return entry.states.map((s) => `state:${s}`).sort();
  return ["any"];
}

/** An entry's own result in every place it names (what one observation says). */
export function placeResultsOf(entry: Pick<FieldManualEntry, "ocdIds" | "bodyIds" | "states" | "outcome" | "observedAt" | "placeResults" | "placeResultsPartial">): PlaceResult[] {
  const implicit = () => placesOf(entry).map(place => ({ place, outcome: entry.outcome, observedAt: entry.observedAt }));
  return entry.placeResults === undefined ? implicit() : entry.placeResultsPartial ? mergePlaceResults(implicit(), entry.placeResults) : [...entry.placeResults];
}

const at = (value: string | null | undefined): string => value ?? "";

/** Per place, the newer observation wins; the result it replaced is recorded; a place the other side never saw is kept as it was. */
export function mergePlaceResults(prior: readonly PlaceResult[], incoming: readonly PlaceResult[]): PlaceResult[] {
  const byPlace = new Map(prior.map((r) => [r.place, r]));
  for (const next of incoming) {
    const old = byPlace.get(next.place);
    if (old === undefined) byPlace.set(next.place, next);
    else if (at(next.observedAt) > at(old.observedAt)) byPlace.set(next.place, { ...next, supersedes: old.observedAt });
    else if (at(next.observedAt) === at(old.observedAt) && next.outcome !== old.outcome) {
      // The same instant with two answers: the worse is kept, so a failure is never hidden by a tie.
      const worse = RANK[next.outcome] > RANK[old.outcome] ? next : old;
      byPlace.set(next.place, { ...worse, supersedes: old.supersedes ?? null });
    }
  }
  return [...byPlace.values()].sort((a, b) => (a.place < b.place ? -1 : a.place > b.place ? 1 : 0));
}

const RANK: Readonly<Record<FieldManualOutcome, number>> = { YIELDED: 0, REFERENCE: 1, ZERO: 2, BLOCKED: 3, FAILED: 4 };

/** What is known of a method in the place a page is for; a method that fails there is left off the page. */
export type MethodHere = { readonly status: "WORKS" } | { readonly status: "UNTRIED" };

/** The words a worker reads after a method's line. */
export function hereNote(here: MethodHere): string {
  return here.status === "WORKS" ? " [works here]" : " [untried here: try it and record the result]";
}
