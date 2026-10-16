import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { meetingDocumentTargets, retrievePublishedMeetingDocument } from "../lib/outcomes/minutes-ingest.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { LocalFileArtifactStore, scopedReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishReaderEdgeArtifacts, readReaderEdgeMeetings } from "../lib/meetings/edge-serving.ts";
import { meetingSettingsFromValues } from "../lib/meetings/settings.ts";
import { meetingPublication } from "./helpers/meeting-publication.ts";
import type { MeetingDocumentCheckPublication, MeetingPublication } from "../lib/meetings/edge-artifacts.ts";
import type { MeetingDocumentChecks } from "../lib/meetings/document-checks.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";

const meeting: Meeting = { id: "calendar:council:1", bodyName: "Council", title: "Regular meeting", jurisdiction: "Example",
  ocdId: "ocd-division/country:us/state:az/place:example", startsAt: "2026-10-16T12:00:00Z", timeZone: "America/Phoenix",
  status: "CONCLUDED", location: null, agendaUrl: "https://clerk.example.gov/agenda",
  provenance: { sourceUrl: "https://clerk.example.gov/calendar", sourceOrg: "Clerk", collectedAt: "2026-10-16T12:00:00Z", verifiedAt: null } };
const checkedAt = "2026-10-16T13:00:00.000Z";
const response = (text: string, at = checkedAt): typeof fetch => async () => new Response(text, {
  headers: { "content-type": "text/html", "x-meanwhile-source-checked-at": at },
});

test("only publisher-identified minutes and results enter the document queue", () => {
  const targets = meetingDocumentTargets([{ ...meeting, publishedLinks: [
    { label: "Minutes", href: "https://clerk.example.gov/minutes" },
    { label: "Meeting results", href: "https://clerk.example.gov/results" },
    { label: "Minutes", href: "https://clerk.example.gov/minutes" },
    { label: "Minutes", href: meeting.agendaUrl! },
    { label: "Minutes", href: "javascript:alert(1)" },
    { label: "Register", href: "https://clerk.example.gov/register" },
  ] }]);
  assert.deepEqual(targets.map(target => [target.kind, target.url]), [
    ["MINUTES", "https://clerk.example.gov/minutes"], ["RESULTS", "https://clerk.example.gov/results"],
  ]);
  assert.equal(targets[1].publisherLabel, "Meeting results");
});

test("published results retain text and their actual wire read time without inventing outcome records", async () => {
  const target = { meeting, url: "https://clerk.example.gov/results", kind: "RESULTS" as const, publisherLabel: "Meeting results" };
  const first = await retrievePublishedMeetingDocument(target, response("<html><h1>Meeting results</h1><p>Item 4 continued.</p></html>"));
  assert.equal(first.kind, "RESULTS");
  assert.equal(first.extraction, "TEXT_EXTRACTED");
  assert.equal(first.checkedAt, checkedAt);
  assert.equal(first.retrievedAt, checkedAt);
  assert.match(first.text!, /Item 4 continued/);
  assert.equal(Object.hasOwn(first, "outcomes"), false);
  const nextAt = "2026-10-16T14:00:00.000Z";
  const same = await retrievePublishedMeetingDocument(target, response("<html><h1>Meeting results</h1><p>Item 4 continued.</p></html>", nextAt), [first]);
  assert.equal(same.contentHash, first.contentHash);
  assert.equal(same.retrievedAt, checkedAt);
  assert.equal(same.checkedAt, nextAt);
  const changed = await retrievePublishedMeetingDocument(target, response("<p>Item 4 withdrawn.</p>", nextAt), [first]);
  assert.notEqual(changed.contentHash, first.contentHash);
  assert.match(changed.text!, /withdrawn/);
});

test("a failed extraction of unchanged bytes is retried and a failed request cannot replace held text", async () => {
  const target = { meeting, url: "https://clerk.example.gov/minutes", kind: "MINUTES" as const };
  const good = await retrievePublishedMeetingDocument(target, response("<p>Minutes published by the clerk.</p>"));
  const failed = { ...good, extraction: "UNREADABLE" as const, text: null, extractionNote: "Previous extraction failed" };
  const retried = await retrievePublishedMeetingDocument(target, response("<p>Minutes published by the clerk.</p>"), [failed]);
  assert.equal(retried.extraction, "TEXT_EXTRACTED");
  assert.match(retried.text!, /Minutes published/);
  await assert.rejects(retrievePublishedMeetingDocument(target, async () => new Response("Unavailable", { status: 503 }), [good]), /HTTP 503/);
  assert.equal(good.text, "Minutes published by the clerk.");
});

