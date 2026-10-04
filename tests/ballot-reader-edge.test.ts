import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

import { publishReaderEdgeArtifacts, type PublishAuthority } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import type { PromotedAuthorityFamily, PromotedFamilyArtifactValue } from "../lib/meetings/edge-artifacts.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import {
  azBallotReadState,
  candidateCorpusReadState,
  candidateProfilesReadState,
  nhBallotReadState,
  readAzBallotProjection,
  readCandidateCorpusProjection,
  readCandidateProfilesProjection,
  readNhBallotProjection,
} from "../lib/civic-data/manual-read-models.ts";
import { DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE } from "../lib/civic-data/derived-campaign-sites.ts";
import { fundingReadState, readFundingSnapshot } from "../lib/funding/snapshot.ts";
import { stateMoneyReadState } from "../lib/funding/state-snapshot.ts";
import { readNhMembers } from "../lib/civic-data/state-members.ts";
import { readOfficialStateLegislatorsProjection } from "../lib/state-rollcalls/legislators.ts";
import { nhSeatHolderReadState } from "../lib/ballot/seat-holders.ts";
import { currentPollingPlaceLinks } from "../lib/ballot/polling-place-links.ts";
import { currentRegistrationLinks } from "../lib/ballot/registration-links.ts";
import { registryRuntimeFirstSeed, registryRuntimeReadState } from "../lib/registry/runtime-read-model.ts";
import { federalDirectoryFirstSeed, federalDirectoryReadState } from "../lib/officials/federal-directory-read-model.ts";
import { authorityVersionKey } from "../lib/registry/server.ts";
import {
  absentEdgeEntry,
  manualEdgeEntry,
  promotedFamily,
  provenEdgeEntry,
  servedValue,
  stateMoneyFixtureEntries,
} from "./helpers/promoted-edge-entry.ts";

/**
 * **A COLD /ballot READS THE AUTHORITY FAMILIES FROM THE READER EDGE.** (R30,
 * 2026-09-25.)
 *
 * A cold /ballot server read about 50 MB from the database (measured on an
 * isolated copy, 2026-09-24), the registry runtime alone about 24 MB, while
 * the registry and the federal directory were already published on the reader
 * edge the map's routes read. The page never entered the edge. An earlier
 * attempt to route it there read MORE: its direct `refresh*FromPromoted`
 * preloads still read the database, and the edge's BOOTSTRAP next to the
 * database's PROMOTED of one version flipped the officeholder cache key.
 *
 * **AND EVERY FAMILY IT STILL READ FROM THE DATABASE.** (2026-09-25.) With
 * those four on the edge, production still took 5.1–5.8 s on the first
 * /ballot?zip=85701 an instance served: the ballot (read first, alone), the
 * candidate profiles, publications, FEC and state money were each a pointer
 * read and a proof read against a cold database. They are proven pointers on
 * the edge now (`PromotedEdgeEntry`), and a cold render with the whole edge
 * makes no database read at all, in the page or in any card.
 *
 * These tests render the real page with no database at all: DATABASE_URL names
 * an `.invalid` host (RFC 2606, it never resolves) and every Neon HTTP request
 * is answered here with no rows and counted by record class, so a family the
 * code reads from the database is seen even though nothing leaves the process.
 * The page's async components are then called from THIS test's context, as
 * React calls them from its render loop, never from inside the page function.
 */

for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_BLOBS_CONTEXT", "NETLIFY_SITE_ID"]) delete process.env[key];

const REGISTRY_VERSION = "edge-test:ballot:registry";
const FEDERAL_VERSION = "edge-test:ballot:federal";

