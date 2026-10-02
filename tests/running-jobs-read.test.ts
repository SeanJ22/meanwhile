import assert from "node:assert/strict";
import test from "node:test";

import { pgActiveWorkClaimReader, unavailableActiveWorkClaims } from "../lib/control-plane/repository/active-work-claims.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import { mapRunningJobRow, RUNNING_JOBS_LIMIT, RUNNING_JOBS_SQL } from "../lib/control-plane/repository/running-jobs.ts";
import { STATE_PROMOTION_SQL, STATE_WORKER_RESULT_SQL, stateSubjectPattern } from "../lib/control-plane/repository/state-progress.ts";
import { stateOfSubject } from "../lib/control-plane/expansion/subjects.ts";

const nowIso = "2026-10-01T20:00:00.000Z";
const READY = [
  { name: "cp_attempts_lease_id", valid: true, indexdef: "CREATE INDEX cp_attempts_lease_id ON cp_attempts USING btree (((value ->> 'leaseId'::text)))" },
  { name: "cp_leases_expiry", valid: true, indexdef: "CREATE INDEX cp_leases_expiry ON cp_leases USING btree (((value ->> 'expiresAt'::text)))" },
];
const row = (n: number, over: Record<string, unknown> = {}) => ({
  lease_key: `rt-${n}`, lease_id: `ls-${n}`, route_task_id: `rt-${n}`, holder: "runner", expires_at: "2026-10-01T20:10:00.000Z", released: "false",
  attempt_id: `at-${n}`, attempt_lease_id: `ls-${n}`, started_at: "2026-10-01T19:58:00.000Z", ended_at: null, outcome: null, role: "ACQUIRER",
  version: "route-executor/1.0", work_item_id: `wi-${n}`, obligation_id: `ob-${n}`, record_class: "meetings", subject_id: `az:city:${n}`,
  scope_divisions: ["ocd-division/country:us/state:az"], assignments: JSON.stringify([{ assignmentKey: "zcta:2020/85635", ref: "r1", at: "2026-09-27T23:10:31.451Z" }]), ...over,
});

function fakeSql(rows: unknown[], index: unknown[] = READY) {
  const calls: { text: string; params: readonly unknown[] | undefined }[] = [];
  const sql = { async query(text: string, params?: readonly unknown[]) { calls.push({ text, params }); return text.includes("pg_class") ? index : rows; } } as Sql;
  return { sql, calls };
}

