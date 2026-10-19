import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "./helpers/playbooks.ts";
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
import type { Meeting } from "../lib/sources/types.ts";
import { installRegistryAuthority, registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { withRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { ambiguousListingPairs, dateOnlyListings, recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";
import { localDate } from "../lib/ask/meeting-time.ts";
import { requireMeetingsProjection } from "../lib/meetings/snapshot.ts";
import { publishRecordedEdge } from "./helpers/reader-edge-meetings.ts";
import { readEveryBody } from "./helpers/meeting-body-national.ts";
import { isAnotherBodysNoticePage } from "../lib/meetings/notice-pages.ts";
import { readSelectedMeetingOutcomes } from "../lib/reader/outcomes.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";
import { installCanonicalEntries } from "./helpers/canonical-reader-fixtures.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.DATABASE_URL;
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
await installRegistryAuthority();
// The recorded 85701 calendar, three of its Tucson Unified sittings each listed a second time, and three date-only listings.
const { meetings: listed, pairs } = ambiguousListingPairs(3);
// A copied listing cannot cite its original's attribution rows: a promoted snapshot's rows each cite only themselves.
const ownRows = (rows: readonly Meeting[]) => rows.map(({ actingBodies: _acting, ...row }) => row as Meeting);
const installed = recordedMeetingsSnapshot(ownRows([...listed, ...dateOnlyListings(3)]));
// Each recorded sitting is promoted through the partition that owns it, then published as its body's record on the edge the routes read.
const PUBLISHED_AT = "2026-09-25T12:00:00.000Z";
const { store: meetingStore, edge, promoted } = await publishRecordedEdge(installed.meetings, installed.agendaDocuments, PUBLISHED_AT);
// What a reader is served from those published bodies (each row stamped with its door).
const snapshot = requireMeetingsProjection((await readEveryBody(meetingStore, PUBLISHED_AT, { edge })).read);
assert.ok(promoted.length >= 6, "the Tucson Unified calendar and its listings are held by a partition");
const headers = { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-listing-identity-control" };

// Each Node test runs in its own async context, just as each reader request does.
const registryTest = (name: string, read: () => void | Promise<void>) => test(name, () =>
  withRegistryRuntimeProjection(registryTransferImport().projection.payload, ["AZ"], read));

registryTest("each date with two equal calendar listings retains both, with an unresolved distinct-meeting count, in real Ask", async () => {
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
      const answer = await agendaPOST(new Request("https://wtp.test/api/ask/agenda", { method: "POST", headers, body: JSON.stringify({ meetingId: id, bodyId: held[0].bodyId }) }));
      const agenda = await answer.json();
      assert.equal(answer.status, 200);
      assert.equal(agenda.meetingId, id);
      assert.deepEqual(agenda.listingIdentity.groups, [group]);
      const documents = snapshot.agendaDocuments?.filter(document => document.meetingId === id) ?? [];
      assert.equal(agenda.documentsHeld, documents.length, "Equal listing fields never copy a sibling's attachment");
      if (!documents.length) { assert.deepEqual(agenda.items, []); assert.equal(agenda.documentUrl, null); }
      const readerResponse = await agendaGET(new Request(`https://wtp.test/api/agenda?meetingId=${encodeURIComponent(id)}&bodyId=${encodeURIComponent(held[0].bodyId!)}`));
      const reader = await readerResponse.json();
      assert.equal(readerResponse.status, 200, JSON.stringify(reader));
      assert.equal(reader.supportingHoldingStatus, "HELD");
      assert.deepEqual(reader.unavailableAuthorities, []);
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

registryTest("the socket reader selects proved outcome rows from the canonical fixture without a network fallback", async () => {
  const source = JSON.parse(readFileSync(new URL("./fixtures/legistar-outcome-store/data/outcomes/legistar-outcomes.json", import.meta.url), "utf8")) as OutcomeSnapshot;
  const sitting = source.sittings.find(row => row.agenda.length && row.rollCalls.length)!;
  installCanonicalEntries([provenEdgeEntry({ recordClass: "MEETING_OUTCOME", scope: "US-AZ:fixture:listing-identity-outcomes",
    sourceId: "listing-identity-outcome-source", versionId: "listing-identity-outcomes", value: source })]);
  const selected = await readSelectedMeetingOutcomes(["AZ"], sitting.bodyId, [sitting.meetingId]);
  assert.deepEqual(selected.sittings, [sitting]);
  assert.deepEqual(selected.sittings[0].agenda, sitting.agenda);
  assert.deepEqual(selected.sittings[0].rollCalls, sitting.rollCalls);
});

registryTest("date-only listing identities remain date-only records without an invented shared time or multiplicity claim", () => {
  const dateOnly = installed.meetings.filter(meeting => meeting.startPrecision === "DAY");
  assert.equal(dateOnly.length, 3);
  const reading = meetingListingKnowledgeFor(installed.meetings, dateOnly.map(meeting => meeting.id)).readback;
  assert.equal(reading.sourceListingCount, dateOnly.length);
  assert.deepEqual(reading.groups, []);
  assert.deepEqual([...reading.unresolvedTimeSourceIds].sort(), dateOnly.map(meeting => meeting.id).sort());
});

registryTest("listing knowledge cannot borrow a summary or notice through equal body/time fields", () => {
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
