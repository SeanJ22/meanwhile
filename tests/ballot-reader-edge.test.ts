import assert from "node:assert/strict";
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
import { ballotElectionKey, genericBallotProblems, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { assembleBallotPackage, type BallotStateFile } from "../scripts/assemble-ballot-package.mts";
import { manualProjectionCandidate } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import {
  azBallotReadState,
  candidateCorpusReadState,
  candidateProfilesReadState,
  nhBallotReadState,
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
  syntheticAzBallot,
  syntheticCandidateCorpus,
  syntheticCandidateProfiles,
  syntheticFederalDirectory,
  syntheticNhBallot,
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

// The values the proven-pointer families carry, built before the fake database is installed: the committed
// Arizona ballot file as the ballot rows, the recorded registry import, and small synthetic values elsewhere.
const seedStore = new MemoryRoutineDataStore();
const azBallot = { ...syntheticAzBallot(), ballot: JSON.parse(readFileSync("data/states/az/ballot/az-pima-2026.json", "utf8")) };
// The synthetic NH ballot plus a state-senate race in every NH senate district the registry holds, so a NH
// reader's ballot carries the legislative race the General Court roster answers.
const nhSynthetic = syntheticNhBallot();
const nhSenateDistricts = registryTransferImport().projection.payload.registry.divisions.filter((division) => /\/state:nh\/sldu:\d+$/.test(division.ocdId));
const nhBallot = { ballot: { ...nhSynthetic.ballot,
  contests: [...nhSynthetic.ballot.contests, ...nhSenateDistricts.map((division) => ({ ...nhSynthetic.ballot.contests[0]!, id: `ballot-nh-test:state-senate-${division.ocdId.split(":").at(-1)}`, ocdId: division.ocdId, title: `State Senator, District ${division.ocdId.split(":").at(-1)}` }))],
  candidacies: [...nhSynthetic.ballot.candidacies, ...nhSenateDistricts.map((division) => ({ ...nhSynthetic.ballot.candidacies[0]!, id: `ballot-nh-test:state-senate-${division.ocdId.split(":").at(-1)}:candidate`, contestId: `ballot-nh-test:state-senate-${division.ocdId.split(":").at(-1)}` }))] } };
const profiles = syntheticCandidateProfiles();
const corpus = syntheticCandidateCorpus();
const federal = syntheticFederalDirectory();
const stateMoneyFixtureEntries = (version: (state: string) => string) => (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]).map((state) =>
  provenEdgeEntry({ recordClass: "STATE_CAMPAIGN_FINANCE", scope: STATE_CAMPAIGN_FINANCE_SOURCES[state].scope, sourceId: STATE_CAMPAIGN_FINANCE_SOURCES[state].sourceId, versionId: version(state), value: stateMoneyFixture(state) }));
const funding = servedValue(await readFundingSnapshot({ store: seedStore, bypassCache: true }));
const nhMembers = servedValue(await readNhMembers({ store: seedStore, bypassCache: true }));
const nhLegislators = servedValue(await readOfficialStateLegislatorsProjection("US-NH", { store: seedStore, bypassCache: true }));
// Arizona carries the committed publisher rows and their stored metadata. No
// synthetic election interval can conceal a production applicability defect.
const districts: CensusDistrictEdge = {
  ...azDistricts, versionId: "edge-test:ballot:districts",
  containers: [
    ...azDistricts.containers,
    { ref: { type: "state_leg_upper", version: "sldu:2024", geoid: "33008", ocdId: null, stateFips: "33", stateAbbr: "NH", memberStates: ["NH"], label: "NH State Senate District 8" }, plan: "NH reader-edge fixture" },
  ],
  codes: { ...azDistricts.codes, "03255": [[azDistricts.containers.length, true, 1]] },
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
  az: "edge-test:ballot:az",
  nh: "edge-test:ballot:nh",
  profiles: "edge-test:ballot:profiles",
  corpus: "edge-test:ballot:corpus",
  funding: "edge-test:ballot:fec",
  campaignFinance: "edge-test:ballot:campaign-finance",
  nhMembers: "edge-test:ballot:nh-members",
  stateMoney: (state: string) => `edge-test:ballot:money:${state}`,
};
const PROMOTED_BALLOT_FAMILIES: Partial<Record<PromotedAuthorityFamily, { value: PromotedFamilyArtifactValue; versionId: string }>> = {
  "ballot-contests": promotedFamily([absentEdgeEntry("BALLOT_CANDIDACY", "US:state-election-ballots")], "edge-test:general-ballot-absent"),
  "ballot-az": promotedFamily([manual("az-sos-ballot", azBallot, EDGE.az)], EDGE.az),
  "ballot-nh": promotedFamily([manual("nh-curated-ballot", nhBallot, EDGE.nh)], EDGE.nh),
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
  const published = await publishReaderEdgeArtifacts(null, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, { store: new LocalFileArtifactStore(dir), authority,
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
async function renderBallot(zip: string): Promise<{ components: Map<string, number>; text: string; contestIds: Set<string> }> {
  clearPromotedReadModelCache();
  databaseReads.length = 0;
  const { default: BallotPage } = await import("../app/ballot/page.tsx");
  phase = "page";
  const tree = await BallotPage({ searchParams: Promise.resolve({ zip }) });
  phase = "components";
  const components = new Map<string, number>();
  const text: string[] = [];
  const contestIds = new Set<string>();
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
      if (Object.getPrototypeOf(node) === Object.prototype) for (const value of Object.values(node)) await walk(value);
      return;
    }
    const contestId = element.props?.["data-contest-id"] ?? (element.props?.attrs as Record<string, unknown> | undefined)?.["data-contest-id"];
    if (typeof contestId === "string") contestIds.add(contestId);
    if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
      const name = element.type.name;
      components.set(name, (components.get(name) ?? 0) + 1);
      await walk(await (element.type as (props: unknown) => Promise<unknown>)(element.props ?? {}));
      return;
    }
    for (const value of Object.values(element.props ?? {})) await walk(value);
  };
  await walk(tree);
  return { components, text: text.join(" "), contestIds };
}

const MAP_FAMILIES = ["REGISTRY_RUNTIME_BINDING", "FEDERAL_DIRECTORY", "STATE_LEGISLATOR"];
// A map-only edge leaves the ballot and campaign-site authorities to the empty database.
const MOVED_FAMILIES = ["BALLOT_CANDIDACY", "BALLOT_CANDIDACY", "CURATED_READER_RECORD"];

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
    ["the Arizona ballot", azBallotReadState(), EDGE.az],
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

test("BL-10: assembly through promotion and the reader edge shows complete contests and named gaps, including a held-only ballot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ballot-contest-holds-"));
  try {
    for (const allHeld of [false, true]) {
      const state = JSON.parse(readFileSync("tests/fixtures/ballot-national/tx.json", "utf8")) as BallotStateFile;
      const ballot = Object.values(state.ballots)[0];
      ballot.contests[0].candidateListComplete = false;
      ballot.contests[1].candidateListComplete = !allHeld;
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
      const rendered = await renderBallot("77002");
      assert.match(rendered.text, /Contests we don't hold yet/);
      assert.match(rendered.text, /Governor.*The official candidate list hasn't been fully checked/);
      assert.match(rendered.text, /We're working on getting complete candidate lists/);
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
      assert.deepEqual(databaseReads, [], "complete contests and holds are both served from the reader edge");
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
  assert.equal(nhBallotReadState().kind, "PROMOTED");
  assert.equal(nhBallotReadState().metadata.versionId, EDGE.nh, "the NH ballot was not served from the edge");
  assert.ok(keys.includes(manifest.stateLegislators!["US-NH"].key), "the requested NH roster came from its jurisdiction edge artifact");
  assert.equal(keys.includes(manifest.stateLegislators!["US-AZ"].key), false, "an NH ballot does not load another state's people");
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
