import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { shareVersionedRows } from "../lib/db/versioned-rows.ts";
import { pgAppendOnlyRepository, pgDoorRepository, pgMethodCandidateSummary, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { CONTROL_COUNTS_DDL } from "../lib/control-plane/repository/control-counts.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordArtifactMetadata } from "../lib/control-plane/repository/coordinator.ts";
import { AppendOnlyViolation, type ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { Attempt } from "../lib/control-plane/attempt.ts";
import { CENSUS_DOOR_MATCH_FIELDS, handWiredMeetingDoor } from "../lib/doors/platform-census.ts";
import { DOOR_READS_DDL } from "../lib/doors/read-changes.ts";
import { applyDerivedRow, checkDoorDraft, type DoorRecord } from "../lib/doors/registry.ts";
import { readRunnerDoors } from "../lib/doors/runner-reads.ts";
import { planProbes, runHourlyProbes } from "../lib/doors/hourly-check.ts";
import { pageDoorsDue } from "../lib/doors/page-refresh.ts";
import { doorPartitionIds, readNowDueRequests } from "../lib/doors/mission-refresh.ts";
import { editDeriveDueRequests } from "../lib/doors/edit-derive.ts";
import { DOOR_DERIVE_CONTRACT_IDS } from "../lib/civic-data/routine-due-request.ts";
import { publishNowDoorTasks } from "../lib/civic-data/publish-now.ts";
import type { RoutineSourceTask } from "../lib/civic-data/runner.ts";
import { candidateCounts, type CandidateSummary } from "../lib/method/candidate.ts";

const AT = "2026-10-23T10:00:00.000Z", NEXT = "2026-10-24T10:00:00.000Z";
async function database(t: test.TestContext) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`CREATE TABLE cp_doors(id text PRIMARY KEY,revision bigint,updated_at timestamptz,changed_at timestamptz DEFAULT now(),value jsonb);
    CREATE TABLE cp_method_candidates(LIKE cp_doors INCLUDING ALL);
    CREATE TABLE cp_log_artifacts(log_key text,record_id text,position bigint,record jsonb,PRIMARY KEY(log_key,position));
    CREATE FUNCTION cp_control_state(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT substring(value->>'ocdId' from '/state:([a-z]{2})')$$;`);
  for (const ddl of CONTROL_COUNTS_DDL) await db.exec(ddl);
  await db.exec(`INSERT INTO cp_control_counts(table_name,bucket,n) VALUES('cp_doors','*',0);
    CREATE TRIGGER a_cp_control_counts AFTER INSERT OR UPDATE OR DELETE ON cp_doors
      FOR EACH ROW EXECUTE FUNCTION cp_touch_control_counts()`);
  for (const ddl of DOOR_READS_DDL) await db.exec(ddl);
  const copies = new Map<string, string>(), received: Record<string, unknown>[] = [];
  const sql: Sql = { query: async (text, params = []) => {
    const rows = (await db.query<Record<string, unknown>>(text, [...params])).rows;
    received.push(...rows); return rows;
  } };
  const identity = createHash("sha256").update(t.name).digest("hex");
  shareVersionedRows(sql, `postgres://fixture:fixture@selectors-${identity}.invalid/neondb`, new CivicReadCache({
    read: async key => copies.get(key) ?? null, write: async (key, value) => { copies.set(key, value); },
  }));
  return { db, sql, received };
}

function calendar(id: string): DoorRecord {
  const draft = checkDoorDraft({ doorId: id, kind: "ical", hosts: ["city.gov"], bodyIds: ["board"],
    ocdId: "ocd-division/country:us/state:az", config: { feedUrl: "https://city.gov/feed", partitionRoute: "0123456789abcdef", capture: "source ".repeat(20_000) },
    meeting: { agendaSourceType: "ICAL", jurisdiction: "City", publishingOrg: "City", timeZone: "UTC", verifiedAt: AT, family: null } });
  assert.ok(draft.ok); return applyDerivedRow(null, draft.value, AT, AT)!;
}

