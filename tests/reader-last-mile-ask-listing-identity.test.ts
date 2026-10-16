import assert from "node:assert/strict";
import test, { after } from "./helpers/playbooks.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFileArtifactStore, scopedReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishReaderEdgeArtifacts } from "../lib/meetings/edge-serving.ts";
import { meetingPublication } from "./helpers/meeting-publication.ts";
import { POST } from "../app/api/ask/grounded/route.ts";
import { resetGroundedState } from "../lib/ask/grounded-state.ts";
import { POST as agendaPOST } from "../app/api/ask/agenda/route.ts";
import { GET as agendaGET } from "../app/api/agenda/route.ts";
import { canonicalBodyIdentity } from "../lib/ask/body-identity.ts";
import { meetingListingIdentity } from "../lib/meetings/listing-identity.ts";
import { meetingListingKnowledgeFor, minutesSummaryEvidenceFor, noticeSummaryEvidenceFor } from "../lib/ask/meeting-knowledge.ts";
import { MINUTES_SUMMARIES } from "../lib/meetings/minutes-summaries.ts";
import { NOTICE_SUMMARIES } from "../lib/meetings/notice-summary.ts";
import type { AskAnswerPayload } from "../lib/ask/answer.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { ambiguousListingPairs, dateOnlyListings, installMeetings, recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";
import { localDate } from "../lib/ask/meeting-time.ts";
import { readMeetingsProjection, requireMeetingsProjection } from "../lib/meetings/snapshot.ts";
import { isAnotherBodysNoticePage } from "../lib/meetings/notice-pages.ts";
import { recordPublisherAgendaObservation } from "../lib/ask/agenda-publication.ts";

delete process.env.ANTHROPIC_API_KEY;
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
await installRegistryAuthority();
// The recorded 85701 calendar, three of its Tucson Unified sittings each listed a second time, and three date-only listings.
const { meetings: listed, pairs } = ambiguousListingPairs(3);
const installed = recordedMeetingsSnapshot([...listed, ...dateOnlyListings(3)]);
installMeetings(installed.meetings, installed.agendaDocuments);
// What the reader composes from those promoted partitions (each row stamped with its door).
const snapshot = requireMeetingsProjection(await readMeetingsProjection({ state: "AZ" }));
const ambiguousIds = new Set(pairs.flatMap(pair => pair.map(meeting => meeting.id)));
const aliasTarget = snapshot.meetings.find(meeting => !ambiguousIds.has(meeting.id) &&
  snapshot.agendaDocuments.some(document => document.meetingId === meeting.id))!;
const alias = `${aliasTarget.id}:verified-alias`;
aliasTarget.mergedMeetingIds = [...(aliasTarget.mergedMeetingIds ?? []), alias];
const artifactPath = await mkdtemp(join(tmpdir(), "reader-listing-identity-"));
const previousArtifactPath = process.env.WTP_READER_EDGE_DIR;
process.env.WTP_READER_EDGE_DIR = artifactPath;
after(async () => {
  if (previousArtifactPath === undefined) delete process.env.WTP_READER_EDGE_DIR;
  else process.env.WTP_READER_EDGE_DIR = previousArtifactPath;
  await rm(artifactPath, { recursive: true, force: true });
});
assert.equal((await publishReaderEdgeArtifacts(meetingPublication(snapshot), {
  sourceThrough: snapshot.generatedAt, retrievedAt: snapshot.generatedAt, promotedThrough: snapshot.generatedAt,
}, { store: scopedReaderArtifactStore(new LocalFileArtifactStore(artifactPath), "AZ") })).status, "PUBLISHED");
const headers = { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-listing-identity-control" };

test("each date with two equal calendar listings retains both, with an unresolved distinct-meeting count, in real Ask", async () => {
  assert.equal(meetingListingIdentity(snapshot.meetings, canonicalBodyIdentity).groups.length, pairs.length);
  for (const pair of pairs) {
    const ids = pair.map(meeting => meeting.id);
    const held = snapshot.meetings.filter(meeting => ids.includes(meeting.id));
    const date = localDate(held[0]);
    assert.equal(held.length, 2, date);
    const body = canonicalBodyIdentity(held[0].bodyId)!;
    assert.ok(body);
    const group = meetingListingIdentity(held, canonicalBodyIdentity).groups[0];
    assert.ok(group, date);
    resetGroundedState();
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers,
      body: JSON.stringify({ question: `What is on this body's agenda on ${date}?`, surface: "MAP", ocdIds: [held[0].ocdId], activeSubjects: [{ id: body.bodyId, name: body.name, kind: "BODY", focused: true }] }) }));
    const payload = await response.json() as AskAnswerPayload;
    assert.equal(response.status, 200);
    assert.equal(payload.answer, null, "No model supplies the known answer");
    assert.equal(payload.subject?.id, body.bodyId);
    const records = payload.records.filter(record => record.kind === "MEETING");
    assert.deepEqual(records.map(record => record.id).sort(), ids.sort());
    for (const source of held) {
      const record = records.find(record => record.id === source.id)!;
      assert.equal(record.sourceUrl, source.provenance.sourceUrl);
      assert.equal(record.sourceOrg, source.provenance.sourceOrg);
      assert.equal(record.retrievedAt, source.provenance.collectedAt);
      assert.match(record.text, /^Calendar listing:/);
      assert.deepEqual(record.meetingListingIdentity, group);
    }
    assert.ok(payload.gaps.some(gap => gap.whose === "OURS" && gap.statement === group.reason));
    assert.equal(payload.denominators.calendarListingsThatLocalDay, 2);
    assert.equal(payload.denominators.uniqueMeetingCountUnresolvedGroups, 1);
    assert.equal(payload.denominators.sittingsThatLocalDay, undefined);
    assert.equal(payload.denominators.meetingsHeldForThisBody, undefined);
    assert.equal(payload.meetingListingIdentity?.sourceListingCount, 2);
    assert.equal(payload.meetingListingIdentity?.groups[0].uniqueMeetingCount, null);
    assert.equal(payload.trace.retrieval.recordCount, payload.records.length);
    assert.deepEqual(payload.meetings.map(meeting => meeting.id).sort(), ids.sort());
    for (const id of ids) {
      const answer = await agendaPOST(new Request("https://wtp.test/api/ask/agenda", { method: "POST", headers, body: JSON.stringify({ meetingId: id }) }));
      const agenda = await answer.json();
      assert.equal(answer.status, 200);
      assert.equal(agenda.meetingId, id);
      assert.deepEqual(agenda.listingIdentity.groups, [group]);
      const documents = snapshot.agendaDocuments?.filter(document => document.meetingId === id) ?? [];
      assert.equal(agenda.documentsHeld, documents.length, "Equal listing fields never copy a sibling's attachment");
      if (!documents.length) { assert.deepEqual(agenda.items, []); assert.equal(agenda.documentUrl, null); }
      const readerResponse = await agendaGET(new Request(`https://wtp.test/api/agenda?meetingId=${encodeURIComponent(id)}`));
      const reader = await readerResponse.json();
      assert.equal(readerResponse.status, 200);
      assert.equal(reader.meetingId, id);
      assert.deepEqual(reader.listingIdentity.groups, [group]);
      // Another body's notice page held for this sitting is never shown for it;
      // it is stated in the accounting instead.
      const sitting = held.find(meeting => meeting.id === id)!;
      const lent = documents.filter(document =>
        isAnotherBodysNoticePage(document.documentUrl, { bodyId: sitting.bodyId, publisher: document.sourceOrg }));
      assert.deepEqual(reader.documents.map((document: { id: string }) => document.id).sort(),
        documents.filter(document => !lent.includes(document)).map(document => document.id).sort());
      assert.equal(reader.documentAccounting.anotherBodysPagesSetAside, lent.length);
    }
  }
});

