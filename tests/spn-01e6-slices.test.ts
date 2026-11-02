import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { markPublicationSlices, markSlicesOn } from "../lib/core/slice-marks.ts";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { exactLine, type SavedCopy } from "../lib/facts/check.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { confirmFactSource } from "../lib/facts/confirmation.ts";
import { publishLoaded } from "../lib/facts/publish.ts";
import { metered, sliceTurn } from "../lib/reader/slice-lane.ts";
import type { MeetingsBody } from "../lib/reader/slice-meetings.ts";
import { buildSlices, packSlice, unpackSlice, writeSlices, type SliceCard } from "../lib/reader/slices.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const PLACE = "ocd-division/country:us/state:az/place:example", BODY = "az:city:example#governing";
const now = new Date("2026-10-24T08:00:00Z"), later = new Date("2026-10-25T08:00:00Z"), clocks = factClocks(null), purge = async () => ({ purged: true });
const HOUR = 3_600_000;

async function open() {
  const db = await migratedFactDb();
  for (const ddl of WORK_DDL) await db.pg.exec(ddl);
  const list = workList(db.query, { owner: "e6-test", leaseMs: 60_000 });
  markSlicesOn(() => workList(db.query, { owner: "slide" }));
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Example','AZ'),($2,'body','Example City Council','AZ')", [PLACE, BODY]);
  await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis) VALUES($1,$2,0,'SERVICE_AREA')", [BODY, PLACE]);
  await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://example.gov/api','https://example.gov/api',$1,$2,'k'),(2,'https://example.gov/api','https://example.gov/api',$3,$2,'k2'),(3,'https://example.gov/other','https://example.gov/other',$3,$2,'k3')",
    [now.toISOString(), "a".repeat(64), later.toISOString()]);
  return { db, list };
}

const text = '{\n  "Phone": "520-555-0100"\n}';
const copy: SavedCopy = { id: 1, finalUrl: "https://example.gov/api", text, fetchedAt: now, isArchive: false };
const file = (db: Awaited<ReturnType<typeof migratedFactDb>>, value = "520-555-0100", at = now) => {
  const page: SavedCopy = { ...copy, id: at === now ? 1 : 2, text: text.replace("520-555-0100", value), fetchedAt: at };
  return publishLoaded(db, { subjectId: BODY, field: "office_phone", fieldKind: "contact" as const, value, valueText: value, quote: value,
    provenance: "OFFICIAL" as const, producedBy: "loader-e6", costUsd: 0, copy: page }, () => ({ quote: exactLine(page.text, "Phone", value)!, valueText: value }), clocks, at, { purge });
};
const waiting = (db: Awaited<ReturnType<typeof migratedFactDb>>) => db.query("SELECT field,status,(due_at>now()+interval '1 hour') AS later FROM work ORDER BY field");
const stamp = async (db: Awaited<ReturnType<typeof migratedFactDb>>) => {
  const body = unpackSlice<{ stamps: [number, string, string][] }>((await db.query("SELECT body FROM place_slice WHERE place_id=$1 AND card='bodies'", [PLACE]))[0]!.body);
  return body.stamps[0]![1];
};