test("changed results at the same URL reach the exact meeting reader as results rather than an agenda", async () => {
  const root = await mkdtemp(join(tmpdir(), "published-results-reader-"));
  try {
    const base = new LocalFileArtifactStore(root), store = scopedReaderArtifactStore(base, "AZ");
    const target = { meeting, url: "https://clerk.example.gov/results", kind: "RESULTS" as const, publisherLabel: "Results" };
    let previous: Awaited<ReturnType<typeof retrievePublishedMeetingDocument>>[] = [];
    for (const text of ["Item 4 continued.", "Item 4 withdrawn."]) {
      const document = await retrievePublishedMeetingDocument(target, response(`<p>${text}</p>`), previous);
      const snapshot = { formatVersion: 1 as const, generatedAt: checkedAt,
        counts: { fresh: 1, carried: 0, total: 1, duplicatesCollapsed: 0 }, sources: [], agendaDocuments: [],
        meetings: [{ ...meeting, publishedLinks: [{ label: "Results", href: target.url, kind: "RESULTS" as const }], publishedDocuments: [document] }] };
      const result = await publishReaderEdgeArtifacts(meetingPublication(snapshot), {
        sourceThrough: checkedAt, retrievedAt: checkedAt, promotedThrough: checkedAt,
      }, { store });
      assert.equal(result.status, "PUBLISHED");
      const read = await readReaderEdgeMeetings({ store: base, meetingId: meeting.id, window: "HELD", now: checkedAt,
        settings: meetingSettingsFromValues(), fallback: async () => { throw new Error("The exact-ID artifact should hold this meeting."); } });
      assert.equal(read.kind, "PROMOTED");
      if (read.kind !== "PROMOTED") throw new Error("Meeting artifact not readable");
      assert.deepEqual(read.value.agendaDocuments, []);
      const delivered = read.value.meetings.find(row => row.id === meeting.id)?.publishedDocuments?.[0];
      assert.equal(delivered?.kind, "RESULTS");
      assert.equal(delivered?.text, text);
      assert.equal(delivered?.url, target.url);
      previous = [document];
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("document confirmations update only place sidecars and a reader never opens another place's checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "document-confirmation-edge-"));
  try {
    const base = new LocalFileArtifactStore(root), store = scopedReaderArtifactStore(base, "AZ");
    const rows = await Promise.all(["first", "second"].map(async name => {
      const row = { ...meeting, id: `calendar:${name}`, ocdId: `ocd-division/country:us/state:az/place:${name}` };
      const document = await retrievePublishedMeetingDocument({ meeting: row, url: `https://clerk.example.gov/${name}/minutes`, kind: "MINUTES" }, response(`<p>${name} minutes</p>`));
      const snapshot: MeetingsSnapshot = { formatVersion: 1, generatedAt: checkedAt, sources: [], agendaDocuments: [],
        meetings: [{ ...row, publishedDocuments: [document] }], counts: { fresh: 1, carried: 0, total: 1, duplicatesCollapsed: 0 } };
      return { name, row, document, snapshot };
    }));
    const publication = (): MeetingPublication => ({ generatedAt: checkedAt, sources: [], meetingCount: 2,
      chunks: (async function* () { for (const row of rows) yield { key: row.name, version: `${row.name}:payload`, read: async () => ({ snapshot: row.snapshot }) }; })() });
    const checks = (firstAt: string, reads: string[] = []): AsyncIterable<MeetingDocumentCheckPublication> => (async function* () {
      for (const row of rows) {
        const at = row.name === "first" ? firstAt : checkedAt;
        yield { chunkKey: row.name, chunkVersion: `${row.name}:payload`, version: `${row.name}:${at}`, read: async () => {
          reads.push(row.name);
          const check: MeetingDocumentChecks = { documents: [{ url: row.document.url, contentHash: row.document.contentHash,
            checkedAt: at, attemptedAt: at, nextDueAt: "2026-10-16T16:00:00Z", outcome: "CHECKED" }] };
          return check;
        } };
      }
    })();
    const metadata = { sourceThrough: checkedAt, retrievedAt: checkedAt, promotedThrough: checkedAt };
    assert.equal((await publishReaderEdgeArtifacts(publication(), metadata, { store,
      checks: { composition: "held", freshChecks: {}, documentChecks: checks(checkedAt) } })).status, "PUBLISHED");
    const before = (await store.readManifest())!.manifest;
    const writes: string[] = [], reads: string[] = [];
    const counted = new Proxy(store, { get(target, property) {
      if (property === "putImmutable") return async (bytes: Uint8Array, suffix: "json" | "json.gz") => {
        const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
        assert.ok(value.checks, "a confirmation cannot copy meeting content");
        writes.push(value.version); return target.putImmutable(bytes, suffix);
      };
      if (property === "writeMeetingStates") return async () => { throw new Error("A confirmation cannot rewrite exact-ID locators"); };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } });
    const later = "2026-10-16T14:00:00Z";
    assert.equal((await publishReaderEdgeArtifacts(null, metadata, { store: counted,
      checks: { composition: "held", freshChecks: {}, documentChecks: checks(later, reads) } })).status, "PUBLISHED");
    assert.deepEqual(reads, ["first"]);
    assert.equal(writes.length, 1);
    const after = (await store.readManifest())!.manifest;
    assert.deepEqual(after.scopes.map(scope => scope.key), before.scopes.map(scope => scope.key));
    assert.equal(JSON.stringify(after).includes("clerk.example.gov"), false, "the state manifest carries references, not document maps");
    const second = after.scopes.find(scope => scope.chunkKey === "second")!;
    const fetched: string[] = [];
    const reader = new Proxy(base, { get(target, property) {
      if (property === "readBytes") return async (key: string) => {
        assert.notEqual(key, second.documentChecks!.key); fetched.push(key); return target.readBytes(key);
      };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    } });
    const read = await readReaderEdgeMeetings({ store: reader, meetingId: rows[0]!.row.id, now: later,
      settings: meetingSettingsFromValues(), window: "HELD", fallback: async () => { throw new Error("The place artifact must answer"); } });
    assert.equal(read.kind, "PROMOTED");
    if (read.kind !== "PROMOTED") throw new Error("Missing place artifact");
    assert.equal(read.value.meetings[0]!.publishedDocuments![0]!.checkedAt, later);
    assert.equal(read.value.meetings[0]!.publishedDocuments![0]!.retrievedAt, checkedAt);
    assert.equal(read.value.meetings[0]!.provenance.collectedAt, meeting.provenance.collectedAt);
    assert.equal(fetched.length, 1);
    reads.length = 0;
    assert.equal((await publishReaderEdgeArtifacts(null, metadata, { store: counted,
      checks: { composition: "held", freshChecks: {}, documentChecks: checks(later, reads) } })).status, "CURRENT");
    assert.deepEqual(reads, []);
    assert.equal(writes.length, 1);
    const held = await store.readManifest();
    const raced: AsyncIterable<MeetingDocumentCheckPublication> = (async function* () { yield {
      chunkKey: "first", chunkVersion: "first:payload", version: "changed-during-read", read: async () => { throw new Error("MEETING_DOCUMENT_CHECKS_RACED"); },
    }; })();
    assert.equal((await publishReaderEdgeArtifacts(null, metadata, { store,
      checks: { composition: "held", freshChecks: {}, documentChecks: raced } })).status, "FAILED");
    assert.deepEqual(await store.readManifest(), held);
    async function* noChecks(): AsyncIterable<MeetingDocumentCheckPublication> {}
    assert.equal((await publishReaderEdgeArtifacts(null, metadata, { store: counted,
      checks: { composition: "held", freshChecks: {}, documentChecks: noChecks() } })).status, "PUBLISHED");
    assert.ok((await store.readManifest())!.manifest.scopes.every(scope => scope.documentChecks === undefined));
    assert.equal(writes.length, 1, "removing obsolete check refs never stores an empty sidecar");
  } finally { await rm(root, { recursive: true, force: true }); }
});
