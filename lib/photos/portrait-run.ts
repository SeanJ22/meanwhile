/** A state's portrait work starts from its people without a portrait readers are shown, read only from rosters that changed
 * and for people whose retry is due. Whether a roster changed is decided from its version row, never by reading it. */
import { ROUTINE_SOURCE_CONTRACTS } from "../civic-data/contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../civic-data/manual-contracts.ts";
import { PEOPLE_SOURCE_IDS, peopleSourceRecordClass, peopleSourceScope } from "../officials/people-sources.ts";
import { peopleJurisdiction } from "../civic-data/people-source-read.ts";
import { stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { readStateRegistryRuntimeProjection } from "../civic-data/read-model.ts";
import { PORTRAIT_SCHEDULE_CODE, type PortraitStamp, type RoutineDataStore } from "../civic-data/store.ts";
import type { SlimRoster } from "../civic-data/portrait-rosters.ts";
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
import { latestPortraitAttempts, portraitAttemptDueAt, portraitDueAt, PORTRAIT_DUE_WINDOW_MS, type PortraitAttempt } from "./portrait-work.ts";

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
  /** Each roster's version the list was read at, by projection key; the next list reads only rosters at another version. */
  readonly read: Readonly<Record<string, string>>;
  /** The promoted rosters the list was read from, each carrying only the rows read: the record's derived inputs and where a person's saved pages are found. */
  readonly rosters: readonly SlimRoster[];
  /** When the earliest person left unread falls due: someone whose last attempt rests and whose rosters did not change. */
  readonly restingDueAt: number | null;
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
export function portraitNextDueAt(people: readonly Officeholder[], members: readonly Officeholder[], facts: readonly PortraitAttempt[], now: string, workRemains: boolean,
  restingDueAt: number | null = null): string | null {
  if (workRemains) return now;
  const state = latestPortraitAttempts(facts, "STATE_PORTRAIT_"), congress = latestPortraitAttempts(facts, "CONGRESS_PORTRAIT_");
  const due = [...people.map(person => portraitDueAt(person, state.get(person.personId ?? person.id), verified)),
    ...members.map(person => portraitDueAt(person, congress.get(person.personId ?? person.id), verified)), restingDueAt ?? Number.POSITIVE_INFINITY].filter(Number.isFinite);
  return due.length ? new Date(Math.max(Date.parse(now), Math.min(...due))).toISOString() : null;
}

/** The people a state's portraits are owed for: everyone its rosters name, merged as readers see them, without a shown portrait.
 * Only rosters at another version than the last list read are read whole, and of them only people without a shown portrait;
 * from the others, only the people whose retry is due. A continuation, or a record without a list, reads every roster. */
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
  const schedule = attempts.find(fact => fact.code === PORTRAIT_SCHEDULE_CODE)?.record as { read?: Record<string, string> } | undefined;
  const continuing = attempts.some(fact => fact.code.endsWith("_WORK_REMAINS"));
  const stateAttempts = latestPortraitAttempts(attempts, "STATE_PORTRAIT_"), congressAttempts = latestPortraitAttempts(attempts, "CONGRESS_PORTRAIT_");
  const dueBy = Date.parse(now) + PORTRAIT_DUE_WINDOW_MS;
  let place: FederalDirectoryReadModel | null = null, placeInput: DerivedInputRef | null = null;
  const directory = national ? null : await readStateFederalDirectory(state, { store, now });
  const local: Officeholder[] = [];
  let registry: string | null = null;
  if (!national) {
    const binding = await readStateRegistryRuntimeProjection(state, { store, now });
    if (binding.kind === "PROMOTED" || binding.kind === "BOOTSTRAP") {
      registry = stateRegistryRuntimeScope(state);
      const bodies = query ? await query("SELECT id FROM entity WHERE kind='body' AND state=$1", [state.toUpperCase()]) : [];
      const rosters = [...binding.value.bodyRosters, ...query ? (await readFactRosters(query, [...new Set([...binding.value.registry.bodies.map(body => body.id), ...bodies.map(body => String(body.id))])])).rosters : []];
      for (const roster of rosters) for (const member of roster.members) local.push({ id: member.id, personId: member.personId ?? member.id,
        nativeIds: member.nativeIds, name: member.name, officeTitle: member.officeTitle, level: "LOCAL", state: state.toUpperCase(),
        termStart: member.termStart ?? "", termEnd: member.termEnd ?? "", birthDate: null, partyLabel: member.partyLabel ?? null,
        websiteUrl: member.websiteUrl, profileUrls: [...new Set([member.websiteUrl, roster.sourceUrl].filter((url): url is string => Boolean(url)))],
        contactFormUrl: null, phone: member.phone, email: member.email, campaignUrl: null, photo: null, social: {},
        provenance: { sourceUrl: roster.sourceUrl, sourceOrg: roster.sourceOrg, collectedAt: roster.collectedAt, verifiedAt: null } });
    }
  }
  const held = await store.readPortraitRosters({ rosters: ordered, portrait: { recordClass: "STATE_LEGISLATOR", scope: portraitScope },
    read: continuing ? null : schedule?.read ?? null,
    due: [...stateAttempts].filter(([, fact]) => portraitAttemptDueAt(fact) <= dueBy).map(([personId]) => personId),
    // Local officials and members of Congress are read elsewhere; the record says which of them have a portrait readers are shown.
    subjects: [...new Set([...local, ...directory?.kind === "PROMOTED" ? directory.value.roster.officeholders : []].map(person => person.personId ?? person.id))] });
  const slim = new Map(held.rosters.map(row => [row.scope, row]));
  const portraits = held.portrait;
  const sets = ordered.flatMap(row => slim.get(row.scope)?.roster ?? []);
  // New Hampshire's official roster is held in its own shape; it is read whole, as readers read it.
  if (target && jurisdiction === "US-NH") {
    const nh = await readOfficialStateLegislatorsProjection(target.jurisdiction, { store, now });
    if (nh.kind === "PROMOTED" || nh.kind === "BOOTSTRAP") sets.splice(slim.has(ordered[0]!.scope) ? 1 : 0, 0, nh.value.roster);
  }
  const merged = mergePeopleSets([...sets, ...!national && portraits ? [portraits] : []]);
  const combined = mergePeopleSets([...merged ? [merged] : [], { scope: state, generatedAt: now, officeholders: local, divisions: [], unmatched: [] }]);
  const people = (combined?.officeholders ?? []).map(person => ({ ...person }));
  // A portrait the record holds is the one readers see for that person.
  if (portraits) {
    const photos = new Map(portraits.officeholders.filter(person => person.photo).map(person => [person.personId ?? person.id, person.photo]));
    for (const person of people) person.photo = person.photo ?? photos.get(person.personId ?? person.id) ?? null;
  }
  if (directory?.kind === "PROMOTED") {
    place = { ...directory.value, roster: portraits ? withFederalPortraits(directory.value.roster, portraits) : directory.value.roster };
    placeInput = promotedInputRef("FEDERAL_DIRECTORY", directory.projection.scope, directory.projection.versionId, directory.projection.payload, directory.projection.promotedAt);
  }
  const members = place?.roster.officeholders ?? [];
  // A local official or member whose portrait the record holds and the database confirms is shown is never read again.
  const shown = new Set(held.shown);
  const unverifiedPeople = people.filter(person => !verified(person) && !shown.has(person.personId ?? person.id)),
    unverifiedMembers = members.filter(person => !verified(person) && !shown.has(person.personId ?? person.id));
  // People left unread wait for their last attempt to fall due. Their rosters did not change, so that is still when they are next owed.
  const listed = new Set(people.map(person => person.personId ?? person.id));
  const resting = held.complete ? [] : [...stateAttempts].filter(([personId]) => !listed.has(personId))
    .map(([, fact]) => portraitAttemptDueAt(fact)).filter(due => due > dueBy);
  return { state, stamp, read: held.versions, rosters: held.rosters, restingDueAt: resting.length ? Math.min(...resting) : null, place, placeInput, registry,
    unverified: { people: unverifiedPeople, members: unverifiedMembers },
    due: { people: unverifiedPeople.filter(person => portraitDueAt(person, stateAttempts.get(person.personId ?? person.id), verified) <= dueBy),
      members: unverifiedMembers.filter(person => portraitDueAt(person, congressAttempts.get(person.personId ?? person.id), verified) <= dueBy) },
    everyone: [...people, ...members] };
}

/** Whether a state has portrait work: someone without a shown portrait falls due, or its rosters name someone new.
 * Only the record's schedule and each roster's digest are read to decide; no roster, record or attempt list is. */
export async function portraitRunNeeded(store: RoutineDataStore, state: string, now: string, query: Query | null): Promise<{ needed: boolean; reason: string }> {
  const last = await store.readPortraitRunState(peopleSourceScope(peopleJurisdiction(state), "people-portraits"));
  if (!last) return { needed: true, reason: "No portrait record is held for this state yet." };
  if (last.nextDueAt && Date.parse(last.nextDueAt) <= Date.parse(now)) return { needed: true, reason: `A person without a portrait fell due at ${last.nextDueAt}.` };
  if (!last.seen) return { needed: true, reason: "The portrait record names no list it was built from; the state runs once to record one." };
  const waiting = last.nextDueAt ? ` The next person without a portrait is due ${last.nextDueAt}.` : " Everyone listed has a portrait.";
  if (samePortraitStamp(await portraitStamp(store, state, query), last.seen)) return { needed: false, reason: `No roster changed since the last list.${waiting}` };
  return { needed: true, reason: "A roster names someone it did not name at the last list, or no longer names someone; only what changed is read." };
}