test("routine stage projections preserve custom routes and all due decisions across daily passes and probe writes", async t => {
  const { sql } = await database(t), repo = pgDoorRepository(sql), base = calendar("meetings:ical:board");
  for (const door of [base, { ...base, doorId: "page", kind: "page", meeting: null,
    config: { url: "https://city.gov/roster", workItemId: "roster-job", capture: "source ".repeat(20_000) },
    lastSuccessAt: "2026-10-21T00:00:00.000Z", observedChangeMinutes: 60 },
    { ...base, doorId: "feed:people", meeting: null, readNow: true, config: { contractId: "people" } },
    { ...base, doorId: "edited", origin: "MANUAL", status: "SHUT", editedAt: AT },
    { ...base, doorId: "suspended", status: "SUSPENDED", readNow: true }] as DoorRecord[]) await repo.put(door.doorId, door, AT);
  const all = (await repo.list()).map(row => row.value), hot = new Set(all.flatMap(doorPartitionIds));
  const tasks = [...hot].map(id => ({ id })) as RoutineSourceTask[];
  for (const now of [AT, NEXT]) {
    const probes = await readRunnerDoors(repo, ["status"], "OPEN", "probes");
    assert.deepEqual(planProbes(probes, hot, now).doors.map(row => row.doorId), planProbes(all, hot, now).doors.map(row => row.doorId));
    assert.equal(planProbes(probes, hot, now).deferred, planProbes(all, hot, now).deferred);
    assert.deepEqual(readNowDueRequests(await readRunnerDoors(repo, ["readNow"], "true", "requests"), hot, now), readNowDueRequests(all, hot, now));
    assert.deepEqual(editDeriveDueRequests(await readRunnerDoors(repo, ["origin"], "MANUAL", "requests"), new Set(DOOR_DERIVE_CONTRACT_IDS), now), editDeriveDueRequests(all, new Set(DOOR_DERIVE_CONTRACT_IDS), now));
    assert.deepEqual(pageDoorsDue(await readRunnerDoors(repo, ["kind"], "page", "refresh"), now).map(row => row.doorId), pageDoorsDue(all, now).map(row => row.doorId));
    assert.deepEqual(publishNowDoorTasks(await readRunnerDoors(repo, ["status"], "OPEN", "publication"), tasks, now), publishNowDoorTasks(all, tasks, now));
    assert.ok(!JSON.stringify(probes).includes("source source"));
    assert.equal(probes.find(row => row.doorId === base.doorId)?.config.partitionRoute, "0123456789abcdef");
    const report = await runHourlyProbes(repo, probes, hot,
      async () => ({ status: 200, headers: { get: () => null }, bytes: async () => new TextEncoder().encode(now) }), now);
    assert.equal(report.changed, 1);
    assert.equal(publishNowDoorTasks(await readRunnerDoors(repo, ["status"], "OPEN", "publication"), tasks, now).length, 1);
    const held = await repo.mustRead(base.doorId);
    await repo.compareAndSet(held.id, held.revision, { ...held.value, lastSuccessAt: now }, now);
    assert.equal(publishNowDoorTasks(await readRunnerDoors(repo, ["status"], "OPEN", "publication"), tasks, now).length, 0);
    assert.equal((await repo.mustRead(base.doorId)).value.config.capture, base.config.capture);
  }
});

test("census SQL selectors preserve null versus absent keys, state scope, and newly changed descriptors", async t => {
  const { sql, db, received } = await database(t), repo = pgDoorRepository(sql), base = calendar("base");
  const doors = [base, { ...base, doorId: "null-key", config: { crosswalkRowId: null } },
    { ...base, doorId: "census", config: { crosswalkRowId: "crosswalk" } },
    { ...base, doorId: "family", meeting: { ...base.meeting!, family: "derived:az" } },
    { ...base, doorId: "page", meeting: null }, { ...base, doorId: "suspended", status: "SUSPENDED" },
    { ...base, doorId: "texas", ocdId: "ocd-division/country:us/state:tx" }] as DoorRecord[];
  for (const door of doors) await repo.put(door.doorId, door, AT);
  assert.deepEqual((await repo.meetingMatches!(false, CENSUS_DOOR_MATCH_FIELDS)).map(row => row.id), doors.filter(handWiredMeetingDoor).map(row => row.doorId).sort());
  assert.deepEqual((await repo.meetingMatches!(true, CENSUS_DOOR_MATCH_FIELDS)).map(row => row.id), ["census", "null-key"]);
  received.length = 0; await repo.meetingMatches!(true, CENSUS_DOOR_MATCH_FIELDS);
  assert.ok(received.every(row => !Object.hasOwn(row, "value")), "unchanged selected bodies stay in the shared copy store");
  assert.deepEqual((await pgDoorRepository(sql, { state: "az" }).meetingMatches!(false, CENSUS_DOOR_MATCH_FIELDS)).map(row => row.id), ["base"]);
  await db.query("UPDATE cp_doors SET revision=revision+1,value=jsonb_set(value,'{config,bodyName}','\"Changed board\"') WHERE id='census'");
  assert.equal((await repo.meetingMatches!(true, CENSUS_DOOR_MATCH_FIELDS))[0].value.config.bodyName, "Changed board");
});