// The values the proven-pointer families carry: the same first seeds and
// fixtures the database path serves this test process, read before the fake
// database is installed.
const seedStore = new MemoryRoutineDataStore();
const azBallot = servedValue(await readAzBallotProjection({ store: seedStore, bypassCache: true }));
const nhBallot = servedValue(await readNhBallotProjection({ store: seedStore, bypassCache: true }));
const profiles = servedValue(await readCandidateProfilesProjection({ store: seedStore, bypassCache: true }));
const corpus = servedValue(await readCandidateCorpusProjection({ store: seedStore, bypassCache: true }));
const funding = servedValue(await readFundingSnapshot({ store: seedStore, bypassCache: true }));
const nhMembers = servedValue(await readNhMembers({ store: seedStore, bypassCache: true }));
const nhLegislators = servedValue(await readOfficialStateLegislatorsProjection("US-NH", { store: seedStore, bypassCache: true }));
const navigation = {
  kind: "ballot-navigation",
  records: [
    ...currentRegistrationLinks().map((value) => ({ id: `registration:${value.state}`, kind: "REGISTRATION_LINK", value })),
    ...currentPollingPlaceLinks().map((value) => ({ id: `polling-place:${value.state}`, kind: "POLLING_PLACE_LINK", value })),
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
  "federal-funding": promotedFamily([provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: fec.scope, sourceId: fec.sourceId, versionId: EDGE.funding, value: funding })], EDGE.funding),
  "state-money": promotedFamily(stateMoneyFixtureEntries(EDGE.stateMoney), "edge-test:ballot:money"),
};

async function publishEdge(withPromoted: boolean): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-ballot-edge-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const authority: PublishAuthority = {
    "registry-runtime": { value: registryRuntimeFirstSeed().value, versionId: REGISTRY_VERSION },
    "federal-directory": { value: federalDirectoryFirstSeed().value, versionId: FEDERAL_VERSION },
    "state-legislators": {
      value: {
        "US-AZ": {
          formatVersion: 1,
          sourceId: "az-legislature",
          jurisdiction: "US-AZ",
          term: "2025-2026",
          generatedAt: "2026-09-25T00:00:00.000Z",
          roster: { formatVersion: 1, generatedAt: "2026-09-25", source: "edge-test", officeholders: [], divisions: [] },
        },
        // The runner publishes every official chamber's legislators (the NH one derives from the General Court roster).
        "US-NH": nhLegislators,
      },
      versionId: "edge-test:ballot:state-legislators",
    },
    ...(withPromoted ? PROMOTED_BALLOT_FAMILIES : {}),
  };
  const published = await publishReaderEdgeArtifacts({
    formatVersion: 1,
    generatedAt: "2026-09-25T00:00:00.000Z",
    counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 },
    sources: [],
    meetings: [],
    agendaDocuments: [],
  }, { sourceThrough: null, retrievedAt: null, promotedThrough: null }, { store: new LocalFileArtifactStore(dir), authority });
  assert.equal(published.status, "PUBLISHED", JSON.stringify(published));
  return dir;
}
/** The R30 edge: only the map's families. */
const mapEdgeDir = await publishEdge(false);
/** The whole ballot edge: the map's families and every proven pointer the page reads. */
const ballotEdgeDir = await publishEdge(true);

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
    // Sean's daily byte counter (§0/§7) writes an aggregate, not a civic pointer read.
    if (/^\s*INSERT INTO database_transfer_daily\b/.test(query.query ?? "")) continue;
    const recordClass = (query.params ?? []).find((p): p is string => typeof p === "string" && /^[A-Z][A-Z_]+$/.test(p) && p !== "UNCHANGED_CONFIRMATION_V1");
    databaseReads.push({ phase, recordClass: recordClass ?? "UNKNOWN" });
  }
  const empty = { command: "SELECT", rowCount: 0, rows: [], fields: [] };
  return new Response(JSON.stringify(body.queries ? { results: queries.map(() => empty) } : empty), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

/** One cold render: the page, then every async component it returned, called from outside the page. */
async function renderBallot(zip: string): Promise<{ components: Map<string, number> }> {
  clearPromotedReadModelCache();
  databaseReads.length = 0;
  const { default: BallotPage } = await import("../app/ballot/page.tsx");
  phase = "page";
  const tree = await BallotPage({ searchParams: Promise.resolve({ zip }) });
  phase = "components";
  const components = new Map<string, number>();
  // A card hands some sections down inside a plain object prop (the battlecard's
  // `money`, which is `CandidateFunding`), so plain objects are walked too, once each.
  const seen = new WeakSet<object>();
  const walk = async (node: unknown): Promise<void> => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const child of node) await walk(child); return; }
    const element = node as { $$typeof?: symbol; type?: unknown; props?: Record<string, unknown> };
    if (element.$$typeof === undefined) {
      if (Object.getPrototypeOf(node) === Object.prototype) for (const value of Object.values(node)) await walk(value);
      return;
    }
    if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
      const name = element.type.name;
      components.set(name, (components.get(name) ?? 0) + 1);
      await walk(await (element.type as (props: unknown) => Promise<unknown>)(element.props ?? {}));
      return;
    }
    for (const value of Object.values(element.props ?? {})) await walk(value);
  };
  await walk(tree);
  return { components };
}

