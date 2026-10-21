import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { publishMeetingFacts } from "../lib/facts/meeting-facts.ts";
import { meetingEntityId, readSittingFacts, withSittingFacts } from "../lib/facts/meeting-read.ts";
import { normalizeWithDrops } from "../lib/sources/legistar/index.ts";
import type { LegistarEvent } from "../lib/sources/legistar/types.ts";
import { factDb } from "./helpers/fact-db.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { promoteMeetingPartitions } from "../scripts/ingest.ts";

const ROOT = join(import.meta.dirname, "..");
const FEED = "https://webapi.legistar.com/v1/pima/events";
const bytes = readFileSync(join(ROOT, "tests", "fixtures", "legistar-pima-events.json"), "utf8");
const NOW = new Date("2026-08-12T22:00:00.000Z");

function capture(text: string, url: string, observedAt = "2026-08-12T21:00:00.000Z"): WorkerPublicationCapture {
  const contentHash = `sha256-${createHash("sha256").update(text).digest("hex")}`;
  return { evidence: { artifactId: `ar-${contentHash.slice(7, 31)}`, contentHash, text, acquiredByAttemptId: "at-feed", canonicalUrl: url,
    retrievedAt: observedAt, sourceId: new URL(url).hostname, methodRouteId: "door" }, observedAt, httpStatus: 200, transport: "REACHABLE", partial: false };
}

test("each sitting a body's door reads becomes facts found on the saved feed; a value the feed does not state stays a blank", async () => {
  const db = await factDb();
  await ensureFactEntities(db, ROOT, ["az"]);
  const events = JSON.parse(bytes) as LegistarEvent[];
  const { meetings } = normalizeWithDrops(events.map(event => ({ event, slug: "pima", collectedAt: NOW.toISOString(), items: null })), NOW);
  const totals = { live: 0, blanks: 0 };
  for (const meeting of meetings) {
    const report = await publishMeetingFacts(db, { meeting, capture: capture(bytes, FEED), producedBy: "door:legistar:pima" }, factClocks(null), NOW);
    totals.live += report.live; totals.blanks += report.blanks;
  }
  assert.equal(totals.blanks, meetings.filter(m => m.location).length, "only places stay open: the feed names the room, not the reviewed venue name");
  const first = meetings[0]!;
  const facts = await db.query("SELECT field, quote FROM fact WHERE entity_id = $1 AND status = 'live' ORDER BY field", [meetingEntityId(first.id)]);
  assert.deepEqual(facts.map(row => [row.field, row.quote]), [["agenda_url", first.agendaUrl], ["starts_at", "2026-05-12T00:00:00 1:00 PM"], ["title", "Study Session"]]);
  assert.deepEqual(await db.query("SELECT DISTINCT stage, reason FROM blank"), [{ stage: "CHECK", reason: "CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY" }]);
});

