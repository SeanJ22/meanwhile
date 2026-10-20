import { nearestZcta } from "../geo/zcta.ts";
import { stateForZip } from "../reader/national.ts";
import { readStatePackage } from "../reader/state.ts";
import { readPlacePackage } from "../reader/place.ts";
import { stateCoverage } from "../reader/coverage.ts";
import { readerLocation, readerTerritory, territoryBodies } from "../reader/location.ts";
import { sha256OfJson } from "../meetings/edge-artifacts.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { Meeting } from "../sources/types.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  indexByDivision,
  indexByOfficeholderId,
  seatHolderForMembership,
  type OfficeholderIndex,
  type PhotoIndex,
  type SeatHolder,
} from "../officials/lookup.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { BODY_TERRITORY_FILE, type BodyTerritoryFile } from "./body-territory.ts";
import { currentStatewideExecutives, statewideExecutivesFor } from "../officials/statewide-executives.ts";
import { currentBodyRosters, currentRosterMemberReaderDisposition, rosterHoldersForBody } from "./body-rosters.ts";
import { scopedHolders } from "../officials/scoped-holders.ts";
import { readDivisionRepresentatives } from "./representation-server.ts";
export { federalDirectoryAppliesToDivision } from "./representation-server.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { federalDirectoryReadState, getFederalOfficeholderSet } from "../officials/federal-directory-read-model.ts";
import { refreshFederalDirectoryFromPromoted, refreshRegistryRuntimeFromPromoted } from "../reader/authority-reads.ts";
import { personIdentityKeys, statePeopleScopeForDivision, statePeopleScopeForId, type StatePeopleJurisdiction } from "../officials/people-identity.ts";

import {
  stateLegislatorCoverageAuthority,
  type CoverageSummary,
  type StateLegislatorCoverageAuthority,
} from "./coverage.ts";
import { divisionIdsAt, divisionsAt as resolveDivisionsAt, type GeoFeature } from "./resolve.ts";
import type { Body, Division, Registry } from "./types.ts";
import { getRegistryRuntimeReadModel, registryRuntimeReadState, selectedRegistryStates } from "./runtime-read-model.ts";
import { currentReaderAuthorityEdge, currentCampaignSitesEdge, currentCommentAccessEdge, currentRegistrationsEdge, currentStateLegislatorsEdge, ReaderEdgeOnlyRefusal, refuseDatabaseInEdgeOnlyContext, settleEdgeFirst } from "./runtime-edge.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { stateRegistryRuntimeScope, statesForRegistryDivisions } from "../civic-data/state-scopes.ts";
import { curatedReaderReadState, primeCuratedReaderProjectionWithOwnerChoices, refreshCampaignSitesFromPromoted } from "../civic-data/curated-reader-read-model.ts";
import { primeCommentAccess, readCommentAccessFacts } from "./comment-access.ts";
import { CivicDataStoreUnavailableError } from "../civic-data/read-model.ts";
import { composeRegistration, type RegistrationLayer } from "../registration/compose.ts";
import { REGISTRATION_TARGETS } from "../registration/publication.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";
import { bindGovernmentBodies, governmentStateOf, type RegistrationGovernmentListing } from "../registration/listings.ts";
import { attachGovernmentDomains, readDotGovProjection } from "../civic-data/dotgov.ts";
import { readRegistrationProjection, readRegistrationDivision, type DivisionMetadata } from "../registration/reader.ts";
import jurisdictionLabels from "../../data/reference/us-jurisdiction-labels.json" with { type: "json" };
import { stateOcdIdFrom } from "../ocd/state-division.ts";
import { stateOf } from "./wording.ts";
import { publishedDivisionsForZip } from "../geo/zip-census-districts.ts";
import type { GeographySelection } from "../census-geography/selection.ts";
import { divisionsFromCensusGeographies, type CensusGeographies } from "../geo/census-geographies.ts";
import {
  heldOfficialStateLegislatorsFromRead,
  primeStatePeopleProjection,
  readStatePeopleProjection,
} from "../state-rollcalls/legislators.ts";

interface Loaded {
  features: GeoFeature[];
  /** Body territories for governments with no Census division. */
  territory: BodyTerritoryFile | null;
  divisionsById: Map<string, Division>;
  registry: Registry;
  officials: OfficeholderIndex;
  /** Every held person, including people whose divisions are not in our geometry. */
  officialsById: Map<string, SeatHolder>;
  federalAvailable: boolean;
}

interface RegistryLoaded {
  features: GeoFeature[];
  divisionsById: Map<string, Division>;
  registry: Registry;
}

