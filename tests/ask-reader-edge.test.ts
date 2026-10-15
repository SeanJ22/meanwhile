import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "./helpers/playbooks.ts";

import { publishReaderEdgeArtifacts, type PublishAuthority, type PublishStateAuthorities } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import type { GlobalPromotedAuthorityFamily, PromotedFamilyArtifactValue } from "../lib/meetings/edge-artifacts.ts";
import { registryPlaceFixtureResult } from "./helpers/registry-place-fetch.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { fundingReadState, readFundingSnapshot } from "../lib/funding/snapshot.ts";
import { PIMA_LOCAL_FINANCE_CONTRACT, STATE_CAMPAIGN_FINANCE_SOURCES, type StateCampaignFinanceJurisdiction } from "../lib/funding/data-plane.ts";
import { federalRollCallsReadState } from "../lib/votes/snapshot.ts";
import { FEDERAL_KEY_VOTE_SCOPE, FEDERAL_ROLLCALL_SCOPE, FEDERAL_VOTES_SOURCE_ID } from "../lib/votes/data-plane.ts";
import { AZ_OFFICIAL_ACTIONS_CONTRACT } from "../lib/outcomes/data-plane.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";
import {
  absentEdgeEntry,
  manualEdgeEntry,
  promotedFamily,
  provenEdgeEntry,
  servedValue,
} from "./helpers/promoted-edge-entry.ts";
import {
  registryTransferImport,
  stateMoneyFixture,
  syntheticAzBallot,
  syntheticCandidateCorpus,
  syntheticCandidateProfiles,
  syntheticFederalDirectory,
  syntheticFederalKeyVotes,
  syntheticFederalRollCalls,
  syntheticOfficeholderStatements,
  syntheticPimaLocalFinance,
} from "./helpers/promoted-fixtures.ts";
import { recordedMeetingsSnapshot, syntheticExecutiveActions } from "./helpers/reader-fixtures.ts";

delete process.env.ANTHROPIC_API_KEY;
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_BLOBS_CONTEXT", "NETLIFY_SITE_ID"]) delete process.env[key];
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
// The values the edge carries: the recorded registry import, the recorded 85701 meetings, and small synthetic
// values for every other family, built before the fake database. FEC funding is still read through its seed.
const seedStore = new MemoryRoutineDataStore();
const served = servedValue;
const outcomes: OutcomeSnapshot = { generatedOn: "2026-09-25", generatedAt: "2026-09-25T12:00:00.000Z", tenants: [], sittings: [] };
const federal = syntheticFederalDirectory();
const manual = manualEdgeEntry;
const family = promotedFamily;
const fec = requiredRoutineContract("fec-funding");
const federalVotes = { sourceId: FEDERAL_VOTES_SOURCE_ID };
const EDGE = { funding: "edge-test:ask:fec", federalVotes: "edge-test:ask:federal-votes" };
const stateMoneyEntries = (version: (state: string) => string) => (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]).map((state) =>
  provenEdgeEntry({ recordClass: "STATE_CAMPAIGN_FINANCE", scope: STATE_CAMPAIGN_FINANCE_SOURCES[state].scope, sourceId: STATE_CAMPAIGN_FINANCE_SOURCES[state].sourceId, versionId: version(state), value: stateMoneyFixture(state) }));
