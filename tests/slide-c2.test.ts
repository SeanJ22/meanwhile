import assert from "node:assert/strict";
import test from "node:test";
import { retireAbsent } from "../lib/core/door.ts";
import { exactLine, type SavedCopy } from "../lib/facts/check.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { publishLoaded } from "../lib/facts/publish.ts";
import { factDb } from "./helpers/fact-db.ts";

const clocks = factClocks(null);
const now = new Date("2026-10-24T08:00:00Z"), before = new Date(now.getTime() - 86_400_000), after = new Date(now.getTime() + 3_600_000);
const BODY = "az:city:example#governing", ROSTER = "https://example.gov/roster";
const purge = async () => ({ purged: true });

async function roster() {
  const db = await factDb();
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Example City Council','AZ')", [BODY]);
  for (const id of ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'person',$1,'AZ')", [id]);
  await db.query(`INSERT INTO source_copy(id,url,final_url,fetched_at,http_status,sha256,blob_key) VALUES
    (1,$1,$1,$2,200,$3,'a'),(2,'https://other.gov/roster','https://other.gov/roster',$2,200,$3,'b'),(3,'https://example.gov/broken','https://example.gov/broken',$2,503,$3,'c'),
    (4,'https://webapi.example.gov/v1/example/officerecords?page=2','https://webapi.example.gov/v1/example/officerecords?page=2',$2,200,$3,'d')`, [ROSTER, before.toISOString(), "a".repeat(64)]);
  const member = (person: string, copy: number, provenance = "OFFICIAL", checked = before) => db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
    VALUES($1,$2,'{}'::jsonb,$3,'live',$4,$5,$3,$6,'t')`, [BODY, `member:${person}`, person, provenance, copy, checked.toISOString()]);
  return { db, member };
}

test("a member the source read in full no longer shows moves to history with the last date it showed them; nothing else moves", async () => {
  const { db, member } = await roster();
  try {
    await member("p1", 1); await member("p2", 1); await member("p3", 2); await member("p4", 1, "OWNER"); await member("p5", 1, "OFFICIAL", after);
    const dates = async () => db.query("SELECT field,status,held_reason,checked_at FROM checked_fact WHERE entity_id=$1 ORDER BY field", [BODY]);
    const held = await dates();
    assert.equal(await retireAbsent(db, { subjectId: BODY, fieldPrefix: "member:", copyId: 1, stillShown: ["member:p1"], at: now, purge }), 1);
    const changed = (await dates()).filter((row, index) => JSON.stringify(row) !== JSON.stringify(held[index]));
    assert.deepEqual(changed.map(row => [row.field, row.status, row.held_reason]), [["member:p2", "superseded", "GONE_FROM_SOURCE"]]);
    assert.deepEqual((await db.query("SELECT checked_at FROM checked_fact WHERE field='member:p2'"))[0]!.checked_at, held[1]!.checked_at, "the history keeps the last date the source showed it");
    assert.equal(await retireAbsent(db, { subjectId: BODY, fieldPrefix: "member:", copyId: 1, stillShown: ["member:p1"], at: now, purge }), 0, "a second read changes nothing");
  } finally { await db.pg.close(); }
});

test("a source that was not read retires nothing", async () => {
  const { db, member } = await roster();
  try {
    await member("p1", 3); await member("p2", 1);
    assert.equal(await retireAbsent(db, { subjectId: BODY, fieldPrefix: "member:", copyId: 3, stillShown: [], at: now }), 0, "an answer of 503 shows nothing about who is gone");
    assert.equal(await retireAbsent(db, { subjectId: BODY, fieldPrefix: "member:", copyId: 99, stillShown: [], at: now }), 0, "a copy that is not held shows nothing");
    assert.equal((await db.query("SELECT count(*)::int n FROM fact WHERE status='live'"))[0]!.n, 2);
  } finally { await db.pg.close(); }
});

test("a source read at any of its addresses retires what none of them shows", async () => {
  const { db, member } = await roster();
  try {
    await member("p6", 4); await member("p7", 4);
    assert.equal(await retireAbsent(db, { subjectId: BODY, fieldPrefix: "member:", sourceUrl: "https://webapi.example.gov/v1/example/officerecords?", stillShown: ["member:p7"], at: now }), 1);
    assert.deepEqual(await db.query("SELECT field,status FROM fact ORDER BY field"), [{ field: "member:p6", status: "superseded" }, { field: "member:p7", status: "live" }]);
  } finally { await db.pg.close(); }
});

test("a loader's fact is checked at its line; one the check refuses or that has no line is not published and opens its blank with the reason", async () => {
  const db = await factDb();
  try {
    const id = "az:city:example#governing", text = '{\n  "Name": "Example City Council",\n  "Phone": "520-555-0100"\n}';
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Example City Council','AZ')", [id]);
    await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://example.gov/api','https://example.gov/api',$1,$2,'k')", [now.toISOString(), "a".repeat(64)]);
    const copy: SavedCopy = { id: 1, finalUrl: "https://example.gov/api", text, fetchedAt: now, isArchive: false };
    const claim = (field: string, value: string) => ({ subjectId: id, field, fieldKind: "contact" as const, value, valueText: value, quote: value, provenance: "OFFICIAL" as const,
      producedBy: "loader-c2", costUsd: 0, copy });
    const facts = () => db.query("SELECT field,quote,quote_start IS NOT NULL AS checked FROM fact WHERE status='live' ORDER BY field");
    const blanks = () => db.query("SELECT field,reason,stage FROM blank ORDER BY field");

    await publishLoaded(db, claim("office_phone", "520-555-0100"), { quote: exactLine(text, "Phone", "520-555-0100")!, valueText: "520-555-0100" }, clocks, now, { purge });
    assert.deepEqual(await facts(), [{ field: "office_phone", quote: '"Phone": "520-555-0100"', checked: true }]);
    assert.deepEqual(await blanks(), []);

    await publishLoaded(db, claim("office_email", "a@example.gov"), { quote: '"Email": "a@example.gov"', valueText: "a@example.gov" }, clocks, now, { purge });
    await publishLoaded(db, claim("homepage", "https://example.gov/"), null, clocks, now, { purge });
    assert.deepEqual(await facts(), [{ field: "office_phone", quote: '"Phone": "520-555-0100"', checked: true }], "neither is published");
    assert.deepEqual(await blanks(), [{ field: "homepage", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY", stage: "CHECK" }, { field: "office_email", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY", stage: "CHECK" }]);
  } finally { await db.pg.close(); }
});
