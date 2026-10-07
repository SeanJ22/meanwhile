import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { Meeting } from "../sources/types.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  holdersFor,
  indexByDivision,
  indexByOfficeholderId,
  stateOcdIdFrom,
  type OfficeholderIndex,
  type PhotoIndex,
  type SeatHolder,
} from "../officials/lookup.ts";
import { mayReadRetiredPluralRoster, officeholderIdentityMayEnterReader, officeholderRosterFiles } from "../officials/roster-authority.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { BODY_TERRITORY_FILE, type BodyTerritoryFile } from "./body-territory.ts";
import { readPublicBodyAttempts, type PublicBodyAttempt } from "./body-attempt-read.ts";
import { attemptsByFamily } from "./attempt-families.ts";
import { currentStatewideExecutives, statewideExecutivesFor } from "../officials/statewide-executives.ts";
import { currentBodyRosters, currentRosterMemberReaderDisposition, rosterGapForBody, rosterHoldersForBody } from "./body-rosters.ts";
import { membersOfBody } from "./body-membership.ts";
import { officePhoneForBody } from "../meetings/office-phone.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { federalDirectoryReadState, getFederalOfficeholderSet, primeFederalDirectoryFromValue, refreshFederalDirectoryFromPromoted } from "../officials/federal-directory-read-model.ts";
import { collapsePhotoIndexByPerson } from "../photos/person.ts";

import {
  stateLegislatorCoverageAuthority,
  summarizeCoverage,
  type CoverageSummary,
  type StateLegislatorCoverageAuthority,
} from "./coverage.ts";
import { divisionsAt as resolveDivisionsAt, type GeoFeature } from "./resolve.ts";
import type { Body, Division, Registry } from "./types.ts";
import { getRegistryRuntimeReadModel, primeRegistryRuntimeFromValue, refreshRegistryRuntimeFromPromoted, registryRuntimeReadState } from "./runtime-read-model.ts";
import { currentCampaignSitesEdge, currentCommentAccessEdge, currentFederalDirectoryEdge, currentReaderAuthorityEdge, currentRegistrationsEdge, currentRegistryRuntimeEdge, currentStateLegislatorsEdge, refuseDatabaseInEdgeOnlyContext, settleEdgeFirst } from "./runtime-edge.ts";
import { curatedReaderReadState, primeCuratedReaderProjection, refreshCampaignSitesFromPromoted, refreshCommentAccessFromPromoted } from "../civic-data/curated-reader-read-model.ts";
import { CivicDataStoreUnavailableError } from "../civic-data/read-model.ts";
import { composeRegistration, type RegistrationLayer } from "../registration/compose.ts";
import { REGISTRATION_TARGETS } from "../registration/publication.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";
import { readRegistrationProjection } from "../registration/reader.ts";
import { stateOf } from "./wording.ts";
import {
  heldOfficialStateLegislators,
  heldOfficialStateLegislatorsFromRead,
  readOfficialStateLegislatorsProjection,
} from "../state-rollcalls/legislators.ts";
import {
  officialStateLegislatorTargetByScope,
  officialStateLegislatorTargetByState,
  officialStateVoteScopeForOfficeholderId,
  type OfficialStateVoteScope,
} from "../state-rollcalls/authority.ts";

/**
 * Server-side access to the registry and the geometry it resolves against.
 *
 * The committed boundary files are the reviewed, immutable Census/GIS source vintage
 * (STATIC_VERSIONED_REFERENCE). Mutable registry bindings are preloaded separately from their canonical
 * data-plane pointer. There is no second runtime geometry authority and no store-error fallback that
 * can switch between competing geometries.
 */

interface Loaded {
  features: GeoFeature[];
  /** Body territories for governments with no Census division. */
  territory: BodyTerritoryFile | null;
  divisionsById: Map<string, Division>;
  registry: Registry;
  officials: OfficeholderIndex;
  /** Every held person, including people whose divisions are not in our geometry. */
  officialsById: Map<string, SeatHolder>;
}

