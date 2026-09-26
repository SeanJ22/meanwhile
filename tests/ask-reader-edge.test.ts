import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { publishReaderEdgeArtifacts, type PublishAuthority } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import type { PromotedAuthorityFamily, PromotedFamilyArtifactValue } from "../lib/meetings/edge-artifacts.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import {
  readAzBallotProjection,
  readCandidateCorpusProjection,
  readCandidateProfilesProjection,
} from "../lib/civic-data/manual-read-models.ts";
import { DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE } from "../lib/civic-data/derived-campaign-sites.ts";
import { fundingReadState, readFundingSnapshot } from "../lib/funding/snapshot.ts";
import { PIMA_LOCAL_FINANCE_CONTRACT } from "../lib/funding/data-plane.ts";
import { azPimaFinanceReadState } from "../lib/control-plane/campaign-finance/held-records.ts";
import { federalRollCallsReadState, readFederalRollCallsProjection } from "../lib/votes/snapshot.ts";
import { readFederalKeyVotesProjection } from "../lib/votes/key-votes-projection.ts";
import { FEDERAL_KEY_VOTE_SCOPE, FEDERAL_ROLLCALL_SCOPE, FEDERAL_VOTES_SOURCE_ID } from "../lib/votes/data-plane.ts";
import { readOfficeholderStatementsProjection } from "../lib/corpus/data-plane.ts";
import { readExecutiveActionsProjection } from "../lib/officials/executive-actions.ts";
import { AZ_OFFICIAL_ACTIONS_CONTRACT } from "../lib/outcomes/data-plane.ts";
import { outcomeProjectionReadState, refreshOutcomeSnapshotFromPromoted } from "../lib/outcomes/store.ts";
import { registryRuntimeFirstSeed } from "../lib/registry/runtime-read-model.ts";
import { federalDirectoryFirstSeed } from "../lib/officials/federal-directory-read-model.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
import {
  absentEdgeEntry,
  manualEdgeEntry,
  promotedFamily,
  provenEdgeEntry,
  servedValue,
  stateMoneyFixtureEntries,
} from "./helpers/promoted-edge-entry.ts";

/**
 * **A COLD ASK READS ITS SOURCES FROM THE READER EDGE.** (2026-09-25.)
 *
 * On production (deploy 9d275798) a cold "When does the Mesa City Council
 * meet next?" spent 14.8 s in `sourcePreloads`: every deferrable source was a
 * pointer read and a proof read against a cold database (a 2026-09-24 local
 * breakdown: Pima finance 6.8 s, state money 2.9 s, federal votes 2.8 s, the
 * AZ ballot 2.4 s). The registry, the federal directory, the recorded outcomes
 * and the comment-access rules were already on the edge (C20). The deferrable
 * sources are proven pointers on the edge now, read through their own Readers.
 *
 * The real Ask route is asked with no database: DATABASE_URL names an
 * `.invalid` host and every Neon HTTP request is answered here with no rows
 * and counted by record class, so any source read from the database is seen.
 */

delete process.env.ANTHROPIC_API_KEY;
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_BLOBS_CONTEXT", "NETLIFY_SITE_ID"]) delete process.env[key];
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
await installRegistryRuntimeFirstSeeds();

