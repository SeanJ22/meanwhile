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
import { officeholderIdentityMayEnterReader, officeholderRosterFiles } from "../officials/roster-authority.ts";
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
import type { Division, Registry } from "./types.ts";
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
 * The committed boundary files are the explicitly reviewed, immutable Census/
 * GIS source vintage classified by PDC as STATIC_VERSIONED_REFERENCE. Mutable
 * registry bindings are preloaded separately from their canonical data-plane
 * pointer. There is no second runtime geometry authority and no store-error
 * fallback that can silently switch between two competing geometries.
 *
 * **This does not scale, and it is not meant to.** 1.9 MB of GeoJSON parsed into
 * server memory is fine for three counties and untenable for the 90,837 local
 * governments Phase 4.7 targets. That phase replaces it with PMTiles plus a real
 * table. The seam is deliberately narrow — one `coverageAt()` call — so swapping
 * the backing store does not reach into the route or the UI.
 */

interface Loaded {
  features: GeoFeature[];
  /** Body territories for governments with no Census division (NH233). */
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
 * The officeholder rosters permitted to answer a Reader, by scope.
 *
 * Production admits the federal roster only. The old state files are
 * Plural/OpenStates intermediary projections, retained as historical research
 * and explicit node:test fixtures but never as a production fallback. State
 * legislators remain visibly unrecorded until an official-publisher promotion
 * is wired to this projection.
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

/*
 * **THE COMMITTED GEOGRAPHY IS READ ONCE PER PROCESS, AND CAN BE STARTED
 * FIRST.** (C21, 2026-09-25.)
 *
 * The resolver geometry and the body territories are the reviewed static files
 * this deploy ships; they cannot change while the process runs. They used to be
 * read inside `loadRegistry` and `load`, which wait for the registry authority
 * to settle, so a cold `/api/meetings` fetched the edge families first and only
 * then began ~25 file reads and parses. Held as their own promises, a route can
 * start them on its first line (`prefetchReaderGeography`), beside the edge
 * fetch, and a new registry version reuses them instead of re-reading every
 * file. A failed read is never held: the next caller reads again, and the
 * failure still reaches whoever awaits it exactly as before.
 */
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
 * Start reading the committed geography now, without waiting for it. Reads no
 * edge or database state, so a route may call it before it has entered the
 * reader authority edge; the loaders below await the same reads.
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

  /*
   * **P-003 · THE RESOLVER READS A MANIFEST, NOT A DIRECTORY.**
   * (Performance audit of `336a3eb`, remediated 2026-08-24.)
   *
   * This used to be `readdir` with one file excluded by name. The exclusion
   * was right and the instrument was wrong: `public/geo` is what the CLIENT
   * downloads, plus the INPUTS to the scripts that build it, and a directory
   * listing cannot tell an input from a product.
   *
   * So the resolver loaded `cd119.geojson` — the 1.63 MB national
   * congressional file, 441 features and 80,115 coordinates — alongside
   * `cd119-04`, `cd119-33` and `cd119-34`, its own per-state derivatives,
   * which `pnpm cd:split` writes and which the map has used since g4 item 3.
   * Every feature in the national file that could match a covered point is
   * byte-identical to one in a per-state file, by construction of the split.
   * The resolver was paying for all 435 other districts on every sweep.
   *
   * Measured: 26 files, 2,291 features, 118,533 coordinates → 25 files,
   * 1,850 features, 38,418 coordinates. 67.6% of the geometry gone with no
   * change to any answer, which `pnpm resolver:identity` proves per zip.
   *
   * The old comment's worry is preserved rather than dropped: an allow-list
   * rots the other way, a new district type silently absent. The manifest is
   * GENERATED, states its rule as SUPERSESSION, and accounts for every
   * canonical state or national `.geojson` on one list or the other —
   * `tests/resolver-manifest.test.ts` fails the build on a file that is on
   * neither.
   */
  const manifest = JSON.parse(
    await readFile(join(root, "data", "derived", "resolver-geometry.json"), "utf8"),
  ) as { files: string[] };
  const names = manifest.files;
  // Read every geometry file CONCURRENTLY (E.1, 2026-09-14). The files are
  // independent and a cold ballot spent most of its wall-clock awaiting these
  // ~25 reads and parses one after another. `Promise.all` keeps each file's
  // validation identical — a throw still rejects the whole load — and the
  // feature ORDER does not matter: `divisionsById` keys on ocdId and the
  // point-in-polygon scan is order-free. Literal roots keep dynamic reads
  // bounded in the server deployment trace, exactly as the serial loop did.
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
  /*
   * LITERAL PATH SEGMENTS, not the imported constant.
   *
   * Next traces this route to decide what ships. Given `join(root, SOME_CONST)`
   * it cannot resolve the path statically, and the first version of this line
   * blew the app trace from 215 files to 4,073 — it swallowed screenshots/,
   * docs/feedback/ and all 1,005 official portraits. `pnpm build`'s own
   * cardinality budget caught it, which is exactly what that budget is for.
   *
   * BODY_TERRITORY_FILE stays exported for the generator and the guards, so
   * there is still one spelling of the path; this is the one place that
   * spells it in segments, because the tracer has to read it.
   */
  return JSON.parse(
    await readFile(join(root, "data", "states", "az", "geo", "body-territories.geojson"), "utf8"),
  ) as BodyTerritoryFile;
}

