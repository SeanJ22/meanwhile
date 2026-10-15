import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { refreshStaleFacts } from "../lib/facts/refresh.ts";
import { withMeetingFacts } from "../lib/facts/meeting-read.ts";
import { factsVersion } from "../lib/facts/db.ts";
import { readCommentAccessFacts } from "../lib/registry/comment-access.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { factDb } from "./helpers/fact-db.ts";

const NOW = "2026-10-15T12:00:00.000Z";
const OLD = "2026-09-01T12:00:00.000Z";

async function seeded() {
  const facts = await factDb();
  const repos = createMemoryRepositories(), vault = new MemoryEvidenceStore();
  async function add(id: string, state: string | null, checkedAt = OLD, field = "title", kind = "meeting") {
    const url = `https://fixture.gov/${id}`;
    await facts.query("INSERT INTO entity (id, kind, name, state) VALUES ($1, $2, 'Council', $3)", [id, kind, state]);
    await facts.query("INSERT INTO entity_host VALUES ($1, 'fixture.gov', NULL)", [id]);
    const [copy] = await facts.query(`INSERT INTO source_copy (url, final_url, fetched_at, http_status, sha256, blob_key)
      VALUES ($1, $1, $2, 200, $3, $4) RETURNING id`, [url, OLD, "a".repeat(64), `held:${id}`]);
    await facts.query(`INSERT INTO fact (entity_id, field, value, value_text, status, provenance_kind, source_copy_id, quote, checked_at, live_at, produced_by)
      VALUES ($1, $2, '"Council meeting"', 'Council meeting', 'live', 'OFFICIAL', $3, 'Council meeting', $4, $4, 'fixture')`, [id, field, copy.id, checkedAt]);
  }
  return { facts, repos, vault, add };
}

