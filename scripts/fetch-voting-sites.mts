import { rememberStatePublicationPrior } from "../lib/civic-data/state-publication.ts";
/* @freshness-reads-here */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assignment } from "./cli-args.mts";
import { REFERENCE_DIR } from "../lib/reference/index.ts";
import { readRegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { requireBallotState } from "../lib/civic-data/state-scopes.ts";
import type { Division, Registry } from "../lib/registry/types.ts";
import { CENSUS_BENCHMARK, CENSUS_GEOCODER_URL, parseCensusPoint } from "../lib/geo/census-geocoder.ts";
import { OUTBOUND_USER_AGENT } from "../lib/geo/outbound-agent.ts";
import { votingSitesCandidate, votingSitesContract, type VotingRawCapture } from "../lib/ballot/voting-sites-data-plane.ts";
import { heldVotingSiteCoordinates, votingSiteAddressKey, type VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { recordSourceObservation } from "../lib/doors/source-capture.ts";
import { cycleVault, VAULT_DIR, type CycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { pageAddress } from "../lib/doors/page-doors.ts";
import { discoverVotingDoors } from "../lib/ballot/voting-source-discovery.ts";
import { mergeVotingSourceRead, recordVotingSourceRead, registeredVotingSourceDoors, replaceVotingJurisdiction,
  saveVotingSourceDoor, holdVotingRawEvidence, combineVotingSourceReads } from "../lib/ballot/voting-source-publication.ts";
import { persistVotingSourceBlanks, planVotingSourceBlanks, votingSourcePlaces } from "../lib/ballot/voting-source-blanks.ts";
import { votingSourcePopulations } from "../lib/ballot/voting-source-population.ts";
import type { VotingDoorScope, VotingSourceDoor, VotingSourceRead, VotingSourceRuntime } from "../lib/ballot/voting-source-types.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { isOfficialVotingSource, openLinkingCopy } from "../lib/facts/linking-copy.ts";
import { routineReceiptFields, type RoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { workerPublicationContext } from "../lib/civic-data/worker-publication-context.ts";
import { publishWorkerReaderResults } from "../lib/civic-data/worker-reader-publication.ts";
import { printWorkerPublicationReceipt } from "../lib/civic-data/worker-publication-tasks.ts";
import { recordVotingFailure } from "../lib/ballot/voting-errors.ts";
import { votingBoundaryBlanks } from "../lib/ballot/voting-source-boundaries.ts";
import { sourceTextWithoutNuls } from "../lib/doors/source-text.ts";
import { votingSourceReadOrder } from "../lib/ballot/voting-source-publication.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS, ROUTINE_SOURCE_SETTLEMENT_BUDGET_MS } from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { readCountyCivicCoverage } from "../lib/sources/google-civic/coverage.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { confirmSourceHashUnchanged, sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { votingSourceContentHash, votingSourceHashKey, votingSourceManifest, votingSourceManifestHash, votingSourceReadComplete } from "../lib/ballot/voting-source-hash.ts";
// Registers the saved-source replacement verifier this job's promotions need (see voting-source-replacement-contract.ts).
import "../lib/ballot/voting-source-replacement.ts";

const statewide = (door: VotingSourceDoor) => /\/(?:state|district|territory):[a-z]{2}$/.test(door.scope.ocdId);
const officeWords = /\b(?:elections?|voter registration|registrar of voters)\b/i;
const localTypes = new Set(["county", "cousub", "place"]);
const normalizeUrl = (value: string): string => { try { const url = new URL(value); url.hash = ""; return url.href.replace(/\/$/, ""); } catch { return value; } };
const localName = (value: string): string => value.toLowerCase().replace(/\b(?:polling locations?|election day polling places?|board of elections?|elections? office|supervisor of elections?|registrar of voters|town clerk)\b/g, "")
  .replace(/\b(?:county|township|town|city|borough|village|municipality|of)\b/g, "").replace(/[^a-z0-9]/g, "");
const typedPlaceName = (value: string): string => value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]/g, "");

/** Leave the standing child's existing settlement budget for durable writes. */
export function votingAcquisitionDeadline(startedAt: number, slotEndsAt = passDeadlineFromEnv()): number {
  const remaining = slotEndsAt - startedAt;
  const settlement = Math.min(ROUTINE_SOURCE_SETTLEMENT_BUDGET_MS, Math.max(0, remaining / 3));
  return Math.min(startedAt + ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS, slotEndsAt - settlement);
}

/** A newly verified parser/route replaces an older saved bootstrap mapping. */
export function currentVotingSourceDoors(seeds: readonly VotingSourceDoor[], saved: readonly VotingSourceDoor[]): VotingSourceDoor[] {
  const doors = new Map(saved.map(door => [door.id, door]));
  for (const seed of seeds) {
    const prior = doors.get(seed.id);
    if (!prior || (Date.parse(seed.access?.checkedAt ?? "") || 0) > (Date.parse(prior.access?.checkedAt ?? "") || 0)) doors.set(seed.id, seed);
  }
  return [...doors.values()];
}

/** FEC roots carry their directory provenance; that does not make them child pages. */
export function votingChiefRoots(doors: readonly VotingSourceDoor[]): VotingSourceDoor[] {
  return doors.filter(door => statewide(door) &&
    (/(?:^|\/)fec_state_election_offices\.csv$/.test(door.discoveredFrom ?? "") ||
      normalizeUrl(door.discoveredFrom ?? "") === "https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices" ||
      !door.discoveredFrom && !door.covers.length));
}

/** An older file remains a fallback until the replacement has actually reached the holding. */
export function votingSupersededSources(doors: readonly VotingSourceDoor[], held: VotingSitesFile | null): Set<string> {
  const urls = new Set<string>();
  for (const door of doors) {
    if (!door.supersedes?.length) continue;
    const current = held?.jurisdictions.find(jurisdiction => jurisdiction.ocdId === door.scope.ocdId);
    const group = new Set(doors.filter(other => other.scope.ocdId === door.scope.ocdId && normalizeUrl(other.url) === normalizeUrl(door.url)).map(other => other.id));
    if (current?.blanks?.some(blank => group.has(blank.doorId) && ["access", "extraction", "missing-sites"].includes(blank.reason))) continue;
    if (current?.sites.some(site => site.electionDate === door.electionDate && site.sources?.some(source => normalizeUrl(source.url) === normalizeUrl(door.url)))) {
      for (const url of door.supersedes) urls.add(normalizeUrl(url));
    }
  }
  return urls;
}

function divisionScope(division: Division, divisions: readonly Division[]): VotingDoorScope {
  let countyFips = division.divisionType === "county" && division.geoid?.length === 5 ? division.geoid
    : localTypes.has(division.divisionType) && division.geoid?.length === 10 ? division.geoid.slice(0, 5) : undefined;
  let parentId = division.parentOcdId;
  const visited = new Set<string>();
  while (!countyFips && parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = divisions.find(row => row.ocdId === parentId); if (!parent) break;
    if (parent.divisionType === "county" && parent.geoid?.length === 5) countyFips = parent.geoid;
    parentId = parent.parentOcdId;
  }
  return { state: division.state, ocdId: division.ocdId, name: division.label,
    ...(countyFips ? { countyFips } : {}),
    ...(localTypes.has(division.divisionType) && division.geoid?.length === 10 ? { countySubdivisionGeoid: division.geoid } : {}) };
}

/** Exact registered identity, constrained by the directory's containing county; no fuzzy place guessing. */
export function votingScopeResolvers(registry: Pick<Registry, "divisions" | "bodies">): Pick<VotingSourceRuntime, "resolveScope" | "resolveCountyFips" | "resolveAiannhGeoid"> {
  return {
    resolveAiannhGeoid: (nation, reservation, state) => {
      const areaName = (value: string) => value.toLowerCase().replace(/\b(?:american indian|indian|reservation|off[ -]reservation|trust lands?|tribes?|tribal|nation)\b/g, "").replace(/[^a-z0-9]/g, "");
      const names = new Set([nation, reservation].map(areaName).filter(Boolean));
      const areas = registry.divisions.filter(division => division.state === state &&
        (division.divisionType === "aiannh" || /\/aiannh:\d+$/.test(division.ocdId)) && division.geoid &&
        (names.has(areaName(division.label)) || registry.bodies.some(body => body.ocdId === division.ocdId && body.name && names.has(areaName(body.name)))));
      const codes = new Set(areas.map(area => area.geoid!));
      return codes.size === 1 ? [...codes][0]! : null;
    },
    resolveCountyFips: (name, state) => {
      const counties = registry.divisions.filter(division => division.state === state && division.divisionType === "county" && division.geoid?.length === 5);
      const exact = counties.filter(division => division.geoid === name || typedPlaceName(division.label) === typedPlaceName(name));
      if (exact.length === 1) return exact[0]!.geoid;
      const candidates = counties.filter(division => localName(division.label.replace(/&/g, " and ")) === localName(name.replace(/&/g, " and ")));
      return candidates.length === 1 ? candidates[0]!.geoid : null;
    },
    resolveScope: (label, url, parent) => {
      const divisions = registry.divisions.filter(division => division.state === parent.state && localTypes.has(division.divisionType) &&
        (!parent.countyFips || divisionScope(division, registry.divisions).countyFips === parent.countyFips));
      const direct = registry.bodies.filter(body => body.homepageUrl && normalizeUrl(body.homepageUrl) === normalizeUrl(url) && body.ocdId &&
        (!localName(label) || /^(?:official\s+)?(?:web\s*site|visit website|view|elections?)$/i.test(label.trim()) ||
          (body.name && localName(body.name) === localName(label)) || divisions.some(division => division.ocdId === body.ocdId && localName(division.label) === localName(label))));
      const directIds = new Set(direct.map(body => body.ocdId));
      let candidates = divisions.filter(division => directIds.has(division.ocdId));
      if (!candidates.length) {
        const exact = /\b(?:county|city|town|township|borough|village)\b/i.test(label)
          ? divisions.filter(division => typedPlaceName(division.label) === typedPlaceName(label)) : [];
        candidates = exact.length ? exact : divisions.filter(division => localName(division.label) === localName(label) &&
          (!/\bcounty\b/i.test(label) || division.divisionType === "county") &&
          (!/\b(?:township|town|city|borough|village)\b/i.test(label) || division.divisionType !== "county"));
        const unit = /\b(township|town|city|borough|village)\b/i.exec(label)?.[1];
        if (unit && candidates.length > 1) {
          const qualified = candidates.filter(division => new RegExp(`\\b${unit}\\b`, "i").test(division.label));
          if (qualified.length) candidates = qualified;
        }
        // The Census county subdivision is the publisher's town unit. A same-named place is its map alias only
        // when the state/containing county admits a single subdivision with that exact normalized name.
        const subdivisions = candidates.filter(division => division.geoid?.length === 10);
        if (subdivisions.length === 1 && candidates.every(division => division.divisionType === "cousub" || division.divisionType === "place")) candidates = subdivisions;
      }
      return candidates.length === 1 ? divisionScope(candidates[0]!, registry.divisions) : null;
    },
  };
}

/** Only a sourced office name establishes that a registered body is an election office. */
function registeredElectionOfficeDoors(root: VotingSourceDoor, registry: Pick<Registry, "divisions" | "bodies">): VotingSourceDoor[] {
  return registry.bodies.flatMap(body => {
    if (!body.name || !officeWords.test(body.name) || !body.homepageUrl || !body.ocdId) return [];
    const division = registry.divisions.find(row => row.ocdId === body.ocdId && row.state === root.scope.state && localTypes.has(row.divisionType));
    if (!division || !/^https?:\/\//.test(body.homepageUrl)) return [];
    return [{ id: `voting-office-${createHash("sha256").update(body.id).digest("hex").slice(0, 20)}`,
      publisher: body.name, url: body.homepageUrl, shape: "list-page" as const, covers: [],
      scope: divisionScope(division, registry.divisions), electionDate: root.electionDate,
      electionPageUrl: body.homepageUrl, discoveredFrom: body.provenance.sourceUrl ?? `registry:${body.id}`,
      office: { name: body.name, url: body.homepageUrl, ...(body.officePhone ? { phone: body.officePhone } : {}),
        ...(body.officeAddress ? { address: body.officeAddress } : {}) } }];
  });
}

/** A publication retains its own read and official linking chain, never unrelated statewide captures. */
export async function votingSourceEvidence(door: VotingSourceDoor, read: VotingSourceRead, captures: VotingSourceRead["rawBodies"] = []): Promise<VotingRawCapture[]> {
  const bodyKey = (body: VotingSourceRead["rawBodies"][number]) => `${body.url}#${createHash("sha256").update(body.bytes).digest("hex")}`;
  const bodies = new Map(read.rawBodies.map(body => [bodyKey(body), body]));
  const links = new Set<string>();
  for (let page = door.linkingPage; page; page = page.linkingPage ?? undefined) {
    links.add(page.url);
    // A linking page that redirected is already held under its final address.
    if (![...bodies.values()].some(body => body.url === page.url || body.requestedUrl === page.url)) {
      const body = { url: page.url, contentType: "text/html", bytes: new TextEncoder().encode((await openLinkingCopy(page)).html) };
      bodies.set(bodyKey(body), body);
    }
  }
  const linked = (body: VotingSourceRead["rawBodies"][number]) => links.has(body.url) || Boolean(body.requestedUrl && links.has(body.requestedUrl));
  for (const capture of captures) if (linked(capture) || capture.url === door.url || capture.requestedUrl === door.url) bodies.set(bodyKey(capture), capture);
  // A linking page held on an older saved door may still print its key; every copy is cleaned as it is saved.
  const saved = await holdVotingRawEvidence({ rawBodies: [...bodies.values()] }, read.sources[0]?.checkedAt ?? new Date().toISOString());
  return [...new Map(saved.map(body => [`${body.url}#${body.rawHash}`, body])).values()];
}

/** Register an address-only route from its fresh official link without querying it for a voter. */
async function votingLookupDiscoveryRead(door: VotingSourceDoor, read: VotingSourceRead, captures: VotingSourceRead["rawBodies"], at: string): Promise<VotingSourceRead> {
  if (door.shape !== "address-lookup" || door.scopeUnresolved || door.access?.status === "identity-locked" ||
      !door.linkingPage || !await isOfficialVotingSource(door.url, door.linkingPage)) return read;
  const linking = captures.filter(capture => capture.url === door.linkingPage!.url);
  if (!linking.length) return read;
  return { ...read, rawBodies: [...read.rawBodies, ...linking],
    sources: [{ publisher: door.publisher, url: door.linkingPage.url, checkedAt: at }],
    attempts: [...read.attempts, { url: door.linkingPage.url, route: "direct",
      outcome: "Official page linked the address-only lookup; no voter address was submitted" }] };
}

function isVotingSourceContent(body: { url: string }): boolean {
  const sourceUrl = new URL(body.url);
  return !sourceUrl.pathname.endsWith("/robots.txt");
}

export async function votingReadHasFacts(door: VotingSourceDoor, read: VotingSourceRead): Promise<boolean> {
  if (!await isOfficialVotingSource(door.url, door.linkingPage)) return false;
  if (!read.rawBodies.some(isVotingSourceContent)) return false;
  if (read.sites.length || read.boundaries?.length || read.contacts?.length) return true;
  if (!read.sources.length || read.blanks.some(blank => blank.reason === "access" || blank.reason === "extraction")) return false;
  return Boolean(read.office || read.rules.length || read.publicationMessage || door.publication || door.shape === "address-lookup");
}

export async function refreshVotingSources(input: {
  state: string;
  store: RoutineDataStore;
  context: Pick<Awaited<ReturnType<typeof workerPublicationContext>>, "repos">;
  now?: () => string;
  deadlineMs?: number;
  fetch?: typeof fetch;
  geocode?: VotingSourceRuntime["geocode"];
  registration?: Awaited<ReturnType<typeof readRegistrationProjection>>;
  registry?: Pick<Registry, "divisions" | "bodies">;
  vault?: CycleVault;
  seeds?: VotingSourceDoor[];
}): Promise<{ terminal: RoutineRunnerReceipt | null; publications: number; confirmedSources: number; attemptedSourceIds: string[] }> {
  const state = requireBallotState(input.state), contract = votingSitesContract(state);
  const { store, context } = input;
  const now = input.now ?? (() => new Date().toISOString());
  const fetchSource = input.fetch ?? fetch;
  const deadlineMs = input.deadlineMs ?? votingAcquisitionDeadline(Date.now());
  const seeds = (input.seeds ?? ["voting-source-doors.json", "voting-legacy-doors.json"].flatMap(name =>
    JSON.parse(readFileSync(join(REFERENCE_DIR, name), "utf8")) as VotingSourceDoor[])).filter(door => door.scope.state === state);
  const election = JSON.parse(readFileSync(join(REFERENCE_DIR, "voting-election.json"), "utf8")) as { electionDate: string };
  let terminal: RoutineRunnerReceipt | null = null, publications = 0;
  const checkedHashes = new Map<string, string>();
  const checkedAt = new Map<string, string>();
  let confirmedSources = 0;
  let successfulSourceReads = 0;
  let latestSourceRead: { requestedUrl: string; finalUrl: string; at: string } | null = null;
  const attemptedSourceIds: string[] = [];
  try {
    // This manifest is a few hashes, never the held sites or their candidate/event bodies.
    const fields = await store.readPromotionPayloadFields(contract.recordClass, contract.scope, ["sourceHashes", "sourceManifestVersion", "supersededSources"]);
    const initialHead = await store.readSourceHead(contract.recordClass, contract.scope);
    if (initialHead && initialHead.sourceId !== contract.sourceId) throw new Error("Voting-source holding names a different publisher.");
    let sourceHashes: Record<string, string | null> = fields?.sourceHashes && typeof fields.sourceHashes === "object" && !Array.isArray(fields.sourceHashes)
      ? Object.fromEntries(Object.entries(fields.sourceHashes).filter((row): row is [string, string | null] => row[1] === null || typeof row[1] === "string" && /^[a-f0-9]{64}$/.test(row[1]))) : {};
    let held: VotingSitesFile | null = null, heldLoaded = false, version: string | null = initialHead?.versionId ?? null;
    let publishedMappings: readonly VotingSourceDoor[] = [];
    const loadHeld = async () => {
      if (heldLoaded) return;
      const prior = await readPromotedCivicData<VotingSitesFile>(contract.recordClass, contract.scope, { store });
      if (prior.kind !== "PROMOTED" && prior.kind !== "NOT_RECORDED") throw new Error("Voting-source holding is unavailable; preserve its last verified facts.");
      if (prior.kind === "PROMOTED" && prior.metadata.sourceId !== contract.sourceId) throw new Error("Voting-source holding names a different publisher.");
      if (prior.kind === "PROMOTED") rememberStatePublicationPrior(store, prior.projection);
      held = prior.kind === "PROMOTED" ? prior.value : null;
      version = prior.kind === "PROMOTED" ? prior.metadata.versionId : null;
      sourceHashes = votingSourceManifest(held, publishedMappings);
      heldLoaded = true;
    };
    const registration = input.registration ?? await readRegistrationProjection(state, { store });
    const savedDoors = await registeredVotingSourceDoors(context.repos.doors, state);
    const registered = await votingSourceReadOrder(context.repos.doors, state,
      currentVotingSourceDoors(seeds, savedDoors));
    const vault = input.vault ?? cycleVault(join(process.cwd(), ...VAULT_DIR));
    {
      const registeredDivisions = registration.kind === "PROMOTED" ? registration.value.divisions : [];
      const reviewed = input.registry ? null : await readRegistryRuntimePrior(store, now(), state);
      const divisions = [...new Map([...registeredDivisions, ...(input.registry?.divisions ?? reviewed?.payload.registry.divisions ?? [])].map(row => [row.ocdId, row])).values()];
      const bodies = [...new Map([...(registration.kind === "PROMOTED" ? registration.value.bodies : []),
        ...(input.registry?.bodies ?? reviewed?.payload.registry.bodies ?? [])].map(row => [row.id, row])).values()];
      const localRegistry = { divisions, bodies };
      const sourceContextHash = canonicalCivicDataHash({ parserVersion: contract.parserVersion,
        divisions: divisions.map(({ ocdId, divisionType, label, state, geoid, parentOcdId }) => ({ ocdId, divisionType, label, state, geoid, parentOcdId }))
          .sort((a, b) => a.ocdId.localeCompare(b.ocdId)),
        bodies: bodies.map(({ id, ocdId, name, homepageUrl }) => ({ id, ocdId, name, homepageUrl })).sort((a, b) => a.id.localeCompare(b.id)),
      });
      const stateDoors = registered.filter(door => door.scope.state === state);
      publishedMappings = stateDoors;
      const roots = votingChiefRoots(stateDoors);
      // The first run of an older package has no source hashes to compare yet.
      if (fields?.sourceManifestVersion !== 1) await loadHeld();
      const superseded = new Set<string>(Array.isArray(fields?.supersededSources) ? fields.supersededSources.filter((url): url is string => typeof url === "string") : []);
      if (heldLoaded) for (const url of votingSupersededSources(stateDoors, held)) superseded.add(url);
      const doors = new Map<string, VotingSourceDoor>();
      const reads = new Map<string, VotingSourceRead>(), walked = new Set<string>();
      const evidenceSources = new Map<string, VotingSourceDoor>();
      const observations = new Map<string, "DOOR" | "EVIDENCE" | "SKIP">();
      const geocodes = new Map<string, { lat: number; lng: number } | null>(heldVotingSiteCoordinates(held));
      let unmatchedSourceReads = false;
      let callbackFailure: unknown;
      const runtime: VotingSourceRuntime = {
        fetch: fetchSource, now, deadlineMs, captureCache: new Map(), discoverySeen: new Set(), ...votingScopeResolvers(localRegistry),
        browserFetch: (url, init) => fetchSource(url, { ...init, headers: { ...init?.headers,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" } }),
      };
      // Location lists publish before optional coordinate enrichment. Thousands
      // of serial Census calls must not occupy the source task's entire slot.
      const geocode = input.geocode ?? (async (address: string) => {
          const key = votingSiteAddressKey(address);
          if (geocodes.has(key)) return geocodes.get(key)!;
          const url = new URL(CENSUS_GEOCODER_URL);
          url.searchParams.set("address", address); url.searchParams.set("benchmark", CENSUS_BENCHMARK); url.searchParams.set("format", "json");
          let point = null;
          try { const response = await fetchSource(url, { headers: { "user-agent": OUTBOUND_USER_AGENT }, signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadlineMs - Date.now()))) });
            if (!response.ok) throw new Error(`Census site geocoder returned HTTP ${response.status}`);
            point = parseCensusPoint(await response.json());
            if (!point) recordVotingFailure({ stage: "site-geocode", state }, new Error("Census returned no unique site point"));
          } catch (error) { recordVotingFailure({ stage: "site-geocode", state }, error); }
          geocodes.set(key, point); return point;
      });
      const publishedReads = new Map<string, { door: VotingSourceDoor; read: VotingSourceRead; acquisition: VotingRawCapture[]; mappings: VotingSourceDoor[] }>();
      const sourceCheck = async (door: VotingSourceDoor, read: VotingSourceRead, rawHash: string, at: string) => {
        if (!store.recordSourceCheck || !version || !votingSourceReadComplete(read)) return;
        const check = { sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
          pointerVersionId: version, sourceKey: votingSourceHashKey(door), rawHash, parserVersion: contract.parserVersion, checkedAt: at,
          sourceUrls: [...new Set([door.url, ...read.sources.map(source => source.url), ...read.rawBodies.filter(isVotingSourceContent).map(body => body.url)])].sort(),
          jurisdictionIds: [...new Set([door.scope.ocdId, ...(read.contacts ?? []).map(contact => contact.scope.ocdId)])].sort() };
        try {
          if (await store.recordSourceCheck(check)) return;
          const current = await store.readSourceHead(contract.recordClass, contract.scope);
          if (current?.sourceId === contract.sourceId && await store.recordSourceCheck({ ...check, pointerVersionId: current.versionId })) return;
          recordVotingFailure({ stage: "source-check", state }, new Error(`The published source changed while ${door.url} was checked; its earlier check is retained.`));
        } catch (error) { recordVotingFailure({ stage: "source-check", state }, error); }
      };
      const publishRead = async (door: VotingSourceDoor, read: VotingSourceRead, acquisition: VotingRawCapture[], at: string, mappings: VotingSourceDoor[]) => {
        await loadHeld();
        for (const [key, point] of heldVotingSiteCoordinates(held)) if (!geocodes.has(key)) geocodes.set(key, point);
        let before = held;
        const jurisdiction = mergeVotingSourceRead(held?.jurisdictions.find(row => row.ocdId === door.scope.ocdId), door, read, at);
        let current = replaceVotingJurisdiction(held, jurisdiction, at);
        // A statewide clerk directory contributes each office to its registered county or town.
        for (const contact of read.contacts ?? []) {
          if (contact.scope.state !== state) throw new Error("Voting contact crossed its state publication scope.");
          const contactDoor = { ...door, scope: contact.scope, model: undefined, matchingUnit: undefined,
            publication: undefined, rules: undefined, boundaries: undefined };
          const contactRead = { ...read, sites: [], rules: [], office: contact.office, sources: [contact.source],
            blanks: read.blanks.filter(blank => blank.scope.ocdId === contact.scope.ocdId) };
          const local = mergeVotingSourceRead(current.jurisdictions.find(row => row.ocdId === contact.scope.ocdId), contactDoor, contactRead, at);
          current = replaceVotingJurisdiction(current, local, at);
        }
        const observed = read.rawBodies.filter(isVotingSourceContent);
        const key = votingSourceHashKey(door);
        const supersededSources = [...votingSupersededSources(stateDoors, current)].sort();
        const replaced = new Set(supersededSources);
        const nextHashes = Object.fromEntries(Object.entries({ ...sourceHashes,
          [key]: votingSourceReadComplete(read) ? votingSourceContentHash(mappings, read, sourceContextHash) : null,
        }).filter(([source]) => !replaced.has(normalizeUrl(source.slice(source.indexOf("|") + 1)))));
        current = { ...current, sourceHashes: nextHashes, sourceManifestVersion: 1, supersededSources };
        const candidate = votingSitesCandidate({ state, current, prior: before, failures: [], acquisition,
          successfulAuthorityReads: observed.length, requestedUrl: door.url, finalUrl: observed.at(-1)?.url ?? door.url,
          retrievedAt: at, carriedFromVersionId: version,
          sourceReplacementDoors: !read.blanks.some(blank => ["access", "extraction", "missing-sites"].includes(blank.reason)) ? mappings : undefined });
        before = null; held = null;
        const outcome = await processRegisteredManualCandidate(store, contract.id, candidate, at, version);
        if (outcome.promoted) {
          held = outcome.promoted.payload as VotingSitesFile; version = outcome.promoted.versionId;
          sourceHashes = { ...(held.sourceHashes ?? {}) };
          if (typeof sourceHashes[key] === "string") { checkedHashes.set(key, sourceHashes[key]); checkedAt.set(key, at); }
          rememberStatePublicationPrior(store, outcome.promoted);
          for (const url of votingSupersededSources(stateDoors, held)) superseded.add(url);
          terminal = { source: contract.id, ...routineReceiptFields(candidate, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS }; publications++;
        } else {
          if (!terminal) terminal = { source: contract.id, ...routineReceiptFields(candidate, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS };
          const retained = await readPromotedCivicData<VotingSitesFile>(contract.recordClass, contract.scope, { store, now: at });
          if (retained.kind !== "PROMOTED" && retained.kind !== "NOT_RECORDED") throw new Error("Voting-source holding is unavailable after a held update.");
          if (retained.kind === "PROMOTED") {
            rememberStatePublicationPrior(store, retained.projection);
            held = retained.value; version = retained.metadata.versionId;
          }
          console.error(`${door.publisher}: voting-source publication held as ${outcome.candidate.state}; prior facts retained.`);
        }
        return Boolean(outcome.promoted);
      };
      const acquire = async (door: VotingSourceDoor, captures: VotingSourceRead["rawBodies"] = [], persistent = true) => {
        if (Date.now() >= deadlineMs) return;
        if (door.scope.state !== state) throw new Error("Voting source crossed its state publication scope.");
        if (superseded.has(normalizeUrl(door.url))) return;
        if (reads.has(door.id)) return;
        attemptedSourceIds.push(door.id);
        const at = now();
        const mappings = [door, ...stateDoors.filter(other => other.id !== door.id && other.scope.ocdId === door.scope.ocdId &&
          pageAddress(other.url)?.url === pageAddress(door.url)?.url)];
        const group: VotingSourceRead[] = [];
        for (const mapping of mappings) {
          if (Date.now() >= deadlineMs) break;
          let read = sourceTextWithoutNuls(await votingLookupDiscoveryRead(mapping, await readVotingSource(mapping, runtime), captures, at));
          if (!await isOfficialVotingSource(mapping.url, mapping.linkingPage)) read = { ...read,
            sites: [], contacts: [], boundaries: [], rules: [], sources: [], office: undefined,
            blanks: [...read.blanks, { id: `${mapping.id}:official-link`, doorId: mapping.id, scope: mapping.scope,
              reason: "access", status: "open", owed: "An official election-office page linking this source",
              tried: [mapping.url], next: [mapping.electionPageUrl] }] };
          reads.set(mapping.id, read); group.push(read);
        }
        if (!group.length) return;
        const read = combineVotingSourceReads(group);
        const publicationDoor = { ...door, supersedes: [...new Set(mappings.flatMap(mapping => mapping.supersedes ?? []))] };
        if (group.length < mappings.length) read.blanks.push({ id: `${door.id}:slot-ended`, doorId: door.id, scope: door.scope,
          reason: "access", status: "open", owed: "The remaining sections of this official source",
          tried: [door.url, "The acquisition slot ended before every configured section was read"], next: [door.url] });
        if (["file", "json", "map-service"].includes(door.shape)) {
          // These captures have no HTML links to discover. Rewalking them
          // repeats PDF extraction/OCR before discovery can see the held read.
          runtime.discoverySeen?.add(pageAddress(door.url)!.url);
          walked.add(pageAddress(door.url)!.url);
        }
        console.info(JSON.stringify({ event: "voting_source_read", state, source: door.url, at,
          sites: read.sites.length, precincts: read.boundaries?.length ?? 0,
          sourceBytes: read.rawBodies.reduce((sum, capture) => sum + capture.bytes.byteLength, 0),
          failures: read.blanks.filter(blank => blank.reason === "access" || blank.reason === "extraction").map(blank => ({ reason: blank.reason, detail: blank.tried })) }));
        if (!await votingReadHasFacts(door, read)) {
          unmatchedSourceReads = true;
          if (persistent && (read.rawBodies.length || read.blanks.length)) await recordVotingSourceRead(context.repos.doors, door, read, at);
          return;
        }
        if (persistent) await recordVotingSourceRead(context.repos.doors, door, read, at);
        const hashKey = votingSourceHashKey(door), contentHash = votingSourceContentHash(mappings, read, sourceContextHash);
        latestSourceRead = { requestedUrl: door.url, finalUrl: read.rawBodies.filter(isVotingSourceContent).at(-1)?.url ?? door.url, at };
        successfulSourceReads++;
        if (votingSourceReadComplete(read) && sourceHashes[hashKey] === contentHash) {
          checkedHashes.set(hashKey, contentHash); checkedAt.set(hashKey, at); confirmedSources++;
          await sourceCheck(publicationDoor, read, contentHash, at);
          console.info(JSON.stringify({ event: "voting_source_read", state, source: door.url, at, result: "CONFIRMED_UNCHANGED" }));
          return;
        }
        unmatchedSourceReads = true;
        const acquisition = await votingSourceEvidence(door, read, captures);
        if (await publishRead(publicationDoor, read, acquisition, at, mappings)) {
          publishedReads.set(door.id, { door: publicationDoor, read, acquisition, mappings });
          await sourceCheck(publicationDoor, read, contentHash, at);
        }
      };
      runtime.onDiscoveredDoor = async (found, captures) => {
        if (callbackFailure) throw callbackFailure;
        try {
          // One file can have several registered county/town mappings; preserve and read each of them.
          const sameSource = stateDoors.filter(door => pageAddress(door.url)?.url === pageAddress(found.url)?.url);
          const targets = sameSource.length ? sameSource : [found];
          for (const existing of targets) {
            if (superseded.has(normalizeUrl(existing.url))) continue;
            const door = existing === found ? found : { ...found, ...existing,
              linkingPage: found.linkingPage ?? existing.linkingPage,
              electionPageUrl: found.electionAssociationVerified ? found.electionPageUrl : existing.electionPageUrl,
              electionAssociationVerified: found.electionAssociationVerified || existing.electionAssociationVerified };
            doors.set(door.id, door); await saveVotingSourceDoor(context.repos.doors, door, now());
            await acquire(door, captures);
          }
        } catch (error) { callbackFailure = error; throw error; }
      };
      runtime.onDiscoveredSource = async ({ source, disposition, capture, linkingCaptures }) => {
        const url = pageAddress(source.url)!.url;
        if (superseded.has(normalizeUrl(url))) {
          await recordSourceObservation(context.repos, { url, ocdId: source.scope.ocdId, state,
            names: [source.scope.name, source.publisher], capture, disposition: {
              kind: "SKIP", family: "voting", recordClass: "VOTING_SITE", belongs: true, quote: "",
              reason: "An official current-election file has replaced this older list and is already published",
            } }, now(), vault);
          observations.set(url, "SKIP");
          return;
        }
        await recordSourceObservation(context.repos, { url, ocdId: source.scope.ocdId, state,
          names: [source.scope.name, source.publisher], disposition, capture }, now(), vault);
        observations.set(url, disposition.kind);
        if (disposition.kind === "EVIDENCE" && disposition.family === "voting") {
          const configured = stateDoors.filter(known => pageAddress(known.url)?.url === url);
          for (const target of configured.length ? configured : [source]) {
            evidenceSources.set(target.id, target);
            await acquire(target, [...linkingCaptures, ...(capture ? [capture] : [])], false);
          }
        }
        if (capture && disposition.kind !== "DOOR") {
          for (const old of stateDoors.filter(old => pageAddress(old.url)?.url === url)) doors.delete(old.id);

        }
      };
      const walk = async (root: VotingSourceDoor) => {
        if (Date.now() >= deadlineMs) return;
        if (superseded.has(normalizeUrl(root.url))) return;
        const key = pageAddress(root.url)!.url;
        if (walked.has(key)) return;
        const discovery = await discoverVotingDoors(root, runtime);
        if (callbackFailure) throw callbackFailure;
        for (const found of discovery.sources) walked.add(pageAddress(found.source.url)!.url);
      };
      // Every configured list goes first, including HTML/vendor lists. A chief
      // office's recursive discovery must not keep a known county list waiting.
      for (const source of stateDoors.filter(door =>
        door.covers.some(kind => kind !== "CANDIDATE_LIST" && kind !== "BALLOT_MEASURES") || door.boundaryLayer || door.rules?.length || door.publication ||
        door.shape === "county-directory" && Boolean(door.extraction?.columns?.officeAddress))) {
        if (Date.now() >= deadlineMs) break;
        if (superseded.has(normalizeUrl(source.url))) continue;
        doors.set(source.id, source);
        await saveVotingSourceDoor(context.repos.doors, source, now());
        await acquire(source);
      }
      for (const root of roots) await walk(root);
      const root = roots[0];
      if (root) for (const office of registeredElectionOfficeDoors(root, localRegistry)) {
        if ([...doors.values()].some(door => door.url === office.url && door.scope.ocdId === office.scope.ocdId)) continue;
        await walk(office);
      }
      // Every registered local office/directory is walked, including routes held before this run.
      for (const source of stateDoors) await walk(source);
      // Enrich already published rows only after every known list has had its turn.
      // The same captured evidence supplies the points; no source is downloaded or parsed twice.
      for (const { door, read, acquisition, mappings } of publishedReads.values()) {
        let changed = false;
        const missing = read.sites.filter(site => site.lat === null || site.lng === null);
        for (let at = 0; at < missing.length && Date.now() < deadlineMs; at += 8) {
          await Promise.all(missing.slice(at, at + 8).map(async site => {
            const point = await geocode(site.address);
            if (point) { site.lat = point.lat; site.lng = point.lng; site.geocodeSource = "CENSUS"; changed = true; }
          }));
        }
        if (changed) await publishRead(door, read, acquisition, now(), mappings);
      }
      const scope = root?.scope ?? stateDoors[0]?.scope;
      if (!scope) throw new Error(`No registered voting source for ${state}.`);
      // Unchanged sources keep their existing open work. A changed or failed read replans from the preserved state.
      if (heldLoaded || unmatchedSourceReads) {
      await loadHeld();
      const delegation = stateDoors.find(door => door.delegation)?.delegation ?? "county";
      const coverage = await readCountyCivicCoverage(store, state, election.electionDate);
      const populations = await votingSourcePopulations({ state, bodies, divisions, coverage });
      const places = votingSourcePlaces({ state: scope, divisions, delegation, populations, coverage });
      const sourceDoors = [...doors.values(), ...evidenceSources.values()];
      const jurisdictions = held?.jurisdictions.filter(jurisdiction => jurisdiction.state === state) ?? [];
      const blanks = [...planVotingSourceBlanks({ electionDate: election.electionDate, places, doors: sourceDoors, reads: [...reads.values()], jurisdictions, coverage }),
        ...votingBoundaryBlanks(places, jurisdictions, sourceDoors)];
      await persistVotingSourceBlanks({ repos: context.repos, blanks, electionDate: election.electionDate, now: now(), coverage });
      console.log(`${state}: ${[...observations.values()].filter(kind => kind === "DOOR").length} publishing doors, ${[...observations.values()].filter(kind => kind === "EVIDENCE").length} evidence captures, ${[...observations.values()].filter(kind => kind === "SKIP").length} skips, ${[...reads.values()].reduce((sum, read) => sum + read.sites.length, 0)} site observations, ${blanks.length} open place blanks`);
      }
    }
    const sourceRead = latestSourceRead as { requestedUrl: string; finalUrl: string; at: string } | null;
    const represented = Object.keys(sourceHashes);
    if (sourceRead && represented.length && represented.every(key => typeof sourceHashes[key] === "string" && checkedHashes.get(key) === sourceHashes[key])) {
      const rawHash = votingSourceManifestHash(sourceHashes);
      const retrievedAt = represented.map(key => checkedAt.get(key)!).sort((a, b) => Date.parse(a) - Date.parse(b))[0]!;
      const confirmation = await confirmSourceHashUnchanged({ store, sourceId: contract.sourceId, recordClass: contract.recordClass,
        scope: contract.scope, parserVersion: contract.parserVersion, rawHash,
        retrieval: { requestedUrl: sourceRead.requestedUrl, finalUrl: sourceRead.finalUrl, httpStatus: 200, rawHash, retrievedAt },
        now: now(), complete: true });
      if (confirmation) terminal = { source: contract.id, ...sourceHashReceiptFields(confirmation), structuralReleaseContract: ZERO_RELEASE_EVENTS };
    }
    if (!terminal && checkedHashes.size) {
      // A cutoff confirms its completed sources on their doors, without claiming that the whole state was refreshed.
      const head = await store.readSourceHead(contract.recordClass, contract.scope);
      if (head?.candidateState === "PROMOTED" && head.acquisitionSucceeded && head.sourceId === contract.sourceId && head.versionId === head.lastKnownGoodVersionId && !head.imported) {
        terminal = { source: contract.id, candidateId: head.versionId, acquisitionSucceeded: true, state: "PROMOTED", decision: "GOOD",
          promotedVersion: head.versionId, lastKnownGoodVersion: head.lastKnownGoodVersionId, structuralReleaseContract: ZERO_RELEASE_EVENTS };
      }
    }
    if (!terminal || !publications && !successfulSourceReads) throw new Error("No official voting-source result could be published; prior facts and open hunter work are retained.");
    return { terminal, publications, confirmedSources, attemptedSourceIds };
  } catch (error) {
    const at = now();
    try {
      const candidate = failedAcquisitionCandidate({ sourceId: contract.sourceId, recordClass: contract.recordClass,
        scope: contract.scope, requestedUrl: seeds[0]?.url ?? "", attemptedAt: at,
        failureDetail: sourceTextWithoutNuls(error instanceof Error ? error.message : String(error)), parserVersion: contract.parserVersion });
      const outcome = await processRegisteredManualCandidate(store, contract.id, candidate, at);
      terminal = { source: contract.id, ...routineReceiptFields(candidate, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS };
    } catch (recordError) {
      recordVotingFailure({ stage: "failure-record", state }, recordError);
    }
    throw error;
  } finally {
    // Source publications are already durable. The supervisor requires exactly one terminal receipt.
    if (terminal) console.log("RCD_RECEIPT=" + JSON.stringify(terminal));
  }
}

async function main() {
  if (!process.argv.includes("--promote")) throw new Error("Voting-source refresh publishes through the data plane; use --promote.");
  const state = requireBallotState(assignment(process.argv, "state") ?? "");
  installNeonRequestDeadline();
  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore(), at = new Date().toISOString();
  const context = await workerPublicationContext(at);
  const workerResults = assignment(process.argv, "worker-results");
  if (workerResults) {
    const report = await publishWorkerReaderResults({ ...context, store, contractId: votingSitesContract(state).id,
      workItemIds: workerResults.split(",").filter(Boolean), now: at });
    if (!await printWorkerPublicationReceipt(store, votingSitesContract(state).id, report, null, at)) throw new Error("No registered polling worker result reached the reader.");
    return;
  }
  await refreshVotingSources({ state, store, context });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error: unknown) => {
  recordVotingFailure({ stage: "acquisition" }, error); process.exitCode = 1;
}).finally(() => console.log("VOTING_JOB_METRICS=" + JSON.stringify({ peakRssBytes: process.resourceUsage().maxRSS * 1024 })));