export class RegistryHoldingReadError extends Error {
  readonly code = "REGISTRY_HOLDING_UNAVAILABLE";
  readonly holdingPath: string;
  constructor(holdingPath: string, cause: unknown) {
    super(`The required canonical registry holding could not be read: ${holdingPath}`, { cause });
    this.name = "RegistryHoldingReadError";
    this.holdingPath = holdingPath;
  }
}

const loadedCaches = new WeakMap<Registry, { authorityKey: string; value: Promise<Loaded> }>();
const registryCaches = new WeakMap<Registry, Promise<RegistryLoaded>>();
const geometryReads = new Map<string, Promise<GeoFeature[]>>();
let territoryRead: Promise<BodyTerritoryFile> | null = null;

function held<T>(current: Promise<T> | null, start: () => Promise<T>, keep: (value: Promise<T> | null) => void): Promise<T> {
  if (current) return current;
  const read = start();
  keep(read);
  read.catch(() => keep(null));
  return read;
}

function resolverGeometry(states: readonly string[] = selectedRegistryStates()): Promise<GeoFeature[]> {
  const key = [...states].sort().join("|");
  const held = geometryReads.get(key);
  if (held) return held;
  const read = readResolverGeometry(states).catch(error => { geometryReads.delete(key); throw error; });
  geometryReads.set(key, read);
  return read;
}

function bodyTerritories(): Promise<BodyTerritoryFile> {
  return held(territoryRead, readBodyTerritories, (read) => { territoryRead = read; });
}

export function prefetchReaderGeography(): void {
  if (registryRuntimeReadState().kind === "PROMOTED" || registryRuntimeReadState().kind === "BOOTSTRAP") void resolverGeometry().catch(() => undefined);
  if (selectedRegistryStates().includes("AZ")) void bodyTerritories().catch(() => undefined);
}

async function loadRegistry(): Promise<RegistryLoaded> {
  const runtimeRegistry = getRegistryRuntimeReadModel();
  const features = await resolverGeometry();
  const registry: Registry = runtimeRegistry.registry;

  return {
    features,
    divisionsById: new Map(registry.divisions.map((d) => [d.ocdId, d])),
    registry,
  };
}

async function readResolverGeometry(states: readonly string[]): Promise<GeoFeature[]> {
  const root = process.cwd();
  const stateCodes = new Set(Object.values(FIPS_TO_STATE).map(state => state.postal.toLowerCase()));

  // The manifest separates resolver geometry from downloads and superseded derivatives.
  const manifest = JSON.parse(
    await readFile(join(root, "data", "derived", "resolver-geometry.json"), "utf8"),
  ) as { files: string[] };
  const selected = new Set(states.map(state => state.toLowerCase()));
  const names = manifest.files.filter(name => !name.startsWith("data/states/") || selected.has(name.split("/")[2]));
  // Read every geometry file concurrently; feature order does not matter. Literal roots keep dynamic
  // reads bounded in the server deployment trace.
  const perFile = await Promise.all(
    names.map(async (name): Promise<GeoFeature[]> => {
      const stateFile = /^data\/states\/([a-z]{2})\/geo\/([a-z0-9][a-z0-9.-]*\.geojson)$/.exec(name);
      const nationalFile = /^public\/geo\/([a-z0-9][a-z0-9.-]*\.geojson)$/.exec(name);
      let raw: string;
      if (stateFile) {
        const [, state, file] = stateFile;
        if (!stateCodes.has(state)) throw new Error(`Unknown state in resolver manifest: ${name}`);
        const fips = /-(\d{2})\.geojson$/.exec(file)?.[1];
        if (fips && FIPS_TO_STATE[fips]?.postal.toLowerCase() !== state) {
          throw new Error(`State/FIPS mismatch in resolver manifest: ${name}`);
        }
        raw = await readFile(join(root, "data", "states", state, "geo", file), "utf8");
      } else if (nationalFile) {
        raw = await readFile(join(root, "public", "geo", nationalFile[1]), "utf8");
      } else {
        throw new Error(`Invalid canonical geometry path in resolver manifest: ${name}`);
      }
      return (JSON.parse(raw) as { features: GeoFeature[] }).features.filter(feature => {
        const state = /\/(?:state|territory|district):([a-z]{2})(?:\/|$)/.exec(feature.properties.ocdId)?.[1];
        return state === undefined || selected.has(state);
      });
    }),
  );
  return perFile.flat();
}

async function readBodyTerritories(): Promise<BodyTerritoryFile> {
  const root = process.cwd();
  // Literal path segments let Next include this file in the deployment trace.
  return JSON.parse(
    await readFile(join(root, "data", "states", "az", "geo", "body-territories.geojson"), "utf8"),
  ) as BodyTerritoryFile;
}