// The values the edge carries: the first seeds and fixtures this test process serves, read before the fake database.
const seedStore = new MemoryRoutineDataStore();
const served = servedValue;
await refreshOutcomeSnapshotFromPromoted();
const outcomes = served(outcomeProjectionReadState());
const fixture = <T,>(...path: string[]): T => JSON.parse(readFileSync(join(process.cwd(), "data", ...path), "utf8")) as T;
const manual = manualEdgeEntry;
const family = promotedFamily;
const fec = requiredRoutineContract("fec-funding");
const federalVotes = { sourceId: FEDERAL_VOTES_SOURCE_ID };
const EDGE = { funding: "edge-test:ask:fec", pima: "edge-test:ask:pima", federalVotes: "edge-test:ask:federal-votes" };
const PROMOTED: Partial<Record<PromotedAuthorityFamily, { value: PromotedFamilyArtifactValue; versionId: string }>> = {
  "ballot-az": family([manual("az-sos-ballot", served(await readAzBallotProjection({ store: seedStore, bypassCache: true })), "edge-test:ask:az")], "edge-test:ask:az"),
  "candidate-profiles": family([
    manual("candidate-profiles", served(await readCandidateProfilesProjection({ store: seedStore, bypassCache: true })), "edge-test:ask:profiles"),
    absentEdgeEntry(DERIVED_CAMPAIGN_SITES_RECORD_CLASS, DERIVED_CAMPAIGN_SITES_SCOPE),
  ], "edge-test:ask:profiles"),
  "candidate-publications": family([manual("candidate-corpus", served(await readCandidateCorpusProjection({ store: seedStore, bypassCache: true })), "edge-test:ask:corpus")], "edge-test:ask:corpus"),
  "federal-funding": family([provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: fec.scope, sourceId: fec.sourceId, versionId: EDGE.funding, value: served(await readFundingSnapshot({ store: seedStore, bypassCache: true })) })], EDGE.funding),
  "state-money": family(stateMoneyFixtureEntries((state) => `edge-test:ask:money:${state}`), "edge-test:ask:money"),
  "pima-finance": family([provenEdgeEntry({
    recordClass: "LOCAL_CAMPAIGN_FINANCE",
    scope: PIMA_LOCAL_FINANCE_CONTRACT.scope,
    sourceId: PIMA_LOCAL_FINANCE_CONTRACT.sourceId,
    versionId: EDGE.pima,
    value: {
      formatVersion: 1,
      held: fixture("states", "az", "campaign-finance", "az-pima-2026-held.json"),
      transactions: fixture("states", "az", "campaign-finance", "az-pima-2026-transactions.json"),
    },
  })], EDGE.pima),
  "federal-votes": family([provenEdgeEntry({ recordClass: "FEDERAL_ROLL_CALL", scope: FEDERAL_ROLLCALL_SCOPE, sourceId: federalVotes.sourceId, versionId: EDGE.federalVotes, value: served(await readFederalRollCallsProjection({ store: seedStore, bypassCache: true })) })], EDGE.federalVotes),
  "federal-key-votes": family([provenEdgeEntry({ recordClass: "FEDERAL_KEY_VOTE", scope: FEDERAL_KEY_VOTE_SCOPE, sourceId: federalVotes.sourceId, versionId: "edge-test:ask:key-votes", value: served(await readFederalKeyVotesProjection({ store: seedStore, bypassCache: true })) })], "edge-test:ask:key-votes"),
  "officeholder-statements": family([manual("officeholder-statements", served(await readOfficeholderStatementsProjection({ store: seedStore, bypassCache: true })), "edge-test:ask:statements")], "edge-test:ask:statements"),
  "executive-actions": family([provenEdgeEntry({
    recordClass: AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass,
    scope: AZ_OFFICIAL_ACTIONS_CONTRACT.scope,
    sourceId: AZ_OFFICIAL_ACTIONS_CONTRACT.sourceId,
    versionId: "edge-test:ask:actions",
    value: served(await readExecutiveActionsProjection({ store: seedStore, bypassCache: true })),
  })], "edge-test:ask:actions"),
};

async function publishEdge(withPromoted: boolean): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-ask-edge-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const snapshot = readSnapshot();
  assert.ok(snapshot, "the bundled meetings snapshot publishes the edge's meeting scopes");
  const authority: PublishAuthority = {
    "registry-runtime": { value: registryRuntimeFirstSeed().value, versionId: "edge-test:ask:registry" },
    "federal-directory": { value: federalDirectoryFirstSeed().value, versionId: "edge-test:ask:federal" },
    "meeting-outcomes": { value: outcomes, versionId: "edge-test:ask:outcomes" },
    ...(withPromoted ? PROMOTED : {}),
  };
  const result = await publishReaderEdgeArtifacts(snapshot, {
    sourceThrough: snapshot.generatedAt,
    retrievedAt: snapshot.generatedAt,
    promotedThrough: snapshot.generatedAt,
  }, { store: new LocalFileArtifactStore(dir), now: new Date().toISOString(), authority });
  assert.equal(result.status, "PUBLISHED", JSON.stringify(result));
  return dir;
}
/** What production served Ask from the edge before this change (C20). */
const c20EdgeDir = await publishEdge(false);
/** And with every deferrable source on it. */
const fullEdgeDir = await publishEdge(true);