test("a source read again with nothing new waits its day before the card's last-checked date is rebuilt, and a change reaches readers at once", async () => {
  const { db, list } = await open();
  try {
    const filed = await file(db); assert.ok("decision" in filed && filed.decision === "PUBLISH");
    const factId = ("factId" in filed ? filed.factId : null)!;
    await sliceTurn({ list, facts: db.query, now });
    assert.deepEqual([(await sliceTurn({ list, facts: db.query, now })).claimed, await stamp(db)], [0, now.toISOString()], "the cards are built and nothing waits");

    // Only the date moved: the marks are made, but not due for a day, so nothing is read or written now.
    await confirmFactSource(db, { copyId: 1, scope: "source-recheck", at: later.toISOString(), factIds: [factId] }, purge);
    assert.deepEqual(await waiting(db), [{ field: "bodies", status: "waiting", later: true }, { field: "more", status: "waiting", later: true }]);
    assert.deepEqual([(await sliceTurn({ list, facts: db.query, now })).claimed, await stamp(db)], [0, now.toISOString()], "an unchanged re-check rebuilds nothing now");

    // A second re-check inside the day shares the same rebuild.
    await confirmFactSource(db, { copyId: 1, scope: "source-recheck", at: new Date(later.getTime() + HOUR).toISOString(), factIds: [factId] }, purge);
    assert.equal((await db.query("SELECT 1 FROM work")).length, 2, "one row for each card, however many re-checks");

    // A change in what the card shows, here the page the fact was read from, is due now and brings the waiting row forward.
    await confirmFactSource(db, { copyId: 3, scope: "source-recheck", at: new Date(later.getTime() + 2 * HOUR).toISOString(), factIds: [factId] }, purge);
    assert.deepEqual(await waiting(db), [{ field: "bodies", status: "waiting", later: false }, { field: "more", status: "waiting", later: false }]);
    const turn = await sliceTurn({ list, facts: db.query, now });
    assert.deepEqual([turn.claimed, turn.built, turn.written], [2, 1, 1], "the card that shows the fact is rebuilt and written, the other is rebuilt and found the same");
    assert.equal(await stamp(db), new Date(later.getTime() + 2 * HOUR).toISOString(), "the card holds the newest check");

    // A different value is a real change: due now, even while a day-long wait is under way.
    await confirmFactSource(db, { copyId: 3, scope: "source-recheck", at: new Date(later.getTime() + 3 * HOUR).toISOString(), factIds: [factId] }, purge);
    assert.deepEqual((await waiting(db)).map(row => row.later), [true, true]);
    const changed = await file(db, "520-555-0199", new Date(later.getTime() + 5 * HOUR)); assert.ok("decision" in changed && changed.decision === "PUBLISH");
    assert.deepEqual((await waiting(db)).map(row => row.later), [false, false], "a new value pulls the waiting rebuild forward");
    await sliceTurn({ list, facts: db.query, now });
    const body = unpackSlice<{ entities: { f: Record<string, unknown[]> }[] }>((await db.query("SELECT body FROM place_slice WHERE place_id=$1 AND card='bodies'", [PLACE]))[0]!.body);
    assert.equal(body.entities[0]!.f.office_phone![0], "520-555-0199", "the new value is on the card");
  } finally { await db.pg.close(); }
});

test("a waiting row is brought forward by a sooner ask and never pushed back; rows taken together finish, wait or go back together", async () => {
  const { db, list } = await open();
  try {
    const ask = (dueAt?: string) => list.touch([{ kind: "slice", placeId: PLACE, subjectId: PLACE, field: "bodies", origin: { from: "loader" }, source: { source: "test" }, ...dueAt ? { dueAt } : {} }]);
    const tomorrow = new Date(Date.now() + 24 * HOUR).toISOString();
    assert.equal(await ask(tomorrow), 1); assert.deepEqual((await list.take("slice", 5)).rows, [], "not due yet");
    assert.equal(await ask(), 1, "an ask due now brings it forward"); assert.equal(await ask(tomorrow), 0, "and a later one does not push it back");
    const first = await list.take("slice", 5);
    assert.deepEqual(first.rows, [{ subjectId: PLACE, field: "bodies" }]);
    await list.laterTaken(first.owner, "a failure");
    assert.deepEqual(await db.query("SELECT status,refusal,attempts FROM work"), [{ status: "waiting", refusal: "a failure", attempts: 1 }]);
    await db.query("UPDATE work SET due_at=now()");
    const second = await list.take("slice", 5); await list.releaseTaken(second.owner);
    assert.deepEqual(await db.query("SELECT status,attempts FROM work"), [{ status: "waiting", attempts: 1 }], "released rows are as if never taken");
    const third = await list.take("slice", 5); assert.equal(await ask(), 1, "asked for while taken"); await list.finishTaken(third.owner);
    assert.deepEqual(await db.query("SELECT status FROM work"), [{ status: "waiting" }], "a row asked for again meanwhile is not closed");
    const fourth = await list.take("slice", 5); await list.finishTaken(fourth.owner);
    assert.deepEqual(await db.query("SELECT status,lease_owner FROM work"), [{ status: "done", lease_owner: null }]);
    assert.deepEqual((await list.take("slice", 5)).rows, [], "nothing is left");
  } finally { await db.pg.close(); }
});