const ballot = syntheticAzBallot();
const PROMOTED: Partial<Record<GlobalPromotedAuthorityFamily, { value: PromotedFamilyArtifactValue; versionId: string }>> = {
  "federal-funding": family([provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: fec.scope, sourceId: fec.sourceId, versionId: EDGE.funding, value: served(await readFundingSnapshot({ store: seedStore, bypassCache: true })) })], EDGE.funding),
  "state-money": family(stateMoneyEntries((state) => `edge-test:ask:money:${state}`), "edge-test:ask:money"),
  "pima-finance": family([provenEdgeEntry({ recordClass: "LOCAL_CAMPAIGN_FINANCE", scope: PIMA_LOCAL_FINANCE_CONTRACT.scope, sourceId: PIMA_LOCAL_FINANCE_CONTRACT.sourceId, versionId: "edge-test:ask:pima-finance", value: syntheticPimaLocalFinance() })], "edge-test:ask:pima-finance"),
  "federal-votes": family([provenEdgeEntry({ recordClass: "FEDERAL_ROLL_CALL", scope: FEDERAL_ROLLCALL_SCOPE, sourceId: federalVotes.sourceId, versionId: EDGE.federalVotes, value: syntheticFederalRollCalls(federal) })], EDGE.federalVotes),
  "federal-key-votes": family([provenEdgeEntry({ recordClass: "FEDERAL_KEY_VOTE", scope: FEDERAL_KEY_VOTE_SCOPE, sourceId: federalVotes.sourceId, versionId: "edge-test:ask:key-votes", value: syntheticFederalKeyVotes(federal) })], "edge-test:ask:key-votes"),
  "officeholder-statements": family([manual("officeholder-statements", syntheticOfficeholderStatements(), "edge-test:ask:statements")], "edge-test:ask:statements"),
  "executive-actions": family([provenEdgeEntry({
    recordClass: AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass,
    scope: AZ_OFFICIAL_ACTIONS_CONTRACT.scope,
    sourceId: AZ_OFFICIAL_ACTIONS_CONTRACT.sourceId,
    versionId: "edge-test:ask:actions",
    value: syntheticExecutiveActions("Katie Hobbs"),
  })], "edge-test:ask:actions"),
};

const STATE_PROMOTED: PublishStateAuthorities = {
  "ballot-contests": { AZ: family([manual("ballot-contests:AZ", { kind: "ballot-contests", ballots: { [ballotElectionKey(ballot)]: ballot } }, "edge-test:ask:ballots")], "edge-test:ask:ballots") },
  "candidate-profiles": { AZ: family([manual("candidate-profiles:AZ", syntheticCandidateProfiles(), "edge-test:ask:profiles")], "edge-test:ask:profiles") },
  "candidate-publications": { AZ: family([manual("candidate-corpus:AZ", syntheticCandidateCorpus(), "edge-test:ask:corpus")], "edge-test:ask:corpus") },
  "candidate-campaign-sites-derived": { AZ: family([absentEdgeEntry("CURATED_READER_RECORD", "US-AZ:candidate-campaign-sites-derived")], "absent:derived:AZ") },
  "voting-sites": { AZ: family([absentEdgeEntry("VOTING_SITE", "US-AZ:voting-sites")], "absent:voting:AZ") },
};

/** `overrides` replaces some proven-pointer families with values published under other versions. */
async function publishEdge(withPromoted: boolean, overrides: typeof PROMOTED = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-ask-edge-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const snapshot = recordedMeetingsSnapshot();
  assert.ok(snapshot.meetings.length > 0, "the recorded meetings publish the edge's meeting scopes");
  const authority: PublishAuthority = {
    "registry-runtime": { value: registryTransferImport().projection.payload, versionId: "edge-test:ask:registry" },
    "federal-directory": { value: federal, versionId: "edge-test:ask:federal" },
    "meeting-outcomes": { value: outcomes, versionId: "edge-test:ask:outcomes" },
    ...(withPromoted ? { ...PROMOTED, ...overrides } : {}),
  };
  const result = await publishReaderEdgeArtifacts(snapshot, {
    sourceThrough: snapshot.generatedAt,
    retrievedAt: snapshot.generatedAt,
    promotedThrough: snapshot.generatedAt,
  }, { store: new LocalFileArtifactStore(dir), now: new Date().toISOString(), authority,
    ...(withPromoted ? { stateAuthorities: STATE_PROMOTED } : {}),
    registrations: {},
    stateLegislators: { "US-AZ": { versionId: "edge-test:ask:az-people", value: {
      formatVersion: 1, sourceId: "plural-openstates", jurisdiction: "US-AZ", term: "2025-2026",
      generatedAt: "2026-09-25T00:00:00.000Z",
      roster: { formatVersion: 1, generatedAt: "2026-09-25", source: "edge-test", officeholders: [], divisions: [] },
    } } },
  });
  assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
  return dir;
}
/** The edge with only the identity sources. */
const c20EdgeDir = await publishEdge(false);
/** And with every deferrable source on it. */
const fullEdgeDir = await publishEdge(true);

