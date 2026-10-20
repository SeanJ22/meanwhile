import { fundingFixtureForState } from "./helpers/funding-fixture.ts";
import { azDistricts } from "./helpers/ballot-district-fixtures.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "./helpers/playbooks.ts";

import { installReaderValues, activateCanonicalFixture, installCanonicalMeetings } from "./helpers/canonical-reader-fixtures.ts";
type PublishAuthorityValue = { readonly value: unknown; readonly versionId: string };
import { type GlobalAuthorityFamily, type StateAuthorityFamily } from "../lib/meetings/edge-artifacts.ts";

type StateValues = Partial<Record<StateAuthorityFamily, Record<string, PublishAuthorityValue>>>;
import { promoteRecorded } from "./helpers/reader-edge-meetings.ts";
import type { GlobalPromotedAuthorityFamily, PromotedFamilyArtifactValue } from "../lib/meetings/edge-artifacts.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
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
} from "./helpers/promoted-edge-entry.ts";
import { stateMoneyFixture, syntheticCandidateCorpus, syntheticCandidateProfiles, syntheticFederalDirectory, syntheticFederalKeyVotes, syntheticFederalRollCalls, syntheticOfficeholderStatements, syntheticPimaLocalFinance, stateFederalDirectoryArtifacts } from "./helpers/promoted-fixtures.ts";
import { recordedMeetingsSnapshot, syntheticExecutiveActions } from "./helpers/reader-fixtures.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import type { Contest } from "../lib/ballot/types.ts";
import type { LineupOutcome } from "../lib/identity/types.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

interface SyntheticLineupNominee {
  readonly name: string;
  readonly partyLabel: string;
  readonly outcome: LineupOutcome;
  readonly candidacyId?: string;
  readonly filingParty?: string;
}

interface SyntheticContest {
  readonly id: string;
  readonly title: string;
  readonly ocdId?: string;
  readonly type?: Contest["type"];
  readonly candidacies?: readonly { readonly id: string; readonly givenName: string; readonly familyName: string; readonly partyLabel?: string | null }[];
  readonly lineup?: readonly SyntheticLineupNominee[];
}

function syntheticAzBallot(contests?: readonly SyntheticContest[]): BallotSet {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/synthetic-az-ballots.json", import.meta.url), "utf8")) as Record<string, BallotSet>;
  const ballot = fixtures[JSON.stringify(contests ?? null)];
  if (!ballot) throw new Error("The synthetic Arizona ballot input has no recorded fixture");
  return ballot;
}

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


delete process.env.ANTHROPIC_API_KEY;
let activeFixture = "";
for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "NETLIFY", "NETLIFY_BLOBS_CONTEXT", "NETLIFY_SITE_ID"]) delete process.env[key];
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
// The canonical holdings: the recorded registry import, the recorded 85701 meetings, and small synthetic
// values for every other family, built before the fake database. FEC funding uses its exact-state recorded pointer.
const outcomes: OutcomeSnapshot = { generatedOn: "2026-09-25", generatedAt: "2026-09-25T12:00:00.000Z", tenants: [], sittings: [] };
const federal = syntheticFederalDirectory();
const manual = manualEdgeEntry;
const family = promotedFamily;
const fec = requiredRoutineContract("fec-funding:AZ");
const federalVotes = { sourceId: FEDERAL_VOTES_SOURCE_ID };
const EDGE = { funding: "edge-test:ask:fec", federalVotes: "edge-test:ask:federal-votes" };
const stateMoneyEntries = (version: (state: string) => string) => (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]).map((state) =>
  provenEdgeEntry({ recordClass: "STATE_CAMPAIGN_FINANCE", scope: STATE_CAMPAIGN_FINANCE_SOURCES[state].scope, sourceId: STATE_CAMPAIGN_FINANCE_SOURCES[state].sourceId, versionId: version(state), value: stateMoneyFixture(state) }));