test("expired facts re-enter work, keep old checked dates on failure, and fresh or other-state facts stay untouched", async () => {
  const fixture = await seeded();
  try {
    await fixture.add("meeting:good", "AZ");
    await fixture.add("meeting:changed", "AZ");
    await fixture.add("meeting:fresh", "AZ", NOW);
    await fixture.add("meeting:foreign", "CA");
    const urls: string[] = [];
    const result = await refreshStaleFacts({ ...fixture, state: "AZ", clocks: factClocks(null), now: NOW,
      fetchImpl: async url => {
        urls.push(String(url));
        assert.equal((await fixture.facts.query("SELECT reason FROM blank WHERE entity_id = $1", [new URL(String(url)).pathname.slice(1)]))[0]?.reason, "RECHECK_DUE");
        return new Response(String(url).includes("changed") ? "The posted event changed" : "Council meeting", { headers: { "content-type": "text/plain" } });
      } });
    assert.deepEqual([result.checked, result.confirmed, result.blanks], [2, 1, 1]);
    assert.deepEqual(urls.sort(), ["https://fixture.gov/meeting:changed", "https://fixture.gov/meeting:good"]);
    const rows = await fixture.facts.query("SELECT entity_id, status, checked_at, value FROM fact ORDER BY entity_id");
    assert.ok(rows.every(row => row.status === "live" && row.value === "Council meeting"));
    assert.equal(new Date(rows.find(row => row.entity_id === "meeting:changed")!.checked_at as string).toISOString(), OLD);
    assert.equal(new Date(rows.find(row => row.entity_id === "meeting:good")!.checked_at as string).toISOString(), NOW);
    assert.deepEqual(await fixture.facts.query("SELECT entity_id, reason, attempts FROM blank"), [
      { entity_id: "meeting:changed", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY", attempts: 1 },
    ]);
    assert.equal(result.nextDueAt, "2026-10-15T13:00:00.000Z");
    assert.equal((await fixture.vault.list("project/freshness/")).filter(key => !key.endsWith(".meta.json")).length, 2);
    const [seen] = await withMeetingFacts([{ id: "changed", provenance: {} } as Meeting], fixture.facts.query);
    assert.equal(seen.title, "Council meeting");
    assert.equal(seen.fieldSources?.title?.verifiedAt, OLD);
  } finally { await fixture.facts.pg.close(); }
});

test("bounded refresh advances past failed facts and honors their retry time", async () => {
  const fixture = await seeded();
  try {
    for (const id of ["a", "b", "c"]) await fixture.add(id, "AZ");
    const calls: string[] = [];
    const refresh = () => refreshStaleFacts({ ...fixture, state: "AZ", clocks: factClocks(null), now: NOW, limit: 1,
      fetchImpl: async url => { calls.push(String(url)); return new Response("unavailable", { status: 503 }); } });
    assert.equal((await refresh()).nextDueAt, "2026-09-08T12:00:00.000Z");
    await refresh();
    await refresh();
    const final = await refresh();
    assert.deepEqual(calls, ["https://fixture.gov/a", "https://fixture.gov/b", "https://fixture.gov/c"]);
    assert.equal(final.checked, 0);
    assert.equal(final.nextDueAt, "2026-10-15T13:00:00.000Z");
    assert.ok((await fixture.facts.query("SELECT checked_at FROM fact")).every(row => new Date(row.checked_at as string).toISOString() === OLD));
  } finally { await fixture.facts.pg.close(); }
});

test("Admin field clocks choose the due fact and federal facts have their own scope", async () => {
  const fixture = await seeded();
  try {
    const checked = "2026-10-15T10:00:00.000Z";
    await fixture.add("agenda", "AZ", checked, "agenda_url");
    await fixture.add("contact", "AZ", checked, "office_phone", "body");
    await fixture.add("federal", null, OLD);
    const clocks = { windowHours: (kind: string) => kind === "agenda" ? 1 : 24, retryMinutes: () => 60 };
    const read = async () => new Response("Council meeting");
    const az = await refreshStaleFacts({ ...fixture, state: "AZ", clocks, now: NOW, fetchImpl: read });
    assert.deepEqual([az.checked, az.confirmed], [1, 1]);
    assert.equal(az.nextDueAt, "2026-10-15T13:00:00.000Z");
    const federal = await refreshStaleFacts({ ...fixture, state: "US", clocks, now: NOW, fetchImpl: read });
    assert.equal(federal.confirmed, 1, JSON.stringify(await fixture.facts.query("SELECT * FROM blank")));
    const copies = await fixture.facts.query("SELECT url, fetched_at, blob_key FROM source_copy WHERE fetched_at = $1 ORDER BY url", [NOW]);
    assert.deepEqual(copies.map(copy => copy.url), ["https://fixture.gov/agenda", "https://fixture.gov/federal"]);
    assert.equal(copies[0]?.blob_key, copies[1]?.blob_key);
  } finally { await fixture.facts.pg.close(); }
});

test("a slower check never moves a newer checked date backwards", async () => {
  const fixture = await seeded();
  try {
    await fixture.add("concurrent", "AZ");
    const newer = "2026-10-15T12:01:00.000Z";
    const result = await refreshStaleFacts({ ...fixture, state: "AZ", clocks: factClocks(null), now: NOW,
      fetchImpl: async () => {
        await fixture.facts.query("UPDATE fact SET checked_at = $1 WHERE entity_id = 'concurrent'", [newer]);
        return new Response("Council meeting");
      } });
    assert.equal(result.confirmed, 0);
    assert.equal(new Date((await fixture.facts.query("SELECT checked_at FROM fact"))[0]!.checked_at as string).toISOString(), newer);
  } finally { await fixture.facts.pg.close(); }
});

test("an older check cannot revive a fact superseded while its source was being read", async () => {
  const fixture = await seeded();
  try {
    await fixture.add("concurrent", "AZ");
    const result = await refreshStaleFacts({ ...fixture, state: "AZ", clocks: factClocks(null), now: NOW,
      fetchImpl: async () => {
        await fixture.facts.query("UPDATE fact SET status = 'superseded' WHERE entity_id = 'concurrent'");
        return new Response("Council meeting");
      } });
    assert.equal(result.confirmed, 0);
    assert.deepEqual((await fixture.facts.query("SELECT status, value FROM fact")), [{ status: "superseded", value: "Council meeting" }]);
  } finally { await fixture.facts.pg.close(); }
});

test("state publication reads its own facts and comments and changes version when their checked date advances", async () => {
  const fixture = await seeded();
  try {
    await fixture.add("meeting:az", "AZ");
    await fixture.add("meeting:ca", "CA");
    await fixture.add("meeting:us", null);
    for (const id of ["meeting:az", "meeting:ca", "meeting:us"]) {
      await fixture.facts.query(`INSERT INTO fact (entity_id, field, value, value_text, status, provenance_kind, source_copy_id, quote, checked_at, live_at, produced_by)
        SELECT entity_id, 'comment:period', '"YES"', 'YES', status, provenance_kind, source_copy_id, 'YES', checked_at, live_at, produced_by
        FROM fact WHERE entity_id = $1 AND field = 'title'`, [id]);
    }
    const before = await factsVersion(fixture.facts.query, "meeting:", "AZ");
    assert.equal(await factsVersion(fixture.facts.query, "meeting:", "US-AZ"), before);
    await fixture.facts.query("UPDATE fact SET checked_at = $1 WHERE entity_id = 'meeting:ca'", [NOW]);
    assert.equal(await factsVersion(fixture.facts.query, "meeting:", "AZ"), before);
    await fixture.facts.query("UPDATE fact SET checked_at = $1 WHERE entity_id = 'meeting:az'", [NOW]);
    assert.notEqual(await factsVersion(fixture.facts.query, "meeting:", "AZ"), before);
    assert.deepEqual((await readCommentAccessFacts(fixture.facts.query, "AZ")).value.records.map(row => row.bodyId), ["meeting:az"]);
    assert.deepEqual((await readCommentAccessFacts(fixture.facts.query, "US-AZ")).value.records.map(row => row.bodyId), ["meeting:az"]);
    assert.deepEqual((await readCommentAccessFacts(fixture.facts.query, null)).value.records.map(row => row.bodyId), ["meeting:us"]);
    assert.equal((await readCommentAccessFacts(fixture.facts.query)).value.records.length, 3);
    const meetings = ["az", "ca", "us"].map(id => ({ id, title: "old", provenance: {} }) as Meeting);
    assert.deepEqual((await withMeetingFacts(meetings, fixture.facts.query, "AZ")).map(row => row.title), ["Council meeting", "old", "old"]);
    assert.deepEqual((await withMeetingFacts(meetings, fixture.facts.query, "US-AZ")).map(row => row.title), ["Council meeting", "old", "old"]);
    assert.deepEqual((await withMeetingFacts(meetings, fixture.facts.query, null)).map(row => row.title), ["old", "old", "Council meeting"]);
  } finally { await fixture.facts.pg.close(); }
});