// Non-registry database holdings are absent in this fixture.
const databaseReads: string[] = [];
const placeReads: string[] = [];
const registry = registryTransferImport().projection.payload;
process.env.DATABASE_URL = "postgresql://edge-test:edge-test@ep-ask-edge-test.ask-edge-test.invalid/none?sslmode=require";
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("ask-edge-test.invalid/")) throw new Error(`the Ask request fetched ${url}`);
  const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string; params?: unknown[]; queries?: { query?: string; params?: unknown[] }[] };
  const queries = body.queries ?? [body];
  const empty = { command: "SELECT", rowCount: 0, rows: [], fields: [] };
  const results = queries.map(query => {
    if (/^\s*INSERT INTO database_transfer_daily\b/.test(query.query ?? "")) return empty;
    const place = registryPlaceFixtureResult(query, registry, "edge-test:ask:registry");
    if (place) { placeReads.push("edge-test:ask:registry"); return place; }
    if (query.query?.includes("FROM fact f JOIN source_copy") || query.query?.includes("WITH people AS")) return empty;
    const recordClass = (query.params ?? []).find((p): p is string => typeof p === "string" && /^[A-Z][A-Z_]+$/.test(p) && p !== "UNCHANGED_CONFIRMATION_V1");
    const scope = (query.params ?? []).find((p): p is string => typeof p === "string" && p !== recordClass && /[:+-]/.test(p));
    databaseReads.push(`${recordClass ?? "UNKNOWN"}${scope ? `:${scope}` : ""}`);
    return empty;
  });
  return new Response(JSON.stringify(body.queries ? { results } : results[0]), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const AZ = "ocd-division/country:us/state:az";

/** One cold Ask about a body's next meeting. */
async function askMesa(question = "When does the Mesa City Council meet next?"): Promise<{ trace: { preloads?: Record<string, number>; preloadSources?: Record<string, string>; sourcesLoaded?: string } }> {
  clearPromotedReadModelCache();
  databaseReads.length = 0;
  placeReads.length = 0;
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-reader-edge-test" },
    body: JSON.stringify({ question, approximateLocation: "85201", surface: "MAP", ocdIds: [AZ, `${AZ}/county:maricopa`, `${AZ}/place:mesa`], today: "2026-09-25" }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(placeReads, ["edge-test:ask:registry"], "the identity query selects only the requested place at the accepted version");
  return await response.json() as { trace: { preloads?: Record<string, number>; preloadSources?: Record<string, string>; sourcesLoaded?: string } };
}

/** What a cold Ask reads from the database when only identity is on the edge. */
const DEFERRABLE_FROM_DATABASE = [
  "BALLOT_CANDIDACY",
  "CANDIDATE_PROFILE",
  "CANDIDATE_PUBLICATION",
  "CURATED_READER_RECORD",
  "FEC_FUNDING",
  "FEDERAL_KEY_VOTE",
  "FEDERAL_ROLL_CALL",
  "LOCAL_CAMPAIGN_FINANCE",
  "OFFICEHOLDER_STATEMENT",
  "STATE_CAMPAIGN_FINANCE",
  "STATE_EXECUTIVE_ACTION",
];
const classOf = (read: string) => read.split(":")[0]!;

const DEFERRABLE_TRACE = ["funding", "stateMoney", "azPimaFinance", "federalVotes", "federalKeyVotes", "ballots", "candidateProfiles", "candidateCorpus", "officeholderStatements", "executiveActions"];
const UNRELATED_TRACE = new Set(["azPimaFinance", "federalVotes", "federalKeyVotes", "officeholderStatements", "executiveActions"]);

test("with an identity-only edge, a cold Mesa question reads its place identity inventory but skips unrelated evidence", async () => {
  process.env.WTP_READER_EDGE_DIR = c20EdgeDir;
  const payload = await askMesa();
  assert.equal(payload.trace.sourcesLoaded, "IDENTITY_AND_MEETINGS");
  assert.deepEqual([...databaseReads].sort(), [
    "BALLOT_CANDIDACY:US-AZ:state-election-ballots",
    "CANDIDATE_PROFILE:US-AZ:candidate-profiles",
    "CANDIDATE_PUBLICATION:US-AZ:candidate-publications",
    "CURATED_READER_RECORD:US-AZ:candidate-campaign-sites-derived",
    "FEC_FUNDING:federal-supported",
    "STATE_CAMPAIGN_FINANCE:US-AZ:campaign-finance:2026",
  ]);
  // No STATE_ROLL_CALL: a body question never waits for a state legislature's roll calls.
  for (const source of DEFERRABLE_TRACE) assert.equal(payload.trace.preloadSources?.[source], UNRELATED_TRACE.has(source) ? undefined : "DATABASE", `the trace misnames ${source}`);
});

test("with every deferrable source on the edge, a cold Mesa question reads only its registry place from the database", async () => {
  process.env.WTP_READER_EDGE_DIR = fullEdgeDir;
  const payload = await askMesa();
  assert.equal(payload.trace.sourcesLoaded, "IDENTITY_AND_MEETINGS");
  const moved = databaseReads.filter((read) => DEFERRABLE_FROM_DATABASE.includes(classOf(read)));
  assert.deepEqual(moved, [], "a source the edge carries was read from the database");
  // State roll calls are read only for a question about a state legislator.
  assert.deepEqual([...databaseReads].sort(), []);
  assert.equal(fundingReadState().metadata.versionId, EDGE.funding, "FEC was not served from the edge");
  for (const source of DEFERRABLE_TRACE) assert.equal(payload.trace.preloadSources?.[source], UNRELATED_TRACE.has(source) ? undefined : "EDGE", `the trace misnames ${source}`);
});

test("an unsettled meeting-shaped question restores deferred edge evidence without additional database holdings", async () => {
  process.env.WTP_READER_EDGE_DIR = fullEdgeDir;
  const payload = await askMesa("When does the Unheld Example City Council meet next?");
  assert.equal(payload.trace.sourcesLoaded, "ALL");
  assert.deepEqual(databaseReads, []);
  assert.equal(federalRollCallsReadState().metadata.versionId, EDGE.federalVotes);
  for (const source of DEFERRABLE_TRACE.filter((name) => name !== "azPimaFinance")) assert.equal(payload.trace.preloadSources?.[source], "EDGE", `the fallback lost ${source}`);
});

test("a marked warm call loads the Ask's code and every Ask source from the edge, with no database request and no other fetch", async () => {
  // Versions only this edge carries: a read state that names one was loaded by the warm call, never by an Ask.
  const WARM = { funding: "edge-test:ask:warm:fec", federalVotes: "edge-test:ask:warm:federal-votes" };
  process.env.WTP_READER_EDGE_DIR = await publishEdge(true, {
    "federal-funding": family([provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: fec.scope, sourceId: fec.sourceId, versionId: WARM.funding, value: served(await readFundingSnapshot({ store: seedStore, bypassCache: true })) })], WARM.funding),
    "federal-votes": family([provenEdgeEntry({ recordClass: "FEDERAL_ROLL_CALL", scope: FEDERAL_ROLLCALL_SCOPE, sourceId: federalVotes.sourceId, versionId: WARM.federalVotes, value: syntheticFederalRollCalls(federal) })], WARM.federalVotes),
  });
  clearPromotedReadModelCache();
  databaseReads.length = 0;
  const stubbed = globalThis.fetch;
  const elsewhere: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("ask-edge-test.invalid/")) elsewhere.push(url);
    return stubbed(input, init);
  }) as typeof fetch;
  try {
    const { GET, KEEP_WARM_MARKER, ASK_SOURCE_PRELOADS } = await import("../app/api/warm/route.ts");
    const response = await GET(new Request("https://wtp.test/api/warm?hold=0", { headers: { "x-wtp-synthetic-run": KEEP_WARM_MARKER } }));
    assert.equal(response.status, 200);
    const { primed } = await response.json() as { primed: { manifest: boolean; ask: { graphMs: number | null; sources: number; sourcesRefused: number; sourcesFailed: number; sourcesMs: number | null } | null } };
    assert.equal(primed.manifest, true);
    assert.ok(primed.ask, "a marked call with an edge primes the Ask");
    assert.equal(typeof primed.ask.graphMs, "number", "the Ask route's module graph was loaded");
    assert.equal(typeof primed.ask.sourcesMs, "number", "the Ask's sources settled within the budget");
    // This edge publishes no comment-access artifact, so that one source is refused rather than read from the database.
    assert.deepEqual(
      { sources: primed.ask.sources, sourcesRefused: primed.ask.sourcesRefused, sourcesFailed: primed.ask.sourcesFailed },
      { sources: Object.keys(ASK_SOURCE_PRELOADS).length - 1, sourcesRefused: 1, sourcesFailed: 0 },
    );
    assert.deepEqual(databaseReads, [], "a warm call reached the database");
    assert.deepEqual(elsewhere, [], "a warm call fetched something other than the edge (a model, a log)");
    assert.equal(fundingReadState().metadata.versionId, WARM.funding, "the warm call did not load FEC from the edge");
    assert.equal(federalRollCallsReadState().metadata.versionId, WARM.federalVotes, "the warm call did not load the federal roll calls from the edge");
  } finally {
    globalThis.fetch = stubbed;
  }
});