const ballot = syntheticAzBallot();
const PROMOTED: Partial<Record<GlobalPromotedAuthorityFamily, { value: PromotedFamilyArtifactValue; versionId: string }>> = {
  "federal-funding": family([provenEdgeEntry({ recordClass: "FEC_FUNDING", scope: fec.scope, sourceId: fec.sourceId, versionId: EDGE.funding, value: fundingFixtureForState("AZ") })], EDGE.funding),
  "state-money": family(stateMoneyEntries((state) => `edge-test:ask:money:${state}`), "edge-test:ask:money"),
  "pima-finance": family([provenEdgeEntry({ recordClass: "LOCAL_CAMPAIGN_FINANCE", scope: PIMA_LOCAL_FINANCE_CONTRACT.scope, sourceId: PIMA_LOCAL_FINANCE_CONTRACT.sourceId, versionId: "edge-test:ask:pima-finance", value: syntheticPimaLocalFinance() })], "edge-test:ask:pima-finance"),
  "federal-votes": family([provenEdgeEntry({ recordClass: "FEDERAL_ROLL_CALL", scope: FEDERAL_ROLLCALL_SCOPE, sourceId: federalVotes.sourceId, versionId: EDGE.federalVotes, value: syntheticFederalRollCalls(federal).window })], EDGE.federalVotes),
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

const STATE_PROMOTED: StateValues = {
  "ballot-contests": { AZ: family([manual("ballot-contests:AZ", { kind: "ballot-contests", ballots: { [ballotElectionKey(ballot)]: ballot } }, "edge-test:ask:ballots")], "edge-test:ask:ballots") },
  "candidate-profiles": { AZ: family([manual("candidate-profiles:AZ", syntheticCandidateProfiles(), "edge-test:ask:profiles")], "edge-test:ask:profiles") },
  "candidate-publications": { AZ: family([manual("candidate-corpus:AZ", syntheticCandidateCorpus(), "edge-test:ask:corpus")], "edge-test:ask:corpus") },
  "candidate-campaign-sites-derived": { AZ: family([absentEdgeEntry("CURATED_READER_RECORD", "US-AZ:candidate-campaign-sites-derived")], "absent:derived:AZ") },
  "voting-sites": { AZ: family([absentEdgeEntry("VOTING_SITE", "US-AZ:voting-sites")], "absent:voting:AZ") },
};

/** `overrides` replaces some proven-pointer families with values published under other versions. */
async function createReaderFixture(withPromoted: boolean, overrides: typeof PROMOTED = {}, stateOverrides: StateValues = {}): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-ask-fixture-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const snapshot = recordedMeetingsSnapshot();
  assert.ok(snapshot.meetings.length > 0, "the recorded meetings publish the edge's meeting indexes");
  const authority: Partial<Record<GlobalAuthorityFamily, PublishAuthorityValue>> = {
    "census-districts": { value: azDistricts, versionId: azDistricts.versionId },
    "meeting-outcomes": { value: outcomes, versionId: "edge-test:ask:outcomes" },
    ...(withPromoted ? { ...PROMOTED, ...overrides } : {}),
  };
  const meetings = new MemoryRoutineDataStore();
  await promoteRecorded(meetings, snapshot.meetings, snapshot.agendaDocuments, snapshot.generatedAt);
  installReaderValues({ authority,
    stateAuthorities: { "registry-runtime": stateRegistryArtifacts("edge-test:ask:registry", ["AZ"]), "federal-directory": stateFederalDirectoryArtifacts("edge-test:ask:federal", federal), ...(withPromoted ? STATE_PROMOTED : {}), ...stateOverrides },
    stateLegislators: { "US-AZ": { versionId: "edge-test:ask:az-people", value: {
      formatVersion: 1, sourceId: "plural-openstates", jurisdiction: "US-AZ", term: "2025-2026",
      generatedAt: "2026-09-25T00:00:00.000Z",
      roster: { formatVersion: 1, generatedAt: "2026-09-25", source: "edge-test", officeholders: [], divisions: [] },
    } }, "US-NH": { versionId: "none", value: null } },
    registrations: { az: { versionId: "none", value: null }, nh: { versionId: "none", value: null } },
  }, dir);
  installCanonicalMeetings(meetings, dir);
  return dir;
}
/** Canonical holdings for each answer source. */
const fullFixture = await createReaderFixture(true);