test("only the large slices that differ from the ones held are sent", async () => {
  const { db } = await open();
  try {
    const big = (n: number) => ({ v: 2, sources: [], stamps: [], boards: [], entities: [{ id: `e${n}`, k: "body", n: `Board ${n}`, f: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`field${i}`, [createHash("sha256").update(`${n}:${i}`).digest("hex"), 0]])) }] });
    assert.ok(JSON.stringify(packSlice(big(1))).length > 1_000, "the fixture is large once packed");
    const cards = (changed: number) => new Map<string, Map<SliceCard, unknown>>([[PLACE, new Map<SliceCard, unknown>([["bodies", big(1)], ["governs", big(changed)], ["money", big(3)], ["ballot", null], ["more", null]])]]);
    const seen: string[] = [], spy = async (sql: string, params: readonly unknown[] = []) => { seen.push(sql.trim().split(/\s/)[0]! + ":" + (sql.includes("INSERT") ? (params[0] as string[]).length : "")); return db.query(sql, params); };
    assert.equal(await writeSlices(spy, cards(2)), 5, "the first time everything is new");
    seen.length = 0;
    assert.equal(await writeSlices(spy, cards(2)), 0, "and none is written"); assert.deepEqual(seen, ["SELECT:", "INSERT:2"], "nothing differs: the fingerprints are asked about and none of the large slices is sent, only the two empty ones, which cost less to send than to ask about");
    seen.length = 0;
    assert.equal(await writeSlices(spy, cards(9)), 1); assert.deepEqual(seen, ["SELECT:", "INSERT:3"], "one large slice differs; it goes with the empty ones");
    assert.deepEqual(unpackSlice<{ entities: { id: string }[] }>((await db.query("SELECT body FROM place_slice WHERE card='governs'"))[0]!.body).entities[0]!.id, "e9");
    assert.deepEqual((await db.query("SELECT card,fingerprint='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' AS empty FROM place_slice WHERE body IS NULL ORDER BY card")), [{ card: "ballot", empty: true }, { card: "more", empty: true }]);
  } finally { await db.pg.close(); }
});

test("a calendar confirmed again is brought up to date in the card held from its confirmation alone, and the card is the one a rebuild makes", async () => {
  const { db, list } = await open();
  try {
    const CURRENT = `source:legistar:body:${encodeURIComponent(BODY)}`, AT = "2026-10-24T08:00:00.000Z";
    const header = { formatVersion: 1, generatedAt: AT, counts: { fresh: 1, total: 1 }, sources: [{ source: "legistar", ok: true, error: null, acquisitions: [] }] };
    await db.publish({ id: "cv-1", recordClass: "MEETING", scope: CURRENT, sourceId: "legistar", at: AT, value: { ...header,
      meetings: [{ id: "m1", ocdId: PLACE, bodyId: BODY, title: "m1", startsAt: "2026-11-02T18:00:00-07:00", timeZone: "America/Phoenix" }], agendaDocuments: [{ id: "d1", meetingId: "m1", ocdId: PLACE, text: "The agenda text." }] } });
    await db.query("DELETE FROM work");
    const wanted = new Map([[BODY, new Set<SliceCard>(["meetings", "agenda"])]]);
    await writeSlices(db.query, await buildSlices(db.query, wanted));
    const held = async () => unpackSlice<MeetingsBody>((await db.query("SELECT body FROM place_slice WHERE place_id=$1 AND card='meetings'", [BODY]))[0]!.body);
    assert.equal((await held()).parts[0]!.c, null);

    const detail = `UNCHANGED_CONFIRMATION_V1 ${JSON.stringify({ checkedAt: later.toISOString() })}`;
    await db.pg.exec("SET session_replication_role = replica");
    await db.query("INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES('cv-1',9,'PROMOTED',$1,$2)", [later.toISOString(), detail]);
    await db.pg.exec("SET session_replication_role = origin");
    markSlicesOn(() => list);
    await markPublicationSlices(db.query, { recordClass: "MEETING", scope: CURRENT, confirmed: true });
    assert.deepEqual(await db.query("SELECT place_id,field,(due_at>now()+interval '30 minutes' AND due_at<now()+interval '90 minutes') AS in_an_hour FROM work"), [{ place_id: BODY, field: "confirmed", in_an_hour: true }], "a calendar's check waits an hour, not a day");
    await db.query("UPDATE work SET due_at=now()");

    const reads: string[] = [], facts = metered(Object.assign(async (sql: string, params: readonly unknown[] = []) => { reads.push(sql); return db.query(sql, params); }, {}));
    const turn = await sliceTurn({ list, facts, now, backfill: false });
    assert.deepEqual([turn.claimed, turn.written], [1, 1]);
    assert.ok(!reads.some(sql => sql.includes("civic_data_rows") || sql.includes("checked_fact")), "no row of the calendar and no sitting is read");
    const patched = await held();
    assert.equal(patched.parts[0]!.c, detail);
    const rebuilt = (await buildSlices(db.query, wanted)).get(BODY)!.get("meetings");
    assert.equal(JSON.stringify(patched), JSON.stringify(rebuilt), "byte for byte what a rebuild makes");
    assert.equal((await sliceTurn({ list, facts, now, backfill: false })).claimed, 0);

    // A calendar that moved to another version since is not patched: its own mark rebuilds it.
    await db.publish({ id: "cv-2", recordClass: "MEETING", scope: CURRENT, sourceId: "legistar", at: later.toISOString(), value: { ...header, meetings: [], agendaDocuments: [] } });
    await db.query("DELETE FROM work"); await markPublicationSlices(db.query, { recordClass: "MEETING", scope: CURRENT, confirmed: true }); await db.query("UPDATE work SET due_at=now()");
    assert.deepEqual([(await sliceTurn({ list, facts, now, backfill: false })).written, (await held()).parts[0]!.v], [0, "cv-1"]);
  } finally { await db.pg.close(); }
});

