import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { markPublicationSlices, markSlicesOn } from "../lib/core/slice-marks.ts";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { exactLine, type SavedCopy } from "../lib/facts/check.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { confirmFactSource } from "../lib/facts/confirmation.ts";
import { publishLoaded } from "../lib/facts/publish.ts";
import { progressLines } from "../lib/control-plane/scheduler/round-progress.ts";
import { laneTurn } from "../lib/ops/lane-turn.ts";
import { runSliceLane, sliceTurn } from "../lib/reader/slice-lane.ts";
import type { MeetingsBody } from "../lib/reader/slice-meetings.ts";
import { sliceProgress } from "../lib/reader/slice-progress.ts";
import { buildSlices, cardOfFact, cardsOfKind, SLICE_CARDS, unpackSlice, type SliceBody, type SliceCard } from "../lib/reader/slices.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const PLACE = "ocd-division/country:us/state:az/place:example", BODY = "az:city:example#governing", PERSON = "az:person:example:mayor";
const now = new Date("2026-10-24T08:00:00Z"), clocks = factClocks(null), purge = async () => ({ purged: true });

async function open() {
  const db = await migratedFactDb();
  for (const ddl of WORK_DDL) await db.pg.exec(ddl);
  const list = workList(db.query, { owner: "slice-test", leaseMs: 60_000 });
  markSlicesOn(() => workList(db.query, { owner: "slide" }));
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Example','AZ'),($2,'body','Example City Council','AZ'),($3,'person','Pat Mayor','AZ'),('az:meeting:one','meeting','A meeting','AZ')",
    [PLACE, BODY, PERSON]);
  await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis) VALUES($1,$3,0,'SERVICE_AREA'),($2,$3,0,'SERVICE_AREA'),('az:meeting:one',$3,0,'SERVICE_AREA')", [BODY, PERSON, PLACE]);
  await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://example.gov/api','https://example.gov/api',$1,$2,'k')", [now.toISOString(), "a".repeat(64)]);
  return { db, list };
}

const text = '{\n  "Name": "Example City Council",\n  "Phone": "520-555-0100",\n  "Site": "https://example.gov/council"\n}';
const copy: SavedCopy = { id: 1, finalUrl: "https://example.gov/api", text, fetchedAt: now, isArchive: false };
const claim = (field: string, value: string) => ({ subjectId: BODY, field, fieldKind: "contact" as const, value, valueText: value, quote: value, provenance: "OFFICIAL" as const,
  producedBy: "loader-d1", costUsd: 0, copy });
const publish = (db: Awaited<ReturnType<typeof migratedFactDb>>, field: string, value: string, label: string) =>
  publishLoaded(db, claim(field, value), () => ({ quote: exactLine(text, label, value)!, valueText: value }), clocks, now, { purge });