async function load(base: RegistryLoaded, federalAvailable: boolean): Promise<Loaded> {
  const runtimeRegistry = getRegistryRuntimeReadModel();
  const { features, divisionsById, registry } = base;

  // State legislators come from their official-publisher promotion; the federal directory is the one roster loaded here.
  const sets: OfficeholderSet[] = federalAvailable ? [getFederalOfficeholderSet()] : [];

  // The photo manifest: per-image source and license, images served from our origin. Missing or
  // unreadable degrades to initials everywhere.
  const photos: PhotoIndex = new Map();
  try {
    const manifest = runtimeRegistry.officialPhotos;
    for (const photo of manifest.photos) {
      photos.set(photo.officeholderId, photo.url);
    }
  } catch {
    // No manifest is a fine state: initials render instead.
  }

  // A required held relationship: a loading failure stays distinguishable from a body having no
  // territorial relationship.
  let territory: BodyTerritoryFile | null = null;
  try {
    // Read once per process (`bodyTerritories`), possibly already started by the route.
    territory = selectedRegistryStates().includes("AZ") ? await bodyTerritories() : null;
  } catch (error) {
    throw new RegistryHoldingReadError(BODY_TERRITORY_FILE, error);
  }

  const officialsById = indexByOfficeholderId(sets, photos);
  for (const holder of statewideExecutivesFor(currentStatewideExecutives().map((executive) => executive.stateOcdId))) {
    officialsById.set(holder.id, holder);
  }
  for (const roster of currentBodyRosters()) for (const holder of rosterHoldersForBody(roster.bodyId)) {
    if (!officialsById.has(holder.id)) officialsById.set(holder.id, holder);
  }
  return {
    features,
    territory,
    divisionsById,
    registry,
    officials: indexByDivision(sets, photos),
    officialsById,
    federalAvailable,
  };
}

export interface RegistryAuthorityReaders {
  readonly registry: () => Promise<void>;
  readonly federal: () => Promise<void>;
}


/** The named places' members of Congress, each place edge first. */
export const settleFederalDirectoryRead = async (states: readonly string[] = selectedRegistryStates()): Promise<void> => {
  if (!states.length) throw new Error("FEDERAL_DIRECTORY_PLACES_NOT_SELECTED");
  await refreshFederalDirectoryFromPromoted(states);
};

/** The registry runtime (divisions, bodies, rosters), edge first. */
const settleRegistryRuntimeRead = async (states: readonly string[] = selectedRegistryStates()): Promise<void> => {
  await refreshRegistryRuntimeFromPromoted(states);
};

/** Geometry/division reads never acquire the unrelated federal roster. */
export async function settleRegistryAuthorityReads(
  scope: "REGISTRY" | "OFFICIALS",
  readers: RegistryAuthorityReaders = {
    registry: settleRegistryRuntimeRead,
    federal: () => settleFederalDirectoryRead(),
  },
): Promise<void> {
  await readers.registry();
  if (scope === "OFFICIALS") await readers.federal();
}

/** The comment-access rules, edge first. */
export const settleCommentAccessRead = (): Promise<void> =>
  settleEdgeFirst(currentCommentAccessEdge, primeCommentAccess, () => readCommentAccessFacts(), "The comment-access rules");

/** The campaign-site URLs, edge first. */
const settleCampaignSitesRead = (): Promise<void> =>
  settleEdgeFirst(currentCampaignSitesEdge, (value, versionId) => primeCuratedReaderProjectionWithOwnerChoices("campaign-sites", value, versionId), refreshCampaignSitesFromPromoted, "The campaign-site URLs");

export function authorityVersionKey(state: { readonly kind: string; readonly metadata: { readonly versionId: string | null } }): string {
  const served = state.kind === "PROMOTED" || state.kind === "BOOTSTRAP";
  return `${served ? "SERVED" : state.kind}:${state.metadata.versionId ?? "none"}:${sha256OfJson({ keys: [...currentReaderSelection()?.keys ?? []].sort(), window: currentReaderSelection()?.governmentWindow })}`;
}


async function currentAuthorityKey(registryKey: string, states: readonly string[]): Promise<{ key: string; federalAvailable: boolean }> {
  let federalAvailable = false;
  try {
    await settleFederalDirectoryRead(states);
    getFederalOfficeholderSet();
    federalAvailable = true;
  } catch {
    // A failed federal authority cannot erase independently held state or local facts.
  }
  let campaign = "TEST_FIRST_SEED";
  if (process.env.NODE_ENV === "production") {
    try {
      await settleCampaignSitesRead();
      campaign = authorityVersionKey(curatedReaderReadState("campaign-sites"));
    } catch {
      // Campaign URLs are an optional, separately promoted projection. A store failure withholds them but
      // cannot make the registry, representation or roster authority unavailable.
      campaign = "UNAVAILABLE";
    }
  }
  return { federalAvailable, key: [
    `federal:${federalAvailable ? authorityVersionKey(federalDirectoryReadState()) : "UNAVAILABLE"}`,
    registryKey,
    `campaign:${campaign}`,
  ].join("|") };
}

