/** A state's portrait work starts from its people without a portrait readers are shown, read from slim rosters. */
import { ROUTINE_SOURCE_CONTRACTS } from "../civic-data/contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../civic-data/manual-contracts.ts";
import { PEOPLE_SOURCE_IDS, peopleSourceRecordClass, peopleSourceScope } from "../officials/people-sources.ts";
import { peopleJurisdiction } from "../civic-data/people-source-read.ts";
import { stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { readStateRegistryRuntimeProjection } from "../civic-data/read-model.ts";
import type { PortraitStamp, RoutineDataStore, SlimRoster, SourceHead } from "../civic-data/store.ts";
import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";
import { sourceAuthority } from "../civic-data/source-authority.ts";
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
import { latestPortraitAttempts, portraitDueAt, PORTRAIT_DUE_WINDOW_MS, PORTRAIT_RETRY_MS, type PortraitAttempt } from "./portrait-work.ts";

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
  const [row] = await query(`WITH members AS MATERIALIZED (
      SELECT f.entity_id AS body_id,substr(f.field,8) AS person_id,f.field,f.value,f.quote,f.provenance_kind,s.sha256,s.url
      FROM fact f JOIN entity b ON b.id=f.entity_id LEFT JOIN source_copy s ON s.id=f.source_copy_id
      WHERE f.status='live' AND f.field LIKE 'member:%' AND b.kind='body' AND b.state=$1
    ), content AS (
      SELECT jsonb_build_array('member',body_id,field,value,quote,provenance_kind,sha256,url)::text AS value FROM members
      UNION ALL SELECT jsonb_build_array('person',m.body_id,f.entity_id,f.field,f.value,f.quote,f.provenance_kind,s.sha256,s.url)::text
      FROM members m JOIN fact f ON f.entity_id=m.person_id LEFT JOIN source_copy s ON s.id=f.source_copy_id
      WHERE f.status='live' AND (f.field IN ('name','email','phone','website') OR f.field LIKE '%:'||m.body_id)
      UNION ALL SELECT jsonb_build_array('id',x.entity_id,x.value)::text FROM entity_external_id x
      WHERE x.scheme='roster-member' AND x.entity_id IN (SELECT person_id FROM members)
    ) SELECT count(*)::text||':'||md5(coalesce(string_agg(value,',' ORDER BY value),'')) AS stamp FROM content`, [state.toUpperCase()]);
  return String(row?.stamp ?? "0:");
}

/** Source content and versions, including changed profile links for people already listed. */
async function portraitSourceInputs(store: RoutineDataStore, state: string, query: Query | null) {
  const inputs = portraitInputScopes(state);
  const versions: Record<string, string> = {};
  const dependencies: Record<string, readonly [string,string|null,string|null,string] | null> = {};
  const sourceContentInputs: DerivedInputRef[] = [];
  const usable = (head: SourceHead) => head.candidateState === "PROMOTED" && head.acquisitionSucceeded && !head.imported && head.versionId === head.lastKnownGoodVersionId;
  for (const input of inputs) {
    const head = await store.readSourceHead(input.recordClass, input.scope), key = `${input.recordClass}\t${input.scope}`;
    const dependency = head ? [head.versionId,head.rawHash,head.normalizedHash,head.parserVersion] as const : null;
    dependencies[key] = dependency;
    versions[key] = canonicalCivicDataHash(dependency);
    if (head?.normalizedHash && usable(head)) sourceContentInputs.push({ kind: "PROMOTED_VERSION", recordClass: head.recordClass,
      scope: head.scope, versionId: head.versionId, readModelSha256: head.normalizedHash, promotedAt: head.promotedAt });
  }
  const stamp = { versions, local: state.toLowerCase() === "us" || !query ? null : await localRosterStamp(query, state) };
  return { stamp, dependencies, sourceContentInputs };
}
export async function portraitStamp(store: RoutineDataStore, state: string, query: Query | null): Promise<PortraitStamp> {
  return (await portraitSourceInputs(store, state, query)).stamp;
}