const AZ = "ocd-division/country:us/state:az";

/** One cold Ask about a body's next meeting. */
async function askMesa(question = "When does the Mesa City Council meet next?"): Promise<{ trace: { preloads?: Record<string, number>; preloadSources?: Record<string, string>; sourcesLoaded?: string } }> {
  clearPromotedReadModelCache();
  activateCanonicalFixture(activeFixture!);
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-reader-edge-test" },
    body: JSON.stringify({ question, approximateLocation: "85201", surface: "MAP", ocdIds: [AZ, `${AZ}/county:maricopa`, `${AZ}/place:mesa`], today: "2026-09-25" }),
  }));
  assert.equal(response.status, 200);
  const payload = await response.json() as { trace: { preloads?: Record<string, number>; preloadSources?: Record<string, string>; sourcesLoaded?: string } };
  assert.ok(payload.trace.preloads?.registry !== undefined, "the identity inventory is loaded");
  return payload;
}

test("a cold Mesa question loads place identity and meetings from canonical holdings", async () => {
  activeFixture = fullFixture;
  const payload = await askMesa();
  assert.equal(payload.trace.sourcesLoaded, "IDENTITY_AND_MEETINGS");
  for (const source of ["funding", "stateMoney", "ballots", "candidateProfiles", "candidateCorpus"])
    assert.ok(payload.trace.preloadSources?.[source] !== undefined, `the question lost ${source}`);
  for (const source of ["azPimaFinance", "federalVotes", "federalKeyVotes", "officeholderStatements", "executiveActions"])
    assert.equal(payload.trace.preloadSources?.[source], undefined, `the question loaded unrelated ${source}`);
});

test("an unsettled meeting question restores deferred canonical evidence", async () => {
  activeFixture = fullFixture;
  const payload = await askMesa("When does the Unheld Example City Council meet next?");
  assert.equal(payload.trace.sourcesLoaded, "ALL");
  assert.equal(federalRollCallsReadState().metadata.versionId, EDGE.federalVotes);
  for (const source of ["funding", "stateMoney", "federalVotes", "federalKeyVotes", "ballots", "candidateProfiles", "candidateCorpus", "officeholderStatements", "executiveActions"])
    assert.ok(payload.trace.preloadSources?.[source] !== undefined, `the fallback lost ${source}`);
});

test("a named New Hampshire official question from an Arizona ZIP reads New Hampshire holdings", async () => {
  const key = await createReaderFixture(true, {}, { "registry-runtime": stateRegistryArtifacts("edge-test:ask:registry", ["AZ", "NH"]) });
  activateCanonicalFixture(key);
  clearPromotedReadModelCache();
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-reader-edge-test" },
    body: JSON.stringify({ question: "Who is the governor of New Hampshire?", approximateLocation: "85701",
      surface: "BALLOT", ocdIds: [AZ, `${AZ}/county:pima`], today: "2026-09-25" }),
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  const governor = registryFixtureForState("NH").statewideExecutives.find(row => row.holder.id.endsWith("/governor"))!;
  assert.ok(payload.answer.includes(governor.holder.name), JSON.stringify(payload).slice(0, 2000));
});

