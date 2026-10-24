import assert from "node:assert/strict";
import test from "node:test";
import { door, decide } from "../lib/core/door.ts";
import { publishClaim, type PublishInput } from "../lib/facts/publish.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { factDb } from "./helpers/fact-db.ts";
import { readFactStore } from "../lib/facts/admin-read.ts";

const now = new Date("2026-10-24T08:00:00Z");
const clocks = factClocks(null);
const purge = async () => ({ purged: true });
const input = (over: Partial<PublishInput> = {}): PublishInput => ({
  entity: { id: "az:city:example#governing", fullName: "Example City Council", stateName: "Arizona", hosts: [], externalIds: [] },
  field: "office_phone", fieldKind: "contact", value: "520-555-0100", valueText: "520-555-0100",
  quote: "", provenance: "OFFICIAL", producedBy: "rb-a9", costUsd: 0,
  copy: { id: 1, finalUrl: "https://example.gov/council", text: "", fetchedAt: now, isArchive: false }, ...over,
});

async function seeded() {
  const db = await factDb();
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Example City Council','AZ')", [input().entity.id]);
  await db.query(`INSERT INTO entity(id,kind,name,state) VALUES('place-one','place','First district','AZ'),('place-two','place','Second district','AZ')`);
  await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,'place-one'),($1,'place-two')", [input().entity.id]);
  await db.query(`INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key)
    VALUES(1,'https://example.gov/council','https://example.gov/council',$1,$2,'first'),
    (2,'https://news.example/council','https://news.example/council',$1,$2,'second')`, [now.toISOString(), "a".repeat(64)]);
  return db;
}

test("an official field publishes without reading or searching the page text, and an exact repeat changes nothing", async () => {
  const db = await seeded();
  try {
    const claim = input({ copy: { ...input().copy, get text(): string { throw new Error("official lane searched the source"); } } });
    assert.deepEqual(await door(db, claim, clocks, now, { purge }), { decision: "PUBLISH", factId: 1 });
    const snapshot = () => db.query(`SELECT jsonb_build_object('facts',(SELECT jsonb_agg(f) FROM fact f),
      'watermarks',(SELECT jsonb_agg(w) FROM fact_watermark w),'sources',(SELECT jsonb_agg(s) FROM source_copy s),
      'blanks',(SELECT jsonb_agg(b) FROM blank b),'flags',(SELECT jsonb_agg(o) FROM owner_flag o),
      'queues',(SELECT jsonb_agg(q) FROM rebuild_queue q),'counts',(SELECT jsonb_agg(c) FROM count_hour c)) AS value`);
    const before = await snapshot();
    assert.deepEqual(await door(db, claim, clocks, new Date(now.getTime() + 3_600_000), { purge }), { decision: "CONFIRM", factId: 1 });
    assert.deepEqual(await snapshot(), before);
    assert.equal((await db.query("SELECT quote_start FROM fact"))[0]!.quote_start, null);
    assert.deepEqual(await db.query("SELECT place_id FROM rebuild_queue ORDER BY place_id"), [{ place_id: "place-one" }, { place_id: "place-two" }]);
    assert.deepEqual(await db.query("SELECT state,step,n::int FROM count_hour"), [{ state: "az", step: "door_official", n: 1 }]);
  } finally { await db.pg.close(); }
});

test("a newer official value replaces OTHER and a repeat of a losing fact creates no second row", async () => {
  const db = await seeded();
  try {
    const other = input({ provenance: "OTHER", copy: { ...input().copy, id: 2, finalUrl: "https://news.example/council",
      text: "Example City Council Arizona Call 520-555-0199", fetchedAt: new Date(now.getTime() - 3_600_000) },
    value: "520-555-0199", valueText: "520-555-0199", quote: "Call 520-555-0199" });
    assert.equal((await door(db, other, clocks, now, { purge }) as { decision: string }).decision, "PUBLISH");
    assert.equal((await door(db, input(), clocks, now, { purge }) as { decision: string }).decision, "PUBLISH");
    await door(db, other, clocks, now, { purge });
    const before = await db.query("SELECT * FROM fact ORDER BY id");
    await door(db, other, clocks, now, { purge });
    assert.deepEqual(await db.query("SELECT * FROM fact ORDER BY id"), before);
    assert.equal((await db.query("SELECT value FROM fact WHERE status='live'"))[0]!.value, input().value);
  } finally { await db.pg.close(); }
});

