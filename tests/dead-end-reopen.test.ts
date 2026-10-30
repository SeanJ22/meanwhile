import assert from "node:assert/strict";
import test, { createMemoryRepositories } from "./helpers/playbooks.ts";
import { PGlite } from "@electric-sql/pglite";
import { CAPABILITY_DDL, REOPEN_BATCH, capabilitiesOfEntries, capabilityLog, deadEndOf, reopenDeadEnds, unlockOf, type Unlock } from "../lib/core/capability.ts";
import { installedParsers } from "../scripts/lib/installed-parsers.mts";
import { KEYS_DDL, keysStore } from "../lib/core/keys-store.ts";
import { WORK_DDL, workList, type WorkInput } from "../lib/core/work.ts";
import { hunterClaims } from "../lib/control-plane/workers/hunter-claims.ts";
import { readReopenedItems } from "../lib/control-plane/admin-view/v6-stuck-reopened.ts";
import { newFieldManualEntry, writeFieldManual } from "../lib/control-plane/field-manual.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-24T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const place = "ocd-division/country:us/state:ma/place:dartmouth";
const parserFor = (platform: string, text = "Nothing reads this kind of site yet."): Unlock => ({ kind: "parser", name: platform, platform, state: "ma", text });

async function open() {
  const pg = new PGlite();
  for (const ddl of [...WORK_DDL, ...CAPABILITY_DDL]) await pg.exec(ddl);
  const query = async (text: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  let clock = T0;
  const list = workList(query, { owner: "test", now: () => new Date(clock) });
  return { pg, query, list, log: capabilityLog(query), at: () => iso(clock), tick: (ms: number) => { clock += ms; } };
}
const deadEnd = async (list: ReturnType<typeof workList>, id: string, unlock: Unlock, extra: Partial<WorkInput> = {}) => {
  await list.add({ kind: "hunt", tier: "reader", placeId: place, subjectId: id, origin: { from: "planner" }, source: { source: "test" }, ...extra });
  const [claim] = await list.claim("hunt", 1, id);
  assert.equal(await list.finish(claim!, undefined, unlock), true);
  return claim!;
};
const rowOf = async (query: Awaited<ReturnType<typeof open>>["query"], id: string) => (await query("SELECT * FROM work WHERE subject_id = $1", [id]))[0]!;

test("a dead end names what would unlock it, and only a capability that names the same thing, and is newer, puts it back", async t => {
  const { pg, query, list, log, at, tick } = await open();
  t.after(() => pg.close());
  await deadEnd(list, "ecode", parserFor("ecode360"));
  await deadEnd(list, "granicus", parserFor("granicus"));
  await deadEnd(list, "key", { kind: "key", name: "exa_api_key", text: "Needs a search key." });
  await deadEnd(list, "method", { kind: "method", platform: "legistar", text: "Needs a way to bind members." });
  assert.equal((await rowOf(query, "ecode")).status, "done");
  tick(60_000);
  const events = [
    { kind: "parser", name: "ecode360", platform: "ecode360", because: "a new reader for ecode360" },
    { kind: "key", name: "brave_api_key", because: "the key brave_api_key was saved and tests Working" },
    { kind: "method", state: "ma", because: "a method that worked for a Massachusetts town" },
    { kind: "method", platform: "legistar", state: "az", because: "a method that worked for legistar in AZ" },
  ] as const;
  await log.record(events, at());
  assert.equal(await reopenDeadEnds(list, log, 5 * DAY, at()), 2, "a reader for ecode360 and a legistar method; not a different key, and a method with no platform in common");
  const reopened = await query("SELECT subject_id, status, tier, due_at, reopened FROM work WHERE reopened IS NOT NULL ORDER BY subject_id");
  assert.deepEqual(reopened.map(row => [row.subject_id, row.status, row.tier]), [["ecode", "waiting", "reader"], ["method", "waiting", "reader"]]);
  assert.equal((reopened[0]!.reopened as { because: string }).because, "unlocked by a new reader for ecode360");
  assert.equal(((reopened[0]!.reopened as { waitedFor: Unlock }).waitedFor).text, "Nothing reads this kind of site yet.");
  assert.equal(new Date(reopened[0]!.due_at as string).toISOString(), at(), "it is due at once");
  assert.equal((await query("SELECT count(*)::int AS n FROM capability WHERE applied_at IS NULL"))[0]!.n, 0, "every event was finished with");
  assert.equal(await reopenDeadEnds(list, log, 5 * DAY, at()), 0, "a second turn moves nothing");
  assert.deepEqual((await list.claim("hunt", 5, "ecode")).map(row => row.subjectId), ["ecode"], "the reopened row is claimed like any other");

  // A capability that was already there when the dead end was marked does not reopen it.
  tick(60_000);
  await deadEnd(list, "later", parserFor("ecode360", "Still needs the reader."));
  await log.record([{ kind: "parser", name: "ecode360", platform: "ecode360", because: "a new reader for ecode360", version: "v1" }], iso(T0));
  assert.equal(await reopenDeadEnds(list, log, 5 * DAY, at()), 0);
  assert.equal((await rowOf(query, "later")).status, "done");
});

test("a changed parser is a new event and an unchanged one is not; installed readers name their code", async t => {
  const { pg, query, log, at } = await open();
  t.after(() => pg.close());
  const first = await installedParsers();
  assert.ok(first.some(reader => reader.name === "legistar" && reader.kind === "parser" && /^[0-9a-f]{16}$/.test(reader.version!)));
  assert.deepEqual(await installedParsers(), first, "the same code gives the same versions");
  await log.record(first, at());
  await log.record(first, at());
  assert.equal((await query("SELECT count(*)::int AS n FROM capability"))[0]!.n, first.length, "announcing again adds nothing");
  await log.record([{ ...first[0]!, version: "changed" }], at());
  assert.equal((await query("SELECT count(*)::int AS n FROM capability"))[0]!.n, first.length + 1);
});

test("while coverage is expanding no dead end waits past its free-try time, on the same clock", async t => {
  const { pg, query, list, log, at, tick } = await open();
  t.after(() => pg.close());
  await deadEnd(list, "stale", parserFor("ecode360"));
  tick(4 * DAY);
  assert.equal(await reopenDeadEnds(list, log, 5 * DAY, at()), 0, "four days is inside five");
  tick(DAY);
  assert.equal(await reopenDeadEnds(list, log, 5 * DAY, at()), 1);
  const row = await rowOf(query, "stale");
  assert.equal(row.status, "waiting");
  assert.equal((row.reopened as { because: string }).because, "its free try came due after 5 days");
  assert.equal(row.dead_since, null);
});

test("an event with more dead ends than one turn takes is finished on the next turn", async t => {
  const { pg, query, list, log, at, tick } = await open();
  t.after(() => pg.close());
  await pg.query(`INSERT INTO work (id,kind,tier,state,place_id,subject_id,status,done_at,unlock,dead_since)
    SELECT 'dead-' || n,'hunt','coverage','MA','p','s-' || n,'done',$1::timestamptz,$2::jsonb,$1::timestamptz FROM generate_series(1, ${REOPEN_BATCH + 3}) n`,
  [iso(T0), JSON.stringify(parserFor("ecode360"))]);
  tick(1_000);
  await log.record([{ kind: "parser", name: "ecode360", because: "a new reader for ecode360" }], at());
  assert.equal(await reopenDeadEnds(list, log, 5 * DAY, at()), REOPEN_BATCH);
  assert.equal((await query("SELECT count(*)::int AS n FROM capability WHERE applied_at IS NULL"))[0]!.n, 1, "the event waits for the rest");
  assert.equal(await reopenDeadEnds(list, log, 5 * DAY, at()), 3);
  assert.equal((await query("SELECT count(*)::int AS n FROM capability WHERE applied_at IS NULL"))[0]!.n, 0);
});

test("a dead end that gets a changed report is alive again, and a dead end is never retired", async t => {
  const { pg, query, list, tick } = await open();
  t.after(() => pg.close());
  const input = (subjectId: string): WorkInput => ({ kind: "check", placeId: place, subjectId, field: "phone", value: "1", quote: "q", origin: { from: "loader" }, source: { source: "t" } });
  const unlock: Unlock = { kind: "source", platform: "legistar", text: "No exact binding" };
  for (const subject of ["body:refused", "body:kept", "body:plain"]) await list.add(input(subject));
  const claimed = new Map((await list.claim("check", 3)).map(claim => [claim.subjectId, claim]));
  assert.equal(await list.refuse(claimed.get("body:refused")!, "No exact binding", unlock), true);
  assert.equal(await list.finish(claimed.get("body:kept")!, undefined, unlock), true);
  assert.equal(await list.finish(claimed.get("body:plain")!), true);
  tick(40 * DAY);
  assert.equal(await list.retire({ rowsBefore: iso(T0 + 30 * DAY), ordersBefore: iso(T0 + 30 * DAY) }), 1, "only the finished row that is not a dead end goes");
  assert.deepEqual((await query("SELECT subject_id FROM work WHERE subject_id LIKE 'body:%' AND dead_since IS NOT NULL ORDER BY 1")).map(row => row.subject_id), ["body:kept", "body:refused"]);
  await list.add({ ...input("body:refused"), value: "2", quote: "q2" });
  const row = await rowOf(query, "body:refused");
  assert.deepEqual([row.status, row.dead_since], ["waiting", null]);
});

test("unlocks keep only what names a kind of capability and somewhere or something it applies to", () => {
  assert.deepEqual(unlockOf({ kind: "parser", platform: " ECode360 ", state: "MA" }, "Needs a reader."), { kind: "parser", platform: "ecode360", state: "ma", text: "Needs a reader." });
  assert.equal(unlockOf({ kind: "parser" }, "x"), null, "no place or thing");
  assert.equal(unlockOf({ kind: "magic", state: "ma" }, "x"), null, "not a kind of capability");
});

test("a key that starts to work, a method that worked, a source added and a reader written are events; a repeat test or a failure is not", async t => {
  const { pg, query, log, at } = await open();
  t.after(() => pg.close());
  await pg.exec(KEYS_DDL);
  const store = keysStore(query, "42".repeat(32));
  const saved = await store.save("exa_api_key", "secret-value", "exa", at());
  await store.tested("exa_api_key", saved, { working: false, says: "Rejected" }, at());
  assert.equal((await query("SELECT count(*)::int AS n FROM capability"))[0]!.n, 0, "a key that does not work is nothing new");
  await store.tested("exa_api_key", saved, { working: true, says: "Working" }, iso(T0 + 1_000));
  await store.tested("exa_api_key", saved, { working: true, says: "Working" }, iso(T0 + DAY));
  assert.deepEqual((await query("SELECT kind,name,because FROM capability")), [{ kind: "key", name: "exa_api_key", because: "the key exa_api_key was saved and tests Working" }]);

  const entry = (kind: string, outcome: string, extra: Record<string, unknown> = {}) => ({ ...newFieldManualEntry("test", `${kind}-${outcome}`, { role: "SHARED", kind, title: "A route", outcome: outcome as "YIELDED",
    states: ["ma"], platforms: ["legistar"], recordClasses: [], summary: "s", observedAt: "2026-10-25", url: "https://example.gov/a", ...extra } as never) });
  const found = capabilitiesOfEntries([entry("ROUTE", "YIELDED"), entry("ROUTE", "ZERO"), entry("SOURCE_REGISTER", "YIELDED"), entry("PLATFORM_ADAPTER", "YIELDED", { platforms: ["ecode360"] }), entry("MEETINGS_LEAD", "YIELDED")]);
  assert.deepEqual(found.map(c => [c.kind, c.name ?? null, c.platform ?? null]), [["method", null, "legistar"], ["source", "example.gov", "legistar"], ["parser", "ecode360", "ecode360"]]);

  // Writing the Knowledge Bank is where those events come from.
  const repos = { ...createMemoryRepositories(), capabilities: log };
  await writeFieldManual(repos, [entry("ROUTE", "YIELDED")], at());
  await writeFieldManual(repos, [entry("ROUTE", "YIELDED")], at());
  assert.equal((await query("SELECT count(*)::int AS n FROM capability WHERE kind = 'method'"))[0]!.n, 1, "the same method on the same day is one event");
});

test("a hunt that leaves a blank open names what would unlock it, the list's clock puts it back, and Admin says it was reopened", async t => {
  const { pg, query, list, log, at, tick } = await open();
  t.after(() => pg.close());
  const repos = createMemoryRepositories();
  const unfilled = new Map<string, unknown>();
  const claims = hunterClaims({ list, repos, now: at, deadEndMs: async () => 5 * DAY, capabilities: log, log: () => {}, funded: () => [], due: async () => true, deadEndOf: async result => deadEndOf(unfilled.get(`${result.obligationId}:${result.attemptId}`)) });
  const pressed = await list.sooner({ placeId: place, subjectId: `${place}#board`, subjectType: "body" });
  await claims.select(["ma"], false);
  const queue = await claims.claim(true);
  assert.equal(queue?.taskIds.length, 1);
  const base = { obligationId: "obligation-1", attemptId: "attempt-1", routeTaskId: queue!.taskIds[0]!, outcome: "WORKED" as const };
  unfilled.set("obligation-1:attempt-1", [
    { subjectId: pressed.subjectId!, field: "meeting_times", tried: "The town page", unlock: "Their agendas are on a platform nobody reads yet.", needs: { kind: "parser", name: "ecode360", platform: "ecode360", state: "ma" } },
    { subjectId: pressed.subjectId!, field: "phone", tried: "x", unlock: "Call them." }]);
  await claims.settle(base as never);
  const dead = await rowOf(query, `${place}#board`);
  assert.deepEqual([dead.status, (dead.unlock as Unlock).kind, (dead.unlock as Unlock).name, dead.dead_since !== null], ["done", "parser", "ecode360", true]);
  assert.match((dead.unlock as Unlock).text, /meeting_times: Their agendas/);

  // A reader for ecode360 is installed. The list's clock last ran at the start; until its next turn (five minutes on) the dead end waits.
  tick(2 * 60_000);
  await log.record([{ kind: "parser", name: "ecode360", platform: "ecode360", because: "a new reader for ecode360", version: "abc" }], at());
  tick(60_000);
  await claims.select(["ma"], false);
  assert.equal((await rowOf(query, `${place}#board`)).status, "done");
  tick(2 * 60_000);
  await claims.select(["ma"], false);
  const back = await rowOf(query, `${place}#board`);
  assert.deepEqual([back.status, back.tier], ["waiting", "reader"], "on the next turn it is back, in its tier");
  const items = await readReopenedItems(query, at());
  assert.equal(items.length, 1);
  assert.equal(items[0]!.cause, "Reopened — unlocked by a new reader for ecode360");
  assert.equal(items[0]!.next, "Back on the work list, waiting its turn.");
  assert.match(items[0]!.tried, /a reader for ecode360/);
  assert.match(items[0]!.title, /Their agendas are on a platform nobody reads yet/);

  // Claimed and finished again, Admin follows the same row.
  const queued = await claims.claim(true);
  assert.equal(queued?.taskIds.length, 1);
  assert.equal((await readReopenedItems(query, at()))[0]!.next, "Back on the list and being worked now.");
});

test("Admin lists only the dead ends reopened in the last week, a few at a time", async t => {
  const { pg, query } = await open();
  t.after(() => pg.close());
  await pg.query(`INSERT INTO work (id,kind,state,place_id,subject_id,status,reopened)
    SELECT 'r-' || n,'hunt','MA','p','s-' || n,'waiting',jsonb_build_object('at',($1::timestamptz - n * interval '1 day')::text,'because','unlocked by x','waitedFor','{"kind":"key","name":"k","text":"Needs a key."}'::jsonb)
    FROM generate_series(1, 12) n`, [iso(T0)]);
  const items = await readReopenedItems(query, iso(T0), 5);
  assert.equal(items.length, 5);
  assert.equal((await readReopenedItems(query, iso(T0))).length, 6, "days one to six are inside the week");
  assert.match(items[0]!.age, /reopened 1 days ago|reopened 24 hours ago/);
});
