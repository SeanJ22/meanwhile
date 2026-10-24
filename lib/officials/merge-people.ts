import { createHash } from "node:crypto";
import type { Provenance } from "../sources/types.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { officeIdentity } from "./office-identity.ts";
import { personIdentityKeys } from "./people-identity.ts";
import { portraitBindingMatches } from "../photos/binding.ts";
import { mergeExecutiveFacts } from "./national-executive.ts";
import type { Officeholder, OfficeholderSet, PersonFieldDisagreement } from "./types.ts";

const normalized = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const present = (value: unknown) => value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
const sourceFor = (person: Officeholder, field: string): Provenance => person.fieldSources?.[field] ?? person.provenance;
/** Shared identifiers first; a unique full name, office and state is the second binding. */
export function mergePeopleSets(sets: readonly OfficeholderSet[]): OfficeholderSet | null {
  if (!sets.length) return null;
  const people: Officeholder[] = [], aliases = new Map<string, string>();
  const offices = new Map<string, string>(), officialUrls = new Map<string, boolean>();
  const info = new WeakMap<Officeholder, { office: string; name: string; state: string; fallback: string; nameKey: string; keys: ReadonlySet<string>; ownUrls: Set<string> }>();
  const infoOf = (person: Officeholder) => {
    let held = info.get(person);
    if (!held) {
      let office = offices.get(person.officeTitle);
      if (office === undefined) { office = officeIdentity(person.officeTitle) ?? normalized(person.officeTitle); offices.set(person.officeTitle, office); }
      if (person.level === "STATE" && ["upper", "lower"].includes(person.chamber ?? "")) office = person.chamber === "upper" ? "state_senator" : "state_lower_house";
      const name = normalized(person.name), state = normalized(person.state ?? "");
      held = { office, name, state, fallback: `${person.state?.toUpperCase()}|${person.level}|${office}|${name}`,
        nameKey: `${state}|${person.level}|${office}|${name}`, keys: personIdentityKeys(person),
        ownUrls: new Set([person.websiteUrl, ...person.profileUrls ?? []].filter((url): url is string => Boolean(url))) };
      info.set(person, held);
    }
    return held;
  };
  const personOffice = (person: Officeholder) => infoOf(person).office;
  const fallbackKey = (person: Officeholder) => infoOf(person).fallback;
  const official = (url: string) => {
    let held = officialUrls.get(url);
    if (held === undefined) { held = isOfficialSource(url); officialUrls.set(url, held); }
    return held;
  };
  const prefers = (right: Officeholder, left: Officeholder, field: string) => {
    const r = sourceFor(right, field), l = sourceFor(left, field);
    const rank = (person: Officeholder, source: Provenance) => {
      const authoritative = source.kind === "OFFICIAL" || Boolean(source.sourceUrl && official(source.sourceUrl));
      return authoritative ? source.sourceUrl && infoOf(person).ownUrls.has(source.sourceUrl) ? 2 : 1 : 0;
    };
    const rightRank = rank(right, r), leftRank = rank(left, l);
    return rightRank > leftRank || rightRank === leftRank && r.collectedAt >= l.collectedAt;
  };
  const ambiguousNames = new Set<string>();
  for (const set of sets) {
    const identities = new Map<string,Set<string>>();
    for (const person of set.officeholders) {const key=fallbackKey(person), ids=identities.get(key) ?? new Set<string>();ids.add(person.personId ?? person.id);identities.set(key,ids);}
    for (const [key,ids] of identities) if (ids.size>1) ambiguousNames.add(key);
  }
  const byIdentity = new Map<string, Set<Officeholder>>(), byName = new Map<string, Set<Officeholder>>();
  const positions = new Map<Officeholder, number>();
  const register = (person: Officeholder, position: number) => {
    positions.set(person, position);
    for (const key of infoOf(person).keys) {
      const holders = byIdentity.get(key) ?? new Set<Officeholder>();
      holders.add(person); byIdentity.set(key, holders);
    }
    const key = infoOf(person).nameKey, names = byName.get(key) ?? new Set<Officeholder>();
    names.add(person); byName.set(key, names);
  };
  const unregister = (person: Officeholder) => {
    positions.delete(person);
    for (const key of infoOf(person).keys) {
      const holders = byIdentity.get(key);
      holders?.delete(person);
      if (holders?.size === 0) byIdentity.delete(key);
    }
    const key = infoOf(person).nameKey, names = byName.get(key);
    names?.delete(person);
    if (names?.size === 0) byName.delete(key);
  };
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
      const equivalent = field === "officeTitle" ? personOffice(left) === personOffice(right) : field === "name" ? infoOf(left).name === infoOf(right).name
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
    const offices = new Map<string, NonNullable<Officeholder["offices"]>[number]>();
    for (const row of [...(left.offices ?? []), ...(right.offices ?? [])]) {
      const { geocodedPoint, pointUnavailable, ...sourceOffice } = row;
      const key = canonicalCivicDataJson(sourceOffice), saved = geocodedPoint ?? offices.get(key)?.geocodedPoint;
      const missing = pointUnavailable ?? offices.get(key)?.pointUnavailable;
      offices.set(key, { ...sourceOffice, ...(saved ? { geocodedPoint: saved } : missing ? {pointUnavailable:missing} : {}) });
    }
    merged.offices = [...offices.values()];
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
    for (const [field, source] of Object.entries(right.fieldSources ?? {})) {
      if (!(fields as readonly string[]).includes(field) && (!merged.fieldSources?.[field] || source.collectedAt >= merged.fieldSources[field].collectedAt)) {
        merged.fieldSources = { ...merged.fieldSources, [field]: source };
      }
    }
    if (left.executive || right.executive) merged.executive = mergeExecutiveFacts(left.executive, right.executive);
    if (prefers(right, left, "name")) merged.provenance = right.provenance;
    return merged;
  };
  for (const set of sets) for (const incoming of set.officeholders) {
    const candidates = new Set<number>();
    for (const key of infoOf(incoming).keys) for (const holder of byIdentity.get(key) ?? []) {
      const position = positions.get(holder);
      if (position !== undefined) candidates.add(position);
    }
    const matches = [...candidates].sort((a, b) => a - b);
    if (!matches.length && !ambiguousNames.has(fallbackKey(incoming))) {
      const nameMatches = incoming.state ? [...byName.get(infoOf(incoming).nameKey) ?? []].flatMap(holder => {
        const position = positions.get(holder);
        return holder.state && position !== undefined ? [position] : [];
      }) : [];
      if (nameMatches.length === 1) matches.push(nameMatches[0]);
    }
    if (!matches.length) {
      const person = {...incoming, fieldSources: {...Object.fromEntries(fields.filter(field=>present(incoming[field])).map(field=>[field, sourceFor(incoming,field)])), ...incoming.fieldSources}};
      people.push(person); register(person, people.length - 1); continue;
    }
    const first = matches[0];
    unregister(people[first]);
    let merged = merge(people[first], incoming);
    aliases.set(incoming.id, merged.id);
    // An ID-bearing bridge can connect previously separate source records.
    for (const index of matches.slice(1).reverse()) {
      const prior = people[index];
      unregister(prior); aliases.set(prior.id, merged.id); merged = merge(merged, prior); people.splice(index, 1);
    }
    if (matches.length > 1) for (let index = first + 1; index < people.length; index++) positions.set(people[index], index);
    people[first] = merged;
    register(merged, first);
  }
  const canonical = (id: string): string => {const seen = new Set<string>(); while (aliases.has(id) && !seen.has(id)) {seen.add(id); id = aliases.get(id)!;} return id;};
  // A later read of the same page replaces its earlier statement about that seat.
  const vacancies = [...new Map(sets.flatMap(set=>set.vacancies ?? []).map(row=>[`${row.ocdId}|${row.sourceUrl}`,row])).values()];
  const keysById = new Map(people.map(person=>[person.id, personIdentityKeys(person)]));
  // The page that states a seat empty lists everyone still sitting in that division; any other holder there is stale.
  const stale = (link: OfficeholderSet["divisions"][number]) => vacancies.some(vacancy => vacancy.ocdId === link.ocdId && vacancy.heldBy !== undefined &&
    ![...keysById.get(canonical(link.officeholderId)) ?? []].some(key => vacancy.heldBy!.includes(key)));
  const divisions = sets.flatMap(set=>set.divisions).filter(row=>!stale(row)).map(row=>({...row,officeholderId:canonical(row.officeholderId)}));
  const unmatched = sets.flatMap(set=>set.unmatched).map(row=>({...row,officeholderId:canonical(row.officeholderId)}));
  return JSON.parse(JSON.stringify({scope: sets[0].scope, generatedAt: sets.map(set=>set.generatedAt).sort().at(-1)!,
    currentMembershipComplete: sets.every(set=>set.currentMembershipComplete === true), officeholders: people,
    divisions: [...new Map(divisions.map(row=>[`${row.officeholderId}|${row.ocdId}|${row.bodyId}|${row.membershipId ?? ""}`,row])).values()],
    unmatched: [...new Map(unmatched.map(row=>[`${row.officeholderId}|${row.reason}`,row])).values()],
    endedMemberships: [...new Map(sets.flatMap(set=>set.endedMemberships ?? []).map(row=>[row.id,row])).values()],
    disagreements: [...disagreements.values()].map(row=>({...row,personId:canonical(row.personId)})),
    ...(vacancies.length ? { vacancies } : {})}));
}