async function load(base: RegistryLoaded): Promise<Loaded> {
  const root = process.cwd();
  const runtimeRegistry = getRegistryRuntimeReadModel();
  const { features, divisionsById, registry } = base;

  // A required roster failure is an OURS loading failure, never an empty roster.
  // Do not cache a partial registry as if those officials were not held. Read
  // concurrently (E.1) — same per-roster validation and error, `Promise.all`
  // preserves ROSTERS order so `sets` is unchanged.
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
          ? "lib/registry/officeholders-us.json"
          : `data/states/${state}/officials/${name}`, error);
      }
    }),
  );

  // The photo manifest (D20): per-image source and license, images served
  // from our origin. Missing or unreadable degrades to initials everywhere.
  const photos: PhotoIndex = new Map();
  try {
    const manifest = runtimeRegistry.officialPhotos as {
      photos: {
        officeholderId: string;
        name: string;
        url: string;
        license: string | null;
      }[];
    };
    const names = new Map<string, string>();
    for (const photo of manifest.photos) {
      if (!officeholderIdentityMayEnterReader(photo.officeholderId)) continue;
      // Unknown license is not clearable — such a photo never ships (D20).
      if (!photo.license) continue;
      photos.set(photo.officeholderId, photo.url);
      names.set(photo.officeholderId, photo.name);
    }
    // One person, one photo (item 6b, 2026-08-15). A person holding two
    // seats has two officeholder ids and had two photo rows, so Consuelo
    // Hernandez's school-board row and her legislative row rendered two
    // different faces of the same woman. Collapsed by person here, once,
    // rather than at each of the surfaces that reads this index.
    const collapsed = collapsePhotoIndexByPerson(photos, names);
    photos.clear();
    for (const [id, url] of collapsed) photos.set(id, url);
  } catch {
    // No manifest is a fine state: initials render instead.
  }

  /*
   * **NH233 — the territory file, loaded beside the boundary files.**
   *
   * This is a required held relationship. Its loading failure must remain
   * distinguishable from a body having no applicable territorial relationship.
   */
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

/*
 * **EDGE FIRST, DATABASE SECOND — EACH A BINDING OF `settleEdgeFirst`.** (R24,
 * 2026-09-25.) A reader request that entered the reader authority edge primes
 * the family from its edge value WITHOUT reading Neon; the standing runner and
 * the workers never enter one, so they read the authoritative database pointer
 * (`refresh*FromPromoted`, unchanged); an edge-only context (the keep-warm
 * call) refuses instead. The five settles were five copies of that shape.
 */

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

/**
 * The comment-access rules, edge first (C20, 2026-09-24): from its
 * comment-access artifact without Neon (0.6–0.8 s from a cold database).
 */
export const settleCommentAccessRead = (): Promise<void> =>
  settleEdgeFirst(currentCommentAccessEdge, (value, versionId) => primeCuratedReaderProjection("comment-access", value, versionId), refreshCommentAccessFromPromoted, "The comment-access rules");

/** The campaign-site URLs, edge first. */
const settleCampaignSitesRead = (): Promise<void> =>
  settleEdgeFirst(currentCampaignSitesEdge, (value, versionId) => primeCuratedReaderProjection("campaign-sites", value, versionId), refreshCampaignSitesFromPromoted, "The campaign-site URLs");