test("the running-jobs statement is one bounded, indexed read of live leases joined to open attempts", () => {
  assert.match(RUNNING_JOBS_SQL, /\(value->>'expiresAt'\) > \$1 AND \(value->>'released'\) = 'false' AND id <> 'nightly-window'/);
  assert.match(RUNNING_JOBS_SQL, /ORDER BY \(value->>'expiresAt'\), id LIMIT \$2/);
  assert.match(RUNNING_JOBS_SQL, /value->>'leaseId' = l\.value->>'id' AND \(value->>'endedAt'\) IS NULL AND \(value->>'outcome'\) IS NULL/);
  assert.match(RUNNING_JOBS_SQL, /regexp_replace\(w\.value->>'obligation', '#\[0-9\]\+\$', ''\)/);
  assert.match(RUNNING_JOBS_SQL, /LIMIT 64/, "an obligation's Send list is bounded too");
  assert.doesNotMatch(RUNNING_JOBS_SQL, /SELECT \*|\.list\(/);
});

test("the read asks for one row more than its limit and says so when it gets it", async () => {
  const rows = Array.from({ length: 4 }, (_, i) => row(i));
  const { sql, calls } = fakeSql(rows);
  const page = await pgActiveWorkClaimReader(sql).readRunningJobs({ nowIso, limit: 3 });
  assert.equal(page.available, true);
  assert.equal(page.truncated, true, "more leases than the limit: every count is a lower bound");
  assert.equal(page.rows.length, 3, "never more rows than the limit");
  assert.deepEqual(calls.at(-1)?.params, [nowIso, 4]);
  const exact = await pgActiveWorkClaimReader(fakeSql(rows.slice(0, 3)).sql).readRunningJobs({ nowIso, limit: 3 });
  assert.equal(exact.truncated, false, "exactly the limit is not a truncation");
  const dflt = await pgActiveWorkClaimReader(fakeSql([]).sql).readRunningJobs({ nowIso });
  assert.equal(dflt.limit, RUNNING_JOBS_LIMIT);
  assert.deepEqual(dflt.rows, []);
  await assert.rejects(pgActiveWorkClaimReader(fakeSql([]).sql).readRunningJobs({ nowIso, limit: RUNNING_JOBS_LIMIT + 1 }), /INVALID_RUNNING_JOBS_LIMIT/);
});

test("a missing or invalid index makes the read unavailable instead of scanning or reporting nothing running", async () => {
  for (const index of [[], [READY[0]], [READY[0], { ...READY[1], valid: false }], [READY[0], { ...READY[1], indexdef: "CREATE INDEX x ON cp_leases (id)" }]]) {
    const { sql, calls } = fakeSql([row(1)], index);
    const page = await pgActiveWorkClaimReader(sql).readRunningJobs({ nowIso });
    assert.equal(page.available, false);
    assert.equal(page.reason, "RUNNING_JOBS_INDEX_NOT_READY");
    assert.equal(calls.length, 1, "the join statement is never sent");
  }
  const memory = await unavailableActiveWorkClaims().readRunningJobs({ nowIso });
  assert.equal(memory.available, false);
  assert.deepEqual(memory.rows, []);
});

test("rows map to leases with their open attempt and obligation; a row that is not a lease claim fails the page", () => {
  const mapped = mapRunningJobRow(row(7));
  assert.equal(mapped.leaseId, "ls-7");
  assert.equal(mapped.released, false);
  assert.equal(mapped.attempt?.role, "ACQUIRER");
  assert.equal(mapped.attempt?.endedAt, null);
  assert.deepEqual(mapped.obligation?.scopeDivisions, ["ocd-division/country:us/state:az"]);
  assert.deepEqual(mapped.obligation?.assignments, [{ assignmentKey: "zcta:2020/85635", ref: "r1", at: "2026-09-27T23:10:31.451Z" }]);
  const noAttempt = mapRunningJobRow(row(8, { attempt_id: null, obligation_id: null }));
  assert.equal(noAttempt.attempt, null);
  assert.equal(noAttempt.obligation, null);
  assert.throws(() => mapRunningJobRow(row(9, { expires_at: "soon" })), /RUNNING_JOBS_ROW_INVALID/);
  assert.throws(() => mapRunningJobRow(row(9, { released: null })), /RUNNING_JOBS_ROW_INVALID/);
  assert.throws(() => mapRunningJobRow(row(9, { role: null })), /RUNNING_JOBS_ATTEMPT_INVALID/);
  assert.equal(mapRunningJobRow(row(9, { assignments: JSON.stringify([{ assignmentKey: "k" }, "x"]) })).obligation?.assignments.length, 0, "a Send mark that is not whole is not kept");
});

test("the state progress statements find the newest row for the state itself, and a row outside it is refused", async () => {
  assert.match(STATE_PROMOTION_SQL, /stage' = 'APPROVED_FOR_PROMOTION' AND lower\(s\.record->>'subjectId'\) ~ \$1\nORDER BY r\.record->>'at' DESC LIMIT 1/);
  assert.match(STATE_WORKER_RESULT_SQL, /'VALIDATOR' AND .*'PASS'\)\n\s+OR \(.*'ADVERSARIAL_AUDITOR' AND .*'SURVIVED'\)/);
  assert.match(STATE_WORKER_RESULT_SQL, /ORDER BY r\.record->>'endedAt' DESC LIMIT 1/);
  const pattern = new RegExp(stateSubjectPattern("az"));
  for (const subject of ["az:2026:state-az:governor", "az-city:x", "ballot-az-2026", "ocd-division/country:us/state:az/county:cochise", "ocd-division/country:us/district:az"])
    assert.ok(pattern.test(subject.toLowerCase()) && stateOfSubject(subject) === "AZ", subject);
  for (const subject of ["nh:2026:x", "azusa:thing", "ocd-division/country:us/state:ak", "zip:85635"])
    assert.ok(!pattern.test(subject.toLowerCase()) && stateOfSubject(subject) !== "AZ", subject);
  const hit = { at: "2026-09-28T23:51:13.777Z", subject: "az:2026:state-az:governor", detail: "candidate-enrichment" };
  const answer = (promotion: unknown[], result: unknown[]) => ({ sql: { async query(text: string) { return text.includes("promotion_pipeline") ? promotion : result; } } as Sql });
  const read = async (promotion: unknown[], result: unknown[]) => pgActiveWorkClaimReader(answer(promotion, result).sql).readLatestStateProgress({ state: "az" });
  assert.deepEqual((await read([hit], [])).progress, { at: hit.at, kind: "PROMOTION", subject: hit.subject, detail: "candidate-enrichment" });
  const newer = { at: "2026-09-29T01:00:00.000Z", subject: "az:city:phoenix", detail: "VALIDATOR" };
  assert.equal((await read([hit], [newer])).progress?.kind, "WORKER_RESULT", "the newer of the two");
  assert.equal((await read([], [])).progress, null, "nothing recorded in the state is null");
  await assert.rejects(read([{ ...hit, subject: "nh:2026:x" }], []), /STATE_PROGRESS_ROW_INVALID/);
  await assert.rejects(pgActiveWorkClaimReader(answer([], []).sql).readLatestStateProgress({ state: "a'; drop" }), /INVALID_STATE_PROGRESS_STATE/);
  const memory = await unavailableActiveWorkClaims().readLatestStateProgress({ state: "az" });
  assert.deepEqual(memory, { available: false, reason: "ACTIVE_CLAIM_INDEX_UNAVAILABLE", progress: null });
});
