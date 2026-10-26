import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { zip } from "../scripts/xlsx.mjs";
import { acquireStatePeople } from "../lib/sources/plural/acquisition.ts";
import { PLURAL_REVISION_URL } from "../lib/sources/plural/targets.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { memberOfficesRunNeeded, publishMemberOffices } from "../lib/officials/member-offices-publication.ts";
import { refreshMemberOfficesFromPromoted, currentMemberOffices } from "../lib/officials/member-offices-read.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { routineTaskNextDueMs } from "../lib/civic-data/runner.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { versionedSelect } from "../lib/db/versioned-query.ts";

beforeEach(() => installFactReader(async () => []));
afterEach(() => installFactReader(undefined));

const sha = "a".repeat(40), at = "2026-10-01T00:00:00.000Z";
const yaml = (id: string) => `id: ocd-person/${id}
name: Member ${id}
roles:
  - type: upper
    district: '7'
    start_date: '2025-01-01'
offices:
  - classification: capitol
    address: 'Room 1, State Capitol'
    voice: '555-1000'
links:
  - url: https://legislature.example.gov/members/${id}
`;
const CONTRACT = requiredManualProductionContract("member-offices");
const TASK = AUTOMATIC_REFRESH_TASKS.find(task => task.id === "member-offices")!;

async function publishState(store: RoutineDataStore, state: string, vault = new MemoryEvidenceStore()) {
  const archive = zip([{ name: `people-${sha}/data/${state}/legislature/One.yml`, data: Buffer.from(yaml(`${state}-one`)) }], "2026-10-01");
  const acquired = await acquireStatePeople({ state, store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks, now: () => at,
    signal: AbortSignal.timeout(10_000), divisions: [],
    fetchImpl: (async url => String(url) === PLURAL_REVISION_URL ? Response.json([{ sha }]) : new Response(archive)) as typeof fetch });
  const published = await publishStatePeople({ vault, store, ...acquired, now: at });
  assert.ok(published.outcome.promoted, JSON.stringify(published.outcome.candidate.receipt));
}

test("a member-office run cut off by its deadline saves the states it finished and the next pass reads only the rest", async () => {
  const store = new MemoryRoutineDataStore();
  await publishState(store, "ca");
  await publishState(store, "tx");
  const read: string[] = [];
  const readCandidateCaptures = store.readCandidateCaptures.bind(store);
  store.readCandidateCaptures = async (id, urls, members) => { read.push(id); return readCandidateCaptures(id, urls, members); };
  // The pass deadline arrives after the first state.
  let ticks = 0;
  const cut = await publishMemberOffices({ store, now: at, jurisdictions: ["US-CA", "US-TX"], deadlineMs: 1e12, clock: () => ticks++ === 0 ? 0 : 1e12 });
  assert.ok(cut.outcome?.promoted, JSON.stringify(cut));
  assert.deepEqual(cut.pending, ["US-TX"]);
  assert.equal(read.length, 1);
  const owed = await store.clock(CONTRACT.sourceId, CONTRACT.recordClass, CONTRACT.scope);
  assert.equal(owed.continuationPending, true);
  const nowMs = Date.parse(at) + 60_000;
  assert.equal(routineTaskNextDueMs(TASK, owed, nowMs), nowMs, "the runner continues on its next pass, not the next day");
  assert.match((await memberOfficesRunNeeded(store, ["US-CA", "US-TX"])).reason, /1 state\(s\) are still owed/);

  read.length = 0;
  const rest = await publishMemberOffices({ store, now: at, jurisdictions: ["US-CA", "US-TX"] });
  assert.ok(rest.outcome?.promoted && !rest.outcome.confirmed, JSON.stringify(rest));
  assert.deepEqual(rest.pending, []);
  assert.equal(read.length, 1, "the finished state is not read again");
  await refreshMemberOfficesFromPromoted({ store, now: at });
  assert.deepEqual(["plural:ca:ca-one", "plural:tx:tx-one"].map(id => currentMemberOffices(id).map(row => row.office.phone)), [["555-1000"], ["555-1000"]],
    "both states' offices are published, the first kept from the cut-off run");
  const settled = await store.clock(CONTRACT.sourceId, CONTRACT.recordClass, CONTRACT.scope);
  assert.equal(settled.continuationPending, false);
  assert.ok(routineTaskNextDueMs(TASK, settled, nowMs) > nowMs + 23 * 3_600_000, "a finished run waits a day");
  assert.equal((await memberOfficesRunNeeded(store, ["US-CA", "US-TX"])).needed, false);
});

