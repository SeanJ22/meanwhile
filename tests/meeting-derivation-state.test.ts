import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CURRENT_CALENDAR_READS_SQL } from "../lib/control-plane/discovery/derived-wiring.ts";
import { derivedInputAuthorityIssue } from "../lib/civic-data/derived-door.ts";
import { readMeetingDerivationProjection } from "../lib/civic-data/meeting-derivation-read.ts";
import { MemoryRoutineDataStore, PostgresRoutineDataStore, type PublishedCandidateMetadata } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { ensureMeetingDoors, MEETING_DOOR_STATES_SQL, MEETING_DOORS_STATE_SQL, meetingDoorsProjectionIssue, readMeetingDoors } from "../lib/doors/meeting-doors.ts";
import { activeWiring } from "../lib/registry/source-wiring.ts";
import { installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";

test("a state's meeting derive reads only its promoted scope", async () => {
  const store = new MemoryRoutineDataStore();
  const scopes: string[] = [];
  const read = store.readPromotion.bind(store);
  store.readPromotion = async (recordClass, scope) => { scopes.push(scope); return read(recordClass, scope); };
  const result = await readMeetingDerivationProjection({ family: "meeting-source-wiring", options: { state: "AZ", store, bypassCache: true },
    statePath: ["row", "state"], value: records => ({ records }) });
  assert.equal(result.kind, "NOT_RECORDED");
  assert.deepEqual(scopes, ["US-AZ:meeting-source-wiring"]);
});

test("the newest calendar reads are selected inside the requested state in the database", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_log_discovery_attempts(log_key text,position bigint,record jsonb)");
    const save = async (state: string, position: number, route: string, at: string) => pg.query("INSERT INTO cp_log_discovery_attempts VALUES($1,$2,$3)",
      [`${state.toLowerCase()}:city:example`, position, JSON.stringify({ stateCode: state, finishedAt: at,
        steps: [{ purpose: "endpoint", url: route, status: 200 }], evidence: state === "NJ" ? "Other state's evidence ".repeat(50_000) : "own evidence" })]);
    await save("AZ", 1, "https://example.az.gov/a", "2026-10-19T10:00:00Z");
    await save("AZ", 2, "https://example.az.gov/b", "2026-10-19T11:00:00Z");
    await save("NJ", 3, "https://example.nj.gov/a", "2026-10-19T12:00:00Z");
    const rows = (await pg.query<{ value: { stateCode: string }; routes: string[] }>(CURRENT_CALENDAR_READS_SQL, [null, "AZ"])).rows;
    assert.equal(rows.length, 2, "both routes survive their independent latest-read selection");
    assert.ok(rows.every(row => row.value.stateCode === "AZ"));
    assert.ok(!JSON.stringify(rows).includes("Other state's evidence"));
  } finally { await pg.close(); }
});

test("a derived input verifies its immutable published hash without loading its country-sized source record", async () => {
  const hash = "a".repeat(64);
  const input = { kind: "PROMOTED_VERSION" as const, versionId: "national-source", recordClass: "CURATED_READER_RECORD", scope: "US:meeting-body-crosswalk",
    readModelSha256: hash, promotedAt: "2026-10-19T00:00:00Z" };
  let fullReads = 0;
  const store = {
    async readCandidate() { fullReads++; throw new Error("the entire source record must stay in the database"); },
    async readPublishedCandidateMetadata() { return { state: "PROMOTED", candidate: { recordClass: input.recordClass, scope: input.scope,
      normalization: { normalizedHash: hash } } } as PublishedCandidateMetadata; },
  };
  const candidate = { retrieval: { derived: { inputs: [input] } } } as unknown as RoutineCandidate;
  assert.equal(await derivedInputAuthorityIssue(store, candidate), null);
  assert.equal(fullReads, 0);
  const changed = { ...candidate, retrieval: { ...candidate.retrieval, derived: { inputs: [{ ...input, readModelSha256: "b".repeat(64) }] } } };
  assert.match(await derivedInputAuthorityIssue(store, changed) ?? "", /READ_MODEL_MISMATCH/);
});

test("a selected state's proven empty hand-wired inventory leaves room for its derived meeting work", async () => {
  const pg = new PGlite();
  const payload = { kind: "meeting-doors", formatVersion: 1, doors: [{ doorId: "az:calendar", ocdId: "ocd-division/country:us/state:az/place:tucson" }] };
  const store = Object.create(PostgresRoutineDataStore.prototype) as PostgresRoutineDataStore;
  store.readPromotion = async () => null;
  try {
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    await insertPublishedSliceFixture(pg, {id: "v1", sourceId: "meeting-doors", recordClass: "CURATED_READER_RECORD", scope: "US:meeting-doors",
      readModel: payload, at: "2026-10-19T00:00:00Z"});
    installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement =>
      (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows)));
    const read = await readMeetingDoors({ state: "AL", store, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    assert.deepEqual(read.value?.doors, []);
    const installed = await ensureMeetingDoors({ state: "AL", store });
    assert.equal(installed.ready, true);
    assert.ok(installed.ready && installed.input?.versionId === "v1", "even an empty selected inventory retains its timed authority for derive work");
    assert.equal(activeWiring().length, 0);
    assert.match(meetingDoorsProjectionIssue({ kind: "meeting-doors", formatVersion: 1, doors: [] }) ?? "", /holds no door/, "an unscoped empty publication still fails");
    const manualScope = "US-AZ+US-NH+US-NJ:meeting-body-crosswalk";
    const manual = { kind: "meeting-body-crosswalk", records: [{ id: "az-binding", ocdId: "ocd-division/country:us/state:az/place:tucson" }] };
    await insertPublishedSliceFixture(pg, {id: "v2", sourceId: "curated-reader-primary-sources", recordClass: "CURATED_READER_RECORD", scope: manualScope,
      readModel: manual, at: "2026-10-19T00:00:00Z"});
    const crosswalk = await readMeetingDerivationProjection({ family: "meeting-body-crosswalk", options: { state: "AL", store }, statePath: ["ocdId"], value: records => ({ records }) });
    assert.equal(crosswalk.kind, "PROMOTED", "the legacy manual pointer uses its real registered scope");
    assert.equal(crosswalk.sourceInput?.scope, manualScope);
    assert.deepEqual(crosswalk.value?.records, []);
  } finally { installReaderDatabaseQuery(undefined); installFixtureDoors(); await pg.close(); }
});

test("door publication selects actual hand-wired meetings before transfer, excluding JSON-null feeds and derived families", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_doors(id text,revision integer,updated_at timestamptz,value jsonb)");
    for (const [id, state, meeting] of [["hand", "AZ", { source: "ical" }], ["feed", "AL", null], ["derived", "NJ", { family: "US-NJ" }]] as const)
      await pg.query("INSERT INTO cp_doors VALUES($1,1,'2026-10-19',$2)", [id, JSON.stringify({ ocdId: `ocd-division/country:us/state:${state.toLowerCase()}`, meeting, status: "OPEN" })]);
    assert.deepEqual((await pg.query(MEETING_DOOR_STATES_SQL)).rows, [{ state: "AZ" }]);
    assert.equal((await pg.query(MEETING_DOORS_STATE_SQL, ["/(state|district|territory):al(/|$)", "^curated:al/"])).rows.length, 0);
  } finally { await pg.close(); }
});
