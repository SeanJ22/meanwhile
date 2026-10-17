import { currentStateAuthorityProjection } from "../lib/civic-data/state-reader.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

import { authorityPointerKey, ensureReaderAuthorityEdge, publishReaderMeetings, readServedPointer, type PublishAuthorityValue } from "../lib/meetings/edge-serving.ts";
import { publishPointers } from "./helpers/edge-pointers.ts";
import { withReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import type { GlobalAuthorityFamily, GlobalPromotedAuthorityFamily, PromotedFamilyArtifactValue, StateAuthorityFamily } from "../lib/meetings/edge-artifacts.ts";

type StateValues = Partial<Record<StateAuthorityFamily, Record<string, PublishAuthorityValue>>>;
import type { CensusDistrictEdge } from "../lib/census-geography/district-edge.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { stateBallotContractId, stateBallotScope, type StateBallotFamily } from "../lib/civic-data/state-scopes.ts";
import { ballotElectionKey, currentGenericBallotProjection, genericBallotProblems, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { runBallotPublication } from "../scripts/assemble-ballot-package.mts";
import type { readBallotStateFile } from "../lib/civic-data/ballot-input.ts";
type BallotStateFile = Awaited<ReturnType<typeof readBallotStateFile>>;

import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { readerBallotSourceForTargetId, readerBallotSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import {
  candidateProfilesReadState,
} from "../lib/civic-data/manual-read-models.ts";
import { fundingReadState, readFundingSnapshot } from "../lib/funding/snapshot.ts";
import { stateMoneyReadState } from "../lib/funding/state-snapshot.ts";
import { readNhMembers } from "../lib/civic-data/state-members.ts";
import { readOfficialStateLegislatorsProjection } from "../lib/state-rollcalls/legislators.ts";
import { POLLING_PLACE_LINKS } from "../lib/ballot/polling-place-links.ts";
import { REGISTRATION_LINKS } from "../lib/ballot/registration-links.ts";
import { registryRuntimeReadState } from "../lib/registry/runtime-read-model.ts";
import { withReaderSelection, type ReaderSelection } from "../lib/db/reader-route.ts";
import { federalDirectoryReadState } from "../lib/officials/federal-directory-read-model.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, type StateCampaignFinanceJurisdiction } from "../lib/funding/data-plane.ts";
import { stateMoneyFixture, syntheticCandidateCorpus, syntheticCandidateProfiles, syntheticFederalDirectory, stateFederalDirectoryArtifacts } from "./helpers/promoted-fixtures.ts";
import { authorityVersionKey } from "../lib/registry/server.ts";
import {
  absentEdgeEntry,
  manualEdgeEntry,
  promotedFamily,
  provenEdgeEntry,
  servedValue,
} from "./helpers/promoted-edge-entry.ts";
import { azDistricts } from "./helpers/ballot-district-fixtures.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";

const committedAzBallot = Object.values(JSON.parse(readFileSync(join(import.meta.dirname, "../data/ballot/2026-general/az.json"), "utf8")).ballots)[0] as BallotSet;

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

function stateRegistryArtifacts(versionId: string, states: readonly string[], value: RegistryRuntimeReadModel = registryTransferImport().projection.payload) {
  return Object.fromEntries(states.map(state => [state, { versionId: `${versionId}:${state}`, value: { kind: "PROMOTED_POINTERS" as const,
    entries: [provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state), sourceId: "registry-reviewed-bindings",
      versionId: `${versionId}:${state}`, value: registryFixtureForState(state, value) })] } }]));
}


for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_BLOBS_CONTEXT", "NETLIFY_SITE_ID"]) delete process.env[key];

const REGISTRY_VERSION = "edge-test:ballot:registry";
const FEDERAL_VERSION = "edge-test:ballot:federal";

const seedStore = new MemoryRoutineDataStore();
const azBallot = committedAzBallot;
const nationalStateBallot = (state: string) => Object.values((JSON.parse(readFileSync(`data/ballot/2026-general/${state}.json`, "utf8")) as GenericBallotProjection).ballots)[0]!;
const nhBallot = nationalStateBallot("nh");
const njBallot = nationalStateBallot("nj");
const profiles = syntheticCandidateProfiles();
const corpus = syntheticCandidateCorpus();
const federal = syntheticFederalDirectory();
const stateMoneyFixtureEntries = (version: (state: string) => string) => (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]).map((state) =>
  provenEdgeEntry({ recordClass: "STATE_CAMPAIGN_FINANCE", scope: STATE_CAMPAIGN_FINANCE_SOURCES[state].scope, sourceId: STATE_CAMPAIGN_FINANCE_SOURCES[state].sourceId, versionId: version(state), value: stateMoneyFixture(state) }));
const funding = servedValue(await readFundingSnapshot({ store: seedStore, bypassCache: true }));
const nhMembers = servedValue(await readNhMembers({ store: seedStore, bypassCache: true }));
const nhLegislators = servedValue(await readOfficialStateLegislatorsProjection("US-NH", { store: seedStore, bypassCache: true }));
// The published Census edge resolves 07960 into both NJ congressional districts.
const njDistricts: CensusDistrictEdge["containers"] = [7, 11].map(district => ({
  ref: { type: "congressional_district", version: "cd:119", geoid: `34${String(district).padStart(2, "0")}`, ocdId: null,
    stateFips: "34", stateAbbr: "NJ", memberStates: ["NJ"], label: `NJ Congressional District ${district} (119th Congress)` },
  plan: "119th Congress",
}));
const nhDistricts: CensusDistrictEdge["containers"] = [
  { type: "congressional_district", version: "cd:119", geoid: "3302", label: "NH Congressional District 2", plan: "119th Congress" },
  { type: "state_leg_upper", version: "sldu:2024", geoid: "33007", label: "NH State Senate District 7", plan: "2024 State Legislative Districts" },
  { type: "state_leg_lower", version: "sldl:2024", geoid: "33607", label: "NH House District Merrimack 07", plan: "2024 State Legislative Districts" },
].map(({ plan, ...ref }) => ({ ref: { ...ref, type: ref.type as "congressional_district" | "state_leg_upper" | "state_leg_lower",
  ocdId: null, stateFips: "33", stateAbbr: "NH", memberStates: ["NH"] }, plan }));
