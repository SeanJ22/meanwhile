import { createHash } from "node:crypto";
import { withoutInvalidStatewidePeople } from "./person-name.ts";
import type { Provenance } from "../sources/types.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { officeIdentity } from "./office-identity.ts";
import { nativePersonIdFromUrl, personIdentityKeys } from "./people-identity.ts";
import { portraitBindingMatches } from "../photos/binding.ts";
import { matchPerson, samePerson, type PersonEvidence } from "../identity/match-person.ts";
import { parsePersonName } from "../identity/name-parts.ts";
import { mergeExecutiveFacts } from "./national-executive.ts";
import { heldPersonSources } from "./held-sources.ts";
import type { Officeholder, OfficeholderSet, PersonFieldDisagreement, PersonIdentityQuestion } from "./types.ts";

const normalized = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const present = (value: unknown) => value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
const sourceFor = (person: Officeholder, field: string): Provenance => person.fieldSources?.[field] ?? person.provenance;
/** Records join on a shared identifier, or on a name in the same seat. A name that is not in a seat both records share is only a question for a detective. */
export function mergePeopleSets(input: readonly OfficeholderSet[]): OfficeholderSet | null {
  const sets = input.map(withoutInvalidStatewidePeople);
  if (!sets.length) return null;
  const people: Officeholder[] = [], aliases = new Map<string, string>();
  const originalSources = new WeakMap<Officeholder, readonly Officeholder[]>();
  // Which of the input sets each held person came from: one source never joins two of its own records on a name, because it already tells them apart.
  const origins = new WeakMap<Officeholder, ReadonlySet<number>>();
  // A reference profile can carry the current publisher ID before its stored native-ID list does.
  // Bind it only against the held official page, with the person's current seat corroborating it.
  const profileKeys = new WeakMap<Officeholder, Set<string>>();
  const personDivisions = new WeakMap<Officeholder, Set<string>>();
  const knownDistrictsAgree = (left:Officeholder,right:Officeholder) => {
    const districts = (person:Officeholder) => [...(personDivisions.get(person) ?? [])].filter(id=>/\/(?:sldu|sldl|cd|ward|council_district):/.test(id)).sort();
    const a=districts(left),b=districts(right);
    return !(a.length||b.length)||canonicalCivicDataJson(a)===canonicalCivicDataJson(b);
  };
  const officialProfiles = new Map<string, Officeholder[]>();
  for (const set of sets) for (const person of set.officeholders) {
    const current = person.memberships?.filter(row => row.current === true).flatMap(row => row.divisionId ? [row.divisionId] : []) ?? [];
    personDivisions.set(person, new Set(current.length ? current : set.divisions.filter(row => row.officeholderId === person.id).map(row => row.ocdId)));
    const binding = nativePersonIdFromUrl(person.provenance.sourceUrl ?? "");
    if (!binding || !personIdentityKeys(person).has(`${binding.source}:${binding.id}`)) continue;
    const key = `${binding.source}:${binding.id}`, held = officialProfiles.get(key) ?? [];
    held.push(person); officialProfiles.set(key, held);
  }
  // The seat is the person's districts, or all of their divisions when they have none, together with the office.
  const seatsOf = (person: Officeholder, office: string) => {
    const divisions = [...personDivisions.get(person) ?? []];
    const districts = divisions.filter(id => /\/(?:sldu|sldl|cd|ward|council_district):/.test(id));
    return (districts.length ? districts : divisions).map(id => `${id}|${person.level}|${office}`);
  };
  const profileEvidence = (person: Officeholder): PersonEvidence => ({ id: person.id, name: person.name, state: person.state,
    seats: seatsOf(person, officeIdentity(person.officeTitle) ?? normalized(person.officeTitle)) });
  const compatibleProfile = (source: Officeholder, target: Officeholder, namespace: string) => {
    if (!source.state || !target.state || source.state.toUpperCase() !== target.state.toUpperCase() || source.level !== target.level ||
      (source.chamber && target.chamber && source.chamber !== target.chamber) ||
      (officeIdentity(source.officeTitle) ?? normalized(source.officeTitle)) !== (officeIdentity(target.officeTitle) ?? normalized(target.officeTitle))) return false;
    if (!samePerson(profileEvidence(source), profileEvidence(target))) return false;
    if (!knownDistrictsAgree(source,target)) return false;
    if (source.birthDate && target.birthDate && source.birthDate !== target.birthDate) return false;
    for (const [key, ids] of Object.entries(source.nativeIds ?? {})) {
      const other = target.nativeIds?.[key];
      if (key !== "reader" && key !== namespace && ids.length && other?.length && !ids.some(id => other.includes(id))) return false;
    }
    return true;
  };
  for (const set of sets) for (const person of set.officeholders) {
    const bindings = new Map<string, Officeholder>();
    for (const url of [person.websiteUrl, ...person.profileUrls ?? []]) {
      const binding = url ? nativePersonIdFromUrl(url) : null;
      if (!binding) continue;
      const key = `${binding.source}:${binding.id}`;
      // A publisher's own current ID cannot be changed by a different profile link.
      if ([person.id, person.personId].some(id => id?.startsWith(`${binding.source}:`) && id !== key)) continue;
      const matches = (officialProfiles.get(key) ?? []).filter(target => {
        if (target === person || !compatibleProfile(person, target, binding.source)) return false;
        if (binding.source === "az-legislature") {
          const linkedTerm = new URL(url!).searchParams.get("legislature");
          const heldTerm = new URL(target.provenance.sourceUrl!).searchParams.get("legislature");
          if (linkedTerm && heldTerm && linkedTerm !== heldTerm) return false;
        }
        return true;
      });
      if (matches.length !== 1) continue;
      bindings.set(key, matches[0]);
    }
    if (new Set(bindings.values()).size === 1) profileKeys.set(person, new Set(bindings.keys()));
  }
  const offices = new Map<string, string>(), officialUrls = new Map<string, boolean>();
  const info = new WeakMap<Officeholder, { office: string; name: string; surname: string; nameKey: string; keys: ReadonlySet<string>; ownUrls: Set<string> }>();
  const infoOf = (person: Officeholder) => {
    let held = info.get(person);
    if (!held) {
      let office = offices.get(person.officeTitle);
      if (office === undefined) { office = officeIdentity(person.officeTitle) ?? normalized(person.officeTitle); offices.set(person.officeTitle, office); }
      if (person.level === "STATE" && ["upper", "lower"].includes(person.chamber ?? "")) office = person.chamber === "upper" ? "state_senator" : "state_lower_house";
      const name = normalized(person.name), state = normalized(person.state ?? "");
      held = { office, name, surname: parsePersonName(person.name).last,
        nameKey: `${state}|${person.level}|${office}|${name}`, keys: new Set([...personIdentityKeys(person), ...(profileKeys.get(person) ?? [])]),
        ownUrls: new Set([person.websiteUrl, ...person.profileUrls ?? []].filter((url): url is string => Boolean(url))) };
      info.set(person, held);
    }
    return held;
  };
  const personOffice = (person: Officeholder) => infoOf(person).office;
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
  // A name one source already gives to two different people never joins anyone on the name, even after an identifier joins those two.
  const sharedNames = new Set<string>();
  for (const set of sets) {
    const identities = new Map<string, Set<string>>();
    for (const person of set.officeholders) {
      const key = infoOf(person).nameKey, ids = identities.get(key) ?? new Set<string>();
      ids.add(person.personId ?? person.id); identities.set(key, ids);
    }
    for (const [key, ids] of identities) if (ids.size > 1) sharedNames.add(key);
  }
  const byIdentity = new Map<string, Set<Officeholder>>(), byName = new Map<string, Set<Officeholder>>(), bySeat = new Map<string, Set<Officeholder>>();
  const positions = new Map<Officeholder, number>();
  const register = (person: Officeholder, position: number) => {
    positions.set(person, position);
    for (const key of infoOf(person).keys) {
      const holders = byIdentity.get(key) ?? new Set<Officeholder>();
      holders.add(person); byIdentity.set(key, holders);
    }
    const key = infoOf(person).nameKey, names = byName.get(key) ?? new Set<Officeholder>();
    names.add(person); byName.set(key, names);
    for (const seat of seatsOf(person, infoOf(person).office)) {
      const holders = bySeat.get(seat) ?? new Set<Officeholder>();
      holders.add(person); bySeat.set(seat, holders);
    }
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
    for (const seat of seatsOf(person, infoOf(person).office)) {
      const holders = bySeat.get(seat);
      holders?.delete(person);
      if (holders?.size === 0) bySeat.delete(seat);
    }
  };
  const evidenceOf = (person: Officeholder): PersonEvidence => ({ id: person.id, name: person.name, state: person.state,
    keys: infoOf(person).keys, seats: seatsOf(person, infoOf(person).office), term: { start: person.termStart, end: person.termEnd } });
  // Two records the publishers' own identifiers already tell apart are never offered to the matcher on a name.
  const knownDifferent = (incoming: Officeholder, holder: Officeholder) => {
    const publisher = /^([a-z]{2}-(?:legislature|general-court)):/.exec(incoming.id)?.[1];
    return Boolean(publisher && holder.id.startsWith(`${publisher}:`) && holder.id !== incoming.id) ||
      Object.entries(incoming.nativeIds ?? {}).some(([key, ids]) => key !== "reader" && !/^[a-z]{2}-(?:legislature|general-court)$/.test(key) &&
        ids.length && holder.nativeIds?.[key]?.length && !ids.some(id => holder.nativeIds![key].includes(id)));
  };
  const questions = new Map<string, PersonIdentityQuestion>();
  for (const set of sets) for (const question of set.identityQuestions ?? []) questions.set(question.key, question);
  const disagreements = new Map<string, PersonFieldDisagreement>();
  for (const set of sets) for (const disagreement of set.disagreements ?? []) disagreements.set(disagreement.key, disagreement);
  const fields = ["name", "officeTitle", "level", "state", "chamber", "termStart", "termEnd", "birthDate", "partyLabel", "websiteUrl", "contactFormUrl", "phone", "email", "campaignUrl", "selectionMethod", "selectionMethodSourceUrl", "portraitCandidate", "photo"] as const;
  const merge = (left: Officeholder, right: Officeholder): Officeholder => {
    const personId = left.personId ?? left.id;
    const keys = new Set([...Object.keys(left.nativeIds ?? {}), ...Object.keys(right.nativeIds ?? {})]);
    const nativeIds = Object.fromEntries([...keys].map(key => [key, [...new Set([...(left.nativeIds?.[key] ?? []), ...(right.nativeIds?.[key] ?? [])])]]));
    nativeIds.reader = [...new Set([...(nativeIds.reader ?? []), left.id, personId, right.id, right.personId ?? right.id])];
    // Optional undefined fields disappear on publication; replay keys must use that same durable form.
    const sourceHolders = [...new Map([left,right].flatMap(person=>originalSources.get(person) ?? heldPersonSources(person))
      .map(person=>[canonicalCivicDataJson(JSON.parse(JSON.stringify(person))),person])).values()];
    const merged: Officeholder = {...left, personId, nativeIds, sourceHolders, fieldSources: {...left.fieldSources}};
    personDivisions.set(merged,new Set([...(personDivisions.get(left)??[]),...(personDivisions.get(right)??[])]));
    const mergedKeys = personIdentityKeys(merged);
    for (const field of fields) {
      const a = left[field]; let b = right[field];
      if (!present(b)) continue;
      if (field === "selectionMethod" && b === "UNKNOWN") continue;
      if (field === "photo") {
        const photo = right.photo, verifiedFor = photo?.verification?.personId;
        if (!photo || !verifiedFor || !personIdentityKeys(right).has(verifiedFor) || !mergedKeys.has(verifiedFor) || !portraitBindingMatches(verifiedFor, photo)) continue;
        // The merge already established this exact source alias as the same person; retain its image proof.
        const rebound = verifiedFor === personId ? photo : {...photo, verification: {...photo.verification!, personId}};
        b = portraitBindingMatches(personId, rebound) ? rebound : photo;
      }
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
  for (const [at, set] of sets.entries()) for (const incoming of set.officeholders) {
    const sharing = new Set<Officeholder>(), pool = new Set<Officeholder>();
    for (const key of infoOf(incoming).keys) for (const holder of byIdentity.get(key) ?? []) sharing.add(holder);
    for (const holder of sharing) pool.add(holder);
    // Holders that share no key are offered only when both records state a state and their known districts agree.
    if (incoming.state) for (const holder of [...seatsOf(incoming, infoOf(incoming).office).flatMap(seat => [...bySeat.get(seat) ?? []]), ...byName.get(infoOf(incoming).nameKey) ?? []])
      if (holder.state && infoOf(holder).surname === infoOf(incoming).surname && !origins.get(holder)?.has(at) && !knownDifferent(incoming, holder) && knownDistrictsAgree(incoming, holder)) pool.add(holder);
    const probe = evidenceOf(incoming);
    let found = matchPerson(probe, [...pool].filter(holder => positions.has(holder)).map(holder => ({ ...evidenceOf(holder), holder })));
    if (found.kind === "MATCH" && found.basis === "SEAT_AND_NAME" && sharedNames.has(infoOf(incoming).nameKey))
      found = { kind: "TIE", reason: "SEAT_AND_NAME_AMBIGUOUS", candidates: [found.candidate] };
    // Several records tied together by the incoming record's own identifiers are one person; any other tie, and a name alone, wait for a detective.
    const matches = (found.kind === "MATCH" ? [found.candidate.holder] : found.kind === "TIE" && found.reason === "KEYS_JOIN_CANDIDATES" ? found.candidates.map(row => row.holder) : [])
      .map(holder => positions.get(holder)!).sort((a, b) => a - b);
    if (found.kind === "NAME_ONLY" || found.kind === "TIE" && found.reason !== "KEYS_JOIN_CANDIDATES") {
      const personIds = [...new Set([incoming, ...found.candidates.map(row => row.holder)].map(person => person.personId ?? person.id))].sort();
      const key = `${found.kind}:${personIds.join("+")}`;
      questions.set(key, { key, state: incoming.state ?? "", personIds, reason: found.kind === "NAME_ONLY" ? "NAME_ONLY" : found.reason as PersonIdentityQuestion["reason"] });
    }
    if (!matches.length) {
      const person = {...incoming, fieldSources: {...Object.fromEntries(fields.filter(field=>present(incoming[field])).map(field=>[field, sourceFor(incoming,field)])), ...incoming.fieldSources}};
      originalSources.set(person,heldPersonSources(incoming));
      personDivisions.set(person,personDivisions.get(incoming)!);
      if (profileKeys.has(incoming)) profileKeys.set(person, profileKeys.get(incoming)!);
      origins.set(person, new Set([at]));
      people.push(person); register(person, people.length - 1); continue;
    }
    const first = matches[0];
    const joined = new Set([at, ...matches.flatMap(index => [...origins.get(people[index]) ?? []])]);
    unregister(people[first]);
    let merged = merge(people[first], incoming);
    aliases.set(incoming.id, merged.id);
    // An ID-bearing bridge can connect previously separate source records.
    for (const index of matches.slice(1).reverse()) {
      const prior = people[index];
      unregister(prior); aliases.set(prior.id, merged.id); merged = merge(merged, prior); people.splice(index, 1);
    }
    if (matches.length > 1) for (let index = first + 1; index < people.length; index++) positions.set(people[index], index);
    origins.set(merged, joined);
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
    ...(questions.size ? { identityQuestions: [...questions.values()].map(row => ({...row, personIds: [...new Set(row.personIds.map(canonical))]})) .filter(row => row.personIds.length > 1) } : {}),
    ...(vacancies.length ? { vacancies } : {})}));
}
