import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

import { ensureReaderAuthorityEdge, publishReaderEdgeArtifacts, type PublishAuthority } from "../lib/meetings/edge-serving.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import type { PromotedAuthorityFamily, PromotedFamilyArtifactValue } from "../lib/meetings/edge-artifacts.ts";
import type { CensusDistrictEdge } from "../lib/census-geography/district-edge.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { ballotElectionKey, currentGenericBallotProjection, genericBallotProblems, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { reconciledCandidacyIdForCard } from "../lib/identity/az-2026.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { assembleBallotPackage, type BallotStateFile } from "../scripts/assemble-ballot-package.mts";
import { manualProjectionCandidate } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { readerBallotSourceForTargetId, readerBallotSources } from "../lib/ballot/reader-sources.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import {
  candidateCorpusReadState,
  candidateProfilesReadState,
} from "../lib/civic-data/manual-read-models.ts";
import { DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE } from "../lib/civic-data/derived-campaign-sites.ts";
import { fundingReadState, readFundingSnapshot } from "../lib/funding/snapshot.ts";
import { stateMoneyReadState } from "../lib/funding/state-snapshot.ts";
import { readNhMembers } from "../lib/civic-data/state-members.ts";
import { readOfficialStateLegislatorsProjection } from "../lib/state-rollcalls/legislators.ts";
import { POLLING_PLACE_LINKS } from "../lib/ballot/polling-place-links.ts";
import { REGISTRATION_LINKS } from "../lib/ballot/registration-links.ts";
import { registryRuntimeReadState } from "../lib/registry/runtime-read-model.ts";
import { federalDirectoryReadState } from "../lib/officials/federal-directory-read-model.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES, type StateCampaignFinanceJurisdiction } from "../lib/funding/data-plane.ts";
import {
  registryTransferImport,
  stateMoneyFixture,
  syntheticCandidateCorpus,
  syntheticCandidateProfiles,
  syntheticFederalDirectory,
} from "./helpers/promoted-fixtures.ts";
import { authorityVersionKey } from "../lib/registry/server.ts";
import {
  absentEdgeEntry,
  manualEdgeEntry,
  promotedFamily,
  provenEdgeEntry,
  servedValue,
} from "./helpers/promoted-edge-entry.ts";
import { azBallot as committedAzBallot, azDistricts } from "./helpers/ballot-district-fixtures.ts";

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
const districts: CensusDistrictEdge = { ...azDistricts, versionId: "edge-test:ballot:districts",
  containers: [...azDistricts.containers, ...njDistricts],
  codes: { ...azDistricts.codes, "07960": njDistricts.map((_, index) => [azDistricts.containers.length + index, false, null]) },
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
const PROMOTED_BALLOT_FAMILIES: Partial<Record<PromotedAuthorityFamily, { value: PromotedFamilyArtifactValue; versionId: string }>> = {
  "ballot-contests": promotedFamily([manual("ballot-contests", { kind: "ballot-contests", ballots: {
    [ballotElectionKey(azBallot)]: azBallot, [ballotElectionKey(nhBallot)]: nhBallot, [ballotElectionKey(njBallot)]: njBallot,
  } }, EDGE.ballots)], EDGE.ballots),
  "candidate-profiles": promotedFamily([
    manual("candidate-profiles", profiles, EDGE.profiles),
    absentEdgeEntry(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE),
  ], EDGE.profiles),
  "candidate-publications": promotedFamily([manual("candidate-corpus", corpus, EDGE.corpus)], EDGE.corpus),
  "ballot-navigation": promotedFamily([manual("ballot-navigation", navigation, "edge-test:ballot:navigation")], "edge-test:ballot:navigation"),
  "official-filings": promotedFamily([absentEdgeEntry("CURATED_READER_RECORD", requiredManualProductionContract("official-filings").scope)], "edge-test:filings:absent"),
  "nh-members": promotedFamily([provenEdgeEntry({ recordClass: nhRoster.recordClass, scope: nhRoster.scope, sourceId: nhRoster.sourceId, versionId: EDGE.nhMembers, value: nhMembers })], EDGE.nhMembers),
  "federal-funding": promotedFamily([
    provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: fec.scope, sourceId: fec.sourceId, versionId: EDGE.funding, value: funding }),
    manual("campaign-finance", { kind: "campaign-finance", records: [] }, EDGE.campaignFinance),
  ], EDGE.funding),
  "state-money": promotedFamily(stateMoneyFixtureEntries(EDGE.stateMoney), "edge-test:ballot:money"),
};