/**
 * **ONE VERSION, ONE KEY, WHICHEVER PATH SERVED IT.** (R30, 2026-09-25.)
 *
 * An edge prime records its family as BOOTSTRAP (the serving copy carries the
 * value and version, not the promotion receipt) and a database read of the
 * same promoted version records PROMOTED. The cache keys below used to include
 * that kind, so an instance serving one request from the edge and the next
 * from the database (a route that does not enter the edge, or a failed edge
 * fetch) saw two keys for one version and rebuilt the registry and the whole
 * officeholder graph each time it alternated. The edge copies exactly the
 * promoted version it names, so a served value is keyed by its version alone;
 * a first seed carries its own `bootstrap:` version id and stays distinct.
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
      // Campaign URLs are an optional, separately promoted projection. A
      // store failure withholds those URLs but cannot make the registry,
      // representation, or roster authority unavailable.
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

/*
 * **REGISTRATION, COMPOSED ONE STATE AT A TIME.** (2026-09-23.)
 *
 * The runner registers every state's Census governments (`lib/registration/`).
 * A request reads only the states its own divisions name, through the shared
 * promoted read and its 30-second pointer check, and composes each beside the
 * reviewed registry held now (`composeRegistration`: reviewed wins). A state
 * with no promoted registration adds nothing. A registration the store could not
 * read is thrown like an unreadable registry, never returned as an emptiness:
 * "nobody governs here" may never stand in for "we could not read who does".
 */
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
 * Who governs this point, and how much of their calendar we actually have.
 *
 * `meetingCount` is the cascade's answer for the same point. It is what
 * separates "nothing is scheduled" from "we cannot see what is scheduled", and
 * those must never render the same way.
 */
/**
 * **EVERY ID A `BODY` CARD CAN BE ABOUT.** (OWN-Q6, 2026-08-31.)
 *
 * The demand-signal route validates a `BODY` subject against this, for the
 * same reason the reaction route validates a target against the votes and
 * ballot snapshots: a row stored against a subject nothing can render is a row
 * no operational reader can act on, which is worse than no row. A missing or
 * unreadable registry fails CLOSED at the caller.
 *
 * **It is the UNION of two id spaces, because the surface is.** `BC-11` fixed
 * the subject id on the body card to *the body id, never the display title* —
 * and there are three constructors in `map-entry.tsx`, of which one uses a
 * registry `body.id` and two use a division's own OCD-ID, because a PLACE and
 * a DISTRICT are governments that are not registry body rows. Validating
 * against only the first would refuse two of the three body cards this product
 * renders, which reads as a broken pill rather than as a narrow allowlist.
 */
export async function knownBodySubjectIds(forSubjectId?: string): Promise<Set<string>> {
  const { registry, divisionsById } = await registryLoaded();
  const out = new Set<string>(registry.bodies.map((b) => b.id));
  for (const ocdId of divisionsById.keys()) out.add(ocdId);
  // A registered body or division is known through its own state's registration (2026-09-23).
  if (forSubjectId !== undefined && !out.has(forSubjectId)) {
    for (const r of await registrationsFor([forSubjectId])) {
      for (const body of r.layer.bodies) out.add(body.id);
      for (const ocdId of r.divisionsById.keys()) out.add(ocdId);
    }
  }
  return out;
}

/** The divisions containing a point, from the committed geometry. */
export async function divisionsAt(lat: number, lng: number): Promise<Division[]> {
  const { features, divisionsById } = await registryLoaded();
  return resolveDivisionsAt([lng, lat], features, divisionsById);
}

/**
 * Divisions by OCD id, for a caller that has resolved an AREA rather than a
 * point. (NJ Hunt 3 item 3.1, 2026-08-22.)
 *
 * `NJ01` fixed the ballot page, which resolved a zip to its ZCTA centroid and
 * asked which divisions contain that ONE point. The map's **"Who governs
 * here"** card was the second instance of the same defect and it was still
 * live: production at 07866 read *"4 bodies govern the area around 07866"* and
 * listed Rockaway TOWNSHIP, with Rockaway BOROUGH — a separate municipality
 * inside the same zip, running a four-candidate council race — absent from a
 * card whose heading is the exact question it was getting wrong.
 *
 * The ballot's widening goes through `lib/ballot/zip-divisions.ts`, which
 * yields OCD ids. This turns those back into `Division` records so the coverage
 * summary can be built from the same area answer.
 *
 * **An id the registry does not hold is DROPPED, not invented.** The zip-area
 * index is built from TIGER polygons and the registry is built from its own
 * sources; the two are allowed to disagree, and a synthesised division would be
 * a government this product asserts exists on the strength of nothing.
 */