const districts: CensusDistrictEdge = { ...azDistricts, versionId: "edge-test:ballot:districts",
  containers: [...azDistricts.containers, ...njDistricts, ...nhDistricts],
  codes: { ...azDistricts.codes, "07960": njDistricts.map((_, index) => [azDistricts.containers.length + index, false, null]),
    "03255": nhDistricts.map((_, index) => [azDistricts.containers.length + njDistricts.length + index, true, 1]) },
};
const navigation = {
  kind: "ballot-navigation",
  records: [
    ...REGISTRATION_LINKS.map((value) => ({ id: `registration:${value.state}`, kind: "REGISTRATION_LINK", value })),
    ...POLLING_PLACE_LINKS.map((value) => ({ id: `polling-place:${value.state}`, kind: "POLLING_PLACE_LINK", value })),
  ],
};

const manual = manualEdgeEntry;
const fec = requiredRoutineContract("fec-funding");
const nhRoster = requiredRoutineContract("nh-members");
const EDGE = {
  ballots: "edge-test:ballot:national",
  profiles: "edge-test:ballot:profiles",
  corpus: "edge-test:ballot:corpus",
  funding: "edge-test:ballot:fec",
  campaignFinance: "edge-test:ballot:campaign-finance",
  nhMembers: "edge-test:ballot:nh-members",
  stateMoney: (state: string) => `edge-test:ballot:money:${state}`,
};
const PROMOTED_BALLOT_FAMILIES: Partial<Record<GlobalPromotedAuthorityFamily, { value: PromotedFamilyArtifactValue; versionId: string }>> = {
  "ballot-navigation": promotedFamily([manual("ballot-navigation", navigation, "edge-test:ballot:navigation")], "edge-test:ballot:navigation"),
  "official-filings": promotedFamily([absentEdgeEntry("CURATED_READER_RECORD", requiredManualProductionContract("official-filings").scope)], "edge-test:filings:absent"),
  "nh-members": promotedFamily([provenEdgeEntry({ recordClass: nhRoster.recordClass, scope: nhRoster.scope, sourceId: nhRoster.sourceId, versionId: EDGE.nhMembers, value: nhMembers })], EDGE.nhMembers),
  "federal-funding": promotedFamily([
    provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: fec.scope, sourceId: fec.sourceId, versionId: EDGE.funding, value: funding }),
    manual("campaign-finance", { kind: "campaign-finance", records: [] }, EDGE.campaignFinance),
  ], EDGE.funding),
  "state-money": promotedFamily(stateMoneyFixtureEntries(EDGE.stateMoney), "edge-test:ballot:money"),
};

const absentStates = (family: StateBallotFamily, recordClass: Parameters<typeof absentEdgeEntry>[0]) =>
  Object.fromEntries(["AZ", "NH", "NJ", "TX"].map(state => [state, promotedFamily([absentEdgeEntry(recordClass, stateBallotScope(family, state))], `absent:${family}:${state}`)]));

const STATE_BALLOT_FAMILIES: StateValues = {
  "ballot-contests": Object.fromEntries([azBallot, nhBallot, njBallot].map(ballot => [ballot.election.state,
    promotedFamily([manual(stateBallotContractId("ballot-contests", ballot.election.state),
      { kind: "ballot-contests", ballots: { [ballotElectionKey(ballot)]: ballot } }, EDGE.ballots)], EDGE.ballots)])),
  "candidate-profiles": { ...absentStates("candidate-profiles", "CANDIDATE_PROFILE"), AZ: promotedFamily([manual("candidate-profiles:AZ", profiles, EDGE.profiles)], EDGE.profiles) },
  "candidate-publications": { ...absentStates("candidate-corpus", "CANDIDATE_PUBLICATION"), AZ: promotedFamily([manual("candidate-corpus:AZ", corpus, EDGE.corpus)], EDGE.corpus) },
  "candidate-campaign-sites-derived": absentStates("candidate-campaign-sites-derived", "CURATED_READER_RECORD"),
  "voting-sites": absentStates("voting-sites", "VOTING_SITE"),
};

async function publishEdge(withPromoted: boolean, authorityOverrides: Partial<Record<GlobalAuthorityFamily, PublishAuthorityValue>> = {}, stateOverrides: StateValues = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-ballot-edge-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const authority: Partial<Record<GlobalAuthorityFamily, PublishAuthorityValue>> = {
    "census-districts": { value: districts, versionId: districts.versionId },
    ...(withPromoted ? PROMOTED_BALLOT_FAMILIES : {}),
    ...authorityOverrides,
  };
  const store = new LocalFileArtifactStore(dir);
  const published = await publishReaderMeetings({
    formatVersion: 1,
    generatedAt: "2026-09-25T00:00:00.000Z",
    counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 },
    sources: [],
    meetings: [],
    agendaDocuments: [],
  }, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, { store });
  const none = { versionId: "none", value: null };
  await publishPointers(store, { authority,
    stateAuthorities: { "registry-runtime": stateRegistryArtifacts(REGISTRY_VERSION, ["AZ", "NH", "NJ", "TX"]), "federal-directory": stateFederalDirectoryArtifacts(FEDERAL_VERSION, federal),
      ...(withPromoted ? { ...STATE_BALLOT_FAMILIES, ...stateOverrides } : {}) },
    registrations: { az: none, nh: none, nj: none, tx: none },
    stateLegislators: { "US-NJ": none, "US-TX": none,
      "US-AZ": { versionId: "edge-test:ballot:az-people", value: {
        formatVersion: 1, sourceId: "plural-openstates", jurisdiction: "US-AZ", term: "2025-2026",
        generatedAt: "2026-09-25T00:00:00.000Z",
        roster: { formatVersion: 1, generatedAt: "2026-09-25", source: "edge-test", officeholders: [], divisions: [] },
      } },
      "US-NH": { versionId: "edge-test:ballot:nh-people", value: nhLegislators },
    },
  });
  assert.equal(published.status, "PUBLISHED", JSON.stringify(published));
  return dir;
}
const mapEdgeDir = await publishEdge(false);
const ballotEdgeDir = await publishEdge(true);