test("a fact the Slide files marks its slice, the lane rebuilds it, the slice holds the fact, and the next look rebuilds nothing", async () => {
  const { db, list } = await open();
  try {
    const reads: string[] = [];
    const facts = Object.assign(async (sql: string, params: readonly unknown[] = []) => { reads.push(sql); return db.query(sql, params); }, {});
    const turn = () => sliceTurn({ list, facts, now });

    // Every place is given its slices, five cards each, before any fact is marked.
    assert.deepEqual(await sliceProgress(db.query), { built: 0, places: 1 }); const first = await turn();
    assert.deepEqual([first.backfilled, first.written], [1, 11]); assert.deepEqual(await sliceProgress(db.query), { built: 1, places: 1 });
    const held = async (card: string) => unpackSlice((await db.query("SELECT body FROM place_slice WHERE place_id=$1 AND card=$2", [PLACE, card]))[0]!.body) as { entities: { id: string; f: Record<string, unknown[]> }[]; sources: string[]; stamps: [number | null, string, string][] } | null;
    assert.deepEqual((await held("bodies"))!.entities.map(entity => entity.id), [BODY], "the body is on the place's bodies card before it has a fact");
    assert.equal(await held("governs"), null, "a person with no fact checked against a page is not listed as governing"); assert.equal(await held("ballot"), null);
    assert.equal((await db.query("SELECT 1 FROM place_slice WHERE place_id='az:meeting:one'")).length, 0, "meetings are not on any card yet");
    const idle = await turn();
    assert.deepEqual([idle.claimed, idle.backfilled, idle.written, idle.idle], [0, 0, 0, true], "once every place has slices, a look with nothing marked builds nothing");
    // A new fact through the Slide marks the slices it belongs to.
    const filed = await publish(db, "office_phone", "520-555-0100", "Phone"); assert.ok("decision" in filed && filed.decision === "PUBLISH");
    assert.deepEqual(await db.query("SELECT kind,place_id,field,status FROM work ORDER BY field"),
      [{ kind: "slice", place_id: PLACE, field: "bodies", status: "waiting" }, { kind: "slice", place_id: PLACE, field: "more", status: "waiting" }]);
    reads.length = 0;
    const rebuilt = await turn();
    assert.deepEqual([rebuilt.claimed, rebuilt.built, rebuilt.written], [2, 1, 1], "two slices marked, one place read, only the one that changed written");
    assert.equal(reads.filter(sql => sql.includes("SELECT DISTINCT ep.place_id,e.id")).length, 1, "one read of the place's entities for the whole look");
    const bodies = (await held("bodies"))!;
    const phone = bodies.entities[0]!.f.office_phone!, stamp = bodies.stamps[phone[1] as number]!;
    assert.deepEqual([phone[0], bodies.sources[stamp[0]!], stamp[1], stamp[2], phone.length], ["520-555-0100", "https://example.gov/api", now.toISOString().replace("08:00:00.000Z", "08:00:00.000Z"), "OFFICIAL", 3],
      "the slice holds the fact, its page, the exact time it was checked, its kind and its quote (the line, not the value)");
    assert.deepEqual(await db.query("SELECT status FROM work ORDER BY field"), [{ status: "done" }, { status: "done" }]);
    // The next look, with nothing new filed, rebuilds nothing and reads nothing about the place.
    reads.length = 0;
    const unchanged = await turn();
    assert.deepEqual([unchanged.claimed, unchanged.built, unchanged.written], [0, 0, 0]);
    assert.equal(reads.filter(sql => sql.includes("entity_place")).length, 0, "an unchanged place is not read");
    const builtAt = (await db.query("SELECT built_at FROM place_slice WHERE card='bodies'"))[0]!.built_at;
    // The same fact seen again changes nothing; a different value marks and rebuilds just that.
    const again = await publish(db, "office_phone", "520-555-0100", "Phone"); assert.ok("decision" in again && again.decision === "CONFIRM");
    assert.deepEqual(await db.query("SELECT status FROM work ORDER BY field"), [{ status: "done" }, { status: "done" }], "a fact seen again marks nothing");
    assert.equal((await turn()).claimed, 0);
    assert.deepEqual((await db.query("SELECT built_at FROM place_slice WHERE card='bodies'"))[0]!.built_at, builtAt);
  } finally { await db.pg.close(); }
});

