import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { meetingPartitionForRow } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { Registry } from "../lib/registry/types.ts";
import type { RetainedSourceResponse } from "../lib/civic-data/retained-meeting-bytes.ts";
import { readHeldMeetingCliOptions, runMeetingIngest } from "../scripts/ingest.ts";
import { FIXTURE_DOOR_ROWS, fixtureDoorRecords, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";
import { withFetch } from "./helpers/with-fetch.ts";
import { AgendaDocumentStore, contentHashOf } from "../lib/meetings/agenda-documents.ts";
import { retrieveAgendas, retrieveHeldAgendas } from "../scripts/ingest.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { makeCivicPlusSource } from "../lib/sources/civicplus/index.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";

test("the ordinary registered command reads one door, one body, and its own venue slice before acquisition", async () => {
  const row = FIXTURE_DOOR_ROWS.find(row => row.agendaSourceType === "ICAL")!, door = fixtureDoorRecords([row])[0]!;
  const partition = meetingPartitionForRow("ical", row.bodyId), calls: string[] = [], at = new Date().toISOString();
  const venue = requiredManualProductionContract("venue-resolutions");
  try {
    const prepared = await readHeldMeetingCliOptions(["composite", "--promote", `--only-partition=${partition.id}`], {
      readDoor: async id => { calls.push(id); return door; },
      query: async (sql, params) => {
        assert.equal(params?.includes(row.bodyId) || params?.includes(row.ocdId), true);
        if (sql.includes("registry_pointer")) return [{ registry_version_id: "held-body", registry_generated_at: at,
          bodies: [{ id: row.bodyId, ocdId: row.ocdId, name: row.config.bodyName }], previous_pointer: null, previous: null, foreign_meetings: 0, foreign_documents: 0 }];
        return [{ venue_pointer: { sourceId: venue.sourceId, recordClass: venue.recordClass, scope: venue.scope, versionId: "held-venues", kind: "venue-resolutions" }, venues: [] }];
      },
    });
    assert.deepEqual(calls, [door.doorId]);
    assert.equal(prepared.registry!.bodies.length, 1);
    assert.equal(prepared.registry!.bodies[0]!.id, row.bodyId);
    assert.deepEqual(prepared.venues, []);
    assert.equal(prepared.partition!.id, partition.id);
  } finally { installFixtureDoors(); }
});

test("a state's calendar program and an unprepared command read no single-board slice", async () => {
  const refuse = { readDoor: async () => { throw new Error("A state program read one board's door"); },
    query: async () => { throw new Error("A state program read one board's reader slice"); } };
  assert.deepEqual(await readHeldMeetingCliOptions(["composite", "--promote", "--contracts-file=handoff.json", "--contracts-count=2", "--contracts-sha256=0"], refuse), {});
  assert.deepEqual(await readHeldMeetingCliOptions(["composite"], refuse), {});
});

test("fresh saved agendas keep their original evidence clock and make no duplicate request", async () => {
  const capturedAt = new Date().toISOString(), url = "https://example.gov/agenda/one";
  const meeting: Meeting = { id: "fresh-one", bodyId: "one-body", ocdId: "ocd-division/country:us/state:az/place:tucson",
    bodyName: "Council", title: "Council", startsAt: new Date().toISOString(), timeZone: "America/Phoenix", location: null,
    agendaUrl: url, jurisdiction: "Tucson", status: "SCHEDULED",
    provenance: { sourceUrl: url, sourceOrg: "Clerk", collectedAt: capturedAt, verifiedAt: null } };
  const store = new AgendaDocumentStore(), text = "1. Call to order. 2. Approval of minutes.";
  const contentHash = contentHashOf(new TextEncoder().encode(text));
  store.append({ id: `${meeting.id}@${contentHash}`, meetingId: meeting.id, ocdId: meeting.ocdId, documentUrl: url,
    contentHash, retrievedAt: capturedAt, contentType: "text/html", text, extraction: "html", extractionNote: null,
    sourceUrl: url, sourceOrg: "Clerk", collectedAt: capturedAt, verifiedAt: null });
  await withFetch(async () => { throw new Error("A fresh saved agenda was requested again"); }, () => retrieveAgendas([meeting], store));
  assert.equal(store.versionsFor(meeting.id).length, 1);
  assert.equal(store.latestFor(meeting.id)!.retrievedAt, capturedAt);
});

test("a calendar's older archive rows do not make the recurring held-body reader walk years of agenda PDFs", async () => {
  const row = FIXTURE_DOOR_ROWS.find(row => row.agendaSourceType === "CIVICPLUS" && row.bodyId.endsWith("#board-of-adjustment"))!;
  const at = new Date().toISOString();
  const page = readFileSync(new URL("./fixtures/civicplus-rockaway-agendacenter.html", import.meta.url), "utf8");
  const meetings = makeCivicPlusSource([row]).normalize([{ wiring: row, ical: "", collectedAt: at,
    agendaPages: [{ url: row.config.agendaCenterUrl!, text: page, collectedAt: at }] }]);
  assert.ok(meetings.some(meeting => Date.parse(at) - Date.parse(meeting.startsAt) > 120 * 86_400_000));
  const documents: string[] = [];
  await withFetch(async (url: string) => {
    if (url.includes("ViewFile")) {
      documents.push(url);
      return new Response(`<html><main>Agenda ${url}. 1. Call to order. 2. Approval of minutes.</main></html>`, { headers: { "content-type": "text/html" } });
    }
    throw new Error(`Unexpected source request ${url}`);
  }, () => retrieveHeldAgendas(meetings, new AgendaDocumentStore(), Date.parse(at)));
  assert.ok(documents.length > 0, "current held-window agendas are read");
  assert.ok(documents.every(url => {
    const date = /_(\d{2})(\d{2})(\d{4})-/.exec(url);
    return date && Math.abs(Date.parse(`${date[3]}-${date[1]}-${date[2]}T12:00:00Z`) - Date.parse(at)) <= 120 * 86_400_000;
  }), `an agenda outside the declared held window was requested: ${documents.join(", ")}`);
});

test("the permanent one-body reader reuses a saved source with its original clock and leaves production writes out of a dry run", async () => {
  const row = FIXTURE_DOOR_ROWS.find(row => row.agendaSourceType === "ICAL")!;
  const partition = meetingPartitionForRow("ical", row.bodyId);
  const readAt = new Date(Date.now() - 30 * 60_000).toISOString();
  const startsAt = new Date(Date.now() + 86_400_000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const bytes = new TextEncoder().encode(["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:one-held-body",
    `DTSTART:${startsAt}`, "SUMMARY:Advisory Budget Committee", "LOCATION:Online", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
  const initialResponse: RetainedSourceResponse = { source: "ical", requestedUrl: row.config.feedUrl!, finalUrl: row.config.feedUrl!,
    httpStatus: 200, rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
    bytes, retrievedAt: readAt, contentType: "text/calendar" };
  const registry: Registry = { generatedAt: readAt, divisions: [], bodies: [{ id: row.bodyId, ocdId: row.ocdId,
    name: row.config.bodyName!, bodyClass: "committee", bodyOrigin: "SOURCED", coverageStatus: "LIVE", agendaSourceType: "ICAL",
    agendaSourceRef: row.config.feedUrl!, meetingCadence: null, homepageUrl: null, demandCount: 0, sourceDataset: "GOV_DIRECTORY",
    provenance: { sourceUrl: row.config.feedUrl!, sourceOrg: row.publishingOrg, collectedAt: readAt, verifiedAt: null } }] };
  const store = new MemoryRoutineDataStore();
  const priorExitCode = process.exitCode;
  const result = await withFetch(async () => { throw new Error("Unexpected live source or database read"); }, () => runMeetingIngest(
    ["composite", "--dry-run", `--only-partition=${partition.id}`], { initialResponse, partition, registry, store, previous: null }));
  assert.equal(result.sourceReads.length, 1);
  assert.equal(result.succeeded, true, result.measurement!.failures.join("; "));
  assert.equal(result.sourceReads[0]!.retrievedAt, readAt);
  assert.equal(result.sourceReads[0]!.rawHash, initialResponse.rawHash);
  assert.equal(result.measurement!.requests, 0, "reusing the already acquired response makes no new source request");
  assert.ok(result.measurement!.factsFound > 0);
  assert.ok(result.measurement!.factsWouldAttach > 0);
  assert.equal(await store.readPromotion("MEETING", partition.scope), null);
  assert.equal(process.exitCode, priorExitCode, "the programmatic reader leaves process exit status to its caller");

  const noticeUrl = "https://www.newbury.nh.gov/board/notice";
  const partial = await withFetch(async (url: string) => {
    assert.equal(url, noticeUrl);
    return new Response("<html><nav>Home</nav></html>", { headers: { "content-type": "text/html" } });
  }, () => runMeetingIngest(["composite", "--dry-run", `--only-partition=${partition.id}`], {
    initialResponse, partition: { ...partition, wiring: { ...row, noticeUrl } }, registry, store, previous: null, venues: [],
  }));
  assert.equal(partial.sourceSucceeded, true, partial.measurement!.failures.join("; "));
  assert.equal(partial.succeeded, true, "a failed agenda extraction leaves the successful calendar's refresh intact");
  assert.equal(partial.measurement!.incomplete, true, "the agenda remains named owed work");
  assert.ok(partial.measurement!.factsWouldAttach > 0, "the verified calendar facts remain independently attachable");

  const address = "10 Main Street", priorAt = new Date(Date.now() - 86_400_000).toISOString();
  const withAddress = new TextEncoder().encode(new TextDecoder().decode(bytes).replace("LOCATION:Online", `LOCATION:${address}`));
  const prior: Meeting = { id: `ical:${row.config.slug}:one-held-body`, bodyId: row.bodyId, ocdId: row.ocdId, bodyName: row.config.bodyName!,
    title: "Advisory Budget Committee", startsAt: new Date(Date.now() + 86_400_000).toISOString(), timeZone: row.timeZone,
    location: { name: "Town Hall", address, lat: 43.32, lng: -72.03 }, agendaUrl: null, jurisdiction: row.jurisdiction, status: "SCHEDULED",
    provenance: { sourceUrl: row.config.feedUrl!, sourceOrg: row.publishingOrg, collectedAt: priorAt, verifiedAt: priorAt } };
  const retainedLocation = await withFetch(async () => { throw new Error("A venue outage triggered another source read"); }, () => runMeetingIngest(
    ["composite", "--dry-run", `--only-partition=${partition.id}`], { partition, registry, store, venues: [], venuesUnavailable: "scoped venue store unavailable",
      previous: { formatVersion: 1, generatedAt: priorAt, counts: { fresh: 1, carried: 0, total: 1 }, sources: [], meetings: [prior], agendaDocuments: [] },
      initialResponse: { ...initialResponse, bytes: withAddress, byteCount: withAddress.length, rawHash: createHash("sha256").update(withAddress).digest("hex") },
    }));
  assert.equal(retainedLocation.sourceSucceeded, true, retainedLocation.measurement!.failures.join("; "));
  assert.ok(retainedLocation.measurement!.byFamily.location, JSON.stringify(retainedLocation.measurement));
  assert.equal(retainedLocation.measurement!.byFamily.location.factsFound, 1);
  assert.equal(retainedLocation.measurement!.byFamily.location.factsWouldAttach, 0, "an existing verified point is retained rather than claimed new");
  assert.match(retainedLocation.measurement!.failures.join("; "), /venue.*unavailable/i);
});