test("a named state replaces inherited place selection without dropping its supplied divisions", async () => {
  const { readerRoute } = await import("../lib/api/reader-route.ts");
  const { currentReaderSelection } = await import("../lib/db/reader-route.ts");
  const IL = "ocd-division/country:us/state:il";
  const handler = readerRoute("/api/ask/grounded", async (_request: Request) => currentReaderSelection());
  const selection = await handler(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST", body: JSON.stringify({ question: "Who governs Springfield, Illinois?", approximateLocation: "85701",
      state: "AZ", ocdIds: [AZ, `${AZ}/county:pima`, `${AZ}/place:tucson`, `${IL}/place:springfield`] }),
  }));
  assert.deepEqual(selection?.states, ["IL"]);
  assert.deepEqual([...selection!.keys].sort(), ["ocd-division/country:us", IL, `${IL}/place:springfield`]);
  assert.equal(selection?.point, undefined);
});

test("a named place absent from its state registry gives a specific holding", async () => {
  const sparse = registryFixtureForState("IL");
  assert.equal(sparse.registry.bodies.length, 0);
  const key = await createReaderFixture(true, {}, { "registry-runtime": stateRegistryArtifacts("edge-test:ask:sparse", ["IL"], sparse) });
  activateCanonicalFixture(key);
  clearPromotedReadModelCache();
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-reader-edge-test" },
    body: JSON.stringify({ question: "Who governs Springfield, Illinois?", approximateLocation: "85701",
      surface: "MAP", ocdIds: [AZ, `${AZ}/county:pima`, `${AZ}/place:tucson`], today: "2026-09-25" }),
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.answer, "We have not recorded local government coverage for Springfield, Illinois yet, so we cannot identify who governs that place.");
  assert.equal(payload.subject, null);
  assert.deepEqual(payload.records, []);
  assert.deepEqual(payload.contacts, []);
  assert.deepEqual(payload.gaps, [{ whose: "OURS", statement: payload.answer }]);
  assert.deepEqual(Object.keys(payload.trace.preloadSources), ["registry"]);
});

test("an unmarked warm call loads nothing for the Ask, and the warm route never calls the Ask's handler, a model, a log or a write", async () => {
  activeFixture = fullFixture;
  const { GET } = await import("../app/api/warm/route.ts");
  const { primed } = await (await GET(new Request("https://wtp.test/api/warm?hold=0"))).json() as { primed: unknown };
  assert.equal(primed, null);
  const source = readFileSync("app/api/warm/route.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  assert.match(source, /import \{ POST as askHandler \} from "@\/app\/api\/ask\/grounded\/route"/, "the route module is statically imported for its graph");
  assert.doesNotMatch(source, /askHandler\s*\(|captureAskInteraction|recordAskGapObservations|afterResponse|interpretQuestion|synthesize|anthropic|getDb/i);
});

test("the warm call settles only unscoped Ask sources and never preloads every state", async () => {
  const sourceNames = warmSourceNames();
  const ask = readFileSync("app/api/ask/grounded/route.ts", "utf8");
  const start = ask.indexOf("const essentialPreloads = [");
  const end = ask.indexOf("await settleGroundedSourcePreloads(topicRoute");
  assert.ok(start > 0 && end > start, "the Ask route's preload lists moved; re-read them here");
  const named = new Set([...ask.slice(start, end).matchAll(/timed\("([A-Za-z]+)"/g)].map((match) => match[1]));
  // The per-state roll calls (`stateVotes:${scope}`) are read from the database for that state only, never warmed.
  assert.match(ask.slice(start, end), /timed\(`stateVotes:\$\{scope\}`/);
  for (const stateSource of ["registry", "federalDirectory", "candidateCorpus", "candidateProfiles", "ballots", "campaignFinance"]) {
    assert.equal(sourceNames.includes(stateSource), false, `${stateSource} requires an explicit place`);
    named.delete(stateSource);
  }
  assert.deepEqual(sourceNames.sort(), [...named].sort());
});

function warmSourceNames(): string[] {
  const source = readFileSync("app/api/warm/route.ts", "utf8");
  const declarations = source.slice(source.indexOf("const ASK_SOURCE_PRELOADS"), source.indexOf("interface AskPrimed"));
  return [...declarations.matchAll(/^  ([a-zA-Z]+):/gm)].map(match => match[1]);
}
