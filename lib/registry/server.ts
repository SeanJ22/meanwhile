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
import { readPublicBodyAttempts, type PublicBodyAttempt } from "./body-attempt-read.ts";
import { attemptsByFamily } from "./attempt-families.ts";
import { currentStatewideExecutives, statewideExecutivesFor } from "../officials/statewide-executives.ts";
import { currentBodyRosters, currentRosterMemberReaderDisposition, rosterGapForBody, rosterHoldersForBody } from "./body-rosters.ts";
import { scopedHolders } from "../officials/scoped-holders.ts";
import { readDivisionRepresentatives } from "./representation-server.ts";
export { federalDirectoryAppliesToDivision } from "./representation-server.ts";
import { membersOfBody } from "./body-membership.ts";
import { officePhoneForBody } from "../meetings/office-phone.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { federalDirectoryReadState, getFederalOfficeholderSet, primeFederalDirectoryFromValue, refreshFederalDirectoryFromPromoted } from "../officials/federal-directory-read-model.ts";
import { personIdentityKeys, statePeopleScopeForDivision, statePeopleScopeForId, type StatePeopleJurisdiction } from "../officials/people-identity.ts";

import {
  stateLegislatorCoverageAuthority,
  summarizeCoverage,
  type CoverageSummary,
  type StateLegislatorCoverageAuthority,
} from "./coverage.ts";
import { divisionsAt as resolveDivisionsAt, type GeoFeature } from "./resolve.ts";
import type { Body, Division, Registry } from "./types.ts";
import { getRegistryRuntimeReadModel, primeRegistryRuntimeFromValue, refreshRegistryRuntimeFromPromoted, registryRuntimeReadState } from "./runtime-read-model.ts";
import { currentCampaignSitesEdge, currentCommentAccessEdge, currentFederalDirectoryEdge, currentReaderAuthorityEdge, currentRegistrationsEdge, currentRegistryRuntimeEdge, currentStateLegislatorsEdge, ReaderEdgeOnlyRefusal, refuseDatabaseInEdgeOnlyContext, settleEdgeFirst } from "./runtime-edge.ts";
import { curatedReaderReadState, primeCuratedReaderProjection, refreshCampaignSitesFromPromoted } from "../civic-data/curated-reader-read-model.ts";
import { primeCommentAccess, readCommentAccessFacts } from "./comment-access.ts";
import { CivicDataStoreUnavailableError } from "../civic-data/read-model.ts";
import { composeRegistration, type RegistrationLayer } from "../registration/compose.ts";
import { REGISTRATION_TARGETS } from "../registration/publication.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";
import { bindGovernmentBodies, governmentStateOf, type RegistrationGovernmentListing } from "../registration/listings.ts";
import { attachGovernmentDomains, readDotGovProjection } from "../civic-data/dotgov.ts";
import { stateOfficesForStates } from "../reference/state-offices.ts";
import { readRegistrationProjection } from "../registration/reader.ts";
import { stateOf } from "./wording.ts";
import { publishedDivisionsForZip } from "../geo/zip-census-districts.ts";
import type { GeographySelection } from "../census-geography/selection.ts";
import { divisionsFromCensusGeographies, type CensusGeographies } from "../geo/census-geographies.ts";
import {
  heldOfficialStateLegislatorsFromRead,
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

let cache: { readonly authorityKey: string; readonly value: Promise<Loaded> } | null = null;
let registryCache: { readonly authorityKey: string; readonly value: Promise<RegistryLoaded> } | null = null;

// Cache committed geography across registry versions; a failed read must remain retryable.
let geometryRead: Promise<GeoFeature[]> | null = null;
let territoryRead: Promise<BodyTerritoryFile> | null = null;

function held<T>(current: Promise<T> | null, start: () => Promise<T>, keep: (value: Promise<T> | null) => void): Promise<T> {
  if (current) return current;
  const read = start();
  keep(read);
  read.catch(() => keep(null));
  return read;
}

function resolverGeometry(): Promise<GeoFeature[]> {
  return held(geometryRead, readResolverGeometry, (read) => { geometryRead = read; });
}

function bodyTerritories(): Promise<BodyTerritoryFile> {
  return held(territoryRead, readBodyTerritories, (read) => { territoryRead = read; });
}

export function prefetchReaderGeography(): void {
  void resolverGeometry().catch(() => undefined);
  void bodyTerritories().catch(() => undefined);
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

async function readResolverGeometry(): Promise<GeoFeature[]> {
  const root = process.cwd();
  const stateCodes = new Set(Object.values(FIPS_TO_STATE).map((state) => state.postal.toLowerCase()));

  // The manifest separates resolver geometry from downloads and superseded derivatives.
  const manifest = JSON.parse(
    await readFile(join(root, "data", "derived", "resolver-geometry.json"), "utf8"),
  ) as { files: string[] };
  const names = manifest.files;
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
      return (JSON.parse(raw) as { features: GeoFeature[] }).features;
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
    territory = await bodyTerritories();
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

// Edge first, database second, each a binding of `settleEdgeFirst`. A reader request that entered the
// reader authority edge primes the family from its edge value without reading the database; the runner
// and workers read the authoritative database pointer; an edge-only context refuses.

/** The federal directory, edge first. */
export const settleFederalDirectoryRead = (): Promise<void> =>
  settleEdgeFirst(currentFederalDirectoryEdge, primeFederalDirectoryFromValue, refreshFederalDirectoryFromPromoted, "The federal directory");

/** The registry runtime (divisions, bodies, rosters), edge first. */
const settleRegistryRuntimeRead = (): Promise<void> =>
  settleEdgeFirst(currentRegistryRuntimeEdge, primeRegistryRuntimeFromValue, refreshRegistryRuntimeFromPromoted, "The registry runtime");

/** Geometry/division reads never acquire the unrelated federal roster. */
export async function settleRegistryAuthorityReads(
  scope: "REGISTRY" | "OFFICIALS",
  readers: RegistryAuthorityReaders = {
    registry: settleRegistryRuntimeRead,
    federal: settleFederalDirectoryRead,
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
  settleEdgeFirst(currentCampaignSitesEdge, (value, versionId) => primeCuratedReaderProjection("campaign-sites", value, versionId), refreshCampaignSitesFromPromoted, "The campaign-site URLs");

export function authorityVersionKey(state: { readonly kind: string; readonly metadata: { readonly versionId: string | null } }): string {
  const served = state.kind === "PROMOTED" || state.kind === "BOOTSTRAP";
  return `${served ? "SERVED" : state.kind}:${state.metadata.versionId ?? "none"}`;
}

async function currentRegistryAuthorityKey(): Promise<string> {
  await settleRegistryAuthorityReads("REGISTRY");
  return `registry:${authorityVersionKey(registryRuntimeReadState())}`;
}

async function currentAuthorityKey(registryKey: string): Promise<{ key: string; federalAvailable: boolean }> {
  let federalAvailable = false;
  try {
    await settleFederalDirectoryRead();
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

async function registryLoaded(): Promise<RegistryLoaded> {
  const authorityKey = await currentRegistryAuthorityKey();
  if (registryCache?.authorityKey === authorityKey) return registryCache.value;
  const value = loadRegistry().catch((error) => {
    if (registryCache?.value === value) registryCache = null;
    throw error;
  });
  registryCache = { authorityKey, value };
  return value;
}

// Registration, composed one state at a time. A request reads only the states its own divisions name
// and composes each beside the reviewed registry (`composeRegistration`: reviewed wins). A state with no
// promoted registration adds nothing. A registration the store could not read is thrown, never returned
// as emptiness: "nobody governs here" never stands in for "we could not read who does".
const REGISTRATION_STATES = new Set(REGISTRATION_TARGETS.map((t) => t.state.toLowerCase()));
interface ComposedRegistration {
  readonly key: string;
  readonly layer: RegistrationLayer;
  readonly divisionsById: ReadonlyMap<string, Division>;
}
const registrationLayers = new Map<string, ComposedRegistration>();

async function registrationFor(state: string): Promise<ComposedRegistration | null> {
  if (!REGISTRATION_STATES.has(state)) return null;
  const base = await registryLoaded();
  const served = await registrationModelFor(state);
  return served ? composed(state, base, served.value, served.versionId) : null;
}

/** A source listing does not depend on the unrelated registry or federal roster. */
async function registrationModelFor(state: string): Promise<{ value: RegistrationReadModel; versionId: string } | null> {
  if (!REGISTRATION_STATES.has(state)) return null;
  // The edge first: an ordinary visitor never wakes the database for registration. The manifest's section is
  // complete, so a state it does not name has no promoted registration.
  const edge = currentRegistrationsEdge();
  if (edge) {
    if (!edge.states.has(state)) return null;
    const served = await edge.load(state);
    if (served) return served;
    // The artifact could not be fetched: this state is read from the database, on this request only.
  }
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
  return { state: code.toUpperCase(), status: held ? "HELD" : "NOT_HELD", versionId: held?.versionId ?? null,
    records: records.slice(start, start + size), total: records.length,
    nextOffset: start + size < records.length ? start + size : null };
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
  const key = `${registryCache?.authorityKey ?? ""}|${versionId}`;
  const held = registrationLayers.get(state);
  if (held?.key === key) return held;
  const layer = composeRegistration(base.registry, model, versionId);
  const entry: ComposedRegistration = { key, layer, divisionsById: new Map(layer.divisions.map((d) => [d.ocdId, d])) };
  registrationLayers.set(state, entry);
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

async function loaded(): Promise<Loaded> {
  const base = await registryLoaded();
  const registryKey = registryCache!.authorityKey;
  const { key: authorityKey, federalAvailable } = await currentAuthorityKey(registryKey);
  if (cache?.authorityKey === authorityKey) return cache.value;
  // Cache by promoted versions so a new GOOD pointer reaches warm Readers after their shared TTL.
  const value = load(base, federalAvailable).catch((error) => {
    if (cache?.value === value) cache = null;
    throw error;
  });
  cache = { authorityKey, value };
  return value;
}

export async function knownBodySubjectIds(forSubjectId?: string): Promise<Set<string>> {
  const { registry, divisionsById } = await registryLoaded();
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
  const { registry } = await registryLoaded();
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
  return resolveDivisionsAt([lng, lat], features, divisionsById);
}

export async function divisionsForCensusGeographies(geographies: CensusGeographies, selection: GeographySelection, vintage: string,
  geographyVintages: Readonly<Record<string, string>>): Promise<Division[]> {
  const rows = divisionsFromCensusGeographies(geographies, selection,
    `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?benchmark=Public_AR_Current&vintage=${vintage}&layers=all&format=json`, new Date().toISOString(), geographyVintages);
  if (!rows.length) return [];
  const held = currentRegistryRuntimeEdge()?.value.registry.divisions ?? [];
  return rows.map(row => {
    const matches = held.filter(division => division.divisionType === row.divisionType && division.geoid === row.geoid);
    return matches.length === 1 ? { ...row, ocdId: matches[0].ocdId, canonicalOcdId: matches[0].canonicalOcdId,
      canonicalMatch: matches[0].canonicalMatch, canonicalGap: matches[0].canonicalGap } : row;
  });
}

export async function divisionsByOcdIds(ocdIds: readonly string[], context?: { zip: string; selection?: GeographySelection }): Promise<Division[]> {
  const { divisionsById } = await registryLoaded();
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

export async function seatHolderById(id: string, stateHint?: string): Promise<SeatHolder | null> {
  // The publisher namespace establishes the one permitted state authority before any store is opened. A
  // state identity never causes a federal/registry read or a name join.
  const officialStateScope = statePeopleScopeForId(id,stateHint);
  if (officialStateScope) {
    const held = await heldStateLegislatorsEdgeFirst(officialStateScope);
    const matches = held?.seats.filter((holder) => personIdentityKeys(holder).has(id)) ?? [];
    return matches.length === 1 ? matches[0] : null;
  }
  if (id.startsWith("congress:")) {
    await settleFederalDirectoryRead();
    return indexByOfficeholderId([getFederalOfficeholderSet()], suppliedOfficialPhotos()).get(id) ?? null;
  }
  await registryLoaded();
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
    return new Map(currentRegistryRuntimeEdge()?.value.officialPhotos.photos.map(photo => [photo.officeholderId, photo.url]) ?? []);
  } catch {
    return new Map();
  }
}

/** Exact named-person answers only; this list asserts no relationship to a reader's location. */
export async function allSeatHolders(divisionIds: readonly string[] = []): Promise<SeatHolder[]> {
  const states = [...new Set(divisionIds.map(statePeopleScopeForDivision).filter((scope): scope is StatePeopleJurisdiction => scope !== null))];
  const [base, ...stateReads] = await Promise.allSettled([loaded().then(value => [...value.officialsById.values()]),
    ...states.map(async scope => [...(await heldStateLegislatorsEdgeFirst(scope))?.seats ?? []].flatMap(holder => {
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
    statePeople: heldStateLegislatorsEdgeFirst,
    federal: async () => {
      await settleFederalDirectoryRead();
      return indexByDivision([getFederalOfficeholderSet()], suppliedOfficialPhotos());
    },
    registry: settleRegistryRuntimeRead,
  });
}

async function heldStateLegislatorsEdgeFirst(scope: StatePeopleJurisdiction) {
  const read = await settleStateLegislatorsRead(scope);
  if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return null;
  return heldOfficialStateLegislatorsFromRead(scope, read);
}

export type CoverageStateLegislatorReader = (
  scope: StatePeopleJurisdiction,
) => ReturnType<typeof readStatePeopleProjection>;

const settleStateLegislatorsRead: CoverageStateLegislatorReader = async (scope) => {
  const edge = currentStateLegislatorsEdge();
  if (edge && !edge.jurisdictions.has(scope)) {
    return { kind: "NOT_RECORDED", value: null, detail: "No state roster is published for this jurisdiction.",
      metadata: { recordClass: "STATE_LEGISLATOR", scope, sourceId: null, version: null, versionId: null,
        lastKnownGoodVersionId: null, sourceThrough: null, retrievedAt: null, promotedAt: null, stale: "UNKNOWN", staleAt: null } };
  }
  const served = edge?.jurisdictions.has(scope) ? await edge.load(scope) : null;
  if (served) {
    const { value, versionId } = served;
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
  // Optional metadata starts beside the existing coverage read. Edge-only
  // requests never open a new database path just to annotate a body card.
  const attemptRead = currentReaderAuthorityEdge()?.edgeOnly
    ? Promise.resolve({ kind: "UNREAD" as const }) : readPublicBodyAttempts();
  const { features, divisionsById, registry, officials, territory, federalAvailable } = await loaded();
  const exactDivisions = resolvedDivisions ?? resolveDivisionsAt([lng, lat], features, divisionsById);
  // The governments registered on these divisions' states, beside the reviewed bodies.
  const divisionIds = exactDivisions.map((d) => d.ocdId);
  const [registered, governmentListings] = await Promise.all([
    registrationsFor(divisionIds).catch(() => []), governmentListingsForDivisions(divisionIds),
  ]);
  const bodies = registered.length === 0 ? registry.bodies : [...registry.bodies, ...registered.flatMap((r) => r.layer.bodies)];
  // A registered body is titled by its division (its name is null until sourced), so the summary needs the
  // registered divisions too, or the card would render a nameless, labelless row.
  const divisions = registered.length === 0
    ? divisionsById
    : new Map<string, Division>([...divisionsById, ...registered.flatMap((r) => [...r.divisionsById])]);
  const stateLegislators = await settleCoverageStateLegislators(exactDivisions, officials);
  const coverage = summarizeCoverage(
    [lng, lat],
    features,
    divisions,
    bodies,
    meetingCount,
    stateLegislators.officials,
    exactDivisions,
    territory,
    stateLegislators.authorities,
    heldMeetings,
  );
  const publicAttempts = await attemptRead;
  const attemptsByBody = new Map<string, PublicBodyAttempt[]>();
  if (publicAttempts.kind === "HELD") for (const attempt of publicAttempts.rows) {
    attemptsByBody.set(attempt.bodyId, [...(attemptsByBody.get(attempt.bodyId) ?? []), attempt]);
  }
  return {
    ...coverage,
    governments: bindGovernmentBodies(governmentListings.records, registry.bodies),
    governmentInventoryStates: governmentListings.states,
    stateOffices: stateOfficesForStates(governmentListings.states),
    governmentInventoryUnavailableStates: governmentListings.unavailableStates,
    federalDirectoryUnavailable: !federalAvailable,
    bodies: coverage.bodies.map((body) => {
      const gap = rosterGapForBody(body.bodyId);
      return {
        ...body,
        ...(publicAttempts.kind === "HELD" ? { publicationAttempts: attemptsByFamily(attemptsByBody.get(body.bodyId) ?? []) } : {}),
        readerRoster: {
          members: membersOfBody(body.bodyId).members,
          gaps: gap === null ? [] : [gap],
          officePhone: officePhoneForBody(body.bodyId),
        },
      };
    }),
  };
}