async function registryLoaded(states: readonly string[] = selectedRegistryStates()): Promise<RegistryLoaded> {
  await settleRegistryRuntimeRead(states);
  const registry = getRegistryRuntimeReadModel().registry;
  let value = registryCaches.get(registry);
  if (!value) { value = loadRegistry(); registryCaches.set(registry, value); }
  return value;
}

const REGISTRATION_STATES = new Set(REGISTRATION_TARGETS.map((t) => t.state.toLowerCase()));
interface ComposedRegistration {
  readonly key: string;
  readonly layer: RegistrationLayer;
  readonly divisionsById: ReadonlyMap<string, Division>;
}
const registrationLayers = new WeakMap<Registry, Map<string, ComposedRegistration>>();

async function registrationFor(state: string): Promise<ComposedRegistration | null> {
  if (!REGISTRATION_STATES.has(state)) return null;
  const base = await registryLoaded(selectedRegistryStates().length ? selectedRegistryStates() : [state]);
  const served = await registrationModelFor(state);
  return served ? composed(state, base, served.value, served.versionId) : null;
}

/** A source listing does not depend on the unrelated registry or federal roster. */
async function registrationModelFor(state: string): Promise<{ value: RegistrationReadModel; versionId: string } | null> {
  if (!REGISTRATION_STATES.has(state)) return null;
  // The edge first: an ordinary visitor never wakes the database for registration. A state with no pointer yet,
  // or whose bytes could not be read, is read from the database on this request only.
  const served = await currentRegistrationsEdge()?.load(state).catch(() => null);
  if (served) return served.value === null ? null : { value: served.value, versionId: served.versionId };
  refuseDatabaseInEdgeOnlyContext(`The ${state} registration`);
  const read = await readRegistrationProjection(state);
  // No store at all (tests, the census gate, local work) has no registration to compose: registration has
  // no first seed. A configured store that did not answer is a failure.
  if (read.kind === "STORE_UNREACHABLE" && read.code === "STORE_NOT_CONFIGURED") return null;
  if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
  if (read.kind !== "PROMOTED" || read.metadata.versionId === null) return null;
  return { value: read.value, versionId: read.metadata.versionId };
}

/** Enrich the complete state inventory before narrowing, so duplicate identities remain ambiguous. */
async function governmentDomainsFor(listings: readonly RegistrationGovernmentListing[]): Promise<RegistrationGovernmentListing[]> {
  if (listings.length === 0) return [];
  // An unavailable registry must not hide the independently held Census listing.
  const read = await readDotGovProjection().catch(() => null);
  return read?.kind === "PROMOTED" ? attachGovernmentDomains(listings, read.value) : [...listings];
}

export interface GovernmentListingPage {
  readonly state: string;
  readonly status: "HELD" | "NOT_HELD";
  readonly versionId: string | null;
  readonly records: readonly RegistrationGovernmentListing[];
  readonly total: number;
  readonly nextOffset: number | null;
}

/** Bounded inventory includes unpaired schools and districts without implying residence. */
export async function governmentListingsForState(state: string, offset = 0, limit = 50): Promise<GovernmentListingPage> {
  const code = state.replace(/^US-/i, "").toLowerCase();
  if (!REGISTRATION_STATES.has(code)) throw new Error("A US state or territory is required");
  const held = await registrationModelFor(code);
  const records = await governmentDomainsFor(held?.value.governments ?? []);
  const start = Math.max(0, Math.floor(offset));
  const size = Math.min(100, Math.max(1, Math.floor(limit)));
  const window = currentReaderSelection()?.governmentWindow;
  const total = held?.value.governmentCount ?? records.length;
  return { state: code.toUpperCase(), status: held ? "HELD" : "NOT_HELD", versionId: held?.versionId ?? null,
    records: window ? records : records.slice(start, start + size), total,
    nextOffset: start + size < total ? start + size : null };
}

/** Native lookup is scoped before a state shard is opened. */
export async function governmentListingById(id: string): Promise<RegistrationGovernmentListing | null> {
  const state = governmentStateOf(id);
  if (!state) return null;
  const held = await registrationModelFor(state);
  const listings = await governmentDomainsFor(held?.value.governments ?? []);
  return listings.find(row => row.id === id || row.aliases.includes(id)) ?? null;
}

