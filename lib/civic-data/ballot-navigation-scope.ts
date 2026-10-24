import { US_JURISDICTIONS } from "../coverage/states.ts";

export const BALLOT_NAVIGATION_STATES = US_JURISDICTIONS.filter(state => state.prefix !== "territory").map(state => state.usps);
const states = new Set<string>(US_JURISDICTIONS.map(state => state.usps));

export function ballotNavigationScope(state: string): string {
  if (!states.has(state)) throw new Error(`Invalid ballot navigation state: ${state}`);
  return `US-${state}:official-ballot-navigation`;
}

export function ballotNavigationState(scope: string): string | null {
  const state = /^US-([A-Z]{2}):official-ballot-navigation$/.exec(scope)?.[1];
  return state && states.has(state) ? state : null;
}

export function ballotNavigationTaskId(state: string): string {
  ballotNavigationScope(state);
  return `ballot-navigation-${state.toLowerCase()}`;
}
export function ballotNavigationTaskState(taskId: string): string | null {
  const state = /^ballot-navigation-([a-z]{2})$/.exec(taskId)?.[1].toUpperCase();
  return state && states.has(state) ? state : null;
}

export function ballotNavigationDivision(state: string): string {
  ballotNavigationScope(state);
  const jurisdiction = US_JURISDICTIONS.find(row => row.usps === state)!;
  return `ocd-division/country:us/${jurisdiction.prefix}:${state.toLowerCase()}`;
}