test("candidate summary checks one document revision and returns the current lifecycle and admission without proposals", async t => {
  const { sql, db, received } = await database(t);
  const summaries: CandidateSummary[] = Array.from({ length: 105 }, (_, n) => ({ id: `candidate-${n}`, lifecycle: n % 2 ? "ADMITTED" : "REJECTED", submittedAt: AT }));
  await db.query("INSERT INTO cp_method_candidates VALUES('live',1,$1,now(),$2)", [AT, JSON.stringify({ candidates: summaries.map(row => ({ ...row, proposal: "proposal".repeat(2000) })) })]);
  assert.deepEqual(await pgMethodCandidateSummary(sql), summaries);
  assert.ok(Buffer.byteLength(JSON.stringify(received)) < 20_000);
  assert.deepEqual(candidateCounts({ candidates: await pgMethodCandidateSummary(sql) }), candidateCounts({ candidates: summaries }));
  received.length = 0; assert.deepEqual(await pgMethodCandidateSummary(sql), summaries);
  assert.equal(received.length, 1); assert.equal(received[0].__unchanged, true); assert.equal(received[0].value, null);
  summaries[104] = { ...summaries[104], lifecycle: "ADMITTED", admission: { at: NEXT, effect: "LEARNED" } } as CandidateSummary;
  await db.query("UPDATE cp_method_candidates SET revision=2,value=$1 WHERE id='live'", [JSON.stringify({ candidates: summaries })]);
  assert.deepEqual(await pgMethodCandidateSummary(sql), summaries, "the next independent operation observes changed membership and admission together");
  const current = [{ id: "current", lifecycle: "PROPOSED", submittedAt: NEXT }] as CandidateSummary[];
  let moved = false;
  const racing: Sql = { query: async (text, params = []) => {
    const rows = await sql.query(text, params);
    if (!moved && text.includes("jsonb_array_elements")) {
      moved = true;
      await db.query("UPDATE cp_method_candidates SET revision=3,value=$1 WHERE id='live'", [JSON.stringify({ candidates: current })]);
    }
    return rows;
  } };
  assert.deepEqual(await pgMethodCandidateSummary(racing), summaries, "one atomic statement keeps all 105 summaries at the same revision during a concurrent replacement");
  assert.deepEqual(await pgMethodCandidateSummary(racing), current, "the following operation sees the concurrent replacement");
  await db.exec("DELETE FROM cp_method_candidates"); assert.deepEqual(await pgMethodCandidateSummary(sql), []);
});

test("artifact duplicate recovery reads one versioned member and preserves its allocated position across gaps", async t => {
  const { sql, db, received } = await database(t), artifacts = pgAppendOnlyRepository<ArtifactRecord>(sql, "artifacts");
  const original: ArtifactRecord = { artifactId: "page", workItemId: "job", routeTaskId: "route", attemptId: "first", tier: "RAW",
    contentHash: "sha256-held", byteLength: 100, contentType: "text/html", canonicalUrl: "https://city.gov/roster", partial: false, recordedAt: AT };
  await db.query("INSERT INTO cp_log_artifacts VALUES($1,$2,19,$3)", ["job", "page", JSON.stringify(original)]);
  const memory = createMemoryRepositories(); await memory.attempts.put("second", { id: "second" } as Attempt, NEXT);
  const repos = { ...memory, artifacts };
  const result = await recordArtifactMetadata(repos, { ...original, attemptId: "second", recordedAt: NEXT }, NEXT);
  assert.deepEqual(result, { appended: false, recordId: "page", record: original, position: 19 });
  received.length = 0; assert.deepEqual(await artifacts.readEntry!("job", "page"), { record: original, position: 19 });
  assert.ok(received.every(row => !Object.hasOwn(row, "record")), "duplicate recovery reuses the shared versioned log slot");
  await assert.rejects(recordArtifactMetadata(repos, { ...original, attemptId: "second", contentHash: "sha256-different" }, NEXT), AppendOnlyViolation);
  await db.query("UPDATE cp_log_artifacts SET record=jsonb_set(record,'{canonicalUrl}','\"https://city.gov/current\"') WHERE log_key='job'");
  assert.equal((await artifacts.readEntry!("job", "page"))?.record.canonicalUrl, "https://city.gov/current");
});