// Transformed Arizona fixtures isolate geography policy without asserting Texas ballot facts.
function houstonPolicyBallot(): BallotSet {
  const election = { ...committedAzBallot.election, id: "tx-plan-policy-2026-11-03", state: "TX" };
  const kept = committedAzBallot.contests.filter(contest => contest.id.endsWith(":governor") || contest.id.endsWith(":us-house-7"));
  const ids = new Map(kept.map(contest => [contest.id, `ballot-tx-plan-policy:${contest.id.endsWith(":governor") ? "governor" : "us-house-38"}`]));
  return { election,
    contests: kept.map(contest => ({ ...contest, id: ids.get(contest.id)!, electionId: election.id,
      ocdId: contest.ocdId.replace("/state:az", "/state:tx").replace("/cd:7", "/cd:38"),
      title: contest.title.replace("District 7", "District 38"),
    })),
    candidacies: committedAzBallot.candidacies.filter(candidate => ids.has(candidate.contestId)).map(candidate => ({ ...candidate,
      id: `tx-plan-policy:${candidate.id}`, contestId: ids.get(candidate.contestId)!,
    })),
    measures: [], absences: [],
  };
}
function houstonPolicyDistricts(withSuccessor: boolean): CensusDistrictEdge {
  const source = azDistricts.containers.find(container => container.ref.type === "congressional_district")!;
  const old = { ...source, ref: { ...source.ref, stateAbbr: "TX", stateFips: "48", memberStates: ["TX"], geoid: "4807", label: "TX plan-transition fixture district 7" } };
  const containers = [...azDistricts.containers, old];
  const scopes = [...azDistricts.scopes];
  const rows: (readonly [number, boolean, number | null])[] = [[azDistricts.containers.length, true, 1]];
  if (withSuccessor) {
    scopes.push({ ...azDistricts.scopes.find(scope => scope.type === "congressional_district")!, version: "cd:120", plan: "120th Congress", retrievalComplete: true });
    rows.push([containers.length, true, 1]);
    containers.push({ ...old, plan: "120th Congress", ref: { ...old.ref, version: "cd:120", geoid: "4838", label: "TX plan-transition fixture district 38" } });
  }
  return { ...azDistricts, versionId: `edge-test:houston-policy:${withSuccessor ? "cd120" : "cd119"}`, scopes, containers,
    codes: { ...azDistricts.codes, "77002": rows },
  };
}
const txPolicyBallot = houstonPolicyBallot();
const txPolicyProjection: GenericBallotProjection = { kind: "ballot-contests", ballots: { [ballotElectionKey(txPolicyBallot)]: txPolicyBallot } };
assert.deepEqual(genericBallotProblems(txPolicyProjection), [], "the Texas policy fixture passes the production ballot schema");
const txPolicyFamily = promotedFamily([manual("ballot-contests:TX", txPolicyProjection, "edge-test:houston-policy:ballot")], "edge-test:houston-policy:ballot");
const houstonEdgeDirs = await Promise.all([false, true].map(async withSuccessor => {
  const value = houstonPolicyDistricts(withSuccessor);
  return publishEdge(true, { "census-districts": { value, versionId: value.versionId } }, { "ballot-contests": { TX: txPolicyFamily } });
}));

type RenderPhase = "page" | "components";
let phase: RenderPhase = "page";
const databaseReads: { phase: RenderPhase; recordClass: string }[] = [];
process.env.DATABASE_URL = "postgresql://edge-test:edge-test@ep-ballot-edge-test.ballot-edge-test.invalid/none?sslmode=require";
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("ballot-edge-test.invalid/")) throw new Error(`the ballot render fetched ${url}`);
  const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; params?: unknown[]; queries?: { query?: string; params?: unknown[] }[] };
  const queries = body.queries ?? [body];
  const empty = { command: "SELECT", rowCount: 0, rows: [], fields: [] };
  const results = queries.map(query => {
    // The daily byte counter writes an aggregate, not a civic pointer read.
    if (/^\s*INSERT INTO database_transfer_daily\b/.test(query.query ?? "")) return empty;
    if (query.query?.includes("FROM fact f JOIN source_copy")) {
      assert.ok(query.params?.[0], "fact reads require selected bodies");
      return empty;
    }
    const key = (query.params ?? []).find((value): value is string => typeof value === "string" && /^[A-Z_]+:US-/.test(value));
    const recordClass = key?.split(":")[0] ?? (query.params ?? []).find((p): p is string => typeof p === "string" && /^[A-Z][A-Z_]+$/.test(p) && p !== "UNCHANGED_CONFIRMATION_V1");
    if (recordClass && ["REGISTRY_RUNTIME_BINDING", "BALLOT_CANDIDACY", "CANDIDATE_PROFILE", "CANDIDATE_PUBLICATION", "VOTING_SITE", "CURATED_READER_RECORD"].includes(recordClass))
      assert.doesNotMatch(query.query ?? "", /reader_place_payload|reader_inventory_payload/);
    databaseReads.push({ phase, recordClass: recordClass ?? "UNKNOWN" });
    return empty;
  });
  return new Response(JSON.stringify(body.queries ? { results } : results[0]), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

/** One cold render: the page, then every async component it returned, called from outside the page. */
async function renderBallot(zip: string): Promise<{ components: Map<string, number>; text: string; contestIds: Set<string>; candidateIds: Set<string>; filingCandidateIds: Set<string>; sourceUrls: Set<string>; candidateSources: Map<string, string[]>; readerEdge: ReaderAuthorityEdgeBundle | null; readerSelection: ReaderSelection | undefined }> {
  clearPromotedReadModelCache();
  databaseReads.length = 0;
  const { default: BallotPage } = await import("../app/ballot/page.tsx");
  phase = "page";
  const tree = await BallotPage({ searchParams: Promise.resolve({ zip }) });
  phase = "components";
  const components = new Map<string, number>();
  const text: string[] = [];
  const contestIds = new Set<string>();
  const candidateIds = new Set<string>();
  const filingCandidateIds = new Set<string>();
  const sourceUrls = new Set<string>();
  const candidateSources = new Map<string, string[]>();
  let readerEdge: ReaderAuthorityEdgeBundle | null = null;
  let readerSelection: ReaderSelection | undefined;
  // A card hands some sections down inside a plain object prop (the battlecard's
  // `money`, which is `CandidateFunding`), so plain objects are walked too, once each.
  const seen = new WeakSet<object>();
  const walk = async (node: unknown): Promise<void> => {
    if (typeof node === "string") { text.push(node); return; }
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const child of node) await walk(child); return; }
    const element = node as { $$typeof?: symbol; type?: unknown; props?: Record<string, unknown> };
    if (element.$$typeof === undefined) {
      if (Object.getPrototypeOf(node) === Object.prototype) for (const [key, value] of Object.entries(node)) {
        if (key === "sourceUrl" && typeof value === "string") sourceUrls.add(value);
        await walk(value);
      }
      return;
    }
    if (element.props?.readerEdge) readerEdge = element.props.readerEdge as ReaderAuthorityEdgeBundle;
    if (element.props?.readerSelection) readerSelection = element.props.readerSelection as ReaderSelection;
    const contestId = element.props?.["data-contest-id"] ?? (element.props?.attrs as Record<string, unknown> | undefined)?.["data-contest-id"];
    if (typeof contestId === "string") contestIds.add(contestId);
    const filingCandidateId = element.props?.["data-filing-candidacy"];
    if (typeof filingCandidateId === "string") filingCandidateIds.add(filingCandidateId);
    const candidateId = element.props?.["data-candidate-target"];
    if (typeof candidateId === "string") candidateIds.add(candidateId);
    const contributionId = element.props?.id;
    if (typeof contributionId === "string" && contributionId.startsWith("candidate-filing:")) {
      candidateSources.set(contributionId.slice("candidate-filing:".length), (element.props?.sources as { provenance: { sourceUrl: string } }[]).map(source => source.provenance.sourceUrl));
    }
    const href = element.props?.href;
    if (typeof href === "string" && href.startsWith("https://")) sourceUrls.add(href);
    if (typeof element.type === "function" && (element.type.constructor.name === "AsyncFunction" || ["CandidateSources", "CandidateContactSources", "CandidatePortraitSources"].includes(element.type.name))) {
      const name = element.type.name;
      components.set(name, (components.get(name) ?? 0) + 1);
      await walk(await (element.type as (props: unknown) => Promise<unknown>)(element.props ?? {}));
      return;
    }
    for (const value of Object.values(element.props ?? {})) await walk(value);
  };
  await walk(tree);
  return { components, text: text.join(" "), contestIds, candidateIds, filingCandidateIds, sourceUrls, candidateSources, readerEdge, readerSelection };
}

