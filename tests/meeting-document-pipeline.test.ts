import assert from "node:assert/strict";
import test from "node:test";
import { runMeetingPartition } from "../scripts/ingest.ts";
import { MEETING_SITTING_WINDOW } from "../lib/civic-data/contracts.ts";
import { buildMeetingPartitions } from "../lib/civic-data/meeting-partitions.ts";
import { MEETING_BODY_DEPENDENCY_SQL, MEETING_DIVISION_DEPENDENCY_SQL, MEETING_VENUE_DEPENDENCY_SQL } from "../lib/civic-data/meeting-dependencies.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { routineCalendarDueAtMs, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { memoryWebsitePacing } from "../lib/control-plane/website-pacing.ts";
import type { Query } from "../lib/facts/publish.ts";
import { MEETINGS_SOURCE_ID, readMeetingsProjection } from "../lib/meetings/snapshot.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { SourceFetchDeferred, runWithSourceFetch } from "../lib/sources/fetch-source.ts";
import type { SavedSourceResponse, SourceFetchStore } from "../lib/sources/fetch-source-state.ts";
import { runWithKnownReleaseCache } from "../lib/sources/known-release.ts";
import { fixtureRepositories, installFixtureDoors } from "./helpers/meeting-doors-fixture.ts";

test("a body publishes its calendar before a deferred document and retries only that document without moving the calendar clock", async t => {
  const now = Date.now(), at = new Date(now).toISOString(), retryAt = new Date(now + 17 * 60_000).toISOString();
  t.mock.timers.enable({ apis: ["Date"], now });
  const ocdId = "ocd-division/country:us/state:az/place:document-pipeline", bodyId = `${ocdId}#governing`;
  const root = "https://document-pipeline.example.gov/AgendaCenter", rss = "https://document-pipeline.example.gov/RSSFeed.aspx?CID=All-0&ModID=65";
  const day = new Date(now + 86_400_000).toISOString().slice(0, 10), token = `${day.slice(5, 7)}${day.slice(8, 10)}${day.slice(0, 4)}-42`;
  const documentUrl = `https://document-pipeline.example.gov/AgendaCenter/ViewFile/Agenda/${token}`;
  const wiring: BodySourceWiring = { bodyId, ocdId, agendaSourceType: "CIVICPLUS", jurisdiction: "Document Pipeline",
    publishingOrg: "Document Pipeline Council", timeZone: "America/Phoenix", verifiedAt: at,
    config: { slug: "document-pipeline", agendaCenterUrl: root, agendaCenterCategoryId: "1" } };
  const partition = buildMeetingPartitions([wiring])[0]!, repos = await fixtureRepositories([wiring]);
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), saved = new Map<string, SavedSourceResponse>();
  const sourceStore: SourceFetchStore = { pacing: memoryWebsitePacing(), withLease: async (_key, work) => work(),
    read: async key => saved.get(key) ?? null, readRequestPlan: async () => null, saveRequestGroup: async () => {},
    record: async (key, value, _check, aliases = []) => { if (value) for (const alias of [key, ...aliases]) saved.set(alias, value); } };
  const dependencyQuery: Query = async (sql, params = []) => {
    if (sql === MEETING_BODY_DEPENDENCY_SQL) {
      assert.deepEqual(params, [bodyId]);
      return [{ version_id: "document-pipeline-registry", value: { id: bodyId, ocdId, name: wiring.publishingOrg } }];
    }
    if (sql.includes("kind = 'registry'")) return [{ version_id: "document-pipeline-registry", value: { generatedAt: at } }];
    if (sql === MEETING_DIVISION_DEPENDENCY_SQL) return [{ value: { ocdId, parentOcdId: "ocd-division/country:us/state:az", label: wiring.jurisdiction } }];
    if (sql === MEETING_VENUE_DEPENDENCY_SQL || sql.includes("FROM fact") || sql.includes("FROM blank")) return [];
    throw new Error(`Unexpected dependency query: ${sql}`);
  };
  const requests: string[] = [];
  const stdout: string[] = [];
  t.mock.method(console, "log", (...values: unknown[]) => { stdout.push(values.map(String).join(" ")); });
  let blocked = true, observedBeforeDocument = false;
  const read = () => readMeetingsProjection({ store, bypassCache: true, now: new Date().toISOString(), partitions: [partition] });
  const transport: typeof fetch = async input => {
    const url = String(input); requests.push(url);
    if (url === rss) return new Response("<rss><channel></channel></rss>", { headers: { "content-type": "application/rss+xml" } });
    if (url === root) return new Response(`<div id="cat1"><h2>Council</h2><table><tr><td><a href="${documentUrl}">Council meeting 5:00 p.m.</a><p>Location: Virtual meeting</p></td></tr></table></div>`, { headers: { "content-type": "text/html" } });
    assert.equal(url, documentUrl);
    const visible = await read();
    assert.equal(visible.kind, "PROMOTED", "calendar is already readable when the document request starts");
    if (visible.kind === "PROMOTED") {
      assert.equal(visible.value.meetings.length, 1);
      assert.equal(visible.value.meetings[0]!.agendaUrl, documentUrl);
      observedBeforeDocument = true;
    }
    if (blocked) throw new SourceFetchDeferred({ ok: false, until: Date.parse(retryAt), why: "ASKED_TO_WAIT" });
    return new Response("<main><h1>Council agenda</h1><p>1. Public hearing on the water budget.</p></main>", { headers: { "content-type": "text/html" } });
  };
  const run = async (calendarDueAt?: string) => {
    const start = stdout.length, receipts: string[] = [];
    await runWithKnownReleaseCache({ store: vault, locks: repos.locks }, () =>
      runWithSourceFetch({ vault, runtime: { store: sourceStore, transport } }, () => runMeetingPartition(partition.id,
        { store, doors: repos.doors, dependencyQuery, facts: { db: null, vault }, calendarDueAt, onReceipt: line => { receipts.push(line); } })));
    assert.ok(receipts.length > 0);
    assert.deepEqual(stdout.slice(start).filter(line => line.startsWith("RCD_MEETING_PARTITION_RECEIPT=")), [receipts.at(-1)],
      "the standalone CLI emits exactly its final receipt while callbacks observe progress");
  };
  try {
    await run();
    assert.equal(observedBeforeDocument, true);
    assert.deepEqual(requests, [rss, root, documentUrl]);
    const first = await store.meetingCheckState(MEETINGS_SOURCE_ID, partition.scope);
    assert.equal(first.sourceCheck?.checkedAt, at);
    assert.deepEqual(first.meetingChecks?.documents, [{ url: documentUrl, checkedAt: null, attemptedAt: at, outcome: "DEFERRED", nextDueAt: retryAt }]);
    const calendarClock = await store.clock(MEETINGS_SOURCE_ID, "MEETING", partition.scope);
    const calendarDueAt = new Date(now + 60 * 60_000).toISOString();

    t.mock.timers.setTime(now + 16 * 60_000);
    await run(calendarDueAt);
    assert.deepEqual(requests, [rss, root, documentUrl], "a pending document is not read before its publisher's retry time");

    t.mock.timers.setTime(Date.parse(retryAt)); blocked = false;
    await run(calendarDueAt);
    assert.deepEqual(requests, [rss, root, documentUrl, documentUrl], "a document-only retry does not read RSS or the calendar");
    const checked = await store.meetingCheckState(MEETINGS_SOURCE_ID, partition.scope);
    assert.deepEqual(checked.sourceCheck, first.sourceCheck);
    assert.equal(checked.meetingChecks?.documents[0]?.checkedAt, retryAt);
    assert.equal(checked.meetingChecks?.documents[0]?.outcome, "CHECKED");
    const nextDueAt = Date.parse(checked.meetingChecks!.documents[0]!.nextDueAt);
    assert.ok(nextDueAt > Date.parse(retryAt) && nextDueAt <= Date.parse(retryAt) + MEETING_SITTING_WINDOW.hotEveryMs,
      "the next document read is admitted early enough to satisfy the Admin hot cadence");
    const afterClock = await store.clock(MEETINGS_SOURCE_ID, "MEETING", partition.scope);
    assert.equal(afterClock.lastAttemptedAt, calendarClock.lastAttemptedAt);
    assert.equal(afterClock.lastSucceededAt, retryAt, "the new document has its own publication time");
    assert.equal(afterClock.lastSucceededObservedAt, calendarClock.lastSucceededObservedAt);
    const task = routineTaskFromContract(partition);
    assert.equal(routineCalendarDueAtMs(task, afterClock, Date.now(), true), routineCalendarDueAtMs(task, calendarClock, Date.now(), true));
    const visible = await read();
    assert.equal(visible.kind, "PROMOTED");
    if (visible.kind === "PROMOTED") assert.match(visible.value.agendaDocuments[0]?.text ?? "", /Public hearing on the water budget/);
  } finally { installFixtureDoors(); }
});