test("date-only listing identities remain date-only records without an invented shared time or multiplicity claim", () => {
  const dateOnly = installed.meetings.filter(meeting => meeting.startPrecision === "DAY");
  assert.equal(dateOnly.length, 3);
  const reading = meetingListingKnowledgeFor(installed.meetings, dateOnly.map(meeting => meeting.id)).readback;
  assert.equal(reading.sourceListingCount, dateOnly.length);
  assert.deepEqual(reading.groups, []);
  assert.deepEqual([...reading.unresolvedTimeSourceIds].sort(), dateOnly.map(meeting => meeting.id).sort());
});

test("a proved listing alias keeps the selected sitting's documents, publication observation and identity", async () => {
  recordPublisherAgendaObservation({ meetingId: aliasTarget.id, provenance: "FIRST_PARTY_PUBLISHER", report: "AVAILABLE",
    observedAt: new Date().toISOString(), observedUrl: aliasTarget.provenance.sourceUrl,
    sourceOrg: aliasTarget.provenance.sourceOrg, evidenceQuote: "Agenda available" });
  const response = await agendaGET(new Request(`https://wtp.test/api/agenda?meetingId=${encodeURIComponent(alias)}`));
  const canonical = await agendaGET(new Request(`https://wtp.test/api/agenda?meetingId=${encodeURIComponent(aliasTarget.id)}`));
  const reading = await response.json(), expected = await canonical.json();
  assert.equal(response.status, 200);
  assert.equal(reading.meetingId, alias);
  assert.equal(reading.publication.publication, "REPORTS_AVAILABLE");
  assert.deepEqual(reading.documents, expected.documents);
  assert.deepEqual(reading.listingIdentity, expected.listingIdentity);
  assert.equal(reading.listingIdentity.sourceListingCount, 1);
  const asked = await agendaPOST(new Request("https://wtp.test/api/ask/agenda", { method: "POST", headers, body: JSON.stringify({ meetingId: alias }) }));
  const answer = await asked.json();
  assert.equal(asked.status, 200);
  assert.equal(answer.meetingId, alias);
  assert.deepEqual(answer.listingIdentity, expected.listingIdentity);
  assert.equal(answer.documentsHeld, snapshot.agendaDocuments.filter(document => document.meetingId === aliasTarget.id).length);
});

test("listing knowledge cannot borrow a summary or notice through equal body/time fields", () => {
  for (const [id, question, readEvidence] of [
    [MINUTES_SUMMARIES[0].meetingId, "What happened?", minutesSummaryEvidenceFor],
    [NOTICE_SUMMARIES[0].meetingId, "What is in the notice?", noticeSummaryEvidenceFor],
  ] as const) {
    const source = installed.meetings.find(meeting => meeting.id === id)!;
    assert.ok(source);
    const unrelated = { ...source, id: `${source.id}:distinct-publisher-listing` };
    const planted = { ...installed, meetings: [source, unrelated] };
    assert.equal(readEvidence(source.bodyId!, unrelated.id, question, () => planted).records.length, 0);
    assert.equal(meetingListingKnowledgeFor(planted.meetings, [unrelated.id]).readback.sourceListingCount, 2);
    const original = readEvidence(source.bodyId!, source.id, question, () => planted);
    assert.equal(original.records.length, 1, "The original exact source summary remains available");
    assert.ok(original.gaps.some(gap => gap.whose === "OURS"));
  }
  assert.equal(meetingListingKnowledgeFor(installed.meetings, ["unheld-listing-id"]).readback.sourceListingCount, 0);
});
