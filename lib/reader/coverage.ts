import type { ReaderStatePackage } from "./state.ts";
import { withReaderSelection } from "../db/reader-route.ts";
import { withReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { withRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { summarizeCoverage, type CoverageSummary } from "../registry/coverage.ts";
import { scopedHolders } from "../officials/scoped-holders.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import { indexByDivision } from "../officials/lookup.ts";
import { withStateRegistryFacts } from "../registry/state-composition.ts";
import { rosterGapForBody } from "../registry/body-rosters.ts";
import { earlierMembersOfBody, membersOfBody } from "../registry/body-membership.ts";
import { officePhoneForBody } from "../meetings/office-phone.ts";
import { stateOfficesForStates } from "../reference/state-offices.ts";
import type { BodyFacts } from "../facts/registry-overlay.ts";
import type { Body, Division } from "../registry/types.ts";
import type { Meeting } from "../sources/types.ts";
import type { BodyTerritory } from "../registry/body-territory.ts";
import { serverReaderValue } from "./memory.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { primeStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { withFederalDirectoryProjection } from "../officials/federal-directory-read-model.ts";
import { primeStateAuthorityProjection } from "../civic-data/state-reader.ts";

/** Place reads carry canonical local boards; the state still supplies its official people and portraits. */
export function withPlaceRegistry<T extends { readonly registry: RegistryRuntimeReadModel }>(state: T, place: RegistryRuntimeReadModel): T {
  return { ...state, registry: { ...state.registry, registry: place.registry,
    bodyRosters: place.bodyRosters, rosterReaderDispositions: place.rosterReaderDispositions } };
}

type CoverageState = Pick<ReaderStatePackage, "state" | "registry" | "version"> & Partial<Pick<ReaderStatePackage,
  "people" | "peopleRead" | "candidateProfilesRead" | "candidatePortraitsRead" | "ballotRead" | "legislativePeople" | "federal" | "federalRead" | "stateLegislatorAuthority">>;
type Officials = { photos: ReaderStatePackage["registry"]["officialPhotos"]; federal: CoverageState["federal"]; people: CoverageState["legislativePeople"]; version: string; officials: ReturnType<typeof indexByDivision> };
const heldOfficials = serverReaderValue("state-official-index", () => new WeakMap<object, Officials>());

/** The state and place responses use the same immutable people, even with different local facts. */
function stateOfficials(state: CoverageState): Officials {
  const people = state.legislativePeople ?? state.people;
  const photos = state.registry.officialPhotos;
  const key = people ?? state.federal ?? photos;
  const prior = heldOfficials.get(key);
  if (prior && prior.photos === photos && prior.federal === state.federal && prior.people === people && prior.version === state.version) return prior;
  const photoIndex = new Map(photos.photos.map(photo => [photo.officeholderId, photo.url]));
  const officials = indexByDivision([...(state.federal ? [state.federal.roster] : []), ...(people ? [people] : [])], photoIndex);
  const federalIds = new Map<string, Set<string>>();
  for (const person of state.federal?.roster.officeholders ?? []) for (const identity of personIdentityKeys(person)) {
    const ids = federalIds.get(identity) ?? new Set<string>();
    ids.add(person.id); federalIds.set(identity, ids);
  }
  for (const [id, holders] of officials) officials.set(id, scopedHolders([], holders).map(holder => {
    const ids = new Set([...personIdentityKeys(holder)].flatMap(identity => [...federalIds.get(identity) ?? []]));
    if (ids.size !== 1) return holder;
    const canonical = [...ids][0];
    if (holder.id === canonical) return holder;
    return { ...holder, id: canonical, nativeIds: { ...holder.nativeIds,
      reader: [...new Set([...(holder.nativeIds?.reader ?? []), holder.id, holder.personId ?? holder.id, canonical])],
    } };
  }));
  const held = { photos, federal: state.federal, people, version: state.version, officials };
  heldOfficials.set(key, held);
  return held;
}

/** Compose from one held state and the indexed place facts; there are no reads here. */
export function stateCoverage(
  state: CoverageState,
  divisionIds: readonly string[],
  lat: number,
  lng: number,
  meetings: readonly Meeting[] = [],
  bodyFacts: readonly BodyFacts[] = [],
  extraDivisions: readonly Division[] = [],
  territory: BodyTerritory | null = null,
  meetingCount: number = meetings.length,
): CoverageSummary {
  const known = new Set(state.registry.registry.bodies.map(body => body.id));
  const acquired = bodyFacts.flatMap((fact): Body[] => {
    const fields = fact.fields;
    // A board no source names yet (one made from its government's Census record) shows under its held name, sourced by that record.
    const name = fields.name ?? fact.name, provenance = fields.provenance ?? Object.values(fields.fieldSources ?? {})[0];
    if (known.has(fact.id) || !name || !provenance?.sourceUrl) return [];
    return [{ id: fact.id, ocdId: fact.division, bodyClass: fields.bodyClass ?? "body", bodyOrigin: "SOURCED",
      coverageStatus: "NOT_ATTEMPTED", agendaSourceType: "NONE", agendaSourceRef: null, meetingCadence: null,
      homepageUrl: null, demandCount: 0, sourceDataset: "GOV_DIRECTORY", ...fields, name, provenance,
      ...(fact.government ? { governmentName: fact.government } : {}) }];
  });
  const composed = withStateRegistryFacts({ ...state.registry, registry: { ...state.registry.registry,
    bodies: [...state.registry.registry.bodies, ...acquired] } }, bodyFacts);
  const runtime = composed;
  const divisions = new Map([...runtime.registry.divisions, ...extraDivisions].map(division => [division.ocdId, division]));
  const resolved = divisionIds.flatMap(id => divisions.get(id) ?? []);
  const bodies = runtime.registry.bodies;
  // Reading a roster member's portrait asks, for each person, for ballots and directories this answer does not hold; each ask throws and is caught.
  // Building those errors' stack traces was most of this function's time, and nothing here reads them.
  const stackLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  try {
  return withReaderSelection(undefined, () => withReaderAuthorityEdge({}, () => withRegistryRuntimeProjection(runtime, [state.state], () => withFederalDirectoryProjection(state.federalRead,[state.state],() => {
    // Carry the already loaded source identities into this composition context.
    // A cached state answer must not depend on another request's resident state.
    if(state.peopleRead?.kind === 'PROMOTED' || state.peopleRead?.kind === 'BOOTSTRAP')primeStatePeopleProjection(state.peopleRead.value);
    if(state.candidateProfilesRead)primeStateAuthorityProjection("candidate-profiles",state.state,state.candidateProfilesRead);
    if(state.candidatePortraitsRead)primeStateAuthorityProjection("candidate-campaign-sites-derived",state.state,state.candidatePortraitsRead);
    if(state.ballotRead)primeStateAuthorityProjection("ballot-contests",state.state,state.ballotRead);
    const { officials } = stateOfficials(state);
    const coverage = summarizeCoverage([lng, lat], [], divisions, bodies, meetingCount, officials, resolved, territory, state.stateLegislatorAuthority ? [state.stateLegislatorAuthority] : [], meetings,
      new Map(state.registry.bodyRosters.map(roster => [roster.bodyId,roster.bodyName])));
    const seats = coverage.seats.map(seat => {
      const vacancy = !seat.representatives.length && [...state.federal?.vacancies ?? [], ...(state.legislativePeople ?? state.people)?.vacancies ?? []]
        .find(row => row.ocdId === seat.ocdId);
      return vacancy ? { ...seat, vacancy } : seat;
    });
    return {
      ...coverage,
      seats,
      seatCounts: { total: seats.length, named: seats.filter(seat => seat.representatives.length > 0).length },
      governments: [],
      governmentInventoryStates: [state.state],
      governmentInventoryUnavailableStates: [],
      stateOffices: stateOfficesForStates([state.state]),
      ...(state.federal === undefined ? {} : { federalDirectoryUnavailable: state.federal === null }),
      bodies: coverage.bodies.map(body => {
        const gap = rosterGapForBody(body.bodyId);
        const earlierMembers = earlierMembersOfBody(body.bodyId);
        const fact = bodyFacts.find(fact => fact.id === body.bodyId);
        return { ...body, ...(fact?.recipientIds?.length ? { recipientIds: fact.recipientIds,
          recipientNames: fact.recipientNames, recipientState: fact.recipientState,
          ...(fact.moneyDivisionId ? { moneyDivisionId: fact.moneyDivisionId } : {}) } : {}),
          readerRoster: { members: membersOfBody(body.bodyId).members, ...(earlierMembers.length ? { earlierMembers } : {}),
            gaps: gap ? [gap] : [], officePhone: officePhoneForBody(body.bodyId) } };
      }),
    };
  }))));
  } finally { Error.stackTraceLimit = stackLimit; }
}
