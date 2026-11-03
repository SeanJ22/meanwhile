import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { markPublicationSlices, markSlicesOn } from "../lib/core/slice-marks.ts";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { exactLine, type SavedCopy } from "../lib/facts/check.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { confirmFactSource } from "../lib/facts/confirmation.ts";
import { publishLoaded } from "../lib/facts/publish.ts";
import { sliceTurn } from "../lib/reader/slice-lane.ts";
import type { MeetingsBody } from "../lib/reader/slice-meetings.ts";
import { buildSlices, packSlice, unpackSlice, writeSlices, type SliceCard } from "../lib/reader/slices.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const PLACE = "ocd-division/country:us/state:az/place:example", BODY = "az:city:example#governing", HOUR = 3_600_000;
const now = new Date("2026-10-24T08:00:00Z"), later = new Date("2026-10-25T08:00:00Z");

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
type Db = Awaited<ReturnType<typeof migratedFactDb>>;
const file = (db: Db, value: string, at = now) => {
  const page: SavedCopy = { id: at === now ? 1 : 2, finalUrl: "https://example.gov/api", text: `{\n  "Phone": "${value}"\n}`, fetchedAt: at, isArchive: false };
  return publishLoaded(db, { subjectId: BODY, field: "office_phone", fieldKind: "contact", value, valueText: value, quote: value, provenance: "OFFICIAL", producedBy: "loader-e6", costUsd: 0, copy: page },
    () => ({ quote: exactLine(page.text, "Phone", value)!, valueText: value }), factClocks(null), at, { purge: async () => ({ purged: true }) });
};
const due = (db: Db) => db.query("SELECT field,(due_at>now()+interval '1 hour') AS later FROM work ORDER BY field");
const phone = async (db: Db) => unpackSlice<{ entities: { f: Record<string, [string, number]> }[]; stamps: [number, string][] }>((await db.query("SELECT body FROM place_slice WHERE card='bodies'"))[0]!.body);

test("a source read again with nothing new waits its day, a change is rebuilt at once, and the lane's counter keeps what it owes", async () => {
  const { db, list } = await open();
  try {
    const filed = await file(db, "520-555-0100"); assert.ok("factId" in filed && filed.factId);
    await sliceTurn({ list, facts: db.query, now });
    const confirm = (copyId: number, hours: number) => confirmFactSource(db, { copyId, scope: "source-recheck", at: new Date(later.getTime() + hours * HOUR).toISOString(), factIds: [filed.factId!] }, async () => ({ purged: true }));
    await confirm(1, 0);
    assert.deepEqual([await due(db), (await sliceTurn({ list, facts: db.query, now })).claimed], [[{ field: "bodies", later: true }, { field: "more", later: true }], 0], "only the date moved: marked, not due, nothing rebuilt now");
    await confirm(3, 1);
    assert.deepEqual((await due(db)).map(row => row.later), [false, false], "a different page is due at once and brings the waiting rebuild forward");
    assert.equal((await sliceTurn({ list, facts: db.query, now })).written, 1);
    await confirm(3, 2); await file(db, "520-555-0199", new Date(later.getTime() + 5 * HOUR));
    assert.deepEqual((await due(db)).map(row => row.later), [false, false]);
    await sliceTurn({ list, facts: db.query, now });
    assert.equal((await phone(db)).entities[0]!.f.office_phone![0], "520-555-0199", "the new value is on the card");
  } finally { await db.pg.close(); }
});

test("only the large slices that differ from the ones held are sent", async () => {
  const { db } = await open();
  try {
    const big = (n: number) => ({ v: 2, sources: [], stamps: [], boards: [], entities: [{ id: `e${n}`, k: "body", n: `Board ${n}`, f: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`field${i}`, [createHash("sha256").update(`${n}:${i}`).digest("hex"), 0]])) }] });
    assert.ok(JSON.stringify(packSlice(big(1))).length > 1_000);
    const cards = (changed: number) => new Map([[PLACE, new Map<SliceCard, unknown>([["bodies", big(1)], ["governs", big(changed)], ["ballot", null]])]]);
    const sent: number[] = [], spy = async (sql: string, params: readonly unknown[] = []) => { if (sql.includes("INSERT")) sent.push((params[0] as string[]).length); return db.query(sql, params); };
    assert.equal(await writeSlices(spy, cards(2)), 3);
    assert.equal(await writeSlices(spy, cards(2)), 0); assert.deepEqual(sent, [3, 1], "nothing differs: only the empty slice, which costs less to send than to ask about, goes");
    assert.equal(await writeSlices(spy, cards(9)), 1); assert.deepEqual(sent, [3, 1, 2]);
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
    const turn = async (confirmed = false) => { await db.query("DELETE FROM work"); await markPublicationSlices(db.query, { recordClass: "MEETING", scope: CURRENT, confirmed }); await db.query("UPDATE work SET due_at=now()"); return sliceTurn({ list, facts, now, backfill: false, purge: async tags => { purged.push(...tags); return { purged: true }; } }); };
    const reads: string[] = [], facts = Object.assign(async (sql: string, params: readonly unknown[] = []) => { reads.push(sql); return db.query(sql, params); }, {});
    const papers = () => reads.filter(sql => sql.includes("AS value") && sql.includes("civic_data_rows")).length;
    const held = async () => unpackSlice<MeetingsBody>((await db.query("SELECT body FROM place_slice WHERE place_id=$1 AND card='meetings'", [BODY]))[0]!.body);

    await publish("cv-1", "First", "The agenda."); assert.equal((await turn()).claimed, 3); assert.equal(papers(), 2, "meetings rows and papers are read the first time");
    assert.ok(purged.includes(tagOf(PLACE)) && purged.includes(tagOf(BODY.split("#")[0]!)), "a board's new cards purge the places it is filed on");
    purged.length = 0; await turn(); assert.deepEqual(purged, [], "slices left as they were purge nothing");
    await publish("cv-2", "Second", "The agenda."); reads.length = 0; await turn();
    assert.equal(papers(), 1, "a new version with the same papers reads none of them");
    await publish("cv-3", "Second", "The agenda, amended."); reads.length = 0; await turn(); assert.equal(papers(), 2);
    assert.equal(unpackSlice<{ documents: { text: string }[] }>((await db.query("SELECT body FROM place_slice WHERE card='agenda'"))[0]!.body).documents[0]!.text, "The agenda, amended.");

    const detail = `UNCHANGED_CONFIRMATION_V1 ${JSON.stringify({ checkedAt: later.toISOString() })}`;
    await db.pg.exec("SET session_replication_role = replica");
    await db.query("INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES('cv-3',9,'PROMOTED',$1,$2)", [later.toISOString(), detail]);
    await db.pg.exec("SET session_replication_role = origin");
    reads.length = 0; assert.equal((await turn(true)).written, 1);
    assert.ok(!reads.some(sql => sql.includes("civic_data_rows") || sql.includes("checked_fact")), "no row and no sitting is read");
    assert.equal(JSON.stringify(await held()), JSON.stringify((await buildSlices(db.query, new Map([[BODY, new Set<SliceCard>(["meetings"])]]))).get(BODY)!.get("meetings")), "byte for byte what a rebuild makes");
  } finally { await db.pg.close(); }
});