export async function governmentListingsForDivisions(divisionIds: readonly string[], scope: "AREA" | "STATE_INVENTORY" = "AREA"): Promise<{
  records: RegistrationGovernmentListing[]; states: string[]; unavailableStates: string[];
}> {
  const states = [...new Set(divisionIds.flatMap(id => statePeopleScopeForDivision(id)?.slice(3).toLowerCase() ?? []))];
  const divisions = new Set(divisionIds);
  const results = await Promise.allSettled(states.map(async state => {
    const held = await registrationModelFor(state);
    return held ? governmentDomainsFor(held.value.governments ?? []) : [];
  }));
  return {
    records: results.flatMap(result => result.status === "fulfilled"
      ? result.value.filter(row => scope === "STATE_INVENTORY" || row.associations.some(link => divisions.has(link.divisionId))) : []),
    states: states.map(state => state.toUpperCase()),
    unavailableStates: states.filter((_, index) => results[index].status === "rejected").map(state => state.toUpperCase()),
  };
}

/** One state's registration composed against the reviewed registry held now, cached by both versions. */
function composed(state: string, base: RegistryLoaded, model: RegistrationReadModel, versionId: string): ComposedRegistration {
  const key = versionId;
  const entries = registrationLayers.get(base.registry) ?? new Map<string, ComposedRegistration>();
  registrationLayers.set(base.registry, entries);
  const held = entries.get(state);
  if (held?.key === key) return held;
  const layer = composeRegistration(base.registry, model, versionId);
  const entry: ComposedRegistration = { key, layer, divisionsById: new Map(layer.divisions.map((d) => [d.ocdId, d])) };
  entries.set(state, entry);
  return entry;
}

/** The registered layers for the states these divisions name. */
async function registrationsFor(ocdIds: Iterable<string>): Promise<ComposedRegistration[]> {
  const states = new Set<string>();
  for (const id of ocdIds) {
    const state = stateOf(id) ?? governmentStateOf(id);
    if (state !== null) states.add(state);
  }
  const composed = await Promise.all([...states].map((state) => registrationFor(state)));
  return composed.filter((c): c is ComposedRegistration => c !== null);
}

async function loaded(states: readonly string[] = selectedRegistryStates()): Promise<Loaded> {
  const base = await registryLoaded(states);
  const registryKey = `registry:${authorityVersionKey(registryRuntimeReadState())}`;
  const { key: authorityKey, federalAvailable } = await currentAuthorityKey(registryKey, states);
  const cached = loadedCaches.get(base.registry);
  if (cached?.authorityKey === authorityKey) return cached.value;
  const value = load(base, federalAvailable);
  loadedCaches.set(base.registry, { authorityKey, value });
  return value;
}

function subjectRegistryStates(id: string): readonly string[] {
  const named = statesForRegistryDivisions([id]), government = governmentStateOf(id);
  return named.length ? named : government ? [government.toUpperCase()] : selectedRegistryStates();
}

export async function knownBodySubjectIds(forSubjectId?: string): Promise<Set<string>> {
  const { registry, divisionsById } = await registryLoaded(forSubjectId ? subjectRegistryStates(forSubjectId) : selectedRegistryStates());
  const out = new Set<string>(registry.bodies.map((b) => b.id));
  for (const ocdId of divisionsById.keys()) out.add(ocdId);
  // A registered body or division is known through its own state's registration.
  if (forSubjectId !== undefined && !out.has(forSubjectId)) {
    for (const r of await registrationsFor([forSubjectId])) {
      for (const body of r.layer.bodies) out.add(body.id);
      for (const ocdId of r.divisionsById.keys()) out.add(ocdId);
    }
  }
  return out;
}

/** One body by its id, from the reviewed registry or its state's registered governments; null when none is held. */
export async function bodyById(bodyId: string): Promise<Body | null> {
  const { registry } = await registryLoaded(subjectRegistryStates(bodyId));
  const found = registry.bodies.find((body) => body.id === bodyId);
  if (found) return found;
  for (const r of await registrationsFor([bodyId])) {
    const registered = r.layer.bodies.find((body) => body.id === bodyId);
    if (registered) return registered;
  }
  return null;
}

/** The divisions containing a point, from the committed geometry. */
export async function divisionsAt(lat: number, lng: number): Promise<Division[]> {
  const { features, divisionsById } = await registryLoaded();
  const selected = currentReaderSelection();
  if (selected?.point?.[0] === lng && selected.point[1] === lat && selected.divisions) {
    return selected.divisions.flatMap(id => divisionsById.has(id) ? [divisionsById.get(id)!] : []);
  }
  return resolveDivisionsAt([lng, lat], features, divisionsById);
}