test("the lane counts what it sends and what comes back, over both databases, for everything it does", async () => {
  const { db } = await open();
  try {
    let outside = 0;
    const probe = (query: typeof db.query) => async (sql: string, params: readonly unknown[] = []) => { outside += sql.length + JSON.stringify(params).length; const rows = await query(sql, params); outside += JSON.stringify(rows).length; return rows; };
    const list = workList(metered(probe(db.query)), { owner: "count-test" }), facts = metered(probe(db.query));
    await list.touch([{ kind: "slice", placeId: PLACE, subjectId: PLACE, field: "bodies", origin: { from: "loader" }, source: { source: "test" } }]);
    outside = 0;
    for (const input of [{ backfill: false }, { backfill: true }, { backfill: true }]) {
      outside = 0; const turn = await sliceTurn({ list, facts, now, ...input });
      assert.equal(turn.read, outside, `a turn that ${turn.claimed ? "rebuilds marks" : turn.backfilled ? "backfills" : "finds nothing"} counts all of its traffic`);
      assert.ok(turn.read! > 0);
    }
  } finally { await db.pg.close(); }
});

test("a new version of a calendar that leaves a board's agenda papers as they were reads none of them, and a changed paper is rebuilt", async () => {
  const { db, list } = await open();
  try {
    const CURRENT = `source:legistar:body:${encodeURIComponent(BODY)}`, AT = "2026-10-24T08:00:00.000Z";
    const header = { formatVersion: 1, generatedAt: AT, counts: { fresh: 1, total: 1 }, sources: [{ source: "legistar", ok: true, error: null, acquisitions: [] }] };
    const meeting = (title: string) => ({ id: "m1", ocdId: PLACE, bodyId: BODY, title, startsAt: "2026-11-02T18:00:00-07:00", timeZone: "America/Phoenix" });
    const paper = (textOf: string) => ({ id: "d1", meetingId: "m1", ocdId: PLACE, bodyId: BODY, documentUrl: "https://example.gov/a.pdf", text: textOf });
    const publish = (id: string, title: string, textOf: string) => db.publish({ id, recordClass: "MEETING", scope: CURRENT, sourceId: "legistar", at: AT, value: { ...header, meetings: [meeting(title)], agendaDocuments: [paper(textOf)] } });
    markSlicesOn(() => list);
    const marked = async () => { await markPublicationSlices(db.query, { recordClass: "MEETING", scope: CURRENT }); await db.query("UPDATE work SET due_at=now()"); };
    const papersRead: string[] = [];
    const facts = Object.assign(async (sql: string, params: readonly unknown[] = []) => { if (sql.includes("AS value") && params[1] === "agendaDocuments") papersRead.push(sql); return db.query(sql, params); }, {});
    const held = async (card: string) => (await db.query("SELECT body,inputs,built_at FROM place_slice WHERE place_id=$1 AND card=$2", [BODY, card]))[0]!;
    const agendaText = async () => unpackSlice<{ documents: { text: string }[] }>((await held("agenda")).body).documents[0]!.text;

    await publish("cv-1", "First title", "The agenda text."); await marked();
    assert.equal((await sliceTurn({ list, facts, now, backfill: false })).claimed, 3);
    assert.equal(papersRead.length, 1, "the first time, the papers are read"); assert.match(String((await held("agenda")).inputs), /^[a-f0-9]{64}$/);
    const builtAt = (await held("agenda")).built_at;

    await publish("cv-2", "Second title", "The agenda text."); await marked(); papersRead.length = 0;
    const same = await sliceTurn({ list, facts, now, backfill: false });
    assert.deepEqual([same.claimed, papersRead.length], [3, 0], "a new version with the same papers reads none of them");
    assert.deepEqual([(await held("agenda")).built_at, unpackSlice<MeetingsBody>((await held("meetings")).body).parts[0]!.v], [builtAt, "cv-2"], "the agenda card is left as it was and the meetings card is the new version's");

    await publish("cv-3", "Second title", "The agenda text, amended."); await marked();
    await sliceTurn({ list, facts, now, backfill: false });
    assert.deepEqual([papersRead.length, await agendaText()], [1, "The agenda text, amended."], "a changed paper is read and kept");

    // A place that is no board's holds no papers, so a build for it reads none.
    papersRead.length = 0;
    await buildSlices(facts, new Map([[PLACE, new Set<SliceCard>(["meetings", "history", "agenda"])]]));
    assert.equal(papersRead.length, 0);
  } finally { await db.pg.close(); }
});