export async function divisionsByOcdIds(ocdIds: readonly string[]): Promise<Division[]> {
  const { divisionsById } = await registryLoaded();
  // An id the reviewed registry does not hold may be one its state registered (2026-09-23).
  const registered = await registrationsFor(ocdIds.filter((id) => !divisionsById.has(id)));
  const out: Division[] = [];
  for (const id of ocdIds) {
    const division = divisionsById.get(id) ?? registered.find((r) => r.divisionsById.has(id))?.divisionsById.get(id);
    if (division) out.push(division);
  }
  return out;
}

/**
 * One officeholder by roster id, in the render shape (4, 2026-08-19).
 * Serves the ballot page's incumbent-record link: the id arrives from an
 * exact-key join (never a name match), and an id the roster doesn't hold
 * returns null — no link rather than a wrong one.
 */
export async function seatHolderById(id: string): Promise<SeatHolder | null> {
  // The publisher namespace establishes the one permitted state authority
  // before any data-plane store is opened. A state identity never causes a
  // federal/registry read and can never fall through to the retired Plural
  // roster or a name join.
  const officialStateScope = officialStateVoteScopeForOfficeholderId(id);
  if (officialStateScope) {
    const held = await heldOfficialStateLegislators(officialStateScope);
    return held?.seats.find((holder) => holder.id === id) ?? null;
  }
  await registryLoaded();
  const rosterIdentity = currentRosterMemberReaderDisposition(id);
  if (rosterIdentity?.state === "IDENTITY_UNRESOLVED") return null;
  const canonicalId = rosterIdentity?.canonicalId ?? id;
  if (!canonicalId.startsWith("congress:")) {
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
 * officeholder id → partyLabel, across every loaded roster (item 3,
 * 2026-08-14 second session). Serves the party-breakdown join in
 * /api/votes — display data only; nothing downstream infers a position
 * from it.
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
 * Which chamber a federal member sits in (item 6b, 2026-08-15).
 *
 * Read off the roster's own `officeTitle`, which the congress-legislators
 * bulk file sets from the term's `type` — so it is the source's answer, not a
 * pattern match on a name. Null for anyone who is not a federal legislator,
 * and the key-votes column simply does not render for them: an entry is a
 * question each CHAMBER answered, and a mayor has no chamber.
 *
 * This exists so the chamber rule ("a House card shows House roll calls
 * only") has exactly one place it can be got wrong.
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
    // A canonical-store outage surfaces to the Reader; it never falls back to a tracked file.
    const held = await heldStateLegislatorsEdgeFirst(officialStateScope);
    if (held) {
      const ids = new Set(held.divisions.filter((row) => row.ocdId === ocdId).map((row) => row.officeholderId));
      return held.seats.filter((holder) => ids.has(holder.id)).sort((a, b) => a.name.localeCompare(b.name));
    }
    return [];
  }
  if (!federalDirectoryAppliesToDivision(ocdId)) {
    // Production's federal directory has no rows for local or state-legislative
    // divisions. Confirm the canonical registry pointer, then return its honest
    // no-federal-row result without letting a federal outage take that scope down.
    await registryLoaded();
    return [];
  }
  const { officials } = await loaded();
  /*
   * **The statewide executives, and ONLY on the state division itself.**
   * (2026-08-27, Red Control 1.)
   *
   * `STATEWIDE_EXECUTIVES` held Katie Hobbs — her office, party, official
   * phone, email, contact form and page — and only `lib/registry/coverage.ts`
   * read it. So her map card said Incumbent and the ballot, asking this
   * function, could not see her at all and called her a Challenger. Folding the
   * store in here is what stops one verified person having two answers; the
   * alternative, a ballot-specific incumbent table, is a second copy of an
   * already-sourced fact, and second copies are how surfaces come to disagree.
   *
   * The `=== stateOcdIdFrom(ocdId)` guard is not incidental. `statewideExecutivesFor`
   * takes the divisions covering a POINT and answers with the governor once,
   * which is right for the map card and wrong here: passing it `.../state:az/cd:6`
   * derives `state:az` and hands back the Governor, so she would have joined the
   * officeholder list of every congressional, legislative, county and place
   * division in Arizona. Caught by the seat census, which showed `cd:6` holding
   * two people where the roster holds one.
   */
  const statewide = stateOcdIdFrom(ocdId) === ocdId ? statewideExecutivesFor([ocdId]) : [];
  return [...holdersFor(officials, ocdId), ...statewide];
}

/**
 * `heldOfficialStateLegislators`, edge-first (C21, 2026-09-25): a request that
 * entered the reader edge reads a district's state legislators from the
 * state-legislators edge value, as the coverage card already does, so the
 * district battlecard (`/api/representation`) does not wake the database for
 * them. Without that scope on the edge it is the same database read as before.
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

  // Per-scope settlement is deliberate. No aggregate read can turn one
  // state's missing or unavailable pointer into another state's disposition.
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
 * **WHO HOLDS THIS EXACT OFFICE, ON THIS DIVISION.**
 * (2026-08-27, the coverage-truth session. Red Control 1.)
 *
 * `seatHoldersForDivision` answers *who holds something here*, and for a
 * division hosting one elected office those are the same question. **They are
 * not the same question anywhere else**, and the pilot ballots are full of
 * "anywhere else": seven statewide AZ offices share `.../state:az`, Governor
 * and U.S. Senator share `.../state:nh`, Mayor and Borough Council share
 * `.../place:butler`, five county row offices share `.../county:merrimack`.
 *
 * Asked for the AZ Governor contest, the division question returned **Mark
 * Kelly and Ruben Gallego**. Katie Hobbs matched neither, and the ballot
 * called the sitting Governor a Challenger while her own map card called her
 * Incumbent.
 *
 * So a ballot asks THIS, with the contest's own title. An office the vocabulary
 * cannot classify returns `[]`, which the resolver renders as UNKNOWN — never
 * as the division-wide list, and never as Challenger.
 *
 * **The statewide executives participate here rather than being duplicated.**
 * `STATEWIDE_EXECUTIVES` held Katie Hobbs, her office, her party, her official
 * phone, email, contact form and page all along; only `lib/registry/coverage.ts`
 * read it, so the map surface had her and the ballot surface could not see her.
 * Folding it into the officeholder lookup itself is what stops one verified
 * person having two different answers on two surfaces — the alternative, a
 * ballot-specific incumbent table, is a second copy of a fact that is already
 * sourced, and second copies are how surfaces come to disagree.
 */
export async function seatHoldersForOffice(
  ocdId: string,
  officeTitle: string,
): Promise<SeatHolder[]> {
  const office = officeIdentity(officeTitle);
  if (office === null) return [];
  if (office !== "us_senator" && office !== "us_representative"
    && /^ocd-division\/country:us\/state:[a-z]{2}$/.test(ocdId)) {
    await registryLoaded();
    return statewideExecutivesFor([ocdId]).filter((holder) => officeIdentity(holder.officeTitle) === office);
  }
  const holders = await seatHoldersForDivision(ocdId);
  return holders.filter((h) => officeIdentity(h.officeTitle) === office);
}

/**
 * Build the coverage graph (rosters, photos, officeholder indexes) for the
 * authority this request reads, so a later `coverageAt` finds it held (C21,
 * 2026-09-25). `/api/meetings` starts it beside its meetings read instead of
 * after it. Edge-aware like every read here: call it only after the handler
 * has entered the reader edge, or it settles the authority from the database.
 * A failure is not held; `coverageAt` then builds, and fails, on its own.
 */
export async function prepareCoverage(): Promise<void> {
  await loaded();
}

export async function coverageAt(
  lat: number,
  lng: number,
  meetingCount: number,
  /**
   * The divisions covering this same point, when the caller already has them
   * (AUD-04, 2026-08-18) — `/api/meetings` resolves them for its online-meeting
   * filter and used to pay for the identical sweep a second time here.
   *
   * MUST be the result of resolving THIS lat/lng and nothing else: handing in
   * another point's divisions would answer confidently about somewhere the
   * reader is not. Omitted, this resolves them itself as it always did, which
   * is also what a caller whose own resolution FAILED must do — passing an
   * empty set from a failed lookup would turn a retrieval failure into a
   * coverage answer of "nothing governs here", and a failed fetch may never be
   * written into the data as an absence.
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
  // The governments registered on these divisions' states, beside the reviewed bodies (2026-09-23).
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
