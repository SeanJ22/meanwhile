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
import { membersOfBody } from "../registry/body-membership.ts";
import { officePhoneForBody } from "../meetings/office-phone.ts";
import { stateOfficesForStates } from "../reference/state-offices.ts";
import type { BodyFacts } from "../facts/registry-overlay.ts";
import type { Body, Division } from "../registry/types.ts";
import type { Meeting } from "../sources/types.ts";
import type { BodyTerritoryFile } from "../registry/body-territory.ts";
import { serverReaderValue } from "./memory.ts";

type Officials = { photos: ReaderStatePackage["registry"]["officialPhotos"]; federal: ReaderStatePackage["federal"]; people: ReaderStatePackage["legislativePeople"]; president: ReaderStatePackage["president"]; version: string; officials: ReturnType<typeof indexByDivision>; presidents: ReturnType<typeof indexByDivision> };
const heldOfficials = serverReaderValue("state-official-index", () => new WeakMap<object, Officials>());

/** The state and place responses use the same immutable people, even with different local facts. */
function stateOfficials(state: ReaderStatePackage): Officials {
  const people = state.legislativePeople ?? state.people;
  const photos = state.registry.officialPhotos;
  const key = people ?? state.federal ?? photos;
  const prior = heldOfficials.get(key);
  if (prior && prior.photos === photos && prior.federal === state.federal && prior.people === people && prior.president === state.president && prior.version === state.version) return prior;
  const photoIndex = new Map(photos.photos.map(photo => [photo.officeholderId, photo.url]));
  const presidents = indexByDivision(state.president ? [state.president] : [], photoIndex);
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
  const held = { photos, federal: state.federal, people, president: state.president, version: state.version, officials, presidents };
  heldOfficials.set(key, held);
  return held;
}

/** Compose from one held state and the indexed place facts; there are no reads here. */
export function stateCoverage(
  state: ReaderStatePackage,
  divisionIds: readonly string[],
  lat: number,
  lng: number,
  meetings: readonly Meeting[] = [],
  bodyFacts: readonly BodyFacts[] = [],
  extraDivisions: readonly Division[] = [],
  territory: BodyTerritoryFile | null = null,
  meetingCount: number = meetings.length,
): CoverageSummary {
  const known = new Set(state.registry.registry.bodies.map(body => body.id));
  const acquired = bodyFacts.flatMap((fact): Body[] => {
    const fields = fact.fields;
    if (known.has(fact.id) || !fields.name || !fields.provenance?.sourceUrl) return [];
    return [{ id: fact.id, ocdId: fact.division, name: fields.name, bodyClass: "UNCLASSIFIED", bodyOrigin: "SOURCED",
      coverageStatus: "NOT_ATTEMPTED", agendaSourceType: "NONE", agendaSourceRef: null, meetingCadence: null,
      homepageUrl: null, demandCount: 0, sourceDataset: "GOV_DIRECTORY", ...fields, provenance: fields.provenance }];
  });
  const runtime = withStateRegistryFacts({ ...state.registry, registry: { ...state.registry.registry,
    bodies: [...state.registry.registry.bodies, ...acquired] } }, bodyFacts);
  const divisions = new Map([...runtime.registry.divisions, ...extraDivisions].map(division => [division.ocdId, division]));
  const resolved = divisionIds.flatMap(id => divisions.get(id) ?? []);
  const bodies = runtime.registry.bodies;
  const { officials, presidents } = stateOfficials(state);
  const president = presidents.get("ocd-division/country:us") ?? [];
  return withReaderSelection(undefined, () => withReaderAuthorityEdge(null, () => withRegistryRuntimeProjection(runtime, [state.state], () => {
    const coverage = summarizeCoverage([lng, lat], [], divisions, bodies, meetingCount, officials, resolved, territory, [state.stateLegislatorAuthority], meetings);
    const seats = president.length ? [...coverage.seats, { ocdId: "ocd-division/country:us", label: "United States", divisionType: "country", tier: "national" as const, representatives: president }] : coverage.seats;
    return {
      ...coverage,
      seats,
      seatCounts: { total: seats.length, named: seats.filter(seat => seat.representatives.length > 0).length },
      governments: [],
      governmentInventoryStates: [state.state],
      governmentInventoryUnavailableStates: [],
      stateOffices: stateOfficesForStates([state.state]),
      federalDirectoryUnavailable: state.federal === null,
      bodies: coverage.bodies.map(body => {
        const gap = rosterGapForBody(body.bodyId);
        return { ...body, readerRoster: { members: membersOfBody(body.bodyId).members, gaps: gap ? [gap] : [], officePhone: officePhoneForBody(body.bodyId) } };
      }),
    };
  })));
}
