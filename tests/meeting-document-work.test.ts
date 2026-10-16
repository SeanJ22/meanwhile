import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { plannedMeetingDocumentChecks, retrieveMeetingDocuments as retrieveDocuments } from "../scripts/ingest.ts";
import { agendaDocumentStore, contentHashOf } from "../lib/meetings/agenda-documents.ts";
import { meetingDocumentCheckClock, meetingDocumentChecksIssue } from "../lib/meetings/document-checks.ts";
import { applyDocumentFreshChecks, confirmationCheckedAt } from "../lib/meetings/fresh-checks.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { withSourceTransport } from "./helpers/source-fetch.ts";
import { runWithSourceFetch, SourceFetchDeferred } from "../lib/sources/fetch-source.ts";
import type { Meeting } from "../lib/sources/types.ts";

const retrieveMeetingDocuments: typeof retrieveDocuments = (meetings, options) =>
  withSourceTransport(undefined, () => runWithSourceFetch({ sourceId: "test-meeting-documents" }, () => retrieveDocuments(meetings, options)));

const NOW = Date.parse("2026-10-16T12:00:00Z");
function meeting(id: string, offset: number, url = `https://clerk.example.gov/${id}`): Meeting {
  return { id, bodyId: "body", ocdId: "ocd-division/country:us/state:az/place:tucson", bodyName: "Council", title: "Council meeting",
    startsAt: new Date(NOW + offset).toISOString(), timeZone: "America/Phoenix", location: null, agendaUrl: url,
    jurisdiction: "Tucson", status: "SCHEDULED", provenance: { sourceUrl: url, sourceOrg: "Clerk", collectedAt: new Date(NOW).toISOString(), verifiedAt: null } };
}
const html = (text: string, at = NOW) => new Response(`<main><p>1. ${text}</p></main>`, { headers: {
  "content-type": "text/html", "x-meanwhile-source-checked-at": new Date(at).toISOString(),
} });
afterEach(() => agendaDocumentStore.clear());

test("a held hot agenda revision precedes old missing links and stays due when its turn is unfinished", async () => {
  const hot = meeting("hot", 86_400_000), cold = meeting("old", -30 * 86_400_000);
  const first = await retrieveMeetingDocuments([hot], { now: () => NOW - 3_600_000, fetchImpl: async () => html("Old budget", NOW - 3_600_000) });
  const requested: string[] = [];
  const next = await retrieveMeetingDocuments([cold, hot], { previous: first, now: () => NOW, maxUrls: 1, fetchImpl: async input => {
    requested.push(String(input)); return html("Revised budget hearing");
  } });
  assert.deepEqual(requested, [hot.agendaUrl]);
  assert.match(agendaDocumentStore.latestFor(hot.id)!.text!, /Revised budget/);
  assert.equal(next.documents.find(check => check.url === cold.agendaUrl)?.attemptedAt, null);
  assert.equal(meetingDocumentCheckClock(next).pendingDocumentCount, 1);
});

test("a deferred document keeps exact retry time and its held text without rereading before due", async () => {
  const row = meeting("deferred", 0), until = NOW + 17 * 60_000;
  const first = await retrieveMeetingDocuments([row], { now: () => NOW - 3_600_000, fetchImpl: async () => html("Held hearing", NOW - 3_600_000) });
  const deferred = await retrieveMeetingDocuments([row], { previous: first, now: () => NOW, fetchImpl: async () => {
    throw new SourceFetchDeferred({ ok: false, until, why: "HOURLY_ALLOWANCE" });
  } });
  assert.equal(meetingDocumentCheckClock(deferred).nextDocumentDueAt, new Date(until).toISOString());
  assert.match(agendaDocumentStore.latestFor(row.id)!.text!, /Held hearing/);
  const before = await retrieveMeetingDocuments([row], { previous: deferred, now: () => until - 1, fetchImpl: async () => { throw new Error("must not open"); } });
  assert.deepEqual(before, deferred);
  assert.equal(meetingDocumentChecksIssue(deferred, new Date(NOW).toISOString()), null);
});

test("one URL is read once for siblings, released, and checked again only at its configured cadence", async () => {
  const url = "https://clerk.example.gov/shared-agenda", rows = [meeting("first", 0, url), meeting("second", 60_000, url)];
  let reads = 0;
  const fetchImpl = async () => { reads++; return html("Public hearing on the water budget", NOW); };
  const first = await retrieveMeetingDocuments(rows, { now: () => NOW, fetchImpl });
  assert.equal(reads, 1);
  assert.equal(agendaDocumentStore.versionsFor(rows[0]!.id).length, 1);
  assert.equal(agendaDocumentStore.versionsFor(rows[1]!.id).length, 1);
  await retrieveMeetingDocuments(rows, { previous: first, now: () => NOW + 1_000, fetchImpl });
  assert.equal(reads, 1);
  await retrieveMeetingDocuments(rows, { previous: first, now: () => NOW + 3_600_000, fetchImpl: async () => {
    reads++; return html("Public hearing on the water budget", NOW + 3_600_000);
  } });
  assert.equal(reads, 2);
  assert.equal(agendaDocumentStore.versionsFor(rows[0]!.id).length, 1);
  assert.equal(agendaDocumentStore.latestFor(rows[0]!.id)!.retrievedAt, new Date(NOW + 3_600_000).toISOString());
  assert.equal(agendaDocumentStore.latestFor(rows[0]!.id)!.contentHash, contentHashOf(new TextEncoder().encode("<main><p>1. Public hearing on the water budget</p></main>")));
});