export async function readerDivisionIdsAt(lat: number, lng: number): Promise<string[]> {
  const zip = nearestZcta(lat, lng)?.zip;
  const state = zip ? stateForZip(zip) : null;
  return divisionIdsAt([lng, lat], await resolverGeometry(state ? [state] : selectedRegistryStates()));
}

export async function divisionsForCensusGeographies(geographies: CensusGeographies, selection: GeographySelection, vintage: string,
  geographyVintages: Readonly<Record<string, string>>): Promise<Division[]> {
  const rows = divisionsFromCensusGeographies(geographies, selection,
    `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?benchmark=Public_AR_Current&vintage=${vintage}&layers=all&format=json`, new Date().toISOString(), geographyVintages);
  if (!rows.length) return [];
  const states = statesForRegistryDivisions(rows.map(row => row.ocdId));
  await settleRegistryRuntimeRead(states);
  const held = getRegistryRuntimeReadModel().registry.divisions;
  return rows.map(row => {
    const matches = held.filter(division => division.divisionType === row.divisionType && division.geoid === row.geoid);
    return matches.length === 1 ? { ...row, ocdId: matches[0].ocdId, canonicalOcdId: matches[0].canonicalOcdId,
      canonicalMatch: matches[0].canonicalMatch, canonicalGap: matches[0].canonicalGap } : row;
  });
}

export async function divisionsByOcdIds(ocdIds: readonly string[], context?: { zip: string; selection?: GeographySelection }): Promise<Division[]> {
  const { divisionsById } = await registryLoaded(statesForRegistryDivisions(ocdIds));
  // An id the reviewed registry does not hold may be one its state registered.
  const registered = await registrationsFor(ocdIds.filter((id) => !divisionsById.has(id)));
  const published = new Map((context ? await publishedDivisionsForZip(context.zip, context.selection) : []).map(row => [row.ocdId, row]));
  const out: Division[] = [];
  for (const id of ocdIds) {
    const division = published.get(id) ?? divisionsById.get(id) ?? registered.find((r) => r.divisionsById.has(id))?.divisionsById.get(id);
    if (division) out.push(division);
  }
  return out;
}

/** Representation needs identity metadata, not a composed registration or resolver geometry. */
export async function representationDivisionMetadata(ocdId: string): Promise<DivisionMetadata | undefined> {
  const root = stateOcdIdFrom(ocdId);
  const state = root?.split(":").at(-1);
  // State divisions are deliberately absent from the registration inventory: the state is its scope.
  if (root === ocdId) {
    const label = jurisdictionLabels.jurisdictions.find(row => row.postal.toLowerCase() === state)?.name;
    return label ? { ocdId, label, divisionType: root.split("/").at(-1)!.split(":")[0], tier: "state" } : undefined;
  }
  await settleRegistryRuntimeRead(statesForRegistryDivisions([ocdId]));
  const known = getRegistryRuntimeReadModel().registry.divisions.find(row => row.ocdId === ocdId);
  return known ?? (state ? readRegistrationDivision(state, ocdId) : undefined);
}

export async function seatHolderById(id: string, stateHint?: string): Promise<SeatHolder | null> {
  // The publisher namespace establishes the one permitted state authority before any store is opened. A
  // state identity never causes a federal/registry read or a name join.
  const officialStateScope = statePeopleScopeForId(id,stateHint);
  if (officialStateScope) {
    const held = await heldStatePeople(officialStateScope, "PERSON");
    const matches = held?.seats.filter((holder) => personIdentityKeys(holder).has(id)) ?? [];
    return matches.length === 1 ? matches[0] : null;
  }
  if (id.startsWith("congress:")) {
    // A member of Congress is found in the place the request names; an id alone names no place.
    await settleFederalDirectoryRead(stateHint ? [stateHint.replace(/^US-/i, "")] : selectedRegistryStates());
    return indexByOfficeholderId([getFederalOfficeholderSet()], suppliedOfficialPhotos()).get(id) ?? null;
  }
  const states = stateHint ? [stateHint.replace(/^US-/i, "")] : subjectRegistryStates(id);
  const current = registryRuntimeReadState();
  const heldScopes = new Set(current.metadata.scope.split("|"));
  if ((current.kind !== "PROMOTED" && current.kind !== "BOOTSTRAP") ||
      states.some(state => !heldScopes.has(stateRegistryRuntimeScope(state)))) await registryLoaded(states);
  const rosterIdentity = currentRosterMemberReaderDisposition(id);
  if (rosterIdentity?.state === "IDENTITY_UNRESOLVED") return null;
  const canonicalId = rosterIdentity?.canonicalId ?? id;
  if (canonicalId.startsWith("congress:")) return seatHolderById(canonicalId);
  const statewide = statewideExecutivesFor(currentStatewideExecutives().map((row) => row.stateOcdId))
    .find((holder) => holder.id === canonicalId);
  if (statewide) return statewide;
  for (const roster of currentBodyRosters()) {
    const holder = rosterHoldersForBody(roster.bodyId).find((row) => row.id === canonicalId);
    if (holder) return holder;
  }
  return null;
}

