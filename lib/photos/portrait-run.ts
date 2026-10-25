/** A state's portrait work starts from its people without a portrait readers are shown, read from slim rosters. */
import { ROUTINE_SOURCE_CONTRACTS } from "../civic-data/contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../civic-data/manual-contracts.ts";
import { PEOPLE_SOURCE_IDS, peopleSourceRecordClass, peopleSourceScope } from "../officials/people-sources.ts";
import { peopleJurisdiction } from "../civic-data/people-source-read.ts";
import { stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { readStateRegistryRuntimeProjection } from "../civic-data/read-model.ts";
import type { PortraitStamp, RoutineDataStore, SlimRoster } from "../civic-data/store.ts";
import type { RoutineRecordClass } from "../civic-data/types.ts";
import { promotedInputRef, type DerivedInputRef } from "../civic-data/derived-authority.ts";
import { mergePeopleSets } from "../officials/merge-people.ts";
import { officialStateLegislatorTargetByScope } from "../state-rollcalls/authority.ts";
import { readOfficialStateLegislatorsProjection } from "../state-rollcalls/legislators.ts";
import { readStateFederalDirectory, withFederalPortraits } from "../officials/federal-directory-read-model.ts";
import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { Officeholder } from "../officials/types.ts";
import { readFactRosters } from "../facts/roster-read.ts";
import type { Query } from "../facts/publish.ts";
import { portraitBindingMatches } from "./binding.ts";
import { latestPortraitAttempts, portraitDueAt, PORTRAIT_DUE_WINDOW_MS, type PortraitAttempt } from "./portrait-work.ts";

/** The promotions a state's portraits are built from: its people and federal directory records and, for a state, its local rosters. */
export function portraitInputScopes(state: string): readonly { readonly recordClass: RoutineRecordClass; readonly scope: string; readonly sourceId: string }[] {
  const jurisdiction = peopleJurisdiction(state);
  const sources = [...ROUTINE_SOURCE_CONTRACTS, ...MANUAL_PRODUCTION_SOURCE_CONTRACTS]
    .filter(row => row.sourceId !== "people-portraits" && ["STATE_LEGISLATOR", "FEDERAL_DIRECTORY"].includes(row.recordClass) &&
      (row.scope === jurisdiction || row.scope.startsWith(`${jurisdiction}:`)))
    .map(row => ({ recordClass: row.recordClass, scope: row.scope, sourceId: row.sourceId }));
  return state.toLowerCase() === "us" ? sources
    : [...sources, { recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: stateRegistryRuntimeScope(state), sourceId: "reader-registry-runtime" }];
}

/** A fingerprint of a state's local board members, which change in the fact store without a promotion. */
async function localRosterStamp(query: Query, state: string): Promise<string> {
  const [row] = await query(`SELECT count(*)::text || ':' || md5(coalesce(string_agg(f.entity_id || '|' || f.field, ',' ORDER BY f.entity_id, f.field), '')) AS stamp
    FROM fact f JOIN entity b ON b.id = f.entity_id
    WHERE f.status = 'live' AND f.field LIKE 'member:%' AND b.kind = 'body' AND b.state = $1`, [state.toUpperCase()]);
  return String(row?.stamp ?? "0:");
}

/** Who a state's rosters name, as digests of their people's ids and a fingerprint of its local board members.
 * A re-promotion naming the same people leaves it as it was. */
export async function portraitStamp(store: RoutineDataStore, state: string, query: Query | null): Promise<PortraitStamp> {
  const inputs = portraitInputScopes(state);
  const versions: Record<string, string> = {};
  for (const recordClass of new Set(inputs.map(row => row.recordClass))) {
    const scopes = inputs.filter(row => row.recordClass === recordClass).map(row => row.scope);
    const rows = recordClass === "REGISTRY_RUNTIME_BINDING"
      ? (await store.readPromotionIdentities(recordClass, scopes)).map(row => ({ scope: row.scope, digest: row.versionId }))
      : await store.readRosterIdDigests(recordClass, scopes);
    for (const row of rows) versions[`${recordClass}\t${row.scope}`] = row.digest;
  }
  return { versions, local: state.toLowerCase() === "us" || !query ? null : await localRosterStamp(query, state) };
}
const stampText = (stamp: PortraitStamp) => JSON.stringify([Object.entries(stamp.versions).sort(([a], [b]) => a.localeCompare(b)), stamp.local]);
export const samePortraitStamp = (left: PortraitStamp, right: PortraitStamp) => stampText(left) === stampText(right);

export interface PortraitList {
  readonly state: string;
  readonly stamp: PortraitStamp;
  /** The slim promoted rosters the list was read from: the record's derived inputs and where a person's saved pages are found. */
  readonly rosters: readonly SlimRoster[];
  /** State, statewide and local people without a shown portrait, and the place's members of Congress without one. */
  readonly unverified: { readonly people: readonly Officeholder[]; readonly members: readonly Officeholder[] };
  /** Those of them whose portrait work is due now. */
  readonly due: { readonly people: readonly Officeholder[]; readonly members: readonly Officeholder[] };
  /** Everyone the list names, for a state's first portrait record. */
  readonly everyone: readonly Officeholder[];
  readonly place: FederalDirectoryReadModel | null;
  /** The place's promoted directory, named as it was read, before its portraits are laid on. */
  readonly placeInput: DerivedInputRef | null;
  /** The local roster binding the list read, when there is one. */
  readonly registry: string | null;
}

const verified = (person: Officeholder) => portraitBindingMatches(person.personId ?? person.id, person.photo ?? { url: "" });

/** When the next person without a portrait falls due; null when everyone listed has one. */
export function portraitNextDueAt(people: readonly Officeholder[], members: readonly Officeholder[], facts: readonly PortraitAttempt[], now: string, workRemains: boolean): string | null {
  if (workRemains) return now;
  const state = latestPortraitAttempts(facts, "STATE_PORTRAIT_"), congress = latestPortraitAttempts(facts, "CONGRESS_PORTRAIT_");
  const due = [...people.map(person => portraitDueAt(person, state.get(person.personId ?? person.id), verified)),
    ...members.map(person => portraitDueAt(person, congress.get(person.personId ?? person.id), verified))].filter(Number.isFinite);
  return due.length ? new Date(Math.max(Date.parse(now), Math.min(...due))).toISOString() : null;
}

/** The people a state's portraits are owed for: everyone its rosters name, merged as readers see them, without a shown portrait. */
export async function portraitList(store: RoutineDataStore, state: string, now: string, attempts: readonly PortraitAttempt[], query: Query | null): Promise<PortraitList> {
  const national = state.toLowerCase() === "us";
  const jurisdiction = peopleJurisdiction(state);
  const stamp = await portraitStamp(store, state, query);
  const portraitScope = peopleSourceScope(jurisdiction, "people-portraits");
  // The order readers merge a state's people in: Open States first, then the official roster, then the people sources.
  const target = national ? undefined : officialStateLegislatorTargetByScope(jurisdiction as `US-${string}`);
  const ordered: { recordClass: RoutineRecordClass; scope: string }[] = national
    ? [{ recordClass: "STATE_LEGISLATOR", scope: peopleSourceScope("US", "statewide-executive-sources") }]
    : [{ recordClass: "STATE_LEGISLATOR", scope: `${jurisdiction}:openstates-people:v1` },
      ...target && jurisdiction !== "US-NH" ? [{ recordClass: "STATE_LEGISLATOR" as const, scope: target.jurisdiction }] : [],
      ...PEOPLE_SOURCE_IDS.filter(sourceId => sourceId !== "people-portraits")
        .map(sourceId => ({ recordClass: peopleSourceRecordClass(sourceId), scope: peopleSourceScope(jurisdiction, sourceId) }))];
  const wanted = [...ordered, { recordClass: "STATE_LEGISLATOR" as const, scope: portraitScope }];
  const slim = new Map<string, SlimRoster>();
  for (const recordClass of new Set(wanted.map(row => row.recordClass))) {
    for (const row of await store.readSlimRosters(recordClass, wanted.filter(item => item.recordClass === recordClass).map(item => item.scope))) slim.set(row.scope, row);
  }
  const portraits = slim.get(portraitScope)?.roster ?? null;
  const sets = ordered.flatMap(row => slim.get(row.scope)?.roster ?? []);
  // New Hampshire's official roster is held in its own shape; it is read whole, as readers read it.
  if (target && jurisdiction === "US-NH") {
    const nh = await readOfficialStateLegislatorsProjection(target.jurisdiction, { store, now, bypassCache: true });
    if (nh.kind === "PROMOTED" || nh.kind === "BOOTSTRAP") sets.splice(slim.has(ordered[0]!.scope) ? 1 : 0, 0, nh.value.roster);
  }
  const merged = mergePeopleSets([...sets, ...!national && portraits ? [portraits] : []]);
  const local: Officeholder[] = [];
  let registry: string | null = null;
  if (!national) {
    const held = await readStateRegistryRuntimeProjection(state, { store, now, bypassCache: true });
    if (held.kind === "PROMOTED" || held.kind === "BOOTSTRAP") {
      registry = stateRegistryRuntimeScope(state);
      const bodies = query ? await query("SELECT id FROM entity WHERE kind='body' AND state=$1", [state.toUpperCase()]) : [];
      const rosters = [...held.value.bodyRosters, ...query ? (await readFactRosters(query, [...new Set([...held.value.registry.bodies.map(body => body.id), ...bodies.map(body => String(body.id))])])).rosters : []];
      for (const roster of rosters) for (const member of roster.members) local.push({ id: member.id, personId: member.personId ?? member.id,
        nativeIds: member.nativeIds, name: member.name, officeTitle: member.officeTitle, level: "LOCAL", state: state.toUpperCase(),
        termStart: member.termStart ?? "", termEnd: member.termEnd ?? "", birthDate: null, partyLabel: member.partyLabel ?? null,
        websiteUrl: member.websiteUrl, profileUrls: [...new Set([member.websiteUrl, roster.sourceUrl].filter((url): url is string => Boolean(url)))],
        contactFormUrl: null, phone: member.phone, email: member.email, campaignUrl: null, photo: null, social: {},
        provenance: { sourceUrl: roster.sourceUrl, sourceOrg: roster.sourceOrg, collectedAt: roster.collectedAt, verifiedAt: null } });
    }
  }
  const combined = mergePeopleSets([...merged ? [merged] : [], { scope: state, generatedAt: now, officeholders: local, divisions: [], unmatched: [] }]);
  const people = (combined?.officeholders ?? []).map(person => ({ ...person }));
  // A portrait the record holds is the one readers see for that person.
  if (portraits) {
    const photos = new Map(portraits.officeholders.filter(person => person.photo).map(person => [person.personId ?? person.id, person.photo]));
    for (const person of people) person.photo = person.photo ?? photos.get(person.personId ?? person.id) ?? null;
  }
  let place: FederalDirectoryReadModel | null = null, placeInput: DerivedInputRef | null = null;
  if (!national) {
    const read = await readStateFederalDirectory(state, { store, now, bypassCache: true });
    if (read.kind === "PROMOTED") {
      place = { ...read.value, roster: portraits ? withFederalPortraits(read.value.roster, portraits) : read.value.roster };
      placeInput = promotedInputRef("FEDERAL_DIRECTORY", read.projection.scope, read.projection.versionId, read.projection.payload, read.projection.promotedAt);
    }
  }
  const members = place?.roster.officeholders ?? [];
  const stateAttempts = latestPortraitAttempts(attempts, "STATE_PORTRAIT_"), congressAttempts = latestPortraitAttempts(attempts, "CONGRESS_PORTRAIT_");
  const dueBy = Date.parse(now) + PORTRAIT_DUE_WINDOW_MS;
  const unverifiedPeople = people.filter(person => !verified(person)), unverifiedMembers = members.filter(person => !verified(person));
  return { state, stamp, rosters: [...slim.values()].filter(row => row.scope !== portraitScope), place, placeInput, registry,
    unverified: { people: unverifiedPeople, members: unverifiedMembers },
    due: { people: unverifiedPeople.filter(person => portraitDueAt(person, stateAttempts.get(person.personId ?? person.id), verified) <= dueBy),
      members: unverifiedMembers.filter(person => portraitDueAt(person, congressAttempts.get(person.personId ?? person.id), verified) <= dueBy) },
    everyone: [...people, ...members] };
}

/** Whether a state has portrait work: someone without a shown portrait is new or falls due. Nothing large is read to decide. */
export async function portraitRunNeeded(store: RoutineDataStore, state: string, now: string, query: Query | null): Promise<{ needed: boolean; reason: string }> {
  const last = await store.readPortraitRunState(peopleSourceScope(peopleJurisdiction(state), "people-portraits"));
  if (!last) return { needed: true, reason: "No portrait record is held for this state yet." };
  if (last.nextDueAt && Date.parse(last.nextDueAt) <= Date.parse(now)) return { needed: true, reason: `A person without a portrait fell due at ${last.nextDueAt}.` };
  const stamp = await portraitStamp(store, state, query);
  const waiting = last.nextDueAt ? ` The next person without a portrait is due ${last.nextDueAt}.` : " Everyone listed has a portrait.";
  if (last.seen && samePortraitStamp(stamp, last.seen)) return { needed: false, reason: `No roster changed since the last list.${waiting}` };
  const list = await portraitList(store, state, now, last.attempts, query);
  const owed = list.due.people.length + list.due.members.length;
  return owed ? { needed: true, reason: `${owed} people without a portrait are due.` }
    : { needed: false, reason: `A roster changed, but everyone it names has a portrait or waits for a retry.${waiting}` };
}