test("a slice holds only what its card shows: no donor or money lines, only a person's seats on the boards filed there, no meetings", async () => {
  const { db } = await open();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES('az:body:elsewhere','body','Elsewhere Board','AZ'),('az:committee:one','committee','Friends of Pat','AZ'),('az:vote:one','vote_event','A vote','AZ')");
    await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis) VALUES('az:committee:one',$1,0,'SERVICE_AREA'),('az:vote:one',$1,0,'SERVICE_AREA')", [PLACE]);
    const fact = (entity: string, field: string, value: unknown) => db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES($1,$2,$3::jsonb,$4,'live','OFFICIAL',1,$4,$5,'t')`, [entity, field, JSON.stringify(value), String(value), now.toISOString()]);
    await fact(PERSON, "name", "Pat Mayor"); await fact(PERSON, `office:${BODY}`, "Mayor"); await fact(PERSON, "office:az:body:elsewhere", "Member");
    await fact(PERSON, "campaign-donor:abc", "A donor"); await fact(PERSON, "campaign-money:x", "A line"); await fact(PERSON, "campaign-cycle:one", "Totals"); await fact(PERSON, "pronouns", "they");
    await fact("az:committee:one", "campaign-money:y", "A line"); await fact("az:vote:one", "result", "passed");
    const built = (await buildSlices(db.query, new Map([[PLACE, new Set<SliceCard>(SLICE_CARDS)]]))).get(PLACE)! as Map<SliceCard, SliceBody>;
    const fields = (card: SliceCard) => built.get(card)!.entities.map(entity => [entity.id, Object.keys(entity.f).sort()]);
    assert.deepEqual(fields("governs"), [[PERSON, ["name", "office@0"]]], "the seat on the board filed here shows; the seat on a board filed elsewhere waits for that board's place");
    assert.deepEqual(built.get("governs")!.boards, [BODY]); assert.deepEqual(fields("money"), [[PERSON, ["campaign-cycle:one"]]], "a summary shows; the lines never do");
    assert.deepEqual(fields("more"), [[PERSON, ["pronouns"]], ["az:vote:one", ["result"]]], "a fact no card claims lands in More about this");
    assert.equal(built.get("ballot"), null);
    assert.ok(![...built.values()].some(slice => JSON.stringify(slice).includes("donor") || JSON.stringify(slice).includes("A line")));
    assert.deepEqual([cardsOfKind("meeting"), cardsOfKind("committee"), cardsOfKind("person")], [["meetings"], [], ["governs", "money", "more"]]);
    assert.equal(cardOfFact("person", "campaign-donor:abc"), null);
  } finally { await db.pg.close(); }
});

test("a release drain lets the rebuild in hand finish, ends the lane without failing anything, and the minute line has moved on", async () => {
  const { db, list } = await open(), total = { built: 0, written: 0, backfilled: 0 };
  const turn = laneTurn(() => `Slices: ${total.built} read, ${total.written} written`), lines: string[] = [];
  try {
    await sliceTurn({ list, facts: db.query, now });
    await publish(db, "office_phone", "520-555-0100", "Phone");
    turn.beat(line => lines.push(line));
    await runSliceLane({ list, facts: (sql, params) => { if (sql.includes("entity_place")) turn.ask(); return db.query(sql, params); }, total, stopRequested: turn.asked, log: () => {} });
    turn.beat(line => lines.push(line));
    assert.deepEqual(await db.query("SELECT DISTINCT status FROM work"), [{ status: "done" }]);
    assert.ok(lines[0] !== lines[1] && progressLines()(`${lines[1]}\n`) === 1);
  } finally { await db.pg.close(); }
});

const later = new Date("2026-10-25T08:00:00Z"), HOUR = 3_600_000;
const due = (db: Awaited<ReturnType<typeof migratedFactDb>>) => db.query("SELECT field,(due_at>now()+interval '1 hour') AS later FROM work ORDER BY field");

test("a source read again with nothing new waits its day, a change is rebuilt at once, and the lane's counter keeps what it owes", async () => {
  const { db, list } = await open();
  try {
    const filed = await publish(db, "office_phone", "520-555-0100", "Phone"); assert.ok("factId" in filed && filed.factId);
    await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(3,'https://example.gov/other','https://example.gov/other',$1,$2,'k3')", [later.toISOString(), "a".repeat(64)]);
    await sliceTurn({ list, facts: db.query, now });
    const confirm = (copyId: number, hours: number) => confirmFactSource(db, { copyId, scope: "source-recheck", at: new Date(later.getTime() + hours * HOUR).toISOString(), factIds: [filed.factId!] }, async () => ({ purged: true }));
    await confirm(1, 0);
    assert.deepEqual([await due(db), (await sliceTurn({ list, facts: db.query, now })).claimed], [[{ field: "bodies", later: true }, { field: "more", later: true }], 0], "only the date moved: marked, not due, nothing rebuilt now");
    await confirm(3, 1);
    assert.deepEqual((await due(db)).map(row => row.later), [false, false], "a different page is due at once and brings the waiting rebuild forward");
    assert.equal((await sliceTurn({ list, facts: db.query, now })).written, 1);
  } finally { await db.pg.close(); }
});

test("a calendar confirmed again is brought up to date from its confirmation alone, as a rebuild would make it, and unchanged agenda papers are not read", async () => {
  const { db, list } = await open();
  try {
    const CURRENT = `source:legistar:body:${encodeURIComponent(BODY)}`, AT = "2026-10-24T08:00:00.000Z";
    const header = { formatVersion: 1, generatedAt: AT, counts: { fresh: 1, total: 1 }, sources: [{ source: "legistar", ok: true, error: null, acquisitions: [] }] };
    const publish = (id: string, title: string, text: string) => db.publish({ id, recordClass: "MEETING", scope: CURRENT, sourceId: "legistar", at: AT, value: { ...header,
      meetings: [{ id: "m1", ocdId: PLACE, bodyId: BODY, title, startsAt: "2026-11-02T18:00:00-07:00", timeZone: "America/Phoenix" }], agendaDocuments: [{ id: "d1", meetingId: "m1", ocdId: PLACE, bodyId: BODY, text }] } });
    markSlicesOn(() => list);
    const purged: string[] = [], tagOf = (place: string) => `reader-place:${createHash("sha256").update(place.toLowerCase()).digest("hex")}`;
    const turn = async (confirmed = false) => { await db.query("DELETE FROM work"); await markPublicationSlices(db.query, { recordClass: "MEETING", scope: CURRENT, confirmed }); await db.query("UPDATE work SET due_at=now()"); return sliceTurn({ list, facts, now, purge: async tags => { purged.push(...tags); return { purged: true }; } }); };
    const reads: string[] = [], facts = Object.assign(async (sql: string, params: readonly unknown[] = []) => { reads.push(sql); return db.query(sql, params); }, {});
    const papers = () => reads.filter(sql => sql.includes("AS value") && sql.includes("civic_data_rows")).length;
    const held = async () => unpackSlice<MeetingsBody>((await db.query("SELECT body FROM place_slice WHERE place_id=$1 AND card='meetings'", [BODY]))[0]!.body);

    await publish("cv-1", "First", "The agenda."); assert.equal((await turn()).claimed, 3); assert.equal(papers(), 2, "meetings rows and papers are read the first time");
    assert.ok(purged.includes(tagOf(PLACE)) && purged.includes(tagOf(BODY.split("#")[0]!)), "a board's new cards purge the places it is filed on");
    purged.length = 0; await turn(); assert.deepEqual(purged, [], "slices left as they were purge nothing");
    await publish("cv-2", "Second", "The agenda."); reads.length = 0; await turn();
    assert.equal(papers(), 1, "a new version with the same papers reads none of them");
    await publish("cv-3", "Second", "The agenda, amended."); reads.length = 0; await turn(); assert.equal(papers(), 1, "only the papers that changed are read, the meetings left as they were");

    const detail = `UNCHANGED_CONFIRMATION_V1 ${JSON.stringify({ checkedAt: later.toISOString() })}`;
    await db.pg.exec("SET session_replication_role = replica");
    await db.query("INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES('cv-3',9,'PROMOTED',$1,$2)", [later.toISOString(), detail]);
    await db.pg.exec("SET session_replication_role = origin");
    reads.length = 0; assert.equal((await turn(true)).written, 1);
    assert.ok(!reads.some(sql => sql.includes("civic_data_rows") || sql.includes("checked_fact")), "no row and no sitting is read");
    assert.equal(JSON.stringify(await held()), JSON.stringify((await buildSlices(db.query, new Map([[BODY, new Set<SliceCard>(["meetings"])]]))).get(BODY)!.get("meetings")), "byte for byte what a rebuild makes");
  } finally { await db.pg.close(); }
});