/** Optional exact photo evidence already supplied to this request must not acquire another authority. */
function suppliedOfficialPhotos(): PhotoIndex {
  try {
    return new Map(getRegistryRuntimeReadModel().officialPhotos.photos.map(photo => [photo.officeholderId, photo.url]) ?? []);
  } catch {
    return new Map();
  }
}

/** Exact named-person answers only; this list asserts no relationship to a reader's location. */
export async function allSeatHolders(divisionIds: readonly string[] = []): Promise<SeatHolder[]> {
  const states = [...new Set(divisionIds.map(statePeopleScopeForDivision).filter((scope): scope is StatePeopleJurisdiction => scope !== null))];
  const [base, ...stateReads] = await Promise.allSettled([loaded(divisionIds.length ? statesForRegistryDivisions(divisionIds) : selectedRegistryStates()).then(value => [...value.officialsById.values()]),
    ...states.map(async scope => [...(await heldStatePeople(scope, "PERSON"))?.seats ?? []].flatMap(holder => {
      const selected = seatHolderForMembership(holder, holder.memberships?.find(row => row.current === true)?.id);
      return selected ? [selected] : [];
    }))]);
  let holders: SeatHolder[] = [];
  for (const read of [base, ...stateReads]) if (read.status === "fulfilled") {
    holders=scopedHolders(holders,read.value);
  }
  if ([base, ...stateReads].every(read => read.status === "rejected")) throw new Error("Officeholder authorities unavailable");
  return holders;
}

export async function partyByOfficeholderId(): Promise<
  Map<string, string | null>
> {
  const { officialsById } = await loaded();
  const map = new Map<string, string | null>();
  for (const holder of officialsById.values()) map.set(holder.id, holder.partyLabel);
  return map;
}

export async function chamberForOfficeholder(
  id: string,
): Promise<"house" | "senate" | null> {
  const holder = await seatHolderById(id);
  if (holder?.officeTitle === "U.S. Senator") return "senate";
  if (holder?.officeTitle === "U.S. Representative") return "house";
  return null;
}

export async function seatHoldersForDivision(
  ocdId: string,
): Promise<SeatHolder[]> {
  return readDivisionRepresentatives(ocdId, {
    statePeople: heldStatePeople,
    federal: async () => {
      await settleFederalDirectoryRead(statesForRegistryDivisions([ocdId]));
      return indexByDivision([getFederalOfficeholderSet()], suppliedOfficialPhotos());
    },
    registry: () => settleRegistryRuntimeRead(statesForRegistryDivisions([ocdId])),
  });
}

async function heldStatePeople(scope: StatePeopleJurisdiction, mode: "DIVISION" | "PERSON" = "DIVISION") {
  const read = await settleStateLegislatorsRead(scope, mode);
  if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return null;
  return heldOfficialStateLegislatorsFromRead(scope, read);
}

export type CoverageStateLegislatorReader = (
  scope: StatePeopleJurisdiction,
) => ReturnType<typeof readStatePeopleProjection>;

const settleStateLegislatorsRead = async (scope: StatePeopleJurisdiction, mode: "DIVISION" | "PERSON" = "DIVISION"): ReturnType<CoverageStateLegislatorReader> => {
  if (!currentReaderAuthorityEdge()) {
    const state = await readStatePackage(scope.slice(3)), read = state.peopleRead;
    if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return read;
    const value = { ...read.value, roster: (mode === "DIVISION" ? state.legislativePeople : state.people) ?? read.value.roster };
    primeStatePeopleProjection(value);
    return { kind: "BOOTSTRAP", value, metadata: read.metadata, detail: "The state's current people, loaded together in memory." };
  }
  const served = await currentStateLegislatorsEdge()?.load(scope).catch(() => null);
  if (served?.value === null) {
    return { kind: "NOT_RECORDED", value: null, detail: "No state roster is published for this jurisdiction.",
      metadata: { recordClass: "STATE_LEGISLATOR", scope, sourceId: null, version: null, versionId: null,
        lastKnownGoodVersionId: null, sourceThrough: null, retrievedAt: null, promotedAt: null, stale: "UNKNOWN", staleAt: null } };
  }
  if (served) {
    const { versionId } = served, value = served.value!;
    primeStatePeopleProjection(value);
    return {
      kind: "BOOTSTRAP",
      value,
      metadata: {
        recordClass: "STATE_LEGISLATOR",
        scope,
        sourceId: value.sourceId,
        version: null,
        versionId,
        lastKnownGoodVersionId: versionId,
        sourceThrough: null,
        retrievedAt: value.generatedAt,
        promotedAt: null,
        stale: "UNKNOWN",
        staleAt: null,
      },
      detail: `Served from the state-legislators edge artifact (version ${versionId}); the promotion receipt stays on the authoritative database path.`,
    };
  }
  refuseDatabaseInEdgeOnlyContext(`The ${scope} state legislators`);
  return readStatePeopleProjection(scope);
};

