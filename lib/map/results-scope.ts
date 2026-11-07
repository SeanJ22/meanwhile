import { useSyncExternalStore } from "react";

export interface ResultsState { abbr: string; name: string }

/**
 * What the results map and the scorecard share, so a tab change on one moves the other.
 * The map owns everything else (layer, county, legend, sheet).
 */
export interface ResultsScope {
  open: boolean;
  scope: "state" | "nation";
  /** The state the map and scorecard show. */
  state: ResultsState;
  /** The reader's own state, always the first scorecard tab. */
  home: ResultsState;
  /** The last other state the reader drilled into: the scorecard's middle tab. */
  visited: ResultsState | null;
  /** Whether the results need district boundaries loaded. The national Senate view draws state shapes and loads none. */
  districts: boolean;
}

const CLOSED: ResultsScope = Object.freeze({
  open: false, scope: "state", state: { abbr: "", name: "" }, home: { abbr: "", name: "" }, visited: null, districts: false,
});

let current: ResultsScope = CLOSED;
const listeners = new Set<() => void>();
const set = (next: ResultsScope) => { current = next; for (const listener of [...listeners]) listener(); };

export const getResultsScope = () => current;
export const getServerResultsScope = () => CLOSED;
export function subscribeResultsScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const useResultsScope = () => useSyncExternalStore(subscribeResultsScope, getResultsScope, getServerResultsScope);

const same = (a: ResultsState, b: ResultsState) => a.abbr === b.abbr;

/** "See the map": open on the reader's own state. */
export function openResults(home: ResultsState): void {
  set({ open: true, scope: "state", state: home, home, visited: null, districts: false });
}
export function closeResults(): void { set(CLOSED); }

/** Scorecard tab or map switch between a state and the whole country. */
export function setResultsScope(scope: ResultsScope["scope"]): void {
  if (current.open && current.scope !== scope) set({ ...current, scope });
}

/** Drilling into a state from the map (or its tab on the scorecard) shows that state on both. */
export function showResultsState(state: ResultsState): void {
  if (!current.open) return;
  set({ ...current, scope: "state", state, visited: same(state, current.home) ? current.visited : state });
}

/** The results map says whether it draws district boundaries, so the one map loads them only then. */
export function setResultsDistricts(districts: boolean): void {
  if (current.open && current.districts !== districts) set({ ...current, districts });
}
