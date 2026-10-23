import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgAggregateRepository, pgAppendOnlyRepository, pgBoxRepository, pgDoorRepository, pgMethodCandidateSummary, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { indexScoutFindings } from "../lib/control-plane/box.ts";
import { handWiredMeetingDoor, CENSUS_DOOR_MATCH_FIELDS } from "../lib/doors/platform-census.ts";
import { applyDerivedRow, checkDoorDraft, type DoorRecord } from "../lib/doors/registry.ts";
import { readRoutineDoors } from "../lib/doors/routine-reads.ts";
import { readNowDueRequests } from "../lib/doors/mission-refresh.ts";
import { editDeriveDueRequests } from "../lib/doors/edit-derive.ts";
import { pageDoorsDue } from "../lib/doors/page-refresh.ts";
import { planProbes, runHourlyProbes } from "../lib/doors/hourly-check.ts";
import { publishNowDoorTasks } from "../lib/civic-data/publish-now.ts";
import { DOOR_DERIVE_CONTRACT_IDS } from "../lib/civic-data/routine-due-request.ts";
import type { RoutineSourceTask } from "../lib/civic-data/runner.ts";

const AT = "2026-10-23T10:00:00.000Z", NEXT = "2026-10-24T10:00:00.000Z";
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

async function database(t: test.TestContext) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`CREATE TABLE cp_doors(id text PRIMARY KEY, revision integer NOT NULL,
    updated_at timestamptz NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(), value jsonb NOT NULL);
    CREATE TABLE cp_box_findings(LIKE cp_doors INCLUDING ALL);
    CREATE TABLE cp_method_candidates(LIKE cp_doors INCLUDING ALL);
    CREATE TABLE cp_log_artifacts(log_key text, record_id text, position integer, record jsonb, PRIMARY KEY(log_key,record_id));
    CREATE FUNCTION cp_control_state(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE
      AS $$SELECT substring(value->>'ocdId' from '/state:([a-z]{2})')$$;`);
  let received = 0;
  const sql: Sql = { query: async (text, params = []) => {
    const { rows } = await db.query(text, [...params]); received += bytes(rows); return rows;
  } };
  return { db, sql, reset: () => { received = 0; }, bytes: () => received };
}

test("routine selectors preserve publication, probes, refresh and due work across the next daily pass", async t => {
  const { sql, bytes: received, reset } = await database(t), repo = pgDoorRepository(sql);
  const checked = checkDoorDraft({ doorId: "calendar", kind: "ical", hosts: ["city.gov"], bodyIds: ["board"],
    config: { feedUrl: "https://city.gov/feed", capture: "source ".repeat(20_000) },
    meeting: { agendaSourceType: "ICAL", jurisdiction: "City", publishingOrg: "City", timeZone: "America/Phoenix", verifiedAt: AT, family: null } });
  assert.ok(checked.ok);
  const calendar = applyDerivedRow(null, checked.value, AT, AT)!;
  const base: DoorRecord[] = [calendar, { ...calendar, doorId: "page", kind: "page", meeting: null,
    config: { url: "https://city.gov/roster", workItemId: "roster-job", capture: "source ".repeat(20_000) },
    lastSuccessAt: "2026-10-21T00:00:00.000Z", checkEveryMinutes: null, observedChangeMinutes: 60 },
    { ...calendar, doorId: "feed:people", meeting: null, readNow: true, config: { contractId: "people" } },
    { ...calendar, doorId: "edited", origin: "MANUAL", status: "SHUT", editedAt: AT },
    { ...calendar, doorId: "suspended", status: "SUSPENDED", readNow: true }];
  for (const door of base) await repo.put(door.doorId, door, AT);
  const all = (await repo.list()).map(row => row.value), before = received(); reset();
  const tasks = [{ id: "calendar" }, { id: "people" }] as RoutineSourceTask[], known = new Set(tasks.map(task => task.id));
  for (const now of [AT, NEXT]) {
    const requests = await readRoutineDoors(repo, "requests");
    assert.deepEqual(readNowDueRequests(requests, known, now), readNowDueRequests(all, known, now));
    assert.deepEqual(editDeriveDueRequests(requests, new Set(DOOR_DERIVE_CONTRACT_IDS), now), editDeriveDueRequests(all, new Set(DOOR_DERIVE_CONTRACT_IDS), now));
    const probes = await readRoutineDoors(repo, "probes");
    assert.deepEqual(planProbes(probes, known, now).doors.map(row => row.doorId), planProbes(all, known, now).doors.map(row => row.doorId));
    assert.deepEqual(pageDoorsDue(await readRoutineDoors(repo, "refresh"), now).map(row => row.doorId), pageDoorsDue(all, now).map(row => row.doorId));
    assert.deepEqual(publishNowDoorTasks(await readRoutineDoors(repo, "publication"), tasks, now), publishNowDoorTasks(all, tasks, now));
  }
  assert.ok(received() < before / 5);
  for (const now of [AT, NEXT]) {
    const report = await runHourlyProbes(repo, await readRoutineDoors(repo, "probes"), known,
      async () => ({ status: 200, headers: { get: () => null }, bytes: async () => new TextEncoder().encode(now) }), now);
    assert.equal(report.changed, 1);
    const publication = publishNowDoorTasks(await readRoutineDoors(repo, "publication"), tasks, now);
    assert.equal(publication[0]?.id, "calendar", "the same pass must see the probe's update");
    const held = await repo.mustRead("calendar");
    await repo.compareAndSet(held.id, held.revision, { ...held.value, lastSuccessAt: now }, now);
    assert.equal(publishNowDoorTasks(await readRoutineDoors(repo, "publication"), tasks, now).length, 0);
    assert.equal((await repo.mustRead("calendar")).value.config.capture, calendar.config.capture);
  }
});