interface RegistryLoaded {
  features: GeoFeature[];
  divisionsById: Map<string, Division>;
  registry: Registry;
}

/**
 * The officeholder rosters permitted to answer a Reader. Production admits the federal roster only;
 * state legislators come from their official-publisher promotion.
 */
const ROSTERS = officeholderRosterFiles();

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

// The committed geography is read once per process, and a route can start it first
// (`prefetchReaderGeography`) beside the edge fetch. A new registry version reuses it. A failed read is
// never held: the next caller reads again.
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

/**
 * Start reading the committed geography now, without waiting for it. Reads no edge or database state,
 * so a route may call it before entering the reader authority edge.
 */
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

  // The resolver reads a generated manifest, not a directory: `public/geo` mixes client downloads with
  // build inputs, and per-state derivatives supersede the national files. `tests/resolver-manifest.test.ts`
  // fails on a canonical `.geojson` that is on neither list.
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
  // Literal path segments, not the imported constant: Next traces this route to decide what ships and
  // cannot resolve `join(root, SOME_CONST)` statically. BODY_TERRITORY_FILE stays the one spelling for
  // everything else.
  return JSON.parse(
    await readFile(join(root, "data", "states", "az", "geo", "body-territories.geojson"), "utf8"),
  ) as BodyTerritoryFile;
}

