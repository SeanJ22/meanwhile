import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { WORK_DDL, workId, workList, type WorkInput } from "../lib/core/work.ts";
import { workCounts } from "../lib/core/work-counts.ts";

const input: WorkInput = { kind: "check", placeId: "ocd-division/country:us/state:az/county:pima", subjectId: "body:pima", origin: { from: "planner" },
  url: "https://www.pima.gov/contact", field: "phone", value: "520-724-4330", quote: "Phone: 520-724-4330", source: { report: "one" } };
const open = async () => {
  const pg = new PGlite();
  for (const ddl of WORK_DDL) await pg.exec(ddl);
  const query = async (sql: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
  return { pg, query };
};

test("work list retains reports without reopening, fences changed work, backs off, recovers leases and creates one detective", async t => {
  const { pg, query } = await open();
  t.after(() => pg.close());
  let at = new Date("2026-10-24T12:00:00Z");
  const list = workList(query, { owner: "test", leaseMs: 5_000, now: () => at });
  const added = await list.add(input);
  const [first] = await list.claim("check", 1);
  assert.equal(first!.id, added.id);
  assert.equal((await list.claim("check", 1)).length, 0, "claimed before work begins");
  assert.equal(await list.finish(first!), true);
  const before = (await query("select due_at from work where id=$1", [added.id]))[0]!.due_at;
  at = new Date("2026-10-24T12:00:01Z");
  const reportTwo = { report: "two", url: "https://www.pima.gov/directory" };
  const repeated = await list.add({ ...input, source: reportTwo, priority: 99 });
  assert.equal(repeated.status, "done");
  assert.equal(new Date(repeated.dueAt).getTime(), new Date(before as string).getTime());
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
  const delayed = (await query("select due_at from work where id=$1", [added.id]))[0]!.due_at;
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
  assert.equal((await query("select count(*)::int n from work where kind='detect'"))[0]!.n, 1, "refusing a detective cannot create a detective loop");
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
  assert.equal((await query("select count(*)::int n from work where kind='detect'"))[0]!.n, 1);
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
  const direct = await query(`SELECT date_trunc('hour',event_at) AS hour,count(*)::int n FROM work
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
  const { pg, query } = await open();
  t.after(() => pg.close());
  const list = workList(query, { owner: "counter" });
  await pg.exec("ALTER TABLE count_hour ADD CONSTRAINT reject_count CHECK(n < 1)");
  await assert.rejects(list.add(input), /reject_count/);
  assert.equal((await query("select count(*)::int n from work"))[0]!.n, 0);
});

const hunt = (subjectId: string, over: Partial<WorkInput> = {}): WorkInput => ({ kind: "hunt", placeId: "ocd-division/country:us/state:az", subjectId,
  origin: { from: "planner" }, source: { source: "planner" }, ...over });
const waitingCounts = async (query: (sql: string) => Promise<Record<string, unknown>[]>) => (await query(
  "SELECT kind,tier,n::int AS n FROM work_waiting WHERE n<>0 ORDER BY kind,tier")).map(r => `${r.kind}/${r.tier}/${r.n}`);
const directCounts = async (query: (sql: string) => Promise<Record<string, unknown>[]>) => (await query(
  "SELECT kind,tier,count(*)::int AS n FROM work WHERE status='waiting' GROUP BY kind,tier ORDER BY kind,tier")).map(r => `${r.kind}/${r.tier}/${r.n}`);

test("claims go by tier, then priority, then due time; the same job offered at a more urgent tier moves up and never down", async t => {
  const { pg, query } = await open();
  t.after(() => pg.close());
  let at = new Date("2026-10-29T12:00:00Z");
  const list = workList(query, { owner: "order", leaseMs: 60_000, now: () => at });
  await list.add(hunt("coverage-old", { tier: "coverage", priority: 50 }));
  at = new Date(at.getTime() + 1_000);
  await list.add(hunt("coverage-new", { tier: "coverage", priority: 50 }));
  await list.add(hunt("reader-low", { tier: "reader", priority: 1 }));
  await list.add(hunt("reader-high", { tier: "reader", priority: 9 }));
  await list.add(hunt("order", { tier: "order", origin: { from: "order", orderId: "order-1" } }));
  await list.add(hunt("clock", { tier: "clock" }));
  await list.add(hunt("later", { tier: "coverage", priority: 99 }));
  const claimed = await list.claim("hunt", 7);
  assert.deepEqual(claimed.map(row => row.subjectId), ["clock", "order", "reader-high", "reader-low", "later", "coverage-old", "coverage-new"]);
  for (const row of claimed) await list.finish(row);

  const promoted = await list.add(hunt("climbs", { tier: "coverage", priority: 3 }));
  assert.equal(promoted.tier, "coverage");
  const asked = await list.add(hunt("climbs", { tier: "reader", priority: 7, origin: { from: "demand", subjectType: "BODY", presses: 1 } }));
  assert.equal(asked.id, promoted.id);
  assert.deepEqual([asked.tier, asked.priority, asked.origin.from], ["reader", 7, "demand"]);
  const lower = await list.add(hunt("climbs", { tier: "coverage", priority: 80 }));
  assert.deepEqual([lower.tier, lower.priority], ["reader", 7], "a later, less urgent offer cannot move it back down");
  const [only] = await list.claim("hunt", 1);
  assert.equal(only!.id, promoted.id);
});

test("an order's steps are kept on its row", async t => {
  const { pg, query } = await open();
  t.after(() => pg.close());
  let at = new Date("2026-10-29T12:00:00Z");
  const list = workList(query, { owner: "order", leaseMs: 60_000, now: () => at });
  const saved = await list.add(hunt("ordered", { tier: "order", origin: { from: "order", orderId: "order-7" } }));
  assert.deepEqual(saved.steps.map(step => step.step), ["Received"]);
  at = new Date(at.getTime() + 5_000);
  const [claim] = await list.claim("hunt", 1);
  assert.deepEqual(claim!.steps.map(step => step.step), ["Received", "In progress"]);
  at = new Date(at.getTime() + 5_000);
  assert.equal(await list.finish(claim!), true);
  const [done] = await query("SELECT steps,done_at FROM work WHERE id=$1", [saved.id]);
  assert.deepEqual((done!.steps as { step: string; at: string }[]).map(step => step.step), ["Received", "In progress", "Done"]);
  assert.equal(new Date(done!.done_at as string).toISOString(), at.toISOString());
  assert.deepEqual((await list.add(hunt("covered"))).steps, [], "only orders carry steps");
});

test("a repeating job gets a new row each time it is due, and only one is ever live", async t => {
  const { pg, query } = await open();
  t.after(() => pg.close());
  let at = new Date("2026-10-29T12:00:00Z");
  const list = workList(query, { owner: "repeat", leaseMs: 60_000, now: () => at });
  const load: WorkInput = { kind: "load", tier: "clock", placeId: "ocd-division/country:us/state:az", subjectId: "legistar-members:pima",
    url: "https://webapi.legistar.com/v1/pima/officerecords", series: "pima", origin: { from: "loader" }, source: { source: "Legistar members" } };
  assert.equal(await list.ensure([load]), 1);
  assert.equal(await list.ensure([load]), 0, "a live row is left as it is");
  const [first] = await list.claim("load", 1);
  assert.equal(await list.finish(first!, 3_600_000), true);
  assert.equal(await list.ensure([load]), 0, "a finished job waiting to repeat is not made again");
  at = new Date(at.getTime() + 3_599_999);
  assert.equal(await list.spawnDue(), 0);
  at = new Date(at.getTime() + 1);
  assert.equal(await list.spawnDue(), 1);
  assert.equal(await list.spawnDue(), 0, "a finished row repeats once");
  assert.equal(await list.ensure([load]), 0);
  const [second] = await list.claim("load", 1);
  assert.notEqual(second!.id, first!.id);
  assert.equal(second!.series, "pima");
  assert.equal(second!.tier, "clock");
  assert.equal(second!.dueAt, new Date("2026-10-29T13:00:00Z").toISOString());
  assert.deepEqual(await query("SELECT status,repeat_ms FROM work WHERE id=$1", [first!.id]), [{ status: "done", repeat_ms: null }]);
  assert.equal(await list.finish(second!), true);
  at = new Date(at.getTime() + 86_400_000);
  assert.equal(await list.spawnDue(), 0, "a job finished without a cadence does not repeat");
});

test("a reader's request moves the blank's one live hunt to the reader tier, and each press moves it up", async t => {
  const { pg, query } = await open();
  t.after(() => pg.close());
  let at = new Date("2026-10-29T12:00:00Z");
  const list = workList(query, { owner: "reader", leaseMs: 60_000, now: () => at });
  const ask = { placeId: "ocd-division/country:us/state:az/county:pima", subjectId: "ocd-division/country:us/state:az/county:pima#board", subjectType: "BODY" };
  assert.equal(await list.ensure([hunt(ask.subjectId, { placeId: ask.placeId, tier: "coverage", series: `blank:${ask.subjectId}` })]), 1);
  const [quiet] = await query("SELECT id FROM work") as { id: string }[];
  await assert.rejects(list.add(hunt("any", { series: "one" })), /WORK_INVALID_INPUT/, "a series is only ever made by ensure and the reader's request");
  const first = await list.sooner(ask);
  assert.equal(first.id, quiet!.id, "the planner's row for this blank is the one that moves");
  assert.deepEqual([first.tier, first.priority, first.origin.presses], ["reader", 1, 1]);
  const second = await list.sooner(ask);
  assert.deepEqual([second.id, second.priority, second.origin.presses], [quiet!.id, 2, 2]);
  const other = await list.sooner({ ...ask, subjectId: "ocd-division/country:us/state:az/county:cochise#board" });
  assert.notEqual(other.id, quiet!.id);
  const [served] = await list.claim("hunt", 1);
  assert.equal(served!.id, quiet!.id, "more presses are served first");
  assert.equal(await list.finish(served!), true);
  at = new Date(at.getTime() + 60_000);
  const again = await list.sooner(ask);
  assert.notEqual(again.id, quiet!.id, "once it is done, a new request is a new row");
  assert.deepEqual([again.tier, again.status, again.series], ["reader", "waiting", `blank:${ask.subjectId}`]);
  assert.deepEqual(await waitingCounts(query), await directCounts(query));
  assert.deepEqual(await waitingCounts(query), ["hunt/reader/2"]);
});

test("waiting counts per kind and tier equal a direct count after every kind of move", async t => {
  const { pg, query } = await open();
  t.after(() => pg.close());
  let at = new Date("2026-10-29T12:00:00Z");
  const list = workList(query, { owner: "counts", leaseMs: 1_000, now: () => at });
  await list.addMany(Array.from({ length: 5 }, (_, i) => ({ ...input, field: `phone:${i}`, value: i, origin: { from: "loader" as const } })));
  await list.add(hunt("a")); await list.add(hunt("b", { tier: "reader" }));
  assert.deepEqual(await waitingCounts(query), await directCounts(query));
  const claims = await list.claim("check", 3);
  assert.deepEqual(await waitingCounts(query), await directCounts(query), "taking rows takes them out of the waiting counts");
  await list.finish(claims[0]!); await list.later(claims[1]!, "Source offline");
  assert.deepEqual(await waitingCounts(query), await directCounts(query));
  at = new Date(at.getTime() + 5_000);
  await list.recover();
  assert.deepEqual(await waitingCounts(query), await directCounts(query), "an expired lease is waiting again");
  await list.add(hunt("a", { tier: "order", origin: { from: "order", orderId: "o" } }));
  assert.deepEqual(await waitingCounts(query), await directCounts(query), "moving up changes the tier it is counted under");
  await pg.exec("DELETE FROM work WHERE kind='hunt'");
  assert.deepEqual(await waitingCounts(query), await directCounts(query));
});

test("a refused row hands its detective the same tier", async t => {
  const { pg, query } = await open();
  t.after(() => pg.close());
  const list = workList(query, { owner: "refuse", leaseMs: 60_000 });
  await list.add({ ...input, tier: "reader", priority: 4, origin: { from: "demand", subjectType: "BODY", presses: 1 } });
  const [claim] = await list.claim("check", 1);
  assert.equal(await list.refuse(claim!, "Value is absent from source"), true);
  const [detect] = await list.claim("detect", 1);
  assert.deepEqual([detect!.tier, detect!.priority, detect!.origin.from], ["reader", 4, "detective"]);
});