/** The portrait job's ordinary input plan and retry cursor; it holds no profile pages or person records. */
export interface PortraitSourceProbe {
  readonly formatVersion: 1;
  readonly sourceId: "people-portraits";
  readonly state: string;
  readonly complete: boolean;
  readonly normalizationInputHash: string;
  readonly dependencies: Readonly<Record<string, readonly [string,string|null,string|null,string] | null>>;
  readonly discovery: string;
  readonly nextTermAt: string | null;
  /** Exact raw digest of the validated sourceContentInputs, including immutable photo evidence. */
  readonly sourceContentHash: string;
  readonly retrievedAt: string;
}

export async function readPortraitSourceSnapshot(store: RoutineDataStore, state: string, query: Query | null) {
  const inputs = await portraitSourceInputs(store, state, query);
  const head = await store.readSourceHead("STATE_LEGISLATOR", peopleSourceScope(peopleJurisdiction(state), "people-portraits"));
  const raw = head ? await store.readCandidatePath<PortraitSourceProbe>(head.versionId, ["normalizedPayload", "sourceProbe"]) : null;
  const probe = raw?.formatVersion === 1 && raw.sourceId === "people-portraits" && raw.state === state.toUpperCase() ? raw : null;
  const discovery = canonicalCivicDataHash(["PORTRAIT_SOURCE_PLAN_V1", sourceAuthority("people-portraits")?.parserVersion,
    PORTRAIT_RETRY_MS, PORTRAIT_DUE_WINDOW_MS, portraitInputScopes(state)]);
  const normalizationInputHash = canonicalCivicDataHash([inputs.dependencies, inputs.stamp.local, discovery]);
  return { ...inputs, head, probe, discovery, normalizationInputHash };
}

export function portraitSnapshotSettled(snapshot: Awaited<ReturnType<typeof readPortraitSourceSnapshot>>, now: string): boolean {
  return snapshot.head?.candidateState === "PROMOTED" && snapshot.head.acquisitionSucceeded && !snapshot.head.imported &&
    snapshot.head.versionId === snapshot.head.lastKnownGoodVersionId && snapshot.head.rawHashBasis === "SOURCE_CONTENT_V1" &&
    snapshot.probe?.complete === true && snapshot.probe.normalizationInputHash === snapshot.normalizationInputHash &&
    snapshot.head.rawHash === snapshot.probe.sourceContentHash &&
    (!snapshot.probe.nextTermAt || Date.parse(snapshot.probe.nextTermAt) > Date.parse(now));
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
export async function portraitList(store: RoutineDataStore, state: string, now: string, attempts: readonly PortraitAttempt[], query: Query | null, sourceStamp?: PortraitStamp): Promise<PortraitList> {
  const national = state.toLowerCase() === "us";
  const jurisdiction = peopleJurisdiction(state);
  const stamp = sourceStamp ?? await portraitStamp(store, state, query);
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
    const nh = await readOfficialStateLegislatorsProjection(target.jurisdiction, { store, now });
    if (nh.kind === "PROMOTED" || nh.kind === "BOOTSTRAP") sets.splice(slim.has(ordered[0]!.scope) ? 1 : 0, 0, nh.value.roster);
  }
  const merged = mergePeopleSets([...sets, ...!national && portraits ? [portraits] : []]);
  const local: Officeholder[] = [];
  let registry: string | null = null;
  if (!national) {
    const held = await readStateRegistryRuntimeProjection(state, { store, now });
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
    const read = await readStateFederalDirectory(state, { store, now });
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
  const snapshot = await readPortraitSourceSnapshot(store, state, query);
  if (!snapshot.head) return { needed: true, reason: "No portrait record is held for this state yet." };
  const next = snapshot.probe?.nextTermAt;
  if (next && Date.parse(next) <= Date.parse(now)) return { needed: true, reason: `A person without a portrait fell due at ${next}.` };
  if (!portraitSnapshotSettled(snapshot, now)) return { needed: true, reason: "Portrait source content changed or unfinished work remains." };
  return { needed: false, reason: next ? `No portrait source changed. The next person without a portrait is due ${next}.` : "No portrait source changed. Everyone listed has a portrait." };
}
