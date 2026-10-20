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
import { readFundingSnapshot } from "../lib/funding/snapshot.ts";
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
async function createReaderFixture(withPromoted: boolean, overrides: typeof PROMOTED = {}, stateOverrides: StateValues = {}, snapshot = recordedMeetingsSnapshot()): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "wtp-ask-fixture-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
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
async function askMesa(question = "When does the Mesa City Council meet next?", today = "2026-09-25"): Promise<{ trace: { preloads?: Record<string, number>; preloadSources?: Record<string, string>; sourcesLoaded?: string } }> {
  clearPromotedReadModelCache();
  activateCanonicalFixture(activeFixture!);
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-reader-edge-test" },
    body: JSON.stringify({ question, approximateLocation: "85201", surface: "MAP", ocdIds: [AZ, `${AZ}/county:maricopa`, `${AZ}/place:mesa`], today }),
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
  assert.equal(payload.trace.preloads.federalDirectory, undefined, "a statewide office lookup reads its own canonical authority");
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

test("Ask reads source-bound campaign facts for the state and exact place", async () => {
  const { campaignDb,publishMoneyFixture } = await import("./helpers/campaign-money-db.ts");
  const { installFactReader } = await import("../lib/facts/db.ts");
  const { campaignSourceRecord } = await import("../lib/funding/state-source-records.ts");
  const { campaignFinanceSource } = await import("../lib/funding/state-sources.ts");
  const { bindCampaignMoney,campaignMoneyPeopleIndex } = await import("../lib/funding/state-people.ts");
  const {rebuildCampaignCycles}=await import("../lib/funding/state-cycles.ts");
  const facts = await campaignDb();
  const state = "ocd-division/country:us/state:wa", place = `${state}/place:seattle`;
  const resource = campaignFinanceSource("WA").resources[0]!;
  const source = JSON.parse(readFileSync(new URL("./fixtures/campaign-finance/wa-native-excerpt.json", import.meta.url), "utf8"))[0];
  const base = campaignSourceRecord("WA", resource, source, { url: resource.url, rawHash: "a".repeat(64),
    vaultKey: "test", byteLength: 10, retrievedAt: "2026-10-17T00:00:00.000Z", publicationDate: null });
  const person = { id: "published-ask-person", name: "Anita Crawford-Willis", seat: place+"#court", office: source.office,
    division: place, incumbent: true, sourceUrl: "https://www.seattle.gov/courts" };
  const bound = bindCampaignMoney(base, campaignMoneyPeopleIndex([person]));
  assert.ok(bound, "the saved native filer matches the published person and exact seat");
  const rows = [{ ...bound, id: "WA:ask-place" }, { ...base, id: "WA:unbound" }, { ...bound, id: "WA:historical", period: "2018" }];
  const placesRead: string[] = [];
  try {
    const committee="campaign-committee:WA:ask-fixture";
    await facts.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
      ($1,'place','Washington','WA',NULL),($2,'place','Seattle','WA',$1),
      ($3,'person',$4,'WA',NULL),($5,'committee',$6,'WA',$3)`,[state,place,person.id,person.name,committee,bound.filerName]);
    await facts.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$3),($1,$4),($2,$3),($2,$4)",[committee,person.id,state,place]);
    const [copy]=await facts.query("INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES($1,$1,$2,$3,'test') RETURNING id",
      [base.provenance.url,base.provenance.retrievedAt,base.provenance.rawHash]);
    for(const row of rows)await facts.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by,cost_usd)
      VALUES($1,$2,$3::jsonb,'','live','OFFICIAL',$4,'','2026-10-17','2026-10-17','legacy-fixture',0)`,[committee,`campaign-money:${row.id}`,JSON.stringify(row),copy.id]);
    const withdrawn = `campaign-committee:WA:${"0".repeat(64)}`;
    await facts.query("INSERT INTO entity (id,kind,name,state,parent_id) VALUES ($1,'committee','Small Donor Fixture','WA',$2)", [withdrawn, state]);
    await facts.query("INSERT INTO entity_place (entity_id,place_id) VALUES ($1,$2),($1,$3)", [withdrawn, state, place]);
    await facts.query(`INSERT INTO fact (entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by,cost_usd)
      VALUES ($1,'campaign-money:WA:withdrawn',$2::jsonb,'','live','OFFICIAL',(SELECT id FROM source_copy WHERE blob_key='test'),'','2026-10-17','2026-10-17','legacy-fixture',0)`,
    [withdrawn, JSON.stringify({ ...base, id: "WA:withdrawn", filerName: "Small Donor Fixture", period: "2026", amounts: [{ label: "Contribution", amount: 150 }] })]);
    await publishMoneyFixture(facts,{recordClass:"REGISTRY_RUNTIME_BINDING",scope:"US-WA",payload:{bodyRosters:[{bodyId:person.seat,sourceUrl:person.sourceUrl,members:[{id:person.id,name:person.name,officeTitle:person.office}]}]}});
    await rebuildCampaignCycles(facts,"WA",[person.id],"2026-10-17T00:00:00.000Z",async()=>({purged:true}));
    const key = await createReaderFixture(true, {}, {
      "registry-runtime": stateRegistryArtifacts("edge-test:ask:campaign", ["WA"]),
    });
    activateCanonicalFixture(key);
    installFactReader(async (text, params) => {
      if (/FROM entity_place (?:ep|p)\b/.test(text)) placesRead.push(String(params?.[0]));
      return facts.query(text, params);
    });
    clearPromotedReadModelCache();
    const { POST } = await import("../app/api/ask/grounded/route.ts");
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-reader-edge-test" },
      body: JSON.stringify({ question: "What campaign money is reported here?", surface: "MAP", ocdIds: [state, place] }),
    }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    const campaignRecords = payload.records.filter((record: { kind: string }) => record.kind === "FINANCE_COMMITTEE");
    assert.equal(campaignRecords.length, 1, "state and exact-place reads share one sourced committee/cycle total");
    assert.equal(campaignRecords[0].subjectId, person.id);
    assert.match(campaignRecords[0].text, /2026 cycle/);
    assert.equal(campaignRecords[0].sourceUrl, base.filingUrl);
    assert.doesNotMatch(JSON.stringify(payload), /Small Donor Fixture|WA:unbound|WA:historical|WA:withdrawn/);
    assert.equal(campaignRecords[0].official,true,"the shared filing remains official evidence");
    assert.ok(placesRead.includes(state));
    assert.ok(placesRead.includes(place));
    const named = await POST(new Request("https://wtp.test/api/ask/grounded", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-reader-edge-test" },
      body: JSON.stringify({ question: "What campaign finance records are held for Seattle?", surface: "MAP", ocdIds: [state] }),
    }));
    assert.equal(named.status, 200);
    const namedPayload = await named.json();
    assert.equal(namedPayload.mode, "GROUNDED_COMPOSED");
    assert.equal(namedPayload.trace.interpretation.why, "place-campaign-records");
    assert.deepEqual(namedPayload.records.map((record: { id: string }) => record.id), campaignRecords.map((record: { id: string }) => record.id));
    assert.doesNotMatch(JSON.stringify(namedPayload), /Small Donor Fixture|WA:unbound|WA:historical|WA:withdrawn/);
    assert.match(namedPayload.answer, /Held campaign records include/);
    assert.equal(namedPayload.trace.preloads.officeholders, undefined);
  } finally {
    installFactReader(undefined);
    await facts.pg.close();
  }
});