const MAP_FAMILIES = ["REGISTRY_RUNTIME_BINDING", "FEDERAL_DIRECTORY", "STATE_LEGISLATOR"];
/** What a cold /ballot?zip=85701 read from the database with only the map's families on the edge (R30). */
const MOVED_FAMILIES = ["BALLOT_CANDIDACY", "BALLOT_CANDIDACY", "CANDIDATE_PROFILE", "CANDIDATE_PUBLICATION", "CURATED_READER_RECORD", "CURATED_READER_RECORD", "FEC_FUNDING", "STATE_CAMPAIGN_FINANCE"];

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

test("with only map families on the edge, a cold ballot reads exactly its missing ballot and filing pointers, none from a card", async () => {
  process.env.WTP_READER_EDGE_DIR = mapEdgeDir;
  const { components } = await renderBallot("85701");
  assert.ok((components.get("BallotBattlecard") ?? 0) >= 10, `the render reached the cards: ${JSON.stringify([...components])}`);
  assert.deepEqual(databaseReads.filter((read) => MAP_FAMILIES.includes(read.recordClass)), [], "a family the edge publishes was read from the database");
  // CURATED_READER_RECORD is the derived campaign sites the standing runner publishes, read beside the profiles.
  assert.deepEqual(databaseReads.map((read) => read.recordClass).sort(), MOVED_FAMILIES);
  assert.deepEqual(databaseReads.filter((read) => read.phase === "components"), [], "a card read the database");
});

test("a cold /ballot?zip=85701 with the whole ballot edge makes no database read at all, in the page or in any card", async () => {
  process.env.WTP_READER_EDGE_DIR = ballotEdgeDir;
  const { components } = await renderBallot("85701");
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

test("a cold /ballot?zip=03255 (Newbury, New Hampshire) with the whole ballot edge reads its ballot and the General Court roster from it, and nothing from the database", async () => {
  process.env.WTP_READER_EDGE_DIR = ballotEdgeDir;
  await renderBallot("03255");
  assert.deepEqual(databaseReads, [], "a cold NH /ballot with the whole edge read the database");
  assert.equal(nhBallotReadState().kind, "PROMOTED");
  assert.equal(nhBallotReadState().metadata.versionId, EDGE.nh, "the NH ballot was not served from the edge");
  assert.equal(nhSeatHolderReadState().metadata.versionId, EDGE.nhMembers, "the NH roster was not served from the edge");
});

test("with no edge published, the same render reads those families from the database: the fallback stays", async () => {
  delete process.env.WTP_READER_EDGE_DIR;
  await renderBallot("85701");
  const classes = new Set(databaseReads.map((read) => read.recordClass));
  for (const family of ["REGISTRY_RUNTIME_BINDING", "FEDERAL_DIRECTORY", ...MOVED_FAMILIES]) assert.ok(classes.has(family), `${family} was not read without an edge`);
  assert.match(registryRuntimeReadState().metadata?.versionId ?? "", /^bootstrap:/, "the database path served the registry");
  assert.match(azBallotReadState().metadata?.versionId ?? "", /^bootstrap:/, "the database path served the ballot");
});

test("one promoted version is one authority key, whether the edge primed it (BOOTSTRAP) or the database read it (PROMOTED)", () => {
  const read = (kind: string, versionId: string | null) => ({ kind, metadata: { versionId } });
  assert.equal(authorityVersionKey(read("BOOTSTRAP", "v1")), authorityVersionKey(read("PROMOTED", "v1")));
  assert.notEqual(authorityVersionKey(read("BOOTSTRAP", "v1")), authorityVersionKey(read("PROMOTED", "v2")), "a new version is a new key");
  assert.notEqual(authorityVersionKey(read("STORE_UNREACHABLE", "v1")), authorityVersionKey(read("PROMOTED", "v1")), "a failed read never shares a served key");
  // A first seed carries its own version id, so it never shares a promoted version's key.
  assert.notEqual(authorityVersionKey(read("BOOTSTRAP", registryRuntimeFirstSeed().versionId)), authorityVersionKey(read("PROMOTED", REGISTRY_VERSION)));
});