async function publishEdge(withPromoted: boolean, authorityOverrides: PublishAuthority = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-ballot-edge-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const authority: PublishAuthority = {
    "registry-runtime": { value: registryTransferImport().projection.payload, versionId: REGISTRY_VERSION },
    "federal-directory": { value: federal, versionId: FEDERAL_VERSION },
    "census-districts": { value: districts, versionId: districts.versionId },
    ...(withPromoted ? PROMOTED_BALLOT_FAMILIES : {}),
    ...authorityOverrides,
  };
  const published = await publishReaderEdgeArtifacts({
    formatVersion: 1,
    generatedAt: "2026-09-25T00:00:00.000Z",
    counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 },
    sources: [],
    meetings: [],
    agendaDocuments: [],
  }, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, { store: new LocalFileArtifactStore(dir), authority,
    registrations: {},
    stateLegislators: {
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
const txPolicyFamily = promotedFamily([manual("ballot-contests", txPolicyProjection, "edge-test:houston-policy:ballot")], "edge-test:houston-policy:ballot");
const houstonEdgeDirs = await Promise.all([false, true].map(async withSuccessor => {
  const value = houstonPolicyDistricts(withSuccessor);
  return publishEdge(true, { "census-districts": { value, versionId: value.versionId }, "ballot-contests": txPolicyFamily });
}));

// Every database request this process makes, by record class, answered with no rows.
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
  for (const query of queries) {
    // The daily byte counter writes an aggregate, not a civic pointer read.
    if (/^\s*INSERT INTO database_transfer_daily\b/.test(query.query ?? "")) continue;
    const recordClass = (query.params ?? []).find((p): p is string => typeof p === "string" && /^[A-Z][A-Z_]+$/.test(p) && p !== "UNCHANGED_CONFIRMATION_V1");
    databaseReads.push({ phase, recordClass: recordClass ?? "UNKNOWN" });
  }
  const empty = { command: "SELECT", rowCount: 0, rows: [], fields: [] };
  return new Response(JSON.stringify(body.queries ? { results: queries.map(() => empty) } : empty), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

/** One cold render: the page, then every async component it returned, called from outside the page. */
async function renderBallot(zip: string): Promise<{ components: Map<string, number>; text: string; contestIds: Set<string>; candidateIds: Set<string>; sourceUrls: Set<string>; candidateSources: Map<string, string[]> }> {
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
  const sourceUrls = new Set<string>();
  const candidateSources = new Map<string, string[]>();
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
    const contestId = element.props?.["data-contest-id"] ?? (element.props?.attrs as Record<string, unknown> | undefined)?.["data-contest-id"];
    if (typeof contestId === "string") contestIds.add(contestId);
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
  return { components, text: text.join(" "), contestIds, candidateIds, sourceUrls, candidateSources };
}

const MAP_FAMILIES = ["REGISTRY_RUNTIME_BINDING", "FEDERAL_DIRECTORY", "STATE_LEGISLATOR"];
const MOVED_FAMILIES = ["BALLOT_CANDIDACY", "CURATED_READER_RECORD"];

test("React renders the page's async components outside the page's context: they see its edge only when handed it", () => {
  // Next's own compiled React Flight server, with the react-server condition it runs under.
  const runtimeEdge = pathToFileURL(join(process.cwd(), "lib", "registry", "runtime-edge.ts")).href;
  const script = `
    import { createRequire } from "node:module";
    const load = createRequire(${JSON.stringify(pathToFileURL(join(process.cwd(), "package.json")).href)});
    const React = load("react");
    const { renderToPipeableStream } = load("next/dist/compiled/react-server-dom-webpack/server.node.js");
    const { enterReaderAuthorityEdge, withReaderAuthorityEdge, currentRegistryRuntimeEdge } = await import(${JSON.stringify(runtimeEdge)});
    const bundle = { registryRuntime: { value: {}, versionId: "flight-probe" } };
    const seen = () => currentRegistryRuntimeEdge()?.versionId ?? "none";
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

test("with only map families on the edge, a cold ballot reads exactly its missing ballot pointers, and never a map family", async () => {
  process.env.WTP_READER_EDGE_DIR = mapEdgeDir;
  await renderBallot("85701");
  assert.deepEqual(databaseReads.filter((read) => MAP_FAMILIES.includes(read.recordClass)), [], "a family the edge publishes was read from the database");
  assert.deepEqual(databaseReads.map((read) => read.recordClass).sort(), MOVED_FAMILIES);
  assert.deepEqual(databaseReads.filter((read) => read.phase === "components"), [], "a card read the database");
});

test("a cold /ballot?zip=85701 with the whole ballot edge makes no database read at all, in the page or in any card", async () => {
  process.env.WTP_READER_EDGE_DIR = ballotEdgeDir;
  const { components, text, contestIds } = await renderBallot("85701");
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
  assert.equal(registryRuntimeReadState().metadata?.versionId, REGISTRY_VERSION, "the registry was not served from the edge");
  assert.equal(federalDirectoryReadState().metadata?.versionId, FEDERAL_VERSION, "the federal directory was not served from the edge");
  // Each family is the edge's proven copy, read as PROMOTED through its own Reader.
  for (const [what, state, version] of [
    ["the candidate profiles", candidateProfilesReadState(), EDGE.profiles],
    ["the candidate publications", candidateCorpusReadState(), EDGE.corpus],
    ["FEC funding", fundingReadState(), EDGE.funding],
    ["Arizona money", stateMoneyReadState("AZ"), EDGE.stateMoney("AZ")],
  ] as const) {
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

test("BL-10: assembly through promotion and the reader edge shows verified candidates and named gaps, including a held-only ballot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ballot-contest-holds-"));
  try {
    for (const allHeld of [false, true]) {
      const state = JSON.parse(readFileSync("tests/fixtures/ballot-national/tx.json", "utf8")) as BallotStateFile;
      const ballot = Object.values(state.ballots)[0];
      ballot.contests[0].candidateListComplete = false;
      ballot.contests[1].candidateListComplete = false;
      ballot.candidacies = ballot.candidacies.filter(candidate => !allHeld && candidate.contestId === ballot.contests[1].id);
      ballot.contests.push({ ...ballot.contests[0], id: "outside-district", title: "Fixture District 99", ocdId: "ocd-division/country:us/state:tx/cd:99" });
      writeFileSync(join(directory, "tx.json"), JSON.stringify(state));
      const store = new MemoryRoutineDataStore(), now = "2026-10-14T00:00:00.000Z";
      const assembled = await assembleBallotPackage({ directory, store, now });
      assert.deepEqual(assembled.skipped, []);
      const outcome = await processRegisteredManualCandidate(store, "ballot-contests", manualProjectionCandidate(assembled.package), now);
      assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? JSON.stringify(outcome.candidate.receipt));
      const read = await readGenericBallotProjection({ store, now, bypassCache: true });
      assert.equal(read.kind, "PROMOTED");
      if (read.kind !== "PROMOTED") throw new Error("The assembled ballot was not published.");
      const versionId = read.metadata.versionId!;
      const family = promotedFamily([manual("ballot-contests", read.value, versionId)], versionId);
      const census = houstonPolicyDistricts(true);
      process.env.WTP_READER_EDGE_DIR = await publishEdge(true, {
        "ballot-contests": family, "census-districts": { value: census, versionId: census.versionId },
      });
      const edgeStore = new LocalFileArtifactStore(process.env.WTP_READER_EDGE_DIR);
      const edge = await ensureReaderAuthorityEdge((await edgeStore.readManifest())!.manifest, edgeStore);
      assert.equal(edge.promoted?.get("BALLOT_CANDIDACY:US:state-election-ballots")?.kind, "PROMOTED");
      const edgeRead = await withReaderAuthorityEdge(edge, () => readGenericBallotProjection());
      assert.equal(edgeRead.kind, "PROMOTED", JSON.stringify(edgeRead));
      if (edgeRead.kind === "PROMOTED") assert.deepEqual(edgeRead.value, read.value);
      const sources = await withReaderAuthorityEdge(edge, () => readerBallotSources());
      assert.equal(sources.length, 1, "a ballot with only named gaps remains a reader source");
      const targetSource = await withReaderAuthorityEdge(edge, () => readerBallotSourceForTargetId("fixture-tx-governor"));
      assert.equal(targetSource?.source.name, sources[0].source.name, "a held contest retains its ballot source");
      const rendered = await renderBallot("77002");
      assert.match(rendered.text, /Contests we don't hold yet/);
      assert.match(rendered.text, /Governor.*No candidates have been verified for this contest yet/);
      assert.match(rendered.text, /We're working on finding verified candidates/);
      assert.doesNotMatch(rendered.text, /Alice Adams|Fixture District 99|We do not have a ballot for this location yet/);
      assert.equal(rendered.text.includes("Bob Baker"), !allHeld);
      assert.deepEqual([...rendered.contestIds].sort(), ["fixture-tx-governor", "fixture-tx-senate"]);
      const { POST } = await import("../app/api/ballot/scope/route.ts");
      const response = await withReaderAuthorityEdge(edge, () => POST(new Request("https://example.org/api/ballot/scope", {
        method: "POST", body: JSON.stringify({ lat: 29.7569, lng: -95.3656 }),
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
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a cold /ballot?zip=03255 (Newbury, New Hampshire) with the whole ballot edge reads its ballot and the General Court roster from it, and nothing from the database", async () => {
  process.env.WTP_READER_EDGE_DIR = ballotEdgeDir;
  const manifest = (await new LocalFileArtifactStore(ballotEdgeDir).readManifest())!.manifest;
  const keys: string[] = [];
  const originalRead = LocalFileArtifactStore.prototype.readBytes;
  LocalFileArtifactStore.prototype.readBytes = async function (key) { keys.push(key); return originalRead.call(this, key); };
  try {
    await renderBallot("03255");
  } finally {
    LocalFileArtifactStore.prototype.readBytes = originalRead;
  }
  assert.deepEqual(databaseReads, [], "a cold NH /ballot with the whole edge read the database");
  assert.deepEqual(currentGenericBallotProjection().ballots[ballotElectionKey(nhBallot)], nhBallot);
  assert.equal(manifest.authorityArtifacts!["ballot-contests"]!.version, EDGE.ballots);
  assert.ok(keys.includes(manifest.stateLegislators!["US-NH"].key), "the requested NH roster came from its jurisdiction edge artifact");
  assert.equal(keys.includes(manifest.stateLegislators!["US-AZ"].key), false, "an NH ballot does not load another state's people");
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
    const canonical = (id: string) => reconciledCandidacyIdForCard(id) ?? id;
    const subjects = new Set([...rendered.candidateIds].map(canonical));
    for (const id of expected.heldCandidates) assert.ok(subjects.has(canonical(id)), `The reader lost ${id}`);
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
  assert.ok(azBallot.candidacies.some(candidate => candidate.id === "ballot-az-pima:corporation-commissioner:myers"), "the superseded filing remains held");
  assert.equal([...rendered.candidateIds].some(id => /(?:myers|Nicholas Myers)$/.test(id)), false, "the current official slate supersedes the prior Myers filing");
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

test("with no edge published, the same render reads its authority from the database: the fallback stays", async () => {
  delete process.env.WTP_READER_EDGE_DIR;
  await renderBallot("85701").catch(() => undefined);
  const classes = new Set(databaseReads.map((read) => read.recordClass));
  // The fake database holds no pointer, so the render stops at the first authority it lacks: the registry.
  assert.ok(classes.has("REGISTRY_RUNTIME_BINDING"), "the registry was not read from the database without an edge");
  assert.equal(registryRuntimeReadState().kind, "NOT_RECORDED", "the database path answered for the registry, not the edge");
});

test("one promoted version is one authority key, whether the edge primed it (BOOTSTRAP) or the database read it (PROMOTED)", () => {
  const read = (kind: string, versionId: string | null) => ({ kind, metadata: { versionId } });
  assert.equal(authorityVersionKey(read("BOOTSTRAP", "v1")), authorityVersionKey(read("PROMOTED", "v1")));
  assert.notEqual(authorityVersionKey(read("BOOTSTRAP", "v1")), authorityVersionKey(read("PROMOTED", "v2")), "a new version is a new key");
  assert.notEqual(authorityVersionKey(read("STORE_UNREACHABLE", "v1")), authorityVersionKey(read("PROMOTED", "v1")), "a failed read never shares a served key");
  // A first seed carries its own version id, so it never shares a promoted version's key.
  assert.notEqual(authorityVersionKey(read("BOOTSTRAP", "bootstrap:registry-runtime")), authorityVersionKey(read("PROMOTED", REGISTRY_VERSION)));
});
