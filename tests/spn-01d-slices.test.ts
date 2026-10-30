import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { markSlicesOn } from "../lib/core/slice-marks.ts";
import { WORK_DDL, workList } from "../lib/core/work.ts";
import { exactLine, type SavedCopy } from "../lib/facts/check.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { publishLoaded } from "../lib/facts/publish.ts";
import { sliceTurn } from "../lib/reader/slice-lane.ts";
import { sliceProgress } from "../lib/reader/slice-progress.ts";
import { buildSlices, cardOfFact, cardsOfKind, SLICE_CARDS, type SliceCard } from "../lib/reader/slices.ts";
import { factDb } from "./helpers/fact-db.ts";

const PLACE = "ocd-division/country:us/state:az/place:example", BODY = "az:city:example#governing", PERSON = "az:person:example:mayor";
const now = new Date("2026-10-24T08:00:00Z"), clocks = factClocks(null), purge = async () => ({ purged: true });
const MIGRATION = readFileSync(new URL("../lib/db/migrations/SPN-01D_place_slice.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "");

async function open() {
  const db = await factDb();
  await db.pg.exec(MIGRATION);
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
const publish = (db: Awaited<ReturnType<typeof factDb>>, field: string, value: string, label: string) =>
  publishLoaded(db, claim(field, value), () => ({ quote: exactLine(text, label, value)!, valueText: value }), clocks, now, { purge });

test("a fact the Slide files marks its slice, the lane rebuilds it, the slice holds the fact, and the next look rebuilds nothing", async () => {
  const { db, list } = await open();
  try {
    const reads: string[] = [];
    const facts = Object.assign(async (sql: string, params: readonly unknown[] = []) => { reads.push(sql); return db.query(sql, params); }, {});
    const turn = () => sliceTurn({ list, facts, now });

    // Every place is given its slices, five cards each, before any fact is marked.
    assert.deepEqual(await sliceProgress(db.query), { built: 0, places: 1 }); const first = await turn();
    assert.deepEqual([first.backfilled, first.written], [1, 5]); assert.deepEqual(await sliceProgress(db.query), { built: 1, places: 1 });
    const held = async (card: string) => (await db.query("SELECT body FROM place_slice WHERE place_id=$1 AND card=$2", [PLACE, card]))[0]!.body as { entities: { id: string; f: Record<string, unknown[]> }[]; sources: string[] } | null;
    assert.deepEqual((await held("bodies"))!.entities.map(entity => entity.id), [BODY], "the body is on the place's bodies card before it has a fact");
    assert.deepEqual((await held("governs"))!.entities.map(entity => entity.id), [PERSON]); assert.equal(await held("ballot"), null);
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
    assert.equal(reads.filter(sql => sql.includes("entity_place")).length, 1, "one read of the place's entities for the whole look");
    const bodies = (await held("bodies"))!;
    const phone = bodies.entities[0]!.f.office_phone!;
    assert.deepEqual([phone[0], bodies.sources[phone[1] as number], phone[2], phone[3]], ["520-555-0100", "https://example.gov/api", "2026-10-24", "OFFICIAL"], "the slice holds the fact, its page, the day it was checked and its kind");
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
    const built = (await buildSlices(db.query, new Map([[PLACE, new Set<SliceCard>(SLICE_CARDS)]]))).get(PLACE)!;
    const fields = (card: SliceCard) => built.get(card)!.entities.map(entity => [entity.id, Object.keys(entity.f).sort()]);
    assert.deepEqual(fields("governs"), [[PERSON, ["name", "office@0"]]], "the seat on the board filed here shows; the seat on a board filed elsewhere waits for that board's place");
    assert.deepEqual(built.get("governs")!.boards, [BODY]); assert.deepEqual(fields("money"), [[PERSON, ["campaign-cycle:one"]]], "a summary shows; the lines never do");
    assert.deepEqual(fields("more"), [[PERSON, ["pronouns"]], ["az:vote:one", ["result"]]], "a fact no card claims lands in More about this");
    assert.equal(built.get("ballot"), null);
    assert.ok(![...built.values()].some(slice => JSON.stringify(slice).includes("donor") || JSON.stringify(slice).includes("A line")));
    assert.deepEqual([cardsOfKind("meeting"), cardsOfKind("committee"), cardsOfKind("person")], [[], [], ["governs", "money", "more"]]);
    assert.equal(cardOfFact("person", "campaign-donor:abc"), null);
  } finally { await db.pg.close(); }
});

test("a slice asked for again waits again when it was done, is left alone when it already waits, and is done once more when it was being built", async () => {
  const { db, list } = await open();
  try {
    const ask = () => list.touch([{ kind: "slice", placeId: PLACE, subjectId: PLACE, field: "bodies", origin: { from: "loader" }, source: { source: "test" } }]);
    assert.equal(await ask(), 1); assert.equal(await ask(), 0, "already waiting: nothing is written");
    const [claim] = await list.claim("slice", 1); assert.equal(await ask(), 1, "asked for while it is being built");
    assert.equal(await list.finish(claim!), false, "the build that began before the new fact does not close the row");
    const [again] = await list.claim("slice", 1); assert.equal(await list.finish(again!), true);
    assert.equal(await ask(), 1, "a finished slice waits again");
    assert.deepEqual(await db.query("SELECT status FROM work"), [{ status: "waiting" }]);
  } finally { await db.pg.close(); }
});

test("a turn whose end arrives mid-rebuild puts the marked slices back to waiting, unfailed, and the next look rebuilds them", async () => {
  const { db, list } = await open(), end = new AbortController();
  try {
    await sliceTurn({ list, facts: db.query, now });
    await publish(db, "office_phone", "520-555-0100", "Phone");
    const stuck = Object.assign(async (sql: string) => { if (sql.includes("entity_place")) { end.abort(); await new Promise(() => {}); } return []; }, {});
    await assert.rejects(sliceTurn({ list, facts: stuck, now, turnEnd: end.signal }));
    assert.deepEqual(await db.query("SELECT status,attempts FROM work"), [{ status: "waiting", attempts: 0 }, { status: "waiting", attempts: 0 }]);
    assert.equal((await sliceTurn({ list, facts: db.query, now })).claimed, 2);
  } finally { await db.pg.close(); }
});