test("Open States and Legistar API fields, and a portal linked by government, use the fast lane", async () => {
  const db = await seeded();
  try {
    for (const url of ["https://v3.openstates.org/people/123", "https://webapi.legistar.com/v1/pima/Bodies", "https://api.legiscan.com/?op=getBill"]) {
      const claim = input({ field: url, provenance: "REFERENCE", copy: { ...input().copy, finalUrl: url } });
      assert.equal((await door(db, claim, clocks, now, { purge }) as { decision: string }).decision, "PUBLISH");
    }
    const outcome = await door(db, { ...input({ field: "portal_phone", copy: { ...input().copy, finalUrl: "https://portal.example/council" } }),
      linkingPage: { url: "https://example.gov/", html: '<a href="https://portal.example/council">Council</a>' },
      sourceField: { record: { Phone: "520-555-0123" }, key: "Phone" } }, clocks, now, { purge });
    assert.equal((outcome as { decision: string }).decision, "PUBLISH");
    assert.equal((await db.query("SELECT value FROM fact WHERE field='portal_phone'"))[0]!.value, "520-555-0123");
  } finally { await db.pg.close(); }
});

test("a campaign or advocacy site cannot publish a fact about someone else, and refusal is recorded once", async () => {
  const db = await seeded();
  try {
    const refusals: string[] = [];
    const claim = input({ provenance: "CAMPAIGN", sourceSubjectId: "another-person", quote: "Call 520-555-0100",
      copy: { ...input().copy, id: 2, finalUrl: "https://campaign.example/", text: "Example City Council Arizona Call 520-555-0100" } });
    assert.deepEqual(await door(db, claim, clocks, now, { refusal: async (_query, _claim, reason) => { refusals.push(reason); } }), { refused: "CAMPAIGN_OTHER_SUBJECT" });
    assert.deepEqual(refusals, ["CAMPAIGN_OTHER_SUBJECT"]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM fact"))[0]!.n, 0);
    assert.deepEqual(await publishClaim(db, claim, clocks, now), { blank: "CAMPAIGN_OTHER_SUBJECT" });
    assert.equal((await db.query("SELECT attempts FROM blank"))[0]!.attempts, 1);
  } finally { await db.pg.close(); }
});

test("nonofficial claims use clocks.ts; a failed quote leaves the old caller its blank", async () => {
  const db = await seeded();
  try {
    const claim = input({ provenance: "NEWS", quote: "Call 520-555-0100", fieldKind: "meeting",
      copy: { ...input().copy, id: 2, finalUrl: "https://news.example/", text: "Example City Council Arizona Call 520-555-0100",
        fetchedAt: new Date(now.getTime() - 48 * 3_600_000) } });
    assert.equal((await door(db, claim, clocks, now, { purge }) as { decision: string }).decision, "PUBLISH");
    assert.deepEqual(await publishClaim(db, { ...claim, quote: "invented words" }, clocks, now), { blank: "QUOTE_NOT_ON_SAVED_COPY" });
  } finally { await db.pg.close(); }
});

test("a hunter's claim is checked against its saved copy even when it cites a government page", async () => {
  const db = await seeded();
  try {
    const claim = input({ acquisition: "hunter", quote: "invented words" });
    assert.deepEqual(await door(db, claim, clocks, now), { refused: "QUOTE_NOT_ON_SAVED_COPY" });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM fact"))[0]!.n, 0);
  } finally { await db.pg.close(); }
});

test("one call creates the board a government names and publishes its fact under that board", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES('az:city:example','government','Example City','AZ','place-one')");
    const { entity: _entity, ...claim } = input();
    const outcome = await door(db, { ...claim, subjectId: "unheld-board",
      board: { governmentId: "az:city:example", name: "Planning Commission" } }, clocks, now, { purge });
    assert.equal((outcome as { decision: string }).decision, "PUBLISH");
    const [board] = await db.query("SELECT e.kind,e.name,e.parent_id FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.id=$1", [(outcome as { factId: number }).factId]);
    assert.deepEqual(board, { kind: "body", name: "Planning Commission", parent_id: "az:city:example" });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM entity WHERE name='Planning Commission'"))[0]!.n, 1);
    await door(db, { ...claim, subjectId: "unheld-board", board: { governmentId: "az:city:example", name: "Planning Commission" } }, clocks, now, { purge });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM fact"))[0]!.n, 1);
  } finally { await db.pg.close(); }
});

