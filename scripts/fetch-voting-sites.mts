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
import { RestrictedDurabilityUnavailable } from "../lib/control-plane/evidence/durable-store.ts";
import { VotingSourceDocumentHeld } from "../lib/ballot/voting-source-evidence.ts";
import { cycleVault, VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { pageAddress } from "../lib/doors/page-doors.ts";
import { discoverVotingDoors } from "../lib/ballot/voting-source-discovery.ts";
import { mergeVotingSourceRead, recordVotingSourceRead, registeredVotingSourceDoors, replaceVotingJurisdiction,
  saveVotingSourceDoor, holdVotingRawEvidence, combineVotingSourceReads } from "../lib/ballot/voting-source-publication.ts";
import { persistVotingSourceBlanks, planVotingSourceBlanks, votingSourcePlaces } from "../lib/ballot/voting-source-blanks.ts";
import { votingSourcePopulations } from "../lib/ballot/voting-source-population.ts";
import type { VotingDoorScope, VotingSourceBlank, VotingSourceDoor, VotingSourceRead, VotingSourceRuntime } from "../lib/ballot/voting-source-types.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { isOfficialSource } from "../lib/civic-data/source-authority.ts";
import { routineReceiptFields, type RoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { workerPublicationContext } from "../lib/civic-data/worker-publication-context.ts";
import { publishWorkerReaderResults } from "../lib/civic-data/worker-reader-publication.ts";
import { printWorkerPublicationReceipt } from "../lib/civic-data/worker-publication-tasks.ts";
import { recordVotingFailure } from "../lib/ballot/voting-errors.ts";
import { votingBoundaryBlanks } from "../lib/ballot/voting-source-boundaries.ts";

const statewide = (door: VotingSourceDoor) => /\/(?:state|district|territory):[a-z]{2}$/.test(door.scope.ocdId);
const officeWords = /\b(?:elections?|voter registration|registrar of voters)\b/i;
const localTypes = new Set(["county", "cousub", "place"]);
const normalizeUrl = (value: string): string => { try { const url = new URL(value); url.hash = ""; return url.href.replace(/\/$/, ""); } catch { return value; } };
const localName = (value: string): string => value.toLowerCase().replace(/\b(?:polling locations?|election day polling places?|board of elections?|elections? office|supervisor of elections?|registrar of voters|town clerk)\b/g, "")
  .replace(/\b(?:county|township|town|city|borough|village|municipality|of)\b/g, "").replace(/[^a-z0-9]/g, "");
const typedPlaceName = (value: string): string => value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]/g, "");

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
export function votingSourceEvidence(door: VotingSourceDoor, read: VotingSourceRead, captures: VotingSourceRead["rawBodies"] = []): Promise<VotingRawCapture[]> {
  const bodyKey = (body: VotingSourceRead["rawBodies"][number]) => `${body.url}#${createHash("sha256").update(body.bytes).digest("hex")}`;
  const bodies = new Map(read.rawBodies.map(body => [bodyKey(body), body]));
  const links = new Set<string>();
  for (let page = door.officialLinkingPage; page; page = page.linkingPage ?? undefined) {
    links.add(page.url);
    if (![...bodies.values()].some(body => body.url === page.url)) {
      const body = { url: page.url, contentType: "text/html", bytes: new TextEncoder().encode(page.html) };
      bodies.set(bodyKey(body), body);
    }
  }
  for (const capture of captures) if (links.has(capture.url) || capture.url === door.url) bodies.set(bodyKey(capture), capture);
  return holdVotingRawEvidence({ rawBodies: [...bodies.values()] });
}

/** Register an address-only route from its fresh official link without querying it for a voter. */
function votingLookupDiscoveryRead(door: VotingSourceDoor, read: VotingSourceRead, captures: VotingSourceRead["rawBodies"], at: string): VotingSourceRead {
  if (door.shape !== "address-lookup" || door.scopeUnresolved || door.access?.status === "identity-locked" ||
      !door.officialLinkingPage || !isOfficialSource(door.url, door.officialLinkingPage)) return read;
  const linking = captures.filter(capture => capture.url === door.officialLinkingPage!.url);
  if (!linking.length) return read;
  return { ...read, rawBodies: [...read.rawBodies, ...linking],
    sources: [{ publisher: door.publisher, url: door.officialLinkingPage.url, checkedAt: at }],
    attempts: [...read.attempts, { url: door.officialLinkingPage.url, route: "direct",
      outcome: "Official page linked the address-only lookup; no voter address was submitted" }] };
}

function isVotingSourceContent(body: { url: string }): boolean {
  const sourceUrl = new URL(body.url);
  return !sourceUrl.pathname.endsWith("/robots.txt");
}

