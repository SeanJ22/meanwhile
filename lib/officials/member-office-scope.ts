import { STATE_PEOPLE_JURISDICTIONS } from "./people-identity.ts";

export function memberOfficeStateScope(state: string): string {
  const jurisdiction = `US-${state.replace(/^US-/i, "").toUpperCase()}` as `US-${string}`;
  if (!STATE_PEOPLE_JURISDICTIONS.includes(jurisdiction)) throw new Error(`MEMBER_OFFICE_STATE_INVALID:${state}`);
  return `${jurisdiction}:state-legislator-member-offices`;
}
export function memberOfficeScopeState(scope: string): string | null {
  const state = /^US-([A-Z]{2}):state-legislator-member-offices$/.exec(scope)?.[1];
  return state && STATE_PEOPLE_JURISDICTIONS.includes(`US-${state}`) ? state : null;
}