test("the per-body turn budget leaves unstarted URLs pending and calendar retry remains distinct", async () => {
  let at = NOW, reads = 0;
  const rows = [meeting("one", 0), meeting("two", 1), meeting("three", 2)];
  const checks = await retrieveMeetingDocuments(rows, { now: () => at, budgetMs: 15, fetchImpl: async () => {
    reads++; at += 20; return html("Council agenda item", at);
  } });
  assert.equal(reads, 1);
  assert.equal(meetingDocumentCheckClock(checks).pendingDocumentCount, 2);
  assert.equal(plannedMeetingDocumentChecks([], { previous: checks }).documents.length, 0);
});

test("minutes and results use the due URL queue and retain their last good text on failure", async () => {
  const row: Meeting = { ...meeting("minutes", 0), agendaUrl: null, publishedLinks: [
    { label: "Approved minutes", href: "https://clerk.example.gov/minutes", kind: "MINUTES" as const },
    { label: "Voting results", href: "https://clerk.example.gov/results", kind: "RESULTS" as const },
  ] };
  const first = await retrieveMeetingDocuments([row], { now: () => NOW, fetchImpl: async input =>
    html(String(input).endsWith("minutes") ? "Motion approved by three votes to two." : "Budget resolution adopted.") });
  assert.deepEqual(row.publishedDocuments?.map(doc => doc.kind), ["MINUTES", "RESULTS"]);
  assert.match(row.publishedDocuments?.find(doc => doc.kind === "MINUTES")?.text ?? "", /three votes/);
  assert.equal(agendaDocumentStore.documentCount, 0);
  const held = structuredClone(row.publishedDocuments);
  const second = await retrieveMeetingDocuments([row], { previous: first, now: () => NOW + 3_600_000,
    fetchImpl: async () => new Response("missing", { status: 404 }) });
  assert.deepEqual(row.publishedDocuments, held);
  assert.equal(meetingDocumentCheckClock(second).pendingDocumentCount, 2);
});

test("document confirmations advance only matching saved bytes and never restamp the calendar", async () => {
  const row = meeting("checked", 0);
  const checks = await retrieveMeetingDocuments([row], { now: () => NOW, fetchImpl: async () => html("Held budget item") });
  const held = agendaDocumentStore.latestFor(row.id)!;
  const later = new Date(NOW + 3_600_000).toISOString();
  const metadata = { documents: checks.documents.map(check => ({ ...check, checkedAt: later, attemptedAt: later })) };
  const snapshot: MeetingsSnapshot = { formatVersion: 1, generatedAt: new Date(NOW).toISOString(),
    sources: [], counts: { total: 1, fresh: 1, carried: 0, duplicatesCollapsed: 0 }, meetings: [row],
    agendaDocuments: [{ ...held, id: "old-version", contentHash: "a".repeat(64) }, held] };
  const refreshed = applyDocumentFreshChecks(snapshot, metadata);
  assert.equal(refreshed.agendaDocuments[0]!.retrievedAt, held.retrievedAt);
  assert.equal(refreshed.agendaDocuments[1]!.retrievedAt, later);
  assert.equal(refreshed.generatedAt, snapshot.generatedAt);
  assert.equal(confirmationCheckedAt({ versionId: "version", retrieval: { requestedUrl: row.agendaUrl!, finalUrl: row.agendaUrl,
    httpStatus: 200, rawHash: held.contentHash, retrievedAt: later,
    sourceCheck: { requestedUrl: row.agendaUrl!, finalUrl: row.agendaUrl!, httpStatus: 200, rawHash: held.contentHash, checkedAt: snapshot.generatedAt },
  } }, "version", true), snapshot.generatedAt);
});

test("a due held document is pending until its own check finishes, including an unstarted turn", async () => {
  const row = meeting("held-due", 0);
  const first = await retrieveMeetingDocuments([row], { now: () => NOW, fetchImpl: async () => html("Council budget") });
  const due = Date.parse(first.documents[0]!.nextDueAt);
  assert.equal(due, NOW + 35 * 60_000);
  const pending = await retrieveMeetingDocuments([row], { previous: first, now: () => due, maxUrls: 0,
    fetchImpl: async () => { throw new Error("unstarted turn must not fetch"); } });
  assert.equal(pending.documents[0]!.checkedAt, first.documents[0]!.checkedAt);
  assert.equal(meetingDocumentCheckClock(pending).pendingDocumentCount, 1);
  assert.equal(meetingDocumentCheckClock(pending).nextDocumentDueAt, first.documents[0]!.nextDueAt);
});