test("a promoted partition's fresh sittings become facts on the very bytes its door read, saved to the vault", async () => {
  const partition = MEETING_PARTITION_CONTRACTS.find(row => row.meetingSource === "civicplus" && row.wiring !== null && row.bodyId !== null)!;
  const feed = partition.wiring!.config.icalUrl as string;
  const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=America/Phoenix:20261020T190000", "SUMMARY:Regular Council Meeting",
    "LOCATION:1415 W Melody Ln\\, Bisbee AZ", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const bytes = new TextEncoder().encode(ics);
  const rawHash = createHash("sha256").update(bytes).digest("hex");
  const at = "2026-10-04T08:30:00.000Z";
  const meeting = { id: "civicplus:fixture:1", ocdId: partition.ocdId, bodyId: partition.bodyId, bodyName: "Council", title: "Regular Council Meeting",
    startsAt: "2026-10-20T19:00:00-07:00", timeZone: "America/Phoenix", location: null, agendaUrl: null, jurisdiction: "County", status: "SCHEDULED",
    provenance: { sourceUrl: feed, sourceOrg: "County", collectedAt: at, verifiedAt: null } } as unknown as Meeting;
  const db = await factDb();
  const vault = new MemoryEvidenceStore();
  const [result] = await promoteMeetingPartitions({ store: new MemoryRoutineDataStore(), partitions: [partition], meetings: [meeting], agendaDocuments: [], generatedAt: at,
    reports: [{ source: "civicplus", ok: true, error: null, fetched: 1, normalized: 1, drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
      acquisitions: [{ source: "civicplus", requestedUrl: feed, finalUrl: feed, httpStatus: 200, rawHash, byteCount: bytes.byteLength }] }],
    venueFetch: (async () => new Response("no", { status: 503 })) as typeof fetch,
    facts: { db, vault, responses: [{ source: "", requestedUrl: feed, finalUrl: feed, httpStatus: 200, rawHash, byteCount: bytes.byteLength, bytes,
      retrievedAt: at, contentType: "text/calendar" }] } });
  assert.equal(result?.outcome.candidate.state, "PROMOTED");
  const live = await db.query(`SELECT f.field, f.quote, s.url, s.blob_key FROM fact f JOIN source_copy s ON s.id = f.source_copy_id
    WHERE f.entity_id = $1 AND f.status = 'live' ORDER BY f.field`, [meetingEntityId(meeting.id)]);
  assert.deepEqual(live.map(row => [row.field, row.quote]), [["starts_at", "20261020T190000"], ["title", "Regular Council Meeting"]]);
  assert.ok(live.every(row => row.url === feed && String(row.blob_key).startsWith("artifact:")));
  assert.equal((await vault.list("project/freshness/")).filter(key => !key.endsWith(".meta.json")).length, 1, "the feed's bytes are in the vault");
});

test("readers see each sitting with its live facts and the saved page every one was found on", async () => {
  const db = await factDb();
  const events = JSON.parse(bytes) as LegistarEvent[];
  const { meetings } = normalizeWithDrops(events.map(event => ({ event, slug: "pima", collectedAt: NOW.toISOString(), items: null })), NOW);
  const first = meetings[0]!;
  await publishMeetingFacts(db, { meeting: first, capture: capture(bytes, FEED), producedBy: "door:legistar:pima" }, factClocks(null), NOW);
  const facts = (await readSittingFacts(db.query, [first.bodyId!])).get(first.bodyId!)!;
  const [seen] = withSittingFacts([{ ...first, title: "A stale partition title" }], facts);
  assert.equal(seen!.title, "Study Session", "the live fact wins over the partition row");
  assert.deepEqual([seen!.fieldSources?.title?.sourceUrl, seen!.fieldSources?.startsAt?.quote], [FEED, "2026-05-12T00:00:00 1:00 PM"]);
  assert.deepEqual(withSittingFacts([first], []), [first], "with no facts the partition row stands");
});

test("platform meeting bodies and sittings retain their registered district or territory state", async () => {
  for (const [state, division] of [["DC", "district:dc"], ["PR", "territory:pr"]]) {
    const db = await factDb();
    try {
      const ocdId = `ocd-division/country:us/${division}`, bodyId = `government:US-${state}:cog:fixture#governing`;
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Fixture place',$2)", [ocdId, state]);
      const text = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Regular Council Meeting\nDTSTART;TZID=America/New_York:20260812T190000\nEND:VEVENT\nEND:VCALENDAR";
      const meeting = { id: `ical:fixture:${state}`, ocdId, bodyId, bodyName: "Fixture Council", title: "Regular Council Meeting",
        startsAt: "2026-08-12T19:00:00-04:00", timeZone: "America/New_York", location: null, agendaUrl: null,
        provenance: { sourceUrl: "https://publisher.example.gov/calendar.ics", sourceOrg: "Fixture Government", collectedAt: NOW.toISOString(), verifiedAt: null } } as Meeting;
      const report = await publishMeetingFacts(db, { meeting, capture: capture(text, meeting.provenance.sourceUrl!), producedBy: "platform-door" }, factClocks(null), NOW);
      assert.equal(report.live, 2);
      const rows = await db.query("SELECT id,state FROM entity WHERE id=ANY($1::text[]) ORDER BY id", [[bodyId, meetingEntityId(meeting.id)]]);
      assert.equal(rows.length, 2); assert.ok(rows.every(row => row.state === state));
    } finally { await db.pg.close(); }
  }
});