test("SQL census predicates preserve absent versus null crosswalk keys and DERIVED hand-wired doors", async t => {
  const { sql } = await database(t), repo = pgDoorRepository(sql);
  const checked = checkDoorDraft({ doorId: "base", kind: "ical", hosts: [], bodyIds: [], meeting: {
    agendaSourceType: "ICAL", jurisdiction: "City", publishingOrg: "City", timeZone: "UTC", verifiedAt: AT, family: null } });
  assert.ok(checked.ok);
  const base = applyDerivedRow(null, checked.value, AT, AT)!;
  for (const door of [base, { ...base, doorId: "null-key", config: { crosswalkRowId: null } },
    { ...base, doorId: "census", config: { crosswalkRowId: "crosswalk" } },
    { ...base, doorId: "family", meeting: { ...base.meeting!, family: "derived:az" } },
    { ...base, doorId: "page", meeting: null }, { ...base, doorId: "suspended", status: "SUSPENDED" }]) {
    await repo.put(door.doorId, door as DoorRecord, AT);
  }
  const all = (await repo.list()).map(row => row.value);
  assert.deepEqual((await repo.meetingMatches!(false, CENSUS_DOOR_MATCH_FIELDS)).map(row => row.id), all.filter(handWiredMeetingDoor).map(row => row.doorId));
  assert.deepEqual((await repo.meetingMatches!(true, CENSUS_DOOR_MATCH_FIELDS)).map(row => row.id), ["census", "null-key"]);
  for (const state of ["az", "tx"]) await repo.put(state, { ...base, doorId: state, ocdId: `ocd-division/country:us/state:${state}` }, AT);
  assert.deepEqual((await pgDoorRepository(sql, { state: "az" }).meetingMatches!(false, CENSUS_DOOR_MATCH_FIELDS)).map(row => row.id), ["az"],
    "a state worker must not load another state's descriptors");
});

