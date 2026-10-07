/**
 * What a method did in each place, kept apart. An entry's `outcome` is the
 * latest result anywhere; `placeResults` keeps one result per place, and a
 * newer result replaces only the same place's, recording what it superseded.
 *
 * When the manual is projected for a place with the fix map's rows for it,
 * each method line says whether it works here, is untried here, or fails here;
 * the ones that fail here are left out of the brief.
 *
 * Pure: no store, no clock.
 */

import type { FieldManualEntry, FieldManualOutcome } from "./field-manual.ts";
import type { FixMapRow } from "../method/fix-map.ts";

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
export function placeResultsOf(entry: Pick<FieldManualEntry, "ocdIds" | "bodyIds" | "states" | "outcome" | "observedAt" | "placeResults">): PlaceResult[] {
  return entry.placeResults !== undefined ? [...entry.placeResults] : placesOf(entry).map((place) => ({ place, outcome: entry.outcome, observedAt: entry.observedAt }));
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

export type MethodHere =
  | { readonly status: "WORKS" }
  | { readonly status: "UNTRIED" }
  | { readonly status: "FAILS"; readonly cause: string };

/** Entries that are reusable methods: the ones the fix map holds results for. */
export const METHOD_KINDS: ReadonlySet<string> = new Set(["METHOD", "ROUTE", "MANIFEST_BRANCH", "BODY_RUNG"]);

/** What the fix map says of one method in the place a projection is for; null when the entry is not a method. */
export function methodHere(entry: Pick<FieldManualEntry, "id" | "kind">, placeRows: readonly FixMapRow[]): MethodHere | null {
  if (!METHOD_KINDS.has(entry.kind)) return null;
  const row = placeRows.find((r) => r.methodId === entry.id);
  if (row === undefined || row.state === "UNTRIED") return { status: "UNTRIED" };
  return row.state === "WORKS" ? { status: "WORKS" } : { status: "FAILS", cause: row.cause ?? "it did not succeed here" };
}

/** The words a Scout reads after the line. */
export function hereNote(here: MethodHere): string {
  if (here.status === "WORKS") return " [works here]";
  if (here.status === "UNTRIED") return " [untried here: try it and record the result]";
  return ` [fails here: ${here.cause.replace(/\s+/g, " ").trim().slice(0, 120)}]`;
}