export function votingReadHasFacts(door: VotingSourceDoor, read: VotingSourceRead): boolean {
  if (!read.rawBodies.some(isVotingSourceContent)) return false;
  if (read.sites.length || read.boundaries?.length || read.contacts?.length) return true;
  if (!read.sources.length || read.blanks.some(blank => blank.reason === "access" || blank.reason === "extraction")) return false;
  return Boolean(read.office || read.rules.length || read.publicationMessage || door.publication || door.shape === "address-lookup");
}

/** Keep the existing restricted-storage refusal local to its document, with a durable source note. */
export async function recordVotingDiscoveryObservation(...args: Parameters<typeof recordSourceObservation>): Promise<void | "HELD"> {
  try { await recordSourceObservation(...args); }
  catch (error) {
    if (!(error instanceof RestrictedDurabilityUnavailable)) throw error;
    const [repos, observation, at, vault] = args;
    await recordSourceObservation(repos, { ...observation, capture: null, disposition: {
      kind: "SKIP", family: "voting", recordClass: "VOTING_SITE", belongs: true, quote: "",
      reason: "This document requires encrypted restricted evidence storage. Other official files remain active.",
    } }, at, vault);
    return "HELD";
  }
}

async function main() {
  if (!process.argv.includes("--promote")) throw new Error("Voting-source refresh publishes through the data plane; use --promote.");
  const state = requireBallotState(assignment(process.argv, "state") ?? "");
  const contract = votingSitesContract(state);
  prepareProductionCivicDataWrite();
  const now = () => new Date().toISOString(), store = new PostgresRoutineDataStore();
  const seeds = ["voting-source-doors.json", "voting-legacy-doors.json"].flatMap(name =>
    JSON.parse(readFileSync(join(REFERENCE_DIR, name), "utf8")) as VotingSourceDoor[]).filter(door => door.scope.state === state);
  const election = JSON.parse(readFileSync(join(REFERENCE_DIR, "voting-election.json"), "utf8")) as { electionDate: string };
  let terminal: RoutineRunnerReceipt | null = null;
  try {
    const context = await workerPublicationContext(now());
    const workerResults = assignment(process.argv, "worker-results");
    if (workerResults) {
      const at = now();
      const report = await publishWorkerReaderResults({ ...context, store, contractId: contract.id, workItemIds: workerResults.split(",").filter(Boolean), now: at });
      if (!await printWorkerPublicationReceipt(store, contract.id, report, null, at)) throw new Error("No registered polling worker result reached the reader.");
      return;
    }
    let priorRead: Awaited<ReturnType<typeof readPromotedCivicData<VotingSitesFile>>> | null = await readPromotedCivicData<VotingSitesFile>(contract.recordClass, contract.scope, { store, bypassCache: true });
    if (priorRead.kind !== "PROMOTED" && priorRead.kind !== "NOT_RECORDED") throw new Error("Voting-source holding is unavailable; preserve its last verified facts.");
    if (priorRead.kind === "PROMOTED" && priorRead.metadata.sourceId !== contract.sourceId) throw new Error("Voting-source holding names a different publisher.");
    if (priorRead.kind === "PROMOTED") rememberStatePublicationPrior(store, priorRead.projection);
    let held = priorRead.kind === "PROMOTED" ? priorRead.value : null;
    let version = priorRead.kind === "PROMOTED" ? priorRead.metadata.versionId : null;
    priorRead = null;
    const registration = await readRegistrationProjection(state, { store, bypassCache: true });
    const savedDoors = await registeredVotingSourceDoors(context.repos.doors, state);
    const registered = [...new Map([...seeds, ...savedDoors].map(source => [source.id, source])).values()];
    const vault = cycleVault(join(process.cwd(), ...VAULT_DIR));
    let publications = 0;
    {
      const registeredDivisions = registration.kind === "PROMOTED" ? registration.value.divisions : [];
      const reviewed = await readRegistryRuntimePrior(store, new Date().toISOString(), state);
      const divisions = [...new Map([...registeredDivisions, ...reviewed?.payload.registry.divisions ?? []].map(row => [row.ocdId, row])).values()];
      const bodies = [...new Map([...(registration.kind === "PROMOTED" ? registration.value.bodies : []),
        ...reviewed?.payload.registry.bodies ?? []].map(row => [row.id, row])).values()];
      const localRegistry = { divisions, bodies };
      const stateDoors = registered.filter(door => door.scope.state === state);
      const roots = votingChiefRoots(stateDoors);
      const superseded = votingSupersededSources(stateDoors, held);
      const doors = new Map<string, VotingSourceDoor>();
      const reads = new Map<string, VotingSourceRead>(), walked = new Set<string>();
      const evidenceSources = new Map<string, VotingSourceDoor>();
      const observations = new Map<string, "DOOR" | "EVIDENCE" | "SKIP">();
      const heldDocuments = new Map<string, VotingSourceBlank>();
      const holdDocument = (door: VotingSourceDoor, url: string) => {
        const detail = "Source document requires encrypted restricted evidence storage; other official files remain active";
        const blank: VotingSourceBlank = { id: `${door.id}:held-document`, doorId: door.id, scope: door.scope,
          reason: "access", status: "open", owed: "Voting places from this held source document",
          tried: [url, detail], next: ["Activate encrypted restricted evidence storage for this document", "Read the other official state and county files"] };
        heldDocuments.set(url, blank);
        const read = reads.get(door.id);
        if (read) reads.set(door.id, { ...read, sites: [], rules: [], boundaries: [], contacts: [], sources: [], blanks: [...read.blanks, blank] });
        console.error(JSON.stringify({ event: "voting_source_document_held", state, source: url, detail }));
      };
      const geocodes = new Map<string, { lat: number; lng: number } | null>(heldVotingSiteCoordinates(held));
      let callbackFailure: unknown;
      const runtime: VotingSourceRuntime = {
        fetch, now, captureCache: new Map(), discoverySeen: new Set(), ...votingScopeResolvers(localRegistry),
        browserFetch: (url, init) => fetch(url, { ...init, headers: { ...init?.headers,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" } }),
        geocode: async address => {
          const key = votingSiteAddressKey(address);
          if (geocodes.has(key)) return geocodes.get(key)!;
          const url = new URL(CENSUS_GEOCODER_URL);
          url.searchParams.set("address", address); url.searchParams.set("benchmark", CENSUS_BENCHMARK); url.searchParams.set("format", "json");
          let point = null;
          try { const response = await fetch(url, { headers: { "user-agent": OUTBOUND_USER_AGENT }, signal: AbortSignal.timeout(10_000) });
            if (!response.ok) throw new Error(`Census site geocoder returned HTTP ${response.status}`);
            point = parseCensusPoint(await response.json());
            if (!point) recordVotingFailure({ stage: "site-geocode", state }, new Error("Census returned no unique site point"));
          } catch (error) { recordVotingFailure({ stage: "site-geocode", state }, error); }
          geocodes.set(key, point); return point;
        },
      };
      const acquire = async (door: VotingSourceDoor, captures: VotingSourceRead["rawBodies"] = [], persistent = true) => {
        if (door.scope.state !== state) throw new Error("Voting source crossed its state publication scope.");
        if (superseded.has(normalizeUrl(door.url))) return;
        if (reads.has(door.id)) return;
        const at = now();
        const mappings = [door, ...stateDoors.filter(other => other.id !== door.id && other.scope.ocdId === door.scope.ocdId &&
          pageAddress(other.url)?.url === pageAddress(door.url)?.url)];
        const group: VotingSourceRead[] = [];
        for (const mapping of mappings) {
          const read = votingLookupDiscoveryRead(mapping, await readVotingSource(mapping, runtime), captures, at);
          reads.set(mapping.id, read); group.push(read);
        }
        const read = combineVotingSourceReads(group);
        console.info(JSON.stringify({ event: "voting_source_read", state, source: door.url, at,
          sites: read.sites.length, precincts: read.boundaries?.length ?? 0,
          sourceBytes: read.rawBodies.reduce((sum, capture) => sum + capture.bytes.byteLength, 0),
          failures: read.blanks.filter(blank => blank.reason === "access" || blank.reason === "extraction").map(blank => ({ reason: blank.reason, detail: blank.tried })) }));
        const observed = read.rawBodies.filter(isVotingSourceContent);
        if (!votingReadHasFacts(door, read)) {
          if (persistent && (read.rawBodies.length || read.blanks.length)) await recordVotingSourceRead(context.repos.doors, door, read, at);
          return;
        }
        let acquisition: VotingRawCapture[];
        try { acquisition = await votingSourceEvidence(door, read, captures); }
        catch (error) {
          if (!(error instanceof VotingSourceDocumentHeld)) throw error;
          for (const mapping of mappings) holdDocument(mapping, error.url);
          if (persistent) await recordVotingSourceRead(context.repos.doors, door, combineVotingSourceReads(mappings.map(mapping => reads.get(mapping.id)!)), at);
          return;
        }
        if (persistent) await recordVotingSourceRead(context.repos.doors, door, read, at);
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
        const candidate = votingSitesCandidate({ state, current, prior: before, failures: [], acquisition,
          successfulAuthorityReads: observed.length, requestedUrl: door.url, finalUrl: observed.at(-1)?.url ?? door.url,
          retrievedAt: at, carriedFromVersionId: version });
        before = null; held = null;
        const outcome = await processRegisteredManualCandidate(store, contract.id, candidate, at, version);
        if (outcome.promoted) {
          held = outcome.promoted.payload as VotingSitesFile; version = outcome.promoted.versionId;
          rememberStatePublicationPrior(store, outcome.promoted);
          for (const url of votingSupersededSources([door], held)) superseded.add(url);
          terminal = { source: contract.id, ...routineReceiptFields(candidate, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS }; publications++;
        } else {
          if (!terminal) terminal = { source: contract.id, ...routineReceiptFields(candidate, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS };
          const retained = await readPromotedCivicData<VotingSitesFile>(contract.recordClass, contract.scope, { store, now: at, bypassCache: true });
          if (retained.kind !== "PROMOTED" && retained.kind !== "NOT_RECORDED") throw new Error("Voting-source holding is unavailable after a held update.");
          if (retained.kind === "PROMOTED") {
            rememberStatePublicationPrior(store, retained.projection);
            held = retained.value; version = retained.metadata.versionId;
          }
          console.error(`${door.publisher}: voting-source publication held as ${outcome.candidate.state}; prior facts retained.`);
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
              officialLinkingPage: found.officialLinkingPage ?? existing.officialLinkingPage,
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
          const recorded = await recordVotingDiscoveryObservation(context.repos, { url, ocdId: source.scope.ocdId, state,
            names: [source.scope.name, source.publisher], capture, disposition: {
              kind: "SKIP", family: "voting", recordClass: "VOTING_SITE", belongs: true, quote: "",
              reason: "An official current-election file has replaced this older list and is already published",
            } }, now(), vault);
          observations.set(url, "SKIP");
          if (recorded === "HELD") { holdDocument(source, url); return "HELD"; }
          return;
        }
        const recorded = await recordVotingDiscoveryObservation(context.repos, { url, ocdId: source.scope.ocdId, state,
          names: [source.scope.name, source.publisher], disposition, capture }, now(), vault);
        observations.set(url, recorded === "HELD" ? "SKIP" : disposition.kind);
        if (recorded === "HELD") { holdDocument(source, url); return "HELD"; }
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
        if (superseded.has(normalizeUrl(root.url))) return;
        const key = pageAddress(root.url)!.url;
        if (walked.has(key)) return;
        const discovery = await discoverVotingDoors(root, runtime);
        if (callbackFailure) throw callbackFailure;
        for (const found of discovery.sources) walked.add(pageAddress(found.source.url)!.url);
      };
      // Publish registered bulk files before broad discovery; state files lead county files.
      for (const source of stateDoors.filter(door => ["file", "json", "map-service"].includes(door.shape) &&
        (door.covers.some(kind => kind !== "CANDIDATE_LIST" && kind !== "BALLOT_MEASURES") || door.boundaryLayer))
        .sort((a, b) => Number(statewide(b)) - Number(statewide(a)) || Number(Boolean(b.supersedes?.length)) - Number(Boolean(a.supersedes?.length)))) {
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
      const scope = root?.scope ?? stateDoors[0]?.scope;
      if (!scope) throw new Error(`No registered voting source for ${state}.`);
      const delegation = stateDoors.find(door => door.delegation)?.delegation ?? "county";
      const populations = await votingSourcePopulations({ state, bodies });
      const places = votingSourcePlaces({ state: scope, divisions, delegation, populations });
      const sourceDoors = [...doors.values(), ...evidenceSources.values()];
      const jurisdictions = held?.jurisdictions.filter(jurisdiction => jurisdiction.state === state) ?? [];
      const blanks = [...planVotingSourceBlanks({ electionDate: election.electionDate, places, doors: sourceDoors, reads: [...reads.values()], jurisdictions }),
        ...votingBoundaryBlanks(places, jurisdictions, sourceDoors), ...heldDocuments.values()];
      await persistVotingSourceBlanks({ repos: context.repos, blanks, electionDate: election.electionDate, now: now() });
      console.log(`${state}: ${[...observations.values()].filter(kind => kind === "DOOR").length} publishing doors, ${[...observations.values()].filter(kind => kind === "EVIDENCE").length} evidence captures, ${[...observations.values()].filter(kind => kind === "SKIP").length} skips, ${[...reads.values()].reduce((sum, read) => sum + read.sites.length, 0)} site observations, ${blanks.length} open place blanks`);
    }
    if (!publications) throw new Error("No official voting-source result could be published; prior facts and open hunter work are retained.");
  } catch (error) {
    const at = now();
    try {
      const candidate = failedAcquisitionCandidate({ sourceId: contract.sourceId, recordClass: contract.recordClass,
        scope: contract.scope, requestedUrl: seeds[0]?.url ?? "", attemptedAt: at,
        failureDetail: error instanceof Error ? error.message : String(error), parserVersion: contract.parserVersion });
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error: unknown) => {
  recordVotingFailure({ stage: "acquisition" }, error); process.exitCode = 1;
}).finally(() => console.log("VOTING_JOB_METRICS=" + JSON.stringify({ peakRssBytes: process.resourceUsage().maxRSS * 1024 })));