export async function settleCoverageStateLegislators(
  exactDivisions: readonly Division[],
  officials: OfficeholderIndex,
  reader: CoverageStateLegislatorReader = settleStateLegislatorsRead,
): Promise<{
  readonly officials: OfficeholderIndex;
  readonly authorities: StateLegislatorCoverageAuthority[];
}> {
  const nextOfficials: OfficeholderIndex = new Map(
    [...officials].map(([division, holders]) => [division, [...holders]]),
  );
  const scopes = [...new Set(exactDivisions
    .map((division) => statePeopleScopeForDivision(division.ocdId))
    .filter((scope): scope is StatePeopleJurisdiction => scope !== null))];
  const authorities: StateLegislatorCoverageAuthority[] = [];

  // Per-scope settlement, so one state's missing or unavailable pointer never becomes another's.
  for (const scope of scopes) {
    let read: Awaited<ReturnType<CoverageStateLegislatorReader>>;
    try {
      read = await reader(scope);
    } catch (error) {
      if (error instanceof ReaderEdgeOnlyRefusal) throw error;
      read = { kind: "STORE_UNREACHABLE", value: null, code: "STORE_READ_FAILED", detail: "The state roster could not be loaded.",
        metadata: { recordClass: "STATE_LEGISLATOR", scope, sourceId: null, version: null, versionId: null,
          lastKnownGoodVersionId: null, sourceThrough: null, retrievedAt: null, promotedAt: null, stale: "UNKNOWN", staleAt: null } };
    }
    authorities.push(stateLegislatorCoverageAuthority(scope, read));
    if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") continue;

    const held = heldOfficialStateLegislatorsFromRead(scope, read);
    const byId = new Map(held.seats.map((holder) => [holder.id, holder]));
    for (const link of held.divisions) {
      const person = byId.get(link.officeholderId);
      if (!person) continue;
      const holder = seatHolderForMembership(person, link.membershipId);
      if (!holder) continue;
      const existing = nextOfficials.get(link.ocdId) ?? [];
      nextOfficials.set(link.ocdId,scopedHolders(existing,[holder]).sort((a,b)=>a.name.localeCompare(b.name)));
    }
  }

  return { officials: nextOfficials, authorities };
}

export async function seatHoldersForOffice(
  ocdId: string,
  officeTitle: string,
): Promise<SeatHolder[]> {
  const office = officeIdentity(officeTitle);
  if (office === null) return [];
  const holders = await seatHoldersForDivision(ocdId);
  return holders.filter((h) => officeIdentity(h.officeTitle) === office);
}

export async function prepareCoverage(): Promise<void> {
  await loaded();
}

export async function coverageAt(
  lat: number,
  lng: number,
  meetingCount: number,

  resolvedDivisions?: Division[],
  heldMeetings: readonly Meeting[] = [],
): Promise<CoverageSummary> {
  const location = await readerLocation(lat, lng);
  const state = statesForRegistryDivisions(resolvedDivisions?.map(division => division.ocdId) ?? [])[0] ?? location.state;
  const ids = resolvedDivisions?.map(division => division.ocdId) ?? await readerDivisionIdsAt(lat, lng);
  const territory = await readerTerritory(state);
  const [bundle, place] = await Promise.all([
    readStatePackage(state), readPlacePackage({ state, divisionIds: ids, bodyIds: territoryBodies(lat, lng, territory) }),
  ]);
  const meetings = heldMeetings.length ? heldMeetings : place.meetings;
  const coverage = stateCoverage(bundle, ids, lat, lng, meetings, place.bodies, [...place.divisions, ...resolvedDivisions ?? []], territory, meetingCount);
  return { ...coverage, governments: bindGovernmentBodies(place.governments, bundle.registry.registry.bodies),
    governmentInventoryUnavailableStates: place.registrationHeld ? [] : [state] };
}