// Every database request, by record class, answered with no rows.
const databaseReads: string[] = [];
process.env.DATABASE_URL = "postgresql://edge-test:edge-test@ep-ask-edge-test.ask-edge-test.invalid/none?sslmode=require";
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("ask-edge-test.invalid/")) throw new Error(`the Ask request fetched ${url}`);
  const body = JSON.parse(String(init?.body ?? "{}")) as { params?: unknown[]; queries?: { params?: unknown[] }[] };
  const queries = body.queries ?? [body];
  for (const query of queries) {
    const recordClass = (query.params ?? []).find((p): p is string => typeof p === "string" && /^[A-Z][A-Z_]+$/.test(p) && p !== "UNCHANGED_CONFIRMATION_V1");
    const scope = (query.params ?? []).find((p): p is string => typeof p === "string" && p !== recordClass && /[:+-]/.test(p));
    databaseReads.push(`${recordClass ?? "UNKNOWN"}${scope ? `:${scope}` : ""}`);
  }
  const empty = { command: "SELECT", rowCount: 0, rows: [], fields: [] };
  return new Response(JSON.stringify(body.queries ? { results: queries.map(() => empty) } : empty), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const AZ = "ocd-division/country:us/state:az";

/** One cold Ask: the Mesa question production measured at 14.8 s of source preloads. */
async function askMesa(): Promise<{ trace: { preloads?: Record<string, number>; preloadSources?: Record<string, string>; sourcesLoaded?: string } }> {
  clearPromotedReadModelCache();
  databaseReads.length = 0;
  const { POST, resetGroundedState } = await import("../app/api/ask/grounded/route.ts");
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-reader-edge-test" },
    body: JSON.stringify({ question: "When does the Mesa City Council meet next?", approximateLocation: "85201", surface: "MAP", ocdIds: [AZ, `${AZ}/county:maricopa`, `${AZ}/place:mesa`], today: "2026-09-25" }),
  }));
  assert.equal(response.status, 200);
  return await response.json() as { trace: { preloads?: Record<string, number>; preloadSources?: Record<string, string>; sourcesLoaded?: string } };
}

/** What a cold Ask read from the database with the C20 edge: every deferrable source. */
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

const DEFERRABLE_TRACE = ["funding", "stateMoney", "azPimaFinance", "federalVotes", "federalKeyVotes", "azBallot", "candidateProfiles", "candidateCorpus", "officeholderStatements", "executiveActions"];

test("with the C20 edge, a cold Mesa question reads every deferrable source from the database: 13 pointer reads", async () => {
  process.env.WTP_READER_EDGE_DIR = c20EdgeDir;
  const payload = await askMesa();
  assert.equal(payload.trace.sourcesLoaded, "ALL", "the question loaded every source");
  assert.deepEqual([...databaseReads].sort(), [
    "BALLOT_CANDIDACY:US-AZ:2026-general:supported-ballot",
    "CANDIDATE_PROFILE:US-AZ+US-NH+US-NJ:2026-supported-candidates",
    "CANDIDATE_PUBLICATION:US-AZ+US-NH+US-NJ:2026-supported-candidates",
    "CURATED_READER_RECORD:US:candidate-campaign-sites-derived",
    "FEC_FUNDING:federal-supported",
    "FEDERAL_KEY_VOTE:US:reviewed-key-vote-selection:v1",
    "FEDERAL_ROLL_CALL:US:recent-federal-rollcalls",
    "LOCAL_CAMPAIGN_FINANCE:US-AZ:county:pima:campaign-finance:2026",
    "OFFICEHOLDER_STATEMENT:US:covered-officeholders:primary-publications",
    "STATE_CAMPAIGN_FINANCE:US-AZ:campaign-finance:2026",
    "STATE_CAMPAIGN_FINANCE:US-NH:campaign-finance:2026",
    "STATE_CAMPAIGN_FINANCE:US-NJ:campaign-finance:2026",
    "STATE_EXECUTIVE_ACTION:US-AZ:governor:official-actions",
  ]);
  // No STATE_ROLL_CALL: a body question never waits for a state legislature's roll calls (2026-09-25; route.ts personStateVotes).
  for (const source of DEFERRABLE_TRACE) assert.equal(payload.trace.preloadSources?.[source], "DATABASE", `the trace misnames ${source}`);
});

test("with every deferrable source on the edge, a cold Mesa question reads none of them from the database: no pointer read left", async () => {
  process.env.WTP_READER_EDGE_DIR = fullEdgeDir;
  const payload = await askMesa();
  assert.equal(payload.trace.sourcesLoaded, "ALL", "the question loaded every source");
  const moved = databaseReads.filter((read) => DEFERRABLE_FROM_DATABASE.includes(classOf(read)));
  assert.deepEqual(moved, [], "a source the edge carries was read from the database");
  // The Arizona state roll calls (a pointer the edge does not carry) are read only for a question about a
  // state legislator since 2026-09-25 (route.ts personStateVotes), so a Mesa question reads nothing from the database.
  assert.deepEqual([...databaseReads].sort(), []);
  assert.equal(fundingReadState().metadata.versionId, EDGE.funding, "FEC was not served from the edge");
  assert.equal(azPimaFinanceReadState().metadata.versionId, EDGE.pima, "Pima finance was not served from the edge");
  assert.equal(federalRollCallsReadState().metadata.versionId, EDGE.federalVotes, "the federal roll calls were not served from the edge");
  for (const source of DEFERRABLE_TRACE) assert.equal(payload.trace.preloadSources?.[source], "EDGE", `the trace misnames ${source}`);
});
