import { createHash } from "node:crypto";
import type { Provenance } from "../sources/types.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { officeIdentity } from "./office-identity.ts";
import { sameNativePerson } from "./people-identity.ts";
import { portraitBindingMatches } from "../photos/binding.ts";
import type { Officeholder, OfficeholderSet, PersonFieldDisagreement } from "./types.ts";

const normalized = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const office = (value: string) => officeIdentity(value) ?? normalized(value);
const personOffice = (person:Officeholder) => person.level === "STATE" && ["upper","lower"].includes(person.chamber ?? "")
  ? person.chamber === "upper" ? "state_senator" : "state_lower_house" : office(person.officeTitle);
const present = (value: unknown) => value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
const sourceFor = (person: Officeholder, field: string): Provenance => person.fieldSources?.[field] ?? person.provenance;
const ownPage = (person: Officeholder, source: Provenance) => Boolean(source.sourceUrl && (source.kind === "OFFICIAL" || isOfficialSource(source.sourceUrl)) &&
  [person.websiteUrl, ...(person.profileUrls ?? [])].includes(source.sourceUrl));
function prefers(right: Officeholder, left: Officeholder, field: string): boolean {
  const r = sourceFor(right, field), l = sourceFor(left, field);
  const rank = (person: Officeholder, source: Provenance) => ownPage(person, source) ? 2 : source.kind === "OFFICIAL" || source.sourceUrl && isOfficialSource(source.sourceUrl) ? 1 : 0;
  return rank(right, r) > rank(left, l) || rank(right, r) === rank(left, l) && r.collectedAt >= l.collectedAt;
}
function sameOfficeAndState(left: Officeholder, right: Officeholder): boolean {
  return Boolean(left.state && right.state && normalized(left.state) === normalized(right.state) && left.level === right.level &&
    personOffice(left) === personOffice(right) && normalized(left.name) === normalized(right.name));
}
/** Shared identifiers first; a unique full name, office and state is the second binding. */
export function mergePeopleSets(sets: readonly OfficeholderSet[]): OfficeholderSet | null {
  if (!sets.length) return null;
  const people: Officeholder[] = [], aliases = new Map<string, string>();
  const fallbackKey = (person:Officeholder) => `${person.state?.toUpperCase()}|${person.level}|${personOffice(person)}|${normalized(person.name)}`;
  const ambiguousNames = new Set<string>();
  for (const set of sets) {
    const identities = new Map<string,Set<string>>();
    for (const person of set.officeholders) {const key=fallbackKey(person), ids=identities.get(key) ?? new Set<string>();ids.add(person.personId ?? person.id);identities.set(key,ids);}
    for (const [key,ids] of identities) if (ids.size>1) ambiguousNames.add(key);
  }
  const disagreements = new Map<string, PersonFieldDisagreement>();
  for (const set of sets) for (const disagreement of set.disagreements ?? []) disagreements.set(disagreement.key, disagreement);
  const fields = ["name", "officeTitle", "level", "state", "chamber", "termStart", "termEnd", "birthDate", "partyLabel", "websiteUrl", "contactFormUrl", "phone", "email", "campaignUrl", "selectionMethod", "selectionMethodSourceUrl", "portraitCandidate", "photo"] as const;
  const merge = (left: Officeholder, right: Officeholder): Officeholder => {
    const personId = left.personId ?? left.id;
    const keys = new Set([...Object.keys(left.nativeIds ?? {}), ...Object.keys(right.nativeIds ?? {})]);
    const nativeIds = Object.fromEntries([...keys].map(key => [key, [...new Set([...(left.nativeIds?.[key] ?? []), ...(right.nativeIds?.[key] ?? [])])]]));
    nativeIds.reader = [...new Set([...(nativeIds.reader ?? []), left.id, personId, right.id, right.personId ?? right.id])];
    const merged: Officeholder = {...left, personId, nativeIds, fieldSources: {...left.fieldSources}};
    for (const field of fields) {
      const a = left[field], b = right[field];
      if (!present(b)) continue;
      if (field === "selectionMethod" && b === "UNKNOWN") continue;
      // A portrait verified for another canonical alias must be re-bound before serving.
      if (field === "photo" && !portraitBindingMatches(personId, right.photo ?? {url: ""})) continue;
      const rightWins = !present(a) || prefers(right, left, field);
      if (rightWins) Object.assign(merged, {[field]: b, fieldSources: {...merged.fieldSources, [field]: sourceFor(right, field)}});
      else merged.fieldSources = {...merged.fieldSources, [field]: sourceFor(left, field)};
      const equivalent = field === "officeTitle" ? personOffice(left) === personOffice(right) : field === "name" ? normalized(String(a)) === normalized(String(b))
        : field === "phone" ? String(a).replace(/\D/g,"").replace(/^1(?=\d{10}$)/,"") === String(b).replace(/\D/g,"").replace(/^1(?=\d{10}$)/,"") : canonicalCivicDataJson(a) === canonicalCivicDataJson(b);
      if (present(a) && !equivalent && !["photo", "portraitCandidate", "selectionMethodSourceUrl"].includes(field) &&
        sourceFor(left, field).sourceUrl !== sourceFor(right, field).sourceUrl) {
        const selected = rightWins ? {value: b, source: sourceFor(right, field)} : {value: a, source: sourceFor(left, field)};
        const alternative = rightWins ? {value: a, source: sourceFor(left, field)} : {value: b, source: sourceFor(right, field)};
        const digest = createHash("sha256").update(canonicalCivicDataJson([personId, field,
          [selected,alternative].map(row=>({value:row.value,sourceUrl:row.source.sourceUrl})).sort((a,b)=>canonicalCivicDataJson(a).localeCompare(canonicalCivicDataJson(b)))])).digest("hex").slice(0,20);
        const key = `${personId}:${field}:${digest}`;
        disagreements.set(key, {key, personId, state: merged.state ?? "", field, selected, alternative, owner: "BL-01", status: "OPEN"});
      }
    }
    merged.profileUrls = [...new Set([...(left.profileUrls ?? []), ...(right.profileUrls ?? []), left.websiteUrl, right.websiteUrl].filter((url): url is string => Boolean(url)))];
    merged.offices = [...new Map([...(left.offices ?? []), ...(right.offices ?? [])].map(row => [canonicalCivicDataJson(row), row])).values()];
    const memberships = new Map<string, NonNullable<Officeholder["memberships"]>[number]>();
    for (const row of [...(left.memberships ?? []), ...(right.memberships ?? [])]) {
      const held = memberships.get(row.id);
      const next = {...held, ...Object.fromEntries(Object.entries(row).filter(([,value])=>value !== undefined && value !== null && value !== "")), personId} as typeof row;
      memberships.set(row.id,{...next,...(row.selectionMethod === "UNKNOWN" && held?.selectionMethod && held.selectionMethod !== "UNKNOWN"
        ? {selectionMethod:held.selectionMethod,selectionMethodSourceUrl:held.selectionMethodSourceUrl} : {})});
    }
    merged.memberships = [...memberships.values()];
    merged.fecCandidateIds = [...new Set([...(left.fecCandidateIds ?? []), ...(right.fecCandidateIds ?? [])])];
    merged.social = right.social ?? left.social;
    if (prefers(right, left, "name")) merged.provenance = right.provenance;
    return merged;
  };
  for (const set of sets) for (const incoming of set.officeholders) {
    const matches = people.flatMap((held, index) => sameNativePerson(held, incoming) ? [index] : []);
    if (!matches.length && !ambiguousNames.has(fallbackKey(incoming))) {
      const byName = people.flatMap((held, index) => sameOfficeAndState(held, incoming) ? [index] : []);
      if (byName.length === 1) matches.push(byName[0]);
    }
    if (!matches.length) {people.push({...incoming, fieldSources: {...Object.fromEntries(fields.filter(field=>present(incoming[field])).map(field=>[field, sourceFor(incoming,field)])), ...incoming.fieldSources}}); continue;}
    const first = matches[0];
    let merged = merge(people[first], incoming);
    aliases.set(incoming.id, merged.id);
    // An ID-bearing bridge can connect previously separate source records.
    for (const index of matches.slice(1).sort((a,b)=>b-a)) {aliases.set(people[index].id, merged.id); merged = merge(merged, people[index]); people.splice(index,1);}
    people[first] = merged;
  }
  const canonical = (id: string): string => {const seen = new Set<string>(); while (aliases.has(id) && !seen.has(id)) {seen.add(id); id = aliases.get(id)!;} return id;};
  const divisions = sets.flatMap(set=>set.divisions).map(row=>({...row,officeholderId:canonical(row.officeholderId)}));
  const unmatched = sets.flatMap(set=>set.unmatched).map(row=>({...row,officeholderId:canonical(row.officeholderId)}));
  return JSON.parse(JSON.stringify({scope: sets[0].scope, generatedAt: sets.map(set=>set.generatedAt).sort().at(-1)!,
    currentMembershipComplete: sets.every(set=>set.currentMembershipComplete === true), officeholders: people,
    divisions: [...new Map(divisions.map(row=>[`${row.officeholderId}|${row.ocdId}|${row.bodyId}|${row.membershipId ?? ""}`,row])).values()],
    unmatched: [...new Map(unmatched.map(row=>[`${row.officeholderId}|${row.reason}`,row])).values()],
    endedMemberships: [...new Map(sets.flatMap(set=>set.endedMemberships ?? []).map(row=>[row.id,row])).values()],
    disagreements: [...disagreements.values()].map(row=>({...row,personId:canonical(row.personId)}))}));
}