test("an unmarked warm call loads nothing for the Ask, and the warm route never calls the Ask's handler, a model, a log or a write", async () => {
  process.env.WTP_READER_EDGE_DIR = fullEdgeDir;
  const { GET } = await import("../app/api/warm/route.ts");
  const { primed } = await (await GET(new Request("https://wtp.test/api/warm?hold=0"))).json() as { primed: unknown };
  assert.equal(primed, null);
  const source = readFileSync("app/api/warm/route.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.match(source, /await import\("@\/app\/api\/ask\/grounded\/route"\)\.then\(\(\) => \{ primed\.graphMs/, "the route module is imported for its graph only");
  assert.doesNotMatch(source, /\bPOST\b|captureAskInteraction|recordAskGapObservations|afterResponse|interpretQuestion|synthesize|anthropic|getDb/i);
});

test("the warm call settles only unscoped Ask sources and never preloads every state", async () => {
  const { ASK_SOURCE_PRELOADS } = await import("../app/api/warm/route.ts");
  const ask = readFileSync("app/api/ask/grounded/route.ts", "utf8");
  const start = ask.indexOf("const essentialPreloads = [");
  const end = ask.indexOf("await settleGroundedSourcePreloads(topicRoute");
  assert.ok(start > 0 && end > start, "the Ask route's preload lists moved; re-read them here");
  const named = new Set([...ask.slice(start, end).matchAll(/timed\("([A-Za-z]+)"/g)].map((match) => match[1]));
  // The per-state roll calls (`stateVotes:${scope}`) are read from the database for that state only, never warmed.
  assert.match(ask.slice(start, end), /timed\(`stateVotes:\$\{scope\}`/);
  for (const stateSource of ["registry", "candidateCorpus", "candidateProfiles", "ballots", "stateMoney"]) {
    assert.equal(stateSource in ASK_SOURCE_PRELOADS, false, `${stateSource} requires an explicit place`);
    named.delete(stateSource);
  }
  assert.deepEqual(Object.keys(ASK_SOURCE_PRELOADS).sort(), [...named].sort());
});
