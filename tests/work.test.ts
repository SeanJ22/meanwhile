import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { workId, workList, type WorkInput } from "../lib/core/work.ts";
import { workCounts } from "../lib/core/work-counts.ts";
import { SHARED_WORK_DDL } from "../lib/control-plane/repository/migrations/RB-A1.ts";

const base = SHARED_WORK_DDL.join(";\n");
const migration = readFileSync(new URL("../lib/control-plane/repository/migrations/RB-A5.sql", import.meta.url), "utf8");
const input: WorkInput = { kind: "check", placeId: "ocd-division/country:us/state:az/county:pima", subjectId: "body:pima",
  url: "https://www.pima.gov/contact", field: "phone", value: "520-724-4330", quote: "Phone: 520-724-4330", source: { report: "one" } };

test("work list retains reports without reopening, fences changed work, backs off, recovers leases and creates one detective", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(base);
  await pg.exec(migration);
  const query = async (sql: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
  let at = new Date("2026-10-24T12:00:00Z");
  const list = workList(query, { owner: "test", leaseMs: 5_000, now: () => at });
  const added = await list.add(input);
  const [first] = await list.claim("check", 1);
  assert.equal(first!.id, added.id);
  assert.equal((await list.claim("check", 1)).length, 0, "claimed before work begins");
  assert.equal(await list.finish(first!), true);
  const before = (await query("select not_before from work_row where id=$1", [added.id]))[0]!.not_before;
  at = new Date("2026-10-24T12:00:01Z");
  const reportTwo = { report: "two", url: "https://www.pima.gov/directory" };
  const repeated = await list.add({ ...input, source: reportTwo, priority: 99 });
  assert.equal(repeated.status, "done");
  assert.equal(new Date(repeated.notBefore).getTime(), new Date(before as string).getTime());
  assert.equal(repeated.priority, 0);
  assert.equal(repeated.reports.length, 2);
  assert.equal(repeated.reports[1]!.url, reportTwo.url, "a finding's referring page stays in its note separately from the work URL");
  assert.equal((await list.claim("check", 1)).length, 0);
  assert.equal((await list.add({ ...input, source: reportTwo })).reports.length, 2, "a replayed report is retained once");
  await list.add({ ...input, url: "https://www.pima.gov/new-contact", quote: "New contact Phone: 520-724-4330", source: { report: "three" } });
  const [changed] = await list.claim("check", 1);
  assert.equal(changed!.url, "https://www.pima.gov/new-contact", "changed evidence keeps the source URL that supplied it");
  await list.add({ ...input, value: "520-724-4444", quote: "Phone: 520-724-4444", source: { report: "four" } });
  assert.equal((await list.claim("check", 1)).length, 0, "changed evidence cannot revoke a live lease");
  assert.equal(await list.finish(changed!), false, "the old value cannot mark the new value done");
  const [retry] = await list.claim("check", 1);
  assert.equal(retry!.value, "520-724-4444");
  assert.equal(await list.later(retry!, "Source offline"), true);
  const delayed = (await query("select not_before from work_row where id=$1", [added.id]))[0]!.not_before;
  assert.equal(new Date(delayed as string).getTime() - at.getTime(), 4_000, "attempt three gets a longer delay");
  await list.add({ ...input, value: "520-724-4444", quote: "Phone: 520-724-4444", source: { report: "five" } });
  assert.equal((await list.claim("check", 1)).length, 0, "a repeat cannot move a delayed row");
  at = new Date(at.getTime() + 4_000);
  const [killed] = await list.claim("check", 1);
  at = new Date(at.getTime() + 5_000);
  assert.equal(await list.finish(killed!), false, "an expired worker cannot finish");
  const [recovered] = await list.claim("check", 1);
  assert.equal(recovered!.id, killed!.id);
  assert.notEqual(recovered!.leaseOwner, killed!.leaseOwner);
  assert.equal(await list.refuse(recovered!, "Value is absent from source"), true);
  assert.equal(await list.refuse(recovered!, "Duplicate callback"), false);
  const [detect] = await list.claim("detect", 1);
  assert.equal(detect!.subjectId, input.subjectId);
  assert.match(String(detect!.reports[0]!.reason), /absent/);
  assert.equal(await list.refuse(detect!, "No alternate source"), true);
  assert.equal((await query("select count(*)::int n from work_row where kind='detect'"))[0]!.n, 1, "refusing a detective cannot create a detective loop");
  const hours = await workCounts(query, "az", at);
  assert.equal(hours.length, 24);
  assert.deepEqual(hours[0], { state: "az", hour: "2026-10-24T12:00:00.000Z", incoming: 2, done: 1, refused: 2 });
  assert.equal((await workCounts(query, "wy", at))[0]!.incoming, 0);
  await assert.rejects(workCounts(query, "invalid", at), /INVALID_STATE/);
  await list.add({ ...input, url: "https://www.pima.gov/updated-contact", value: "520-724-5555", quote: "Phone: 520-724-5555", sources: ["source-new"], source: { report: "six" } });
  const [revised] = await list.claim("check", 1);
  assert.ok(await list.refuse(revised!, "Changed claim is still unsupported"));
  const [reopenedDetect] = await list.claim("detect", 1);
  assert.equal(reopenedDetect!.id, detect!.id);
  assert.deepEqual(reopenedDetect!.sources, ["source-new"], "the existing detective retains the new source evidence");
  assert.equal(reopenedDetect!.url, "https://www.pima.gov/updated-contact");
  assert.ok(await list.finish(reopenedDetect!));
  assert.equal((await query("select count(*)::int n from work_row where kind='detect'"))[0]!.n, 1);
  await list.add({ ...input, field: "member", claimKey: "seat-a", value: "Person A", source: { report: "seat-a" } });
  await list.add({ ...input, field: "member", claimKey: "seat-b", value: "Person B", source: { report: "seat-b" } });
  const members = await list.claim("check", 2);
  assert.deepEqual(members.map(row => row.value).sort(), ["Person A", "Person B"], "a multivalued field retains both claims");
  assert.ok(await list.finish(members[0]!));
  assert.ok(await list.finish(members[1]!));
  const held = members[0]!;
  const key = held.value === "Person A" ? "seat-a" : "seat-b";
  at = new Date("2026-10-24T13:00:00Z");
  await list.add({ ...input, field: "member", claimKey: key, value: "Updated name", source: { report: "updated-member" } });
  const [reopened] = await list.claim("check", 1);
  assert.equal(reopened!.id, held.id);
  assert.ok(await list.finish(reopened!));
  const direct = await query(`SELECT date_trunc('hour',event_at) AS hour,count(*)::int n FROM work_row
    CROSS JOIN LATERAL unnest(done_times) AS events(event_at) GROUP BY 1 ORDER BY 1`);
  const counters = await query("SELECT hour,n::int FROM count_hour WHERE step='work_done' AND state='AZ' ORDER BY hour");
  assert.deepEqual(counters, direct, "a changed row finishing in a second hour preserves both completions for direct counts");
});

test("link reports share a row across subjects; claim ids survive changed values", () => {
  assert.equal(workId({ ...input, field: undefined, url: "https://EXAMPLE.gov:443/a#section" }),
    workId({ ...input, subjectId: "another-subject", field: undefined, url: "https://example.gov/a" }));
  assert.equal(workId(input), workId({ ...input, url: "https://www.pima.gov/new-contact" }));
  assert.notEqual(workId(input), workId({ ...input, field: "email" }));
  assert.notEqual(workId({ ...input, field: "member", claimKey: "seat-a" }), workId({ ...input, field: "member", claimKey: "seat-b" }),
    "two people on the same board are two claims");
});

test("a counter failure rolls back the work transition", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(base);
  await pg.exec(migration);
  const query = async (sql: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
  const list = workList(query, { owner: "counter" });
  await pg.exec("ALTER TABLE count_hour ADD CONSTRAINT reject_count CHECK(n < 1)");
  await assert.rejects(list.add(input), /reject_count/);
  assert.equal((await query("select count(*)::int n from work_row"))[0]!.n, 0);
});