test("on the production store the member-office progress, capture list and continuation are read without the records", async () => {
  await withMigratedRoutineStore("openstates-people-ca", async (store, vault, pg) => {
    // The shared migrated store already holds the fact and owner-flag tables.
    const checked=versionedSelect(process.env.DATABASE_URL!);
    installFactReader((text,params=[])=>checked(async(text,params)=>(await pg.query<Record<string,unknown>>(text,[...params])).rows,text,params));
    try {
    const as = (contract: string, capability = "ROUTINE_CONTRACT") => Object.assign(store as unknown as { writeAuthority: object }, {
      writeAuthority: { ...(store as unknown as { writeAuthority: object }).writeAuthority, contract, capability } });
    await publishState(store, "ca", vault);
    as("openstates-people-tx");
    await publishState(store, "tx", vault);
    const [roster] = await store.readPromotionIdentities("STATE_LEGISLATOR", ["US-CA:openstates-people:v1"]);
    const captures = await store.readCandidateField(roster!.versionId, ["normalizedPayload", "captures"]);
    assert.ok(Array.isArray(captures) && captures.length === 1, JSON.stringify(captures));
    assert.equal(await store.readCandidateField(roster!.versionId, ["normalizedPayload", "absent"]), undefined);
    assert.equal(await store.readPromotionPayloadFields(CONTRACT.recordClass, CONTRACT.scope, ["rosterDigests"]), null);
    const [digest] = await store.readRosterIdDigests("STATE_LEGISLATOR", ["US-CA:openstates-people:v1"]);
    assert.match(digest!.digest, /^1:[a-f0-9]{32}$/);
    as("member-offices", "MANUAL_CONTRACT");
    let ticks = 0;
    const cut = await publishMemberOffices({ store, now: at, jurisdictions: ["US-CA", "US-TX"], deadlineMs: 1e12, clock: () => ticks++ === 0 ? 0 : 1e12 });
    assert.ok(cut.outcome?.promoted, JSON.stringify(cut));
    const held = await store.readPromotionPayloadFields(CONTRACT.recordClass, CONTRACT.scope, ["rosterDigests", "pending", "absent"]);
    assert.deepEqual(held, { rosterDigests: { "US-CA": digest!.digest }, pending: ["US-TX"] });
    assert.equal((await store.clock(CONTRACT.sourceId, CONTRACT.recordClass, CONTRACT.scope)).continuationPending, true);
    const before=Number((await pg.query<{version:string}>("SELECT version::text FROM civic_data_clock_versions WHERE record_class=$1 AND scope=$2",
      [CONTRACT.recordClass,CONTRACT.scope])).rows[0]!.version);
    const rest = await publishMemberOffices({ store, now: at, jurisdictions: ["US-CA", "US-TX"] });
    assert.ok(rest.outcome?.promoted, JSON.stringify(rest));
    const after=Number((await pg.query<{version:string}>("SELECT version::text FROM civic_data_clock_versions WHERE record_class=$1 AND scope=$2",
      [CONTRACT.recordClass,CONTRACT.scope])).rows[0]!.version);
    assert.ok(after>before,"continuing a publication updates the same scope's stored version");
    assert.equal((await store.clock(CONTRACT.sourceId, CONTRACT.recordClass, CONTRACT.scope)).continuationPending, false);
    assert.equal((await memberOfficesRunNeeded(store, ["US-CA", "US-TX"])).needed, false);
    } finally { installFactReader(undefined); }
  });
});