test("all source ranks are respected, newest wins within a rank, and every conflicting system value flags the owner", () => {
  const side = (provenance: PublishInput["provenance"], value: string, time = now) => ({ provenance, value, fetchedAt: time });
  const ranks = ["OFFICIAL", "REFERENCE", "NEWS", "CAMPAIGN", "OTHER"] as const;
  for (let i = 0; i < ranks.length - 1; i++) {
    assert.equal(decide(side(ranks[i + 1]!, "old"), side(ranks[i]!, "new")), "PUBLISH");
    assert.equal(decide(side(ranks[i]!, "old"), side(ranks[i + 1]!, "new", new Date(now.getTime() + 1))), "KEEP_CURRENT");
  }
  assert.equal(decide(side("FILING", "old"), side("OFFICIAL", "new", new Date(now.getTime() + 1))), "PUBLISH");
  assert.equal(decide(side("NEWS", "old"), side("NEWS", "new", new Date(now.getTime() + 1))), "PUBLISH");
  for (const rank of ranks) assert.equal(decide(side("OWNER", "typed"), side(rank, "system")), "FLAG_OWNER");
});

test("the next hour accepts a changed official field and Admin reads both lanes for every state and hour", async () => {
  const db = await seeded();
  try {
    await door(db, input(), clocks, now, { purge });
    const checked = input({ field: "meeting_cadence", fieldKind: "meeting", provenance: "NEWS", quote: "Every Tuesday",
      value: "Every Tuesday", valueText: "Every Tuesday", copy: { ...input().copy, id: 2, finalUrl: "https://news.example/council",
        text: "Example City Council Arizona meets Every Tuesday" } });
    await door(db, checked, clocks, now, { purge });
    const next = new Date(now.getTime() + 3_600_000);
    await db.query(`INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key)
      VALUES(3,'https://example.gov/council','https://example.gov/council',$1,$2,'next-hour')`, [next.toISOString(), "b".repeat(64)]);
    const claim = input({ value: "520-555-0123", valueText: "520-555-0123", copy: { ...input().copy, id: 3, fetchedAt: next } });
    assert.equal((await door(db, claim, clocks, next, { purge }) as { decision: string }).decision, "PUBLISH");
    assert.equal((await db.query("SELECT value FROM fact WHERE field='office_phone' AND status='live'"))[0]!.value, claim.value);
    const reading = await readFactStore(async statements => {
      const rows = [];
      for (const statement of statements) rows.push(await db.query(statement.text, statement.params));
      return rows;
    }, next);
    assert.deepEqual(reading.hours?.find(row => row.state === "az" && row.hour === now.toISOString()),
      { state: "az", hour: now.toISOString(), official: 1, checked: 1 });
    assert.deepEqual(reading.hours?.find(row => row.state === "az" && row.hour === next.toISOString()),
      { state: "az", hour: next.toISOString(), official: 1, checked: 0 });
    for (const state of ["ak", "ca", "la", "mt", "nd", "ne", "vt", "wy"])
      assert.ok(reading.hours?.some(row => row.state === state && row.hour === next.toISOString()), state);
    assert.equal(reading.hours?.find(row => row.state === "az" && row.hour < now.toISOString())?.official, null);
  } finally { await db.pg.close(); }
});