const MAP_FAMILIES = ["REGISTRY_RUNTIME_BINDING", "FEDERAL_DIRECTORY", "STATE_LEGISLATOR"];
const MOVED_FAMILIES = ["BALLOT_CANDIDACY"];

test("React renders the page's async components outside the page's context: they see its edge only when handed it", () => {
  // Next's own compiled React Flight server, with the react-server condition it runs under.
  const runtimeEdge = pathToFileURL(join(process.cwd(), "lib", "registry", "runtime-edge.ts")).href;
  const script = `
    import { createRequire } from "node:module";
    const load = createRequire(${JSON.stringify(pathToFileURL(join(process.cwd(), "package.json")).href)});
    const React = load("react");
    const { renderToPipeableStream } = load("next/dist/compiled/react-server-dom-webpack/server.node.js");
    const { enterReaderAuthorityEdge, withReaderAuthorityEdge, currentReaderAuthorityEdge } = await import(${JSON.stringify(runtimeEdge)});
    const bundle = { promotedFamilies: new Set(["flight-probe"]) };
    const seen = () => currentReaderAuthorityEdge()?.promotedFamilies?.has("flight-probe") ? "flight-probe" : "none";
    async function Card({ readerEdge }) {
      await Promise.resolve();
      const plain = seen();
      const handed = await withReaderAuthorityEdge(readerEdge, async () => { await Promise.resolve(); return seen(); });
      return React.createElement("i", null, "card:" + plain + ":" + handed);
    }
    async function Page() {
      await Promise.resolve();
      enterReaderAuthorityEdge(bundle);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return React.createElement("div", null, "page:" + seen() + ";", React.createElement(Card, { readerEdge: bundle }));
    }
    let out = "";
    const { Writable } = await import("node:stream");
    renderToPipeableStream(React.createElement(Page), {}).pipe(new Writable({
      write(chunk, _encoding, done) { out += chunk; done(); },
      final(done) { process.stdout.write(out); done(); },
    }));
  `;
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const out = execFileSync(process.execPath, ["--conditions", "react-server", "--experimental-strip-types", "--input-type=module", "-e", script], { encoding: "utf8", env, cwd: process.cwd() });
  assert.match(out, /page:flight-probe;/, `the page's own reads see the edge it entered: ${out}`);
  assert.match(out, /card:none:flight-probe/, `a component sees the page's edge only through withReaderAuthorityEdge: ${out}`);
});

test("with map families on the edge, a cold ballot reads missing ballot pointers and its exact registry place", async () => {
  process.env.WTP_READER_EDGE_DIR = mapEdgeDir;
  await renderBallot("85701");
  assert.deepEqual(databaseReads.filter((read) => MAP_FAMILIES.includes(read.recordClass)), [], "a family the edge publishes was read from the database");
  assert.deepEqual(databaseReads.map((read) => read.recordClass).sort(), MOVED_FAMILIES);
  assert.deepEqual(databaseReads.filter((read) => read.phase === "components"), [], "a card read the database");
});

