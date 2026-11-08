import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { factDb } from "./helpers/fact-db.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { confirmMeetingFactsFromSources, meetingFactWorkRemains } from "../lib/civic-data/meeting-source-confirmation.ts";
import { meetingEntityId } from "../lib/facts/meeting-read.ts";
import { meetingFactsAfterSourceCheck } from "../lib/civic-data/meeting-fact-progress.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { derivedSourceContentHash } from "../lib/civic-data/derived-source-hash.ts";

test("an identical source refresh confirms its body's exact versions without rewriting facts or replacing owner facts", async () => {
  const db = await factDb(), old = "2026-10-01T00:00:00.000Z", current = "2026-10-01T01:00:00.000Z";
  const url = "https://example.gov/calendar", body = "Council meeting\n2026-10-20T19:00:00Z", bytes = new TextEncoder().encode(body);
  const hash = createHash("sha256").update(bytes).digest("hex"), first = meetingEntityId("first"), other = meetingEntityId("other");
  try {
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES ('body:first','body','First','AZ',NULL),('body:other','body','Other','AZ',NULL),
      ($1,'meeting','First meeting','AZ','body:first'),($2,'meeting','Other meeting','AZ','body:other')`, [first, other]);
    await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,$1,$1,$2,$3,'source')", [url, old, hash]);
    for (const [entity, field, provenance] of [[first, "title", "OFFICIAL"], [first, "starts_at", "OFFICIAL"], [first, "location", "OWNER"], [other, "title", "OFFICIAL"]])
      await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
        VALUES($1,$2,$3,'Council meeting','live',$4,1,'Council meeting',$5,'fixture')`, [entity, field, JSON.stringify({ value: "Council meeting", unused: "x".repeat(1_000_000) }), provenance, old]);
    let responseBytes = 0;
    const facts = { query: db.query, transaction: <T>(work: Parameters<typeof db.transaction<T>>[0]) => db.transaction(query => work(async (text, params) => {
      const rows = await query(text, params); responseBytes += Buffer.byteLength(JSON.stringify(rows)); return rows;
    })) };
    const confirmed = await confirmMeetingFactsFromSources({ facts, vault: new MemoryEvidenceStore(), bodyIds: ["body:first"],
      responses: [{ source: "ical", requestedUrl: url, finalUrl: url, rawHash: hash, byteCount: bytes.length, bytes, httpStatus: 200, retrievedAt: current, contentType: "text/plain" }] });
    assert.equal(confirmed, 2);
    assert.ok(responseBytes < 4000, `Only changed entity identities should return, got ${responseBytes} bytes`);
    const rows = await db.query("SELECT entity_id,field,checked_at FROM checked_fact ORDER BY entity_id,field");
    assert.ok(rows.filter(row => row.entity_id === first && row.field !== "location").every(row => Date.parse(String(row.checked_at)) === Date.parse(current)));
    assert.ok(rows.filter(row => row.entity_id === other || row.field === "location").every(row => Date.parse(String(row.checked_at)) === Date.parse(old)));
    assert.ok((await db.query("SELECT checked_at FROM fact")).every(row=>Date.parse(String(row.checked_at))===Date.parse(old)),"immutable fact versions are never rewritten for a check");
    assert.equal(await meetingFactWorkRemains(db.query, ["first"], ["body:first"], current), false);
    assert.equal(await meetingFactWorkRemains(db.query, ["missing"], ["body:first"], current), true);
    const location = { name: "Old Hall", address: "1 Old Street", lat: 33, lng: -112 };
    await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(2,$1,$1,$2,$3,'old-source')", [url, old, "0".repeat(64)]);
    await db.query("UPDATE fact SET provenance_kind='OFFICIAL',source_copy_id=2,value=$2 WHERE entity_id=$1 AND field='location'", [first, JSON.stringify(location)]);
    const changed = new TextEncoder().encode(`${body}\nexport nonce changed`), later = "2026-10-01T02:00:00.000Z";
    await meetingFactsAfterSourceCheck({ facts, vault: new MemoryEvidenceStore(), head: null, clocks: factClocks(null), at: later, meetingIds: ["first"], bodyIds: ["body:first"],
      observations: [{ source: "ical", requestedUrl: url, finalUrl: url, rawHash: createHash("sha256").update(changed).digest("hex"), byteCount: changed.length, bytes: changed, httpStatus: 200, retrievedAt: later, contentType: "text/plain" }] });
    const [retained] = await db.query("SELECT value,checked_at FROM fact WHERE entity_id=$1 AND field='location'", [first]);
    assert.deepEqual(retained!.value, location); assert.equal(Date.parse(String(retained!.checked_at)), Date.parse(old), "semantic equality cannot reverify an older differing fact by URL and meeting ID");
    await db.query("INSERT INTO blank(entity_id,field,stage,reason,next_try_at) VALUES($1,'agenda_url','ACQUIRE','missing',$2)", [first, current]);
    assert.equal(await meetingFactWorkRemains(db.query, ["first"], ["body:first"], current), true, "a due publication blank cannot disappear behind a successful hash confirmation");
  } finally { await db.pg.close(); }
});

test("the rolling calendar query reopens an unchanged recurring source when its window advances", () => {
  const source = { kind: "MEMBER_ACQUISITION" as const, memberKey: "body:first", requestedUrl: "https://example.gov/calendar.ics", finalUrl: "https://example.gov/calendar.ics",
    httpStatus: 200, rawHash: "a".repeat(64), retrievedAt: "2026-10-01T00:00:00.000Z", horizonDay: "2026-10-01" };
  assert.equal(derivedSourceContentHash([source]), derivedSourceContentHash([{ ...source, retrievedAt: "2026-10-01T01:00:00.000Z" }]));
  assert.notEqual(derivedSourceContentHash([source]), derivedSourceContentHash([{ ...source, horizonDay: "2026-10-02" }]));
});