async function load(base: RegistryLoaded): Promise<Loaded> {
  const root = process.cwd();
  const runtimeRegistry = getRegistryRuntimeReadModel();
  const { features, divisionsById, registry } = base;

  // A required roster failure is a loading failure, never an empty roster; a partial registry is never
  // cached. `Promise.all` preserves ROSTERS order.
  const sets: OfficeholderSet[] = await Promise.all(
    ROSTERS.map(async (name) => {
      const fips = /^officeholders-(\d{2})\.json$/.exec(name)?.[1];
      const state = fips ? FIPS_TO_STATE[fips]?.postal.toLowerCase() : undefined;
      if (name !== "officeholders-us.json" && !state) throw new Error(`Invalid canonical roster name: ${name}`);
      try {
        return name === "officeholders-us.json"
          ? getFederalOfficeholderSet()
          : (JSON.parse(await readFile(join(root, "data", "states", state!, "officials", name), "utf8")) as OfficeholderSet);
      } catch (error) {
        throw new RegistryHoldingReadError(name === "officeholders-us.json"
          ? "federal directory"
          : `data/states/${state}/officials/${name}`, error);
      }
    }),
  );

  // The photo manifest: per-image source and license, images served from our origin. Missing or
  // unreadable degrades to initials everywhere.
  const photos: PhotoIndex = new Map();
  try {
    const manifest = runtimeRegistry.officialPhotos as {
      photos: {
        officeholderId: string;
        name: string;
        url: string;
      }[];
    };
    const names = new Map<string, string>();
    for (const photo of manifest.photos) {
      if (!officeholderIdentityMayEnterReader(photo.officeholderId)) continue;
      photos.set(photo.officeholderId, photo.url);
      names.set(photo.officeholderId, photo.name);
    }
    // One person, one photo: a person holding two seats has two officeholder ids. Collapsed by person here,
    // once, rather than at each surface.
    const collapsed = collapsePhotoIndexByPerson(photos, names);
    photos.clear();
    for (const [id, url] of collapsed) photos.set(id, url);
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
  settleEdgeFirst(currentCommentAccessEdge, (value, versionId) => primeCuratedReaderProjection("comment-access", value, versionId), refreshCommentAccessFromPromoted, "The comment-access rules");

/** The campaign-site URLs, edge first. */
const settleCampaignSitesRead = (): Promise<void> =>
  settleEdgeFirst(currentCampaignSitesEdge, (value, versionId) => primeCuratedReaderProjection("campaign-sites", value, versionId), refreshCampaignSitesFromPromoted, "The campaign-site URLs");

/**
 * One version, one key, whichever path served it. An edge prime records BOOTSTRAP and a database read of
 * the same promoted version records PROMOTED; keying on that kind would rebuild the registry each time
 * the two alternated. A first seed carries its own `bootstrap:` version id and stays distinct.
 */
export function authorityVersionKey(state: { readonly kind: string; readonly metadata: { readonly versionId: string | null } }): string {
  const served = state.kind === "PROMOTED" || state.kind === "BOOTSTRAP";
  return `${served ? "SERVED" : state.kind}:${state.metadata.versionId ?? "none"}`;
}

async function currentRegistryAuthorityKey(): Promise<string> {
  await settleRegistryAuthorityReads("REGISTRY");
  return `registry:${authorityVersionKey(registryRuntimeReadState())}`;
}

async function currentAuthorityKey(registryKey: string): Promise<string> {
  await settleRegistryAuthorityReads("OFFICIALS", {
    registry: async () => undefined,
    federal: settleFederalDirectoryRead,
  });
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
  return [
    `federal:${authorityVersionKey(federalDirectoryReadState())}`,
    registryKey,
    `campaign:${campaign}`,
  ].join("|");
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
  // The edge first: an ordinary visitor never wakes the database for registration. The manifest's section is
  // complete, so a state it does not name has no promoted registration.
  const edge = currentRegistrationsEdge();
  if (edge) {
    if (!edge.states.has(state)) return null;
    const served = await edge.load(state);
    if (served) return composed(state, base, served.value, served.versionId);
    // The artifact could not be fetched: this state is read from the database, on this request only.
  }
  refuseDatabaseInEdgeOnlyContext(`The ${state} registration`);
  const read = await readRegistrationProjection(state);
  // No store at all (tests, the census gate, local work) has no registration to compose: registration has
  // no first seed. A configured store that did not answer is a failure.
  if (read.kind === "STORE_UNREACHABLE" && read.code === "STORE_NOT_CONFIGURED") return null;
  if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
  if (read.kind !== "PROMOTED" || read.metadata.versionId === null) return null;
  return composed(state, base, read.value, read.metadata.versionId);
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
    const state = stateOf(id);
    if (state !== null) states.add(state);
  }
  const composed = await Promise.all([...states].map((state) => registrationFor(state)));
  return composed.filter((c): c is ComposedRegistration => c !== null);
}

async function loaded(): Promise<Loaded> {
  const base = await registryLoaded();
  const registryKey = registryCache!.authorityKey;
  const authorityKey = await currentAuthorityKey(registryKey);
  if (cache?.authorityKey === authorityKey) return cache.value;
  // Cache the materialization only for the exact promoted versions. Pointer
  // refresh uses the shared 30-second civic-data TTL; a new GOOD version gets
  // a new key and reaches a warm Reader without a process restart.
  const value = load(base).catch((error) => {
    if (cache?.value === value) cache = null;
    throw error;
  });
  cache = { authorityKey, value };
  return value;
}

/**
 * Every id a `BODY` card can be about. The demand-signal route validates a `BODY` subject against this;
 * a missing or unreadable registry fails closed at the caller. It is the union of registry body ids and
 * division OCD-IDs, because some body cards are about a place or district that is not a registry body.
 */
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

/**
 * Divisions by OCD id, for a caller that has resolved an area rather than a point (e.g. the ZIP-area
 * widening in `lib/ballot/zip-divisions.ts`). An id the registry does not hold is dropped, never
 * invented.
 */
export async function divisionsByOcdIds(ocdIds: readonly string[]): Promise<Division[]> {
  const { divisionsById } = await registryLoaded();
  // An id the reviewed registry does not hold may be one its state registered.
  const registered = await registrationsFor(ocdIds.filter((id) => !divisionsById.has(id)));
  const out: Division[] = [];
  for (const id of ocdIds) {
    const division = divisionsById.get(id) ?? registered.find((r) => r.divisionsById.has(id))?.divisionsById.get(id);
    if (division) out.push(division);
  }
  return out;
}

/**
 * One officeholder by roster id, in the render shape. The id arrives from an exact-key join (never a
 * name match); an id the roster does not hold returns null.
 */
export async function seatHolderById(id: string): Promise<SeatHolder | null> {
  // The publisher namespace establishes the one permitted state authority before any store is opened. A
  // state identity never causes a federal/registry read or a name join.
  const officialStateScope = officialStateVoteScopeForOfficeholderId(id);
  if (officialStateScope) {
    const held = await heldOfficialStateLegislators(officialStateScope);
    return held?.seats.find((holder) => holder.id === id) ?? null;
  }
  await registryLoaded();
  const rosterIdentity = currentRosterMemberReaderDisposition(id);
  if (rosterIdentity?.state === "IDENTITY_UNRESOLVED") return null;
  const canonicalId = rosterIdentity?.canonicalId ?? id;
  if (!canonicalId.startsWith("congress:") && !mayReadRetiredPluralRoster()) {
    const statewide = statewideExecutivesFor(currentStatewideExecutives().map((row) => row.stateOcdId))
      .find((holder) => holder.id === canonicalId);
    if (statewide) return statewide;
    for (const roster of currentBodyRosters()) {
      const holder = rosterHoldersForBody(roster.bodyId).find((row) => row.id === canonicalId);
      if (holder) return holder;
    }
    return null;
  }
  return (await loaded()).officialsById.get(canonicalId) ?? null;
}

/** Exact named-person answers only; this list asserts no relationship to a reader's location. */
export async function allSeatHolders(): Promise<SeatHolder[]> {
  return [...(await loaded()).officialsById.values()];
}

/**
 * officeholder id → partyLabel, across every loaded roster. Display data only; nothing downstream
 * infers a position from it.
 */
export async function partyByOfficeholderId(): Promise<
  Map<string, string | null>
> {
  const { officialsById } = await loaded();
  const map = new Map<string, string | null>();
  for (const holder of officialsById.values()) map.set(holder.id, holder.partyLabel);
  return map;
}

/**
 * Which chamber a federal member sits in, read off the roster's own `officeTitle`. Null for anyone who
 * is not a federal legislator. The one place the chamber rule can be got wrong.
 */
export async function chamberForOfficeholder(
  id: string,
): Promise<"house" | "senate" | null> {
  const holder = await seatHolderById(id);
  if (holder?.officeTitle === "U.S. Senator") return "senate";
  if (holder?.officeTitle === "U.S. Representative") return "house";
  return null;
}

/**
 * **Who holds this division's seats — keyed by the DIVISION, not by the
 * reader** (M112, 2026-08-16).
 *
 * `coverageAt` answers "who represents this point", and its `seats` array is
 * point-scoped by construction: it carries only the divisions containing the
 * reader. The district battlecard resolved against that array, so opening any
 * OTHER drawn district on the map produced an empty list — and the empty list
 * rendered as OUR gap. State House District 21 told a reader in District 20
 * that we hold no officeholder for it, over Consuelo Hernandez and Stephanie
 * Stahl Hamilton, both in the index the same page had already loaded.
 *
 * The scope limit was real; the sentence about it was false. This function is
 * the resolution the sentence was standing in for: the index is keyed by
 * OCD-ID, so a division is answerable whether or not the reader is in it.
 * Same store, same rows, same sourcing — no new data.
 *
 * An empty return here is a REAL absence: we asked the store by the
 * division's own key and it holds nobody.
 */
export async function seatHoldersForDivision(
  ocdId: string,
): Promise<SeatHolder[]> {
  if (/\/sld[lu]:[^/]+$/.test(ocdId)) {
    // Independently verified district-seat rosters publish through the registry
    // too. Settle its typed reader (which hydrates storage parts) before using
    // synchronous selectors; a missing statewide roster must not hide them.
    await settleRegistryAuthorityReads("REGISTRY");
    const published = rosterHoldersForBody(`${ocdId}#seat`);
    if (published.length) return published.map(holder => ({
      ...holder,
      officeTitle: /\/sldl:/.test(ocdId) ? "State Representative" : "State Senator",
    }));
  }
  const officialStateScope = officialStateLegislatorScopeForDivision(ocdId);
  if (officialStateScope) {
    try {
      const held = await heldStateLegislatorsEdgeFirst(officialStateScope);
      if (held) {
        const ids = new Set(held.divisions.filter((row) => row.ocdId === ocdId).map((row) => row.officeholderId));
        return held.seats.filter((holder) => ids.has(holder.id)).sort((a, b) => a.name.localeCompare(b.name));
      }
      if (!mayReadRetiredPluralRoster()) return [];
    } catch (error) {
      // Old state snapshots are test evidence only: production surfaces a canonical-store outage.
      if (!mayReadRetiredPluralRoster() || !(error instanceof CivicDataStoreUnavailableError)) throw error;
    }
  }
  if (!federalDirectoryAppliesToDivision(ocdId) && !mayReadRetiredPluralRoster()) {
    // Production's federal directory has no rows for local or state-legislative
    // divisions. Confirm the canonical registry pointer, then return its honest
    // no-federal-row result without letting a federal outage take that scope down.
    await registryLoaded();
    return [];
  }
  const { officials } = await loaded();
  // The statewide executives, and only on the state division itself. `statewideExecutivesFor` takes the
  // divisions covering a point and would otherwise attach the governor to every division in the state.
  const statewide = stateOcdIdFrom(ocdId) === ocdId ? statewideExecutivesFor([ocdId]) : [];
  return [...holdersFor(officials, ocdId), ...statewide];
}

/**
 * `heldOfficialStateLegislators`, edge first: a request that entered the reader edge reads a district's
 * state legislators from the edge value instead of the database.
 */
async function heldStateLegislatorsEdgeFirst(scope: OfficialStateVoteScope) {
  const read = await settleStateLegislatorsRead(scope);
  if (read.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(read);
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return null;
  return heldOfficialStateLegislatorsFromRead(scope, read);
}

/** Exact divisions to which the production federal roster can contribute. */
export function federalDirectoryAppliesToDivision(ocdId: string): boolean {
  return ocdId === "ocd-division/country:us"
    || /^ocd-division\/country:us\/state:[a-z]{2}$/.test(ocdId)
    || /\/cd:[^/]+$/.test(ocdId);
}

export type CoverageStateLegislatorReader = (
  scope: OfficialStateVoteScope,
) => ReturnType<typeof readOfficialStateLegislatorsProjection>;

/**
 * Settle each exact official state-roster authority without erasing its read
 * disposition. In particular, an empty canonical pointer and an unavailable
 * store both yield no names, but remain different facts on CoverageSummary.
 */
/**
 * The state-legislators reader, edge-aware: a reader request that primed the
 * request-scoped state-legislators edge map serves it (per scope) WITHOUT
 * reading Neon; the runner/workers fall through to the authoritative database
 * reader. BOOTSTRAP kind — the serving copy carries the value + version, not the
 * promotion receipt.
 */
const settleStateLegislatorsRead: CoverageStateLegislatorReader = async (scope) => {
  const edge = currentStateLegislatorsEdge();
  const value = edge?.value?.[scope];
  if (value) {
    return {
      kind: "BOOTSTRAP",
      value,
      metadata: {
        recordClass: "STATE_LEGISLATOR",
        scope,
        sourceId: officialStateLegislatorTargetByScope(scope)?.sourceId ?? null,
        version: null,
        versionId: edge.versionId,
        lastKnownGoodVersionId: edge.versionId,
        sourceThrough: null,
        retrievedAt: null,
        promotedAt: null,
        stale: "CURRENT",
        staleAt: null,
      },
      detail: `Served from the state-legislators edge artifact (version ${edge.versionId}); the promotion receipt stays on the authoritative database path.`,
    };
  }
  refuseDatabaseInEdgeOnlyContext(`The ${scope} state legislators`);
  return readOfficialStateLegislatorsProjection(scope);
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
    .map((division) => officialStateLegislatorScopeForDivision(division.ocdId))
    .filter((scope): scope is OfficialStateVoteScope => scope !== null))];
  const authorities: StateLegislatorCoverageAuthority[] = [];

  // Per-scope settlement, so one state's missing or unavailable pointer never becomes another's.
  for (const scope of scopes) {
    const read = await reader(scope);
    authorities.push(stateLegislatorCoverageAuthority(scope, read));
    if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") continue;

    const held = heldOfficialStateLegislatorsFromRead(scope, read);
    const byId = new Map(held.seats.map((holder) => [holder.id, holder]));
    for (const link of held.divisions) {
      const holder = byId.get(link.officeholderId);
      if (!holder) continue;
      const existing = nextOfficials.get(link.ocdId) ?? [];
      if (!existing.some((row) => row.id === holder.id)) {
        nextOfficials.set(
          link.ocdId,
          [...existing, holder].sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
    }
  }

  return { officials: nextOfficials, authorities };
}

/** Exact permanent roster scope implied by one state-legislative division. */
function officialStateLegislatorScopeForDivision(ocdId: string): OfficialStateVoteScope | null {
  const match = /^ocd-division\/country:us\/state:([a-z]{2})\/sld[lu]:[^/]+$/.exec(ocdId);
  if (!match) return null;
  return officialStateLegislatorTargetByState(match[1]!)?.jurisdiction ?? null;
}

/**
 * Who holds this exact office on this division. Several offices often share one division (statewide
 * offices on the state division, a mayor and council on a place), so a ballot asks with the contest's
 * own title. An office the vocabulary cannot classify returns `[]`, rendered as UNKNOWN, never as the
 * division-wide list. Statewide executives participate here rather than being duplicated.
 */
export async function seatHoldersForOffice(
  ocdId: string,
  officeTitle: string,
): Promise<SeatHolder[]> {
  const office = officeIdentity(officeTitle);
  if (office === null) return [];
  if (office !== "us_senator" && office !== "us_representative"
    && /^ocd-division\/country:us\/state:[a-z]{2}$/.test(ocdId)
    && !mayReadRetiredPluralRoster()) {
    await registryLoaded();
    return statewideExecutivesFor([ocdId]).filter((holder) => officeIdentity(holder.officeTitle) === office);
  }
  const holders = await seatHoldersForDivision(ocdId);
  return holders.filter((h) => officeIdentity(h.officeTitle) === office);
}

/**
 * Build the coverage graph for the authority this request reads, so a later `coverageAt` finds it
 * held. Call only after the handler has entered the reader edge, or it settles the authority from the
 * database. A failure is not held.
 */
export async function prepareCoverage(): Promise<void> {
  await loaded();
}

export async function coverageAt(
  lat: number,
  lng: number,
  meetingCount: number,
  /**
   * The divisions covering this same point, when the caller already has them. Must be the result of
   * resolving this lat/lng. A caller whose own resolution failed must omit it: an empty set would turn a
   * retrieval failure into "nothing governs here".
   */
  resolvedDivisions?: Division[],
  heldMeetings: readonly Meeting[] = [],
): Promise<CoverageSummary> {
  // Optional metadata starts beside the existing coverage read. Edge-only
  // requests never open a new database path just to annotate a body card.
  const attemptRead = currentReaderAuthorityEdge()?.edgeOnly
    ? Promise.resolve({ kind: "UNREAD" as const }) : readPublicBodyAttempts();
  const { features, divisionsById, registry, officials, territory } = await loaded();
  const exactDivisions = resolvedDivisions ?? resolveDivisionsAt([lng, lat], features, divisionsById);
  // The governments registered on these divisions' states, beside the reviewed bodies.
  const registered = await registrationsFor(exactDivisions.map((d) => d.ocdId));
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