test("Box replays return only an identity; missing metadata still merges and preserves builder state", async t => {
  const { sql, bytes: received, reset } = await database(t), repo = pgBoxRepository(sql);
  const result = { subjectId: "person", attemptId: "attempt", workItemId: "job", recordedAt: AT,
    findings: [{ kind: "RECORD" as const, summary: "City Clerk", exactQuote: "City Clerk", sourceUrl: "https://city.gov/roster", artifactIds: ["page"] }] };
  const [identity] = await indexScoutFindings(repo, result, AT);
  const held = await repo.mustRead(identity.id);
  const wide = { ...held.value, state: "built" as const, publicationId: "live", generation: 7,
    origins: [...held.value.origins, ...Array.from({ length: 200 }, (_, n) => ({ ...held.value.origins[0], resultId: `other-${n}`, artifactIds: ["capture".repeat(200)] }))] };
  await repo.compareAndSet(identity.id, held.revision, wide, AT);
  reset(); await repo.read(identity.id); const before = received(); reset();
  assert.deepEqual(await indexScoutFindings(repo, result, NEXT), [identity]);
  assert.ok(received() < before / 100);
  const unchanged = await repo.mustRead(identity.id);
  assert.equal(unchanged.revision, 2); assert.deepEqual(unchanged.value, wide);
  await indexScoutFindings(repo, { ...result, obligationId: "log-partition" }, NEXT);
  const upgraded = (await repo.mustRead(identity.id)).value;
  assert.equal(upgraded.origins.find(origin => origin.resultId === "attempt")?.resultKey, "log-partition");
  assert.equal(upgraded.state, "built"); assert.equal(upgraded.generation, 7); assert.equal(upgraded.publicationId, "live");
  assert.equal(upgraded.origins.length, wide.origins.length);
  const withFact = { ...result, findings: [{ ...result.findings[0], field: "officeholder.title", value: "City Clerk" }] };
  assert.deepEqual(await indexScoutFindings(repo, withFact, NEXT), [identity], "a legacy fact keeps its original identity");
  const gained = await repo.mustRead(identity.id);
  assert.equal(gained.value.fact?.field, "officeholder.title");
  reset(); assert.deepEqual(await indexScoutFindings(repo, withFact, NEXT), [identity]);
  assert.ok(received() < 500);
  const replayBytes = received();
  assert.equal((await repo.mustRead(identity.id)).revision, gained.revision);
  t.diagnostic(`Box replay SQL response bytes: ${before} -> ${replayBytes}`);
});

test("a created aggregate returns the submitted JSON snapshot without rereading its payload", async () => {
  const input = { capture: "original" }, calls: string[] = [];
  const sql: Sql = { query: async text => {
    calls.push(text); input.capture = "caller changed it during the request";
    return [{ id: "row", revision: 1, updated_at: AT }];
  } };
  const result = await pgAggregateRepository(sql, "entry", "cp_field_manual_entries").put("row", input, AT);
  assert.deepEqual(result.persisted.value, { capture: "original" });
  assert.equal(calls.length, 1); assert.match(calls[0], /^INSERT/);
});

test("candidate summaries page in SQL and artifact recovery keeps an allocated position with gaps", async t => {
  const { sql, db, bytes: received, reset } = await database(t);
  const repo = pgAggregateRepository(sql, "MethodCandidateStore", "cp_method_candidates");
  const summaries = Array.from({ length: 105 }, (_, n) => ({ id: `candidate-${n}`, lifecycle: n % 2 ? "ADMITTED" : "REJECTED", submittedAt: AT }));
  await repo.put("live", { candidates: summaries.map(row => ({ ...row, proposal: "page".repeat(1000) })) }, AT);
  reset(); assert.deepEqual(await pgMethodCandidateSummary(sql), summaries);
  assert.ok(received() < 20_000);
  let moved = false;
  const raced: Sql = { query: async (text, params = []) => {
    const rows = await sql.query(text, params);
    if (!moved && text.includes("c.position")) {
      moved = true;
      await db.query("UPDATE cp_method_candidates SET revision=revision+1 WHERE id='live'");
    }
    return rows;
  } };
  await assert.rejects(pgMethodCandidateSummary(raced), /modified concurrently/, "a metrics snapshot cannot mix array pages from different revisions");
  await db.query("INSERT INTO cp_log_artifacts VALUES($1,$2,$3,$4)", ["job", "page", 19, JSON.stringify({ artifactId: "page" })]);
  assert.deepEqual(await pgAppendOnlyRepository(sql, "artifacts").readEntry!("job", "page"), { position: 19, record: { artifactId: "page" } });
});
