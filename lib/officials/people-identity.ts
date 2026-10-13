import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { OFFICIAL_ROSTER_TARGETS } from "../sources/official-rosters/targets.ts";
import type { Officeholder } from "./types.ts";

export type StatePeopleJurisdiction = `US-${string}`;
export const STATE_PEOPLE_JURISDICTIONS: readonly StatePeopleJurisdiction[] = Object.values(FIPS_TO_STATE)
  .map(state => `US-${state.postal}` as StatePeopleJurisdiction);

export function statePeopleScopeForDivision(divisionId: string): StatePeopleJurisdiction | null {
  const state = /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(divisionId)?.[1];
  const scope = state ? `US-${state.toUpperCase()}` as StatePeopleJurisdiction : null;
  return scope && STATE_PEOPLE_JURISDICTIONS.includes(scope) ? scope : null;
}

export function statePeopleSourceScopes(jurisdiction: string): readonly string[] {
  return [jurisdiction, `${jurisdiction}:openstates-people:v1`, ...OFFICIAL_ROSTER_TARGETS.filter(target => target.jurisdiction === jurisdiction).map(target => target.scope)];
}

export function statePeopleScopeForId(id: string, stateHint?: string): StatePeopleJurisdiction | null {
  const nativeGlobal = /^(?:plural:|ocd-person\/)[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(id);
  const state = /^plural:([a-z]{2}):/.exec(id)?.[1] ?? /^([a-z]{2})-(?:legislature|general-court):/.exec(id)?.[1] ??
    /^official-legislature-([a-z]{2}):/.exec(id)?.[1] ?? /^official-roster-record:([a-z]{2}):[a-f0-9]{64}$/.exec(id)?.[1] ??
    (nativeGlobal ? /^(?:US-)?([A-Z]{2})$/i.exec(stateHint ?? "")?.[1] : undefined);
  const scope = state ? `US-${state.toUpperCase()}` as StatePeopleJurisdiction : null;
  return scope && STATE_PEOPLE_JURISDICTIONS.includes(scope) ? scope : null;
}

/** Only exact publisher identity participates in a cross-source person join. */
export function personIdentityKeys(person: Pick<Officeholder, "id" | "personId" | "nativeIds">): ReadonlySet<string> {
  const keys = new Set([person.id, person.personId ?? person.id]);
  for (const [source, ids] of Object.entries(person.nativeIds ?? {})) {
    for (const id of ids) if (id) {
      keys.add(source === "reader" ? id : `${source}:${id}`);
      if (source === "ocd-person" && id.startsWith("ocd-person/")) keys.add(id);
    }
  }
  return keys;
}

export function sameNativePerson(left: Pick<Officeholder, "id" | "personId" | "nativeIds">,
  right: Pick<Officeholder, "id" | "personId" | "nativeIds">): boolean {
  const keys = personIdentityKeys(left);
  return [...personIdentityKeys(right)].some(key => keys.has(key));
}

/** A native official member URL carried by a source can link to that publisher's exact ID. */
export function nativePersonIdFromUrl(value: string): { source: string; id: string } | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "azleg.gov" && /\/(?:House|Senate)\/(?:House|Senate)-member\//i.test(url.pathname)) {
    const id = url.searchParams.get("legislator");
    if (id && /^\d+$/.test(id)) return { source: "az-legislature", id };
  }
  if (host === "njleg.state.nj.us") {
    const id = /^\/legislative-roster\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1];
    if (id) return { source: "nj-legislature", id };
  }
  if (host === "gc.nh.gov") {
    const id = [...url.searchParams].find(([key]) => /^personid$/i.test(key))?.[1];
    if (id && /^\d+$/.test(id)) return { source: "nh-general-court", id };
  }
  if (host === "congress.gov" || host === "bioguide.congress.gov") {
    const id = /(?:\/|=)([A-Z]\d{6})(?:\/|$|&)/i.exec(url.href)?.[1];
    if (id) return { source: "congress", id: id.toUpperCase() };
  }
  return null;
}
