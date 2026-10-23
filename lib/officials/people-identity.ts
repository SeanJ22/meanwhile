import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { Officeholder } from "./types.ts";
import { PEOPLE_SOURCE_IDS, peopleSourceScope, peopleSourceRecordClass } from "./people-sources.ts";

export type StatePeopleJurisdiction = `US-${string}`;
export const STATE_PEOPLE_JURISDICTIONS: readonly StatePeopleJurisdiction[] = Object.values(FIPS_TO_STATE)
  .map(state => `US-${state.postal}` as StatePeopleJurisdiction);

export function statePeopleScopeForDivision(divisionId: string): StatePeopleJurisdiction | null {
  const state = /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(divisionId)?.[1];
  const scope = state ? `US-${state.toUpperCase()}` as StatePeopleJurisdiction : null;
  return scope && STATE_PEOPLE_JURISDICTIONS.includes(scope) ? scope : null;
}

export function statePeopleSourceScopes(jurisdiction: string): readonly string[] {
  return statePeopleSourcePointers(jurisdiction).filter(row=>row.recordClass === "STATE_LEGISLATOR").map(row=>row.scope);
}

export function statePeopleSourcePointers(jurisdiction: string) {
  return [{recordClass:"STATE_LEGISLATOR" as const,scope:jurisdiction}, {recordClass:"STATE_LEGISLATOR" as const,scope:`${jurisdiction}:openstates-people:v1`},
    ...PEOPLE_SOURCE_IDS.map(sourceId=>({recordClass:peopleSourceRecordClass(sourceId),scope:peopleSourceScope(jurisdiction,sourceId)}))];
}

export function statePeopleScopeForId(id: string, stateHint?: string): StatePeopleJurisdiction | null {
  const nativeGlobal = /^(?:plural:|ocd-person\/)[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(id) || /^(?:legiscan|official-legislature|wikidata|congress-api|govinfo):[^:]+$/.test(id);
  const state = /^(?:plural|statewide|legiscan|official-legislature|wikidata|congress-api|govinfo):([a-z]{2}):/.exec(id)?.[1] ?? /^([a-z]{2})-(?:legislature|general-court):/.exec(id)?.[1] ??
    (nativeGlobal ? /^(?:US-)?([A-Z]{2})$/i.exec(stateHint ?? "")?.[1] : undefined);
  const scope = state ? `US-${state.toUpperCase()}` as StatePeopleJurisdiction : null;
  return scope && STATE_PEOPLE_JURISDICTIONS.includes(scope) ? scope : null;
}

export const PERSON_ID_NAMESPACES: Readonly<Record<string,string>> = {bioguide:"congress",congress:"congress",legiscan:"legiscan",legiscanapi:"legiscan",votesmart:"votesmart",followthemoney:"followthemoney",opensecrets:"opensecrets",ballotpedia:"ballotpedia",wikidata:"wikidata",openstates:"ocd-person",ocdperson:"ocd-person",plural:"ocd-person"};

/** Only exact publisher identity participates in a cross-source person join. */
export function personIdentityKeys(person: Pick<Officeholder, "id" | "personId" | "nativeIds">): ReadonlySet<string> {
  const keys = new Set([person.id, person.personId ?? person.id]);
  for (const [source, ids] of Object.entries(person.nativeIds ?? {})) {
    for (const id of ids) if (id) {
      keys.add(source === "reader" ? id : `${source}:${id}`);
      const namespace = source.toLowerCase().replace(/[^a-z0-9]/g, "");

      const canonical = PERSON_ID_NAMESPACES[namespace];
      if (canonical) keys.add(`${canonical}:${canonical === "ocd-person" ? id.replace(/^ocd-person\//, "") : id}`);
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