test("an unheld budget goes directly to the separate AI after the held-data composers decline", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const calls: string[] = [];
  process.env.ANTHROPIC_API_KEY = "fixture-ask-key";
  globalThis.fetch = (async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("https://api.anthropic.com/")) return originalFetch(input, init);
    const body = JSON.parse(String(init?.body));
    calls.push(body.tools?.[0]?.name ?? "grounded-writer");
    return Response.json({ content: [{ type: "tool_use", name: "answer_reader", input: { known: false, answer: "" } }],
      usage: { input_tokens: 10, output_tokens: 5 } });
  }) as typeof fetch;
  try {
    activeFixture = fullFixture;
    const payload = await askMesa("What is Mesa City Council's budget?") as Awaited<ReturnType<typeof askMesa>> & {
      answer: string; aiAnswer: string; gaps: { statement: string }[];
    };
    assert.deepEqual(calls, ["answer_reader"], "no model is needed to compose the missing held-data line");
    assert.equal(payload.answer, "We don't have that answer yet.");
    assert.equal(payload.aiAnswer, "I don't know.");
    assert.ok(payload.gaps.every(gap => !/calendar/i.test(gap.statement)), "a finance question has no unrelated calendar failure");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
});


test("a last meeting outside the shown window is still answered from retained canonical records", async () => {
  const past = recordedMeetingsSnapshot().meetings.find(meeting => meeting.id.startsWith("legistar:") &&
    meeting.bodyId?.endsWith("county:pima#governing") && meeting.status !== "CANCELED" && meeting.timeZone && meeting.startsAt.startsWith("2026-"));
  assert.ok(past, "the fixture supplies one dated, unambiguous retained sitting");
  activeFixture = await createReaderFixture(true, {}, {}, recordedMeetingsSnapshot([past]));
  const originalNow = Date.now;
  Date.now = () => Date.parse("2027-09-25T12:00:00Z");
  try {
    const payload = await askMesa("When was the last Pima County Board of Supervisors meeting?", "2027-09-25") as Awaited<ReturnType<typeof askMesa>> & {
      answer: string; records: { kind: string; id: string; occurredAt?: string }[];
    };
    assert.match(payload.answer,/most recent.*Pima/i);
    assert.ok(payload.records.some(record => record.kind === "MEETING" && record.id === past.id), "a shown-window miss must return the retained sitting");
  } finally { Date.now = originalNow; }
});
