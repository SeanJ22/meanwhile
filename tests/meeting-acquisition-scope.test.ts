import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { platformWiringDoors } from "../lib/doors/platform-census.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { upsertDerivedDoor } from "../lib/doors/registry.ts";
import { installDoorRecords } from "../lib/doors/meeting-doors.ts";
import { meetingPartitionContract, type MeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { CompositeSource } from "../lib/sources/composite/index.ts";
import { accountedNormalize } from "../lib/sources/normalize-account.ts";
import type { ReportingMeetingSource } from "../lib/sources/types.ts";
import type { DerivedWiringRow } from "../lib/civic-data/derived-meeting-wiring.ts";
import { primeCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { runtimeCivicReadCache } from "../lib/db/civic-read-cache.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { failedMeetingAcquisitionCandidate } from "../lib/civic-data/failed-meeting-acquisition.ts";
import { processRegisteredMeetingPartitionCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";

const AT = "2026-10-28T05:14:10.000Z";
const row: DerivedWiringRow = {
  bodyId: "government:US-NV:cog:fixture#water-conveyance-advisory-committee", ocdId: "ocd-division/country:us/state:nv",
  bodyName: "Water Conveyance Advisory Committee", kind: "ICAL", route: "https://county.example.gov/calendar.ics?catID=14",
  officialHost: "county.example.gov", jurisdictionId: "nv:special:fixture", state: "US-NV", publishingOrg: "Fixture District",
  timeZone: "America/Los_Angeles", config: { slug: "fixture-water", feedUrl: "https://county.example.gov/calendar.ics?catID=14", feedScope: "category" },
  crosswalkRowId: "fixture-water", reviewedAt: "2026-10-20T12:00:00Z", verifiedAt: "2026-10-20T12:00:00Z",
};

async function installedPartition(): Promise<MeetingPartitionContract> {
  primeCuratedReaderProjection("venue-resolutions", { kind: "venue-resolutions", records: [{ id: "unrelated-fixture", value: {} }] }, "fixture");
  const repos = createMemoryRepositories(), [draft] = platformWiringDoors(row);
  await upsertDerivedDoor(repos.doors, draft!, row.verifiedAt, row.verifiedAt);
  installDoorRecords((await repos.doors.list()).map(record => record.value));
  return meetingPartitionContract(draft!.doorId)!;
}

/** The runner's local read-copy host: plain HTTP on 127.0.0.1, as production's supervisor starts it for its children. */
async function readCopyHost(t: { after: (fn: () => Promise<void> | void) => void }) {
  const copies = new Map<string, string>();
  const server = createServer(async (request, response) => {
    if (request.method === "PUT") {
      let body = ""; for await (const chunk of request) body += chunk;
      copies.set(request.url!, body); response.writeHead(204).end(); return;
    }
    const held = copies.get(request.url!);
    if (held === undefined) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "application/json" }).end(held);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address() as { port: number };
  const prior = { url: process.env.WTP_CIVIC_READ_CACHE_URL, token: process.env.WTP_CIVIC_READ_CACHE_TOKEN };
  process.env.WTP_CIVIC_READ_CACHE_URL = `http://127.0.0.1:${address.port}`;
  process.env.WTP_CIVIC_READ_CACHE_TOKEN = "fixture-token";
  t.after(async () => {
    if (prior.url === undefined) delete process.env.WTP_CIVIC_READ_CACHE_URL; else process.env.WTP_CIVIC_READ_CACHE_URL = prior.url;
    if (prior.token === undefined) delete process.env.WTP_CIVIC_READ_CACHE_TOKEN; else process.env.WTP_CIVIC_READ_CACHE_TOKEN = prior.token;
    server.close();
  });
}

test("a control-plane copy read during a board's failed read is not that board's acquisition, so its true failure is recorded", async t => {
  await readCopyHost(t);
  const partition = await installedPartition();
  const failure = "PUBLISHER_CONNECTION_RESET: the county calendar closed the connection";
  const child: ReportingMeetingSource<unknown> = {
    name: "granicus", publishedLookbackDays: null,
    async fetch() {
      // A known-release read checks held control-plane state through the runner's copy host while the source is in scope.
      const cache = runtimeCivicReadCache("postgres://fixture").jobState();
      await cache.checkpoint("known-release", "index", { held: true });
      assert.deepEqual(await cache.readCheckpoint("known-release", "index"), { held: true }, "the copy host answered over plain HTTP");
      throw new Error(failure);
    },
    normalize: () => [],
    normalizeWithDrops: raw => accountedNormalize("granicus", raw as unknown[], { meetings: [], drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }),
    upsert: async meetings => ({ inserted: 0, updated: meetings.length }),
  };
  const source = new CompositeSource([child], { captureAcquisitionEvidence: true });
  await source.fetch({ lat: 39, lng: -119.8, radiusKm: 1000 });
  const report = source.fetchedSourceReport("granicus")!;
  assert.equal(report.ok, false);
  assert.match(report.error ?? "", /PUBLISHER_CONNECTION_RESET/);
  assert.deepEqual(report.acquisitions, [], "the read-copy host is our own infrastructure, never the publisher's evidence");

  const candidate = failedMeetingAcquisitionCandidate({ sourceId: partition.sourceId, scope: partition.scope,
    acquisitions: report.acquisitions, attemptedAt: AT, failureDetail: report.error! });
  const outcome = await processRegisteredMeetingPartitionCandidate(new MemoryRoutineDataStore(), partition.id, candidate, AT);
  assert.equal(outcome.promoted, null);
  assert.equal(outcome.candidate.acquisitionSucceeded, false);
  assert.equal(outcome.candidate.candidate.retrieval.failureDetail, report.error, "Admin sees the publisher's own failure");
});

test("a request the publication rules refuse names itself in the recorded failure instead of crashing the board's read", async () => {
  const partition = await installedPartition();
  const plain = "http://county.example.gov/calendar.ics?catID=14";
  // The production failure: the plain-HTTP request named the attempt and the contract refused to record it at all.
  await assert.rejects(processRegisteredMeetingPartitionCandidate(new MemoryRoutineDataStore(), partition.id,
    failedAcquisitionCandidate({ sourceId: partition.sourceId, recordClass: "MEETING", scope: partition.scope, requestedUrl: plain,
      attemptedAt: AT, failureDetail: "SOURCE_UNAVAILABLE", parserVersion: "meetings-composite/2" }), AT),
  /MEETING_PARTITION_CANDIDATE_MISMATCH:.*FINAL_URL_NOT_HTTPS/);

  for (const acquisitions of [[{ requestedUrl: plain }, { requestedUrl: row.route }], [{ requestedUrl: plain }]]) {
    const candidate = failedMeetingAcquisitionCandidate({ sourceId: partition.sourceId, scope: partition.scope, acquisitions,
      attemptedAt: AT, failureDetail: "SOURCE_UNAVAILABLE" });
    assert.equal(candidate.retrieval.requestedUrl, acquisitions.length === 2 ? row.route : "", "only an accepted request names the attempt");
    const outcome = await processRegisteredMeetingPartitionCandidate(new MemoryRoutineDataStore(), partition.id, candidate, AT);
    assert.equal(outcome.promoted, null, "nothing from a plain-HTTP read is published");
    assert.match(outcome.candidate.candidate.retrieval.failureDetail ?? "", /^SOURCE_UNAVAILABLE .*FINAL_URL_NOT_HTTPS: http:\/\/county\.example\.gov\/calendar\.ics\?catID=14 is not HTTPS\./);
  }
});