test("a cold /ballot?zip=85701 reads one state registry and all ballot families from the state edge", async () => {
  process.env.WTP_READER_EDGE_DIR = ballotEdgeDir;
  const { components, text, contestIds, readerEdge, readerSelection } = await renderBallot("85701");
  for (const id of ["state-senate-20", "state-house-20", "us-house-7"]) {
    assert.ok([...contestIds].some(contestId => contestId.endsWith(`:${id}`)), `the page omitted ${id}`);
  }
  for (const title of ["State Senator, District 20", "State Representative, District 20", "U.S. Representative, District 7"]) {
    assert.ok(text.includes(title), `the reader did not see ${title}`);
  }
  assert.doesNotMatch(text, /We're working on getting the (?:U\.S\. House|State Senate|State House) district|District contests may be missing/);
  assert.ok((components.get("BallotBattlecard") ?? 0) >= 10, `the render reached the cards: ${JSON.stringify([...components])}`);
  assert.ok((components.get("IncumbentName") ?? 0) >= 10, `the render reached the names: ${JSON.stringify([...components])}`);
  assert.ok((components.get("CandidateFunding") ?? 0) >= 1, `the render reached the funding cards: ${JSON.stringify([...components])}`);

  assert.deepEqual(databaseReads, [], "a cold /ballot with the whole edge read the database");
  assert.deepEqual(readerSelection?.states, ["AZ"]);
  const registry = withReaderSelection(readerSelection, () => registryRuntimeReadState());
  assert.equal(registry.metadata.versionId, `${REGISTRY_VERSION}:AZ`, "the registry uses the exact state artifact");
  assert.ok(readerEdge?.stateAuthorities?.families.has("registry-runtime"));
  assert.equal(withReaderSelection(readerSelection, () => federalDirectoryReadState()).metadata?.versionId, `${FEDERAL_VERSION}:AZ`, "the federal directory was not served from the edge");
  // Each family is the edge's proven copy, read as PROMOTED through its own Reader.
  for (const [what, state, version] of withReaderSelection(readerSelection, () => withReaderAuthorityEdge(readerEdge, () => [
    ["the candidate profiles", candidateProfilesReadState("AZ"), EDGE.profiles],
    ["the candidate publications", currentStateAuthorityProjection("candidate-publications", "AZ")!.result, EDGE.corpus],
    ["FEC funding", fundingReadState(), EDGE.funding],
    ["Arizona money", stateMoneyReadState("AZ"), EDGE.stateMoney("AZ")],
  ] as const))) {
    assert.equal(state.kind, "PROMOTED", `${what} was not read as the promoted version`);
    assert.equal(state.metadata.versionId, version, `${what} was not served from the edge`);
  }
});

test("a cold /ballot?zip=85641 renders both LD17 and LD19 and U.S. House 6 from the published Census edge", async () => {
  process.env.WTP_READER_EDGE_DIR = ballotEdgeDir;
  const { text, contestIds } = await renderBallot("85641");
  const expected = ["state-senate-17", "state-senate-19", "state-house-17", "state-house-19", "us-house-6"];
  const rendered = [...contestIds].map(id => id.split(":").at(-1)!).filter(id => /^(?:state-senate|state-house|us-house)-/.test(id));
  assert.deepEqual(rendered.sort(), expected.sort());
  for (const title of ["State Senator, District 17", "State Senator, District 19", "State Representative, District 17", "State Representative, District 19", "U.S. Representative, District 6"]) {
    assert.ok(text.includes(title), `the reader did not see ${title}`);
  }
  assert.doesNotMatch(text, /We're working on getting the (?:U\.S\. House|State Senate|State House) district|District contests may be missing/);
  assert.deepEqual(databaseReads, [], "the rendered split-ZIP ballot read the database");
});

test("a Houston ballot with only cd:119 shows the exact U.S. House district note, then a held cd:120 supplies its House contest", async () => {
  process.env.WTP_READER_EDGE_DIR = houstonEdgeDirs[0]!;
  const old = await renderBallot("77002");
  assert.deepEqual([...old.contestIds].sort(), ["ballot-tx-plan-policy:governor"]);
  const note = "We're working on getting the U.S. House district for ZIP 77002. U.S. House contests aren't shown until we have it.";
  assert.ok(old.text.includes(note), "the reader needs the exact office-specific district gap note");
  assert.doesNotMatch(old.text, /We're working on getting the State (?:Senate|House) district/);
  assert.deepEqual(databaseReads, [], "the missing House district does not cause a database read");

  process.env.WTP_READER_EDGE_DIR = houstonEdgeDirs[1]!;
  const successor = await renderBallot("77002");
  assert.deepEqual([...successor.contestIds].sort(), ["ballot-tx-plan-policy:governor", "ballot-tx-plan-policy:us-house-38"]);
  assert.ok(successor.text.includes("U.S. Representative, District 38"));
  assert.ok(!successor.text.includes(note), "the district note clears when its election plan is held");
  assert.deepEqual(databaseReads, [], "the complete House plan is served entirely from the edge");
});

test("BL-10: assembly through promotion and the reader edge shows complete contests and named gaps, including a held-only ballot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ballot-contest-holds-"));
  const oldEnv = { DATABASE_URL: process.env.DATABASE_URL, WTP_RUNTIME_MODE: process.env.WTP_RUNTIME_MODE,
    WTP_DB_ROLE: process.env.WTP_DB_ROLE, WTP_SANCTIONED_WRITE: process.env.WTP_SANCTIONED_WRITE, WTP_CONTROL_PLANE_DATABASE_URL: process.env.WTP_CONTROL_PLANE_DATABASE_URL };
  Object.assign(process.env, { DATABASE_URL: "postgres://fixture:fixture@localhost/fixture", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", WTP_CONTROL_PLANE_DATABASE_URL: "postgres://fixture:fixture@localhost/control" });
  try {
    for (const allHeld of [false, true]) {
      const state = JSON.parse(readFileSync("tests/fixtures/ballot-national/tx.json", "utf8")) as BallotStateFile;
      const ballot = Object.values(state.ballots)[0];
      ballot.contests[0].candidateListComplete = false;
      ballot.contests[1].candidateListComplete = !allHeld;
      ballot.candidacies = ballot.candidacies.filter(candidate => !allHeld && candidate.contestId === ballot.contests[1].id);
      ballot.contests.push({ ...ballot.contests[0], id: "outside-district", title: "Fixture District 99", ocdId: "ocd-division/country:us/state:tx/cd:99" });
      writeFileSync(join(directory, "tx.json"), JSON.stringify(state));
      const store = new MemoryRoutineDataStore(), now = "2026-10-14T00:00:00.000Z";
      const publication = await runBallotPublication({ state: "TX", directory, store, now });
      assert.deepEqual(publication.report.skipped, []);
      assert.equal(publication.report.status, "PUBLISHED", publication.report.reason ?? "");
      const read = await readGenericBallotProjection("TX", { store, now, bypassCache: true });
      assert.equal(read.kind, "PROMOTED");
      if (read.kind !== "PROMOTED") throw new Error("The assembled ballot was not published.");
      const versionId = read.metadata.versionId!;
      const family = promotedFamily([manual("ballot-contests:TX", read.value, versionId)], versionId);
      const census = houstonPolicyDistricts(true);
      process.env.WTP_READER_EDGE_DIR = await publishEdge(true, {
        "census-districts": { value: census, versionId: census.versionId },
      }, { "ballot-contests": { TX: family } });
      const edgeStore = new LocalFileArtifactStore(process.env.WTP_READER_EDGE_DIR);
      const edge = (await ensureReaderAuthorityEdge(null, edgeStore))!;
      assert.ok(await edgeStore.readJsonPointer(authorityPointerKey("ballot-contests", "TX")));
      const edgeRead = await withReaderAuthorityEdge(edge, () => readGenericBallotProjection("TX"));
      assert.equal(edgeRead.kind, "PROMOTED", JSON.stringify(edgeRead));
      if (edgeRead.kind === "PROMOTED") assert.deepEqual(edgeRead.value, read.value);
      const sources = await withReaderAuthorityEdge(edge, () => readerBallotSourcesForDivisions(["ocd-division/country:us/state:tx"]));
      assert.equal(sources.length, 1, "a ballot with only named gaps remains a reader source");
      const targetSource = await withReaderAuthorityEdge(edge, () => readerBallotSourceForTargetId("fixture-tx-governor", ["ocd-division/country:us/state:tx"]));
      assert.equal(targetSource?.source.name, sources[0].source.name, "a held contest retains its ballot source");
      const rendered = await renderBallot("77002");
      assert.match(rendered.text, /Contests we don't hold yet/);
      assert.match(rendered.text, /Governor.*The official candidate list hasn.t been fully checked/);
      assert.match(rendered.text, /We're working on finding verified candidates/);
      assert.doesNotMatch(rendered.text, /Alice Adams|Fixture District 99|We do not have a ballot for this location yet/);
      assert.equal(rendered.text.includes("Bob Baker"), !allHeld);
      assert.deepEqual([...rendered.contestIds].sort(), ["fixture-tx-governor", "fixture-tx-senate"]);
      const { POST } = await import("../app/api/ballot/scope/route.ts");
      const response = await withReaderAuthorityEdge(edge, () => POST(new Request("https://example.org/api/ballot/scope", {
        method: "POST", body: JSON.stringify({ lat: 29.7569, lng: -95.3656, zip: "77002" }),
      })));
      assert.equal(response.status, 200);
      const scope = await response.json();
      assert.deepEqual(scope.contestIds.sort(), ["fixture-tx-governor", "fixture-tx-senate"]);
      const { POST: resolveAddress } = await import("../app/api/address/resolve/route.ts");
      const addressFixture = readFileSync("tests/fixtures/census-address-tx.json", "utf8");
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        return url.hostname === "geocoding.geo.census.gov"
          ? new Response(addressFixture, { status: 200, headers: { "content-type": "application/json" } })
          : previousFetch(input, init);
      }) as typeof fetch;
      try {
        const addressResponse = await withReaderAuthorityEdge(edge, () => resolveAddress(new Request("https://example.org/api/address/resolve", {
          method: "POST", body: JSON.stringify({ zip: "78701", houseNumber: "1100", street: "Congress Ave",
            selection: { purpose: "election", asOf: "2026-10-14", electionDate: "2026-11-03" } }),
        })));
        assert.equal(addressResponse.status, 200);
        const address = await addressResponse.json();
        assert.deepEqual(address.contestIds.sort(), ["fixture-tx-governor", "fixture-tx-senate"], "address narrowing retains the exact in-scope contest gaps");
      } finally { globalThis.fetch = previousFetch; }
      assert.deepEqual(databaseReads, [], "verified candidates and named gaps are both served from the reader edge");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(oldEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("a cold New Hampshire ballot loads its state ballot and General Court edge while selecting only its registry place", async () => {
  process.env.WTP_READER_EDGE_DIR = ballotEdgeDir;
  const edgeStore = new LocalFileArtifactStore(ballotEdgeDir);
  const ref = async (family: Parameters<typeof authorityPointerKey>[0], place: string) => (await readServedPointer(edgeStore, authorityPointerKey(family, place)))!.ref;
  const keys: string[] = [];
  const originalRead = LocalFileArtifactStore.prototype.readBytes;
  LocalFileArtifactStore.prototype.readBytes = async function (key) { keys.push(key); return originalRead.call(this, key); };
  try {
    await renderBallot("03255");
  } finally {
    LocalFileArtifactStore.prototype.readBytes = originalRead;
  }
  assert.deepEqual(databaseReads, [], "a cold NH /ballot with the whole edge read the database");
  const bundle = await ensureReaderAuthorityEdge(null, edgeStore);
  await withReaderAuthorityEdge(bundle, async () => {
    await readGenericBallotProjection("NH");
    assert.deepEqual(currentGenericBallotProjection("NH").ballots[ballotElectionKey(nhBallot)], nhBallot);
  });
  assert.equal((await ref("ballot-contests", "NH")).version, EDGE.ballots);
  assert.ok(keys.includes((await ref("state-legislators", "US-NH")).key), "the requested NH roster came from its jurisdiction edge artifact");
  assert.equal(keys.includes((await ref("ballot-contests", "AZ")).key), false, "an NH ballot never fetches Arizona ballot bytes");
  assert.equal(keys.includes((await ref("state-legislators", "US-AZ")).key), false, "an NH ballot does not load another state's people");
  assert.equal(keys.includes((await ref("registry-runtime", "AZ")).key), false, "an NH ballot does not load country registry bytes");
});

const nationalReaderCases = [
  { zip: "85701", contests: 22, candidates: 24,
    contestHash: "a2b93fbe3e669b28e1a63f193ecff3fe1721c99bc91762e9d0ce5b24a97cea83",
    heldCandidates: [
      "ballot-az-pima:governor|Katie Hobbs",
      "ballot-az-pima:governor|Andy Biggs",
      "ballot-az-pima:governor|Risa Lombardo",
      "ballot-az-pima:governor|Teri Ann Hourihan",
      "ballot-az-pima:secretary-of-state|Adrian Fontes",
      "ballot-az-pima:secretary-of-state|Alexander Kolodin",
      "ballot-az-pima:secretary-of-state|Duwayne Collier",
      "ballot-az-pima:attorney-general|Kris Mayes",
      "ballot-az-pima:attorney-general|Warren Petersen",
      "ballot-az-pima:state-treasurer|Nick Mansour",
      "ballot-az-pima:state-treasurer|Elijah Norton",
      "ballot-az-pima:superintendent|Teresa Leyba Ruiz",
      "ballot-az-pima:superintendent|Kimberly Yee",
      "ballot-az-pima:mine-inspector|Brian Matlock",
      "ballot-az-pima:mine-inspector|Walter \"Les\" Presmyk",
      "ballot-az-pima:us-house-7|Adelita Grijalva",
      "ballot-az-pima:us-house-7|Daniel Francis Butierez Sr.",
      "ballot-az-pima:state-senate-20|Alma Hernandez",
      "ballot-az-pima:state-house-20|Sally Ann Gonzales",
      "ballot-az-pima:state-house-20|Betty Villegas",
      "ballot-az-pima:corporation-commissioner:hill",
      "ballot-az-pima:corporation-commissioner:pratte",
      "ballot-az-pima:corporation-commissioner:thompson"
],
    sources: ["https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
      "https://apps.azsos.gov/election/2026/canvass/20260806_Primary_Canvass.pdf", "https://apps.azsos.gov/election/2026/canvass/2026_Primary_Canvass_Pima.pdf"] },
  { zip: "03255", contests: 13, candidates: 47,
    contestHash: "b4a7a32dcce7c74631f8eb4aab6e64a00e6d38435a2b4196ec7633a30afee2db",
    candidateHash: "e0221e2a94941ba60461b34868892bfb533bf36e1576ae1b688396c62ce345d5",
    sources: ["https://www.sos.nh.gov/sites/g/files/ehbemt561/files/docs/cumulative-filings-7.16.26.pdf"] },
  { zip: "07960", contests: 22, candidates: 53,
    contestHash: "d929e1057ff955fc1b67170758a02e176c5421341967c49d4106605f8d30dd68",
    candidateHash: "3f46869ee22fc55ef7af34ffbf0db8d35ed2dabe8a232e4555fc6a31d658a906",
    sources: ["https://www.morriscountyclerk.org/files/sharedassets/clerk/v/11/elections/past-results/2026-general-election-candidates-9012026.pdf",
      "https://www.morriscountyclerk.org/files/sharedassets/clerk/v/12/elections/past-results/2026-general-candidates.pdf",
      "https://www.morriscountyclerk.org/files/sharedassets/clerk/v/17/elections/past-results/2026-general-school-candidates.pdf"] },
] as const;
const idHash = (ids: Set<string>) => createHash("sha256").update([...ids].sort().join("\n")).digest("hex");

for (const expected of nationalReaderCases) test(`BL-30: ${expected.zip} preserves every live contest, candidate and election source on the national ballot edge`, async () => {
  process.env.WTP_READER_EDGE_DIR = ballotEdgeDir;
  const rendered = await renderBallot(expected.zip);
  assert.equal(rendered.contestIds.size, expected.contests, [...rendered.contestIds].join("\n"));
  assert.equal(idHash(rendered.contestIds), expected.contestHash, [...rendered.contestIds].join("\n"));
  if ("heldCandidates" in expected) {
    const aliases = new Map(azBallot.lineupReconciliation!.rows.filter(row => row.outcome === "RECONCILED").map(row => [row.cardKey, row.canonicalCandidacyId]));
    const canonical = (id: string) => aliases.get(id) ?? id;
    const subjects = new Set([...rendered.candidateIds].map(canonical));
    for (const id of expected.heldCandidates) assert.ok(subjects.has(canonical(id)), `The reader lost ${id}`);
  } else if (expected.zip === "03255") {
    const subjects = new Set([...rendered.candidateIds, ...rendered.filingCandidateIds]);
    assert.equal(subjects.size, 52, "all original filings and five verified general additions remain accessible");
    assert.equal(rendered.filingCandidateIds.size, 25, "primary-only filings are identified separately");
    assert.equal(rendered.candidateIds.size, 27);
    const original = new Set([...subjects].filter(id => id.startsWith("ballot-nh-merrimack:")));
    assert.equal(original.size, expected.candidates);
    assert.equal(idHash(original), expected.candidateHash);
  } else {
    assert.equal(rendered.candidateIds.size, expected.candidates, [...rendered.candidateIds].join("\n"));
    assert.equal(idHash(rendered.candidateIds), expected.candidateHash, [...rendered.candidateIds].join("\n"));
  }
  for (const source of expected.sources) assert.ok(rendered.sourceUrls.has(source), `The reader lost ${source}`);
  assert.deepEqual(databaseReads, [], "the national ballot and its cards use the published edge");
});

test("BL-30: Arizona additions and the corrected Corporation Commission slate each cite their official filing", async () => {
  process.env.WTP_READER_EDGE_DIR = ballotEdgeDir;
  const rendered = await renderBallot("85701");
  const commissioner = azBallot.generalLineup!.contests.find(contest => contest.contestId.endsWith(":corporation-commissioner"))!;
  const source = "https://storageccec.blob.core.usgovcloudapi.net/public/docs/1509-1497AllDistrictWebEnglishv2.pdf";
  assert.deepEqual(commissioner.nominees.map(nominee => nominee.name).sort(), ["Clara Pratte", "Jonathon Hill", "Kevin Thompson", "Mike Cease", "Ralph Heap"]);
  assert.ok(azBallot.filingCandidacies?.some(candidate => candidate.id === "ballot-az-pima:corporation-commissioner:myers"), "the superseded filing remains held");
  assert.equal([...rendered.candidateIds].some(id => !rendered.filingCandidateIds.has(id) && /(?:myers|Nicholas Myers)$/.test(id)), false, "the current official slate supersedes the prior Myers filing");
  for (const nominee of commissioner.nominees) assert.equal(nominee.provenance?.sourceUrl, source);
  for (const lineup of azBallot.generalLineup!.contests.filter(lineup => rendered.contestIds.has(lineup.contestId))) {
    for (const nominee of lineup.nominees) {
      if (!nominee.provenance) continue;
      const id = `${lineup.contestId}|${nominee.name}`;
      assert.ok(rendered.candidateIds.has(id), `The reader omitted the verified ${nominee.name} filing`);
      assert.deepEqual(rendered.candidateSources.get(id), [nominee.provenance.sourceUrl]);
    }
  }
  assert.ok(rendered.text.includes("General-election candidates"));
  assert.deepEqual(databaseReads, []);
});

test("BL-30: ZIP 85260 renders the complete official Arizona District 1 House race from the national edge", async () => {
  process.env.WTP_READER_EDGE_DIR = ballotEdgeDir;
  const rendered = await renderBallot("85260");
  const house = azBallot.contests.find(contest => contest.ocdId === "ocd-division/country:us/state:az/cd:1")!;
  assert.ok(house, "the national Arizona file holds District 1");
  assert.equal(house.candidateListComplete, true);
  assert.ok(rendered.contestIds.has(house.id), "the AZ-01 ZIP shows its House race");
  assert.ok(house.provenance.sourceUrl, "the House race has an official source");
  assert.ok(rendered.sourceUrls.has(house.provenance.sourceUrl));
  assert.deepEqual(databaseReads, [], "the added House race uses the published edge");
});

test("with no edge published, the ballot reads only its named state authorities from the database", async () => {
  delete process.env.WTP_READER_EDGE_DIR;
  await renderBallot("85701").catch(() => undefined);
  const classes = new Set(databaseReads.map((read) => read.recordClass));
  assert.ok(classes.has("BALLOT_CANDIDACY"), "the named state ballot was not read without an edge");
  assert.equal(classes.has("REGISTRY_RUNTIME_BINDING"), false, "the missing edge cannot trigger a country registry read");
});

test("one promoted version is one authority key, whether the edge primed it (BOOTSTRAP) or the database read it (PROMOTED)", () => {
  const read = (kind: string, versionId: string | null) => ({ kind, metadata: { versionId } });
  assert.equal(authorityVersionKey(read("BOOTSTRAP", "v1")), authorityVersionKey(read("PROMOTED", "v1")));
  assert.notEqual(authorityVersionKey(read("BOOTSTRAP", "v1")), authorityVersionKey(read("PROMOTED", "v2")), "a new version is a new key");
  assert.notEqual(authorityVersionKey(read("STORE_UNREACHABLE", "v1")), authorityVersionKey(read("PROMOTED", "v1")), "a failed read never shares a served key");
  // A first seed carries its own version id, so it never shares a promoted version's key.
  assert.notEqual(authorityVersionKey(read("BOOTSTRAP", "bootstrap:registry-runtime")), authorityVersionKey(read("PROMOTED", REGISTRY_VERSION)));
});


test("ballot reads isolate concurrent states and slice every candidate to the requested divisions", async () => {
  const store = new LocalFileArtifactStore(ballotEdgeDir);
  const manifest = (await store.readManifest())!.manifest;
  const azRequest = await ensureReaderAuthorityEdge(manifest, store, ["ballot-contests"]);
  const nhRequest = await ensureReaderAuthorityEdge(manifest, store, ["ballot-contests"]);
  await withReaderAuthorityEdge(azRequest, async () => {
    const divisions = ["ocd-division/country:us/state:az/cd:1"];
    const sources = await readerBallotSourcesForDivisions(divisions);
    assert.equal(sources.length, 1);
    const ballot = sources[0].source.normalize(await sources[0].source.fetch());
    assert.ok(ballot.contests.some(contest => contest.ocdId === divisions[0]));
    assert.ok(ballot.contests.every(contest => contest.ocdId === divisions[0] || contest.ocdId === "ocd-division/country:us/state:az"));
    const contestIds = new Set(ballot.contests.map(contest => contest.id));
    assert.ok(ballot.candidacies.every(candidate => contestIds.has(candidate.contestId)));
    assert.ok((ballot.filingCandidacies ?? []).every(candidate => contestIds.has(candidate.contestId)));
    const filing = ballot.filingCandidacies?.[0];
    assert.ok(filing, "the scoped ballot preserves earlier filings");
    assert.ok(await readerBallotSourceForTargetId(filing.id, divisions));
    assert.throws(() => currentGenericBallotProjection("NH"), /UNREAD/);
    await withReaderAuthorityEdge(nhRequest, async () => {
      await readGenericBallotProjection("NH");
      assert.throws(() => currentGenericBallotProjection("AZ"), /UNREAD/);
      assert.deepEqual(Object.keys(currentGenericBallotProjection("NH").ballots), [ballotElectionKey(nhBallot)]);
    });
    assert.deepEqual(Object.keys(currentGenericBallotProjection("AZ").ballots), [ballotElectionKey(azBallot)]);
  });
});


test("publication rejects retained filing collisions, broken contest joins and duplicate embedded identities", () => {
  const invalid = (change: (ballot: BallotSet) => void, expected: RegExp) => {
    const ballot = structuredClone(azBallot);
    change(ballot);
    const problems = genericBallotProblems({ kind: "ballot-contests", ballots: { [ballotElectionKey(ballot)]: ballot } }, "AZ");
    assert.match(problems.join(" "), expected);
  };
  invalid(ballot => { ballot.filingCandidacies!.push(structuredClone(ballot.candidacies[0])); }, /retained filing repeats/);
  invalid(ballot => { ballot.filingCandidacies!.push(structuredClone(ballot.filingCandidacies![0])); }, /retained filing repeats/);
  invalid(ballot => { ballot.filingCandidacies![0].contestId = "another-state-contest"; }, /exact contest/);
  invalid(ballot => { ballot.filingCandidacies![0].familyName = ""; }, /filed name/);
  invalid(ballot => { ballot.filingCandidacies![0].provenance.sourceUrl = null; }, /source/);
  invalid(ballot => { ballot.filingCandidacies![0].identity!.identityId = ballot.candidacies[0].identity!.identityId; }, /embedded ballot identity/);
  invalid(ballot => { ballot.contests[0].identity!.identityId = ballot.contests[1].identity!.identityId; }, /embedded ballot identity/);
});
