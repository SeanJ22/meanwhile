import assert from "node:assert/strict";

import test from "node:test";

import { minutesSummaryEvidenceFor, commentAccessEvidenceFor, noticeSummaryEvidenceFor } from "../lib/ask/meeting-knowledge.ts";

import { NOTICE_SUMMARIES } from "../lib/meetings/notice-summary.ts";

import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

import { recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";

await installRegistryAuthority();

/** The recorded 85701 meetings and the notice document versions their summaries cite. */
const readSnapshot = () => recordedMeetingsSnapshot();

test("notice summaries require the current exact content hash and cannot answer an outcome question", () => {
  const snapshot = readSnapshot()!;
  const meetingId = NOTICE_SUMMARIES[0].meetingId;
  const meeting = snapshot.meetings.find((row) => row.id === meetingId)!;
  const document = snapshot.agendaDocuments!.find((row) => row.meetingId === meetingId)!;
  const read = () => snapshot;
  assert.equal(noticeSummaryEvidenceFor(meeting.bodyId!, meetingId, "What is in the meeting notice?", read).records.length, 1);
  assert.equal(noticeSummaryEvidenceFor(meeting.bodyId!, meetingId, "What did the board decide?", read).records.length, 0);
  assert.equal(noticeSummaryEvidenceFor("wrong-body", meetingId, "What is in the notice?", read).records.length, 0);
  const originalHash = document.contentHash;
  try {
    document.contentHash = "changed-source-content";
    assert.equal(noticeSummaryEvidenceFor(meeting.bodyId!, meetingId, "What is in the notice?", read).records.length, 0);
  } finally { document.contentHash = originalHash; }
});

test("missing or unreadable summary identity holdings stay explicit OURS gaps", () => {
  for (const read of [() => null, () => { throw new Error("unreadable holding"); }]) {
    const minutes = minutesSummaryEvidenceFor("ocd-division/country:us/state:az/county:pima#governing", "legistar:pima:1822", "What happened?", read);
    const notice = noticeSummaryEvidenceFor("unused-body", NOTICE_SUMMARIES[0].meetingId, "What is in the notice?", read);
    for (const result of [minutes, notice]) {
      assert.equal(result.records.length, 0);
      assert.equal(result.gaps.length, 1);
      assert.equal(result.gaps[0].whose, "OURS");
    }
  }
});

test("minutes paraphrases never attach to another body or supply a member roll call", () => {
  const body = "ocd-division/country:us/state:az/county:pima#governing";
  const snapshot = readSnapshot()!;
  const read = () => snapshot;
  assert.equal(minutesSummaryEvidenceFor(body, "legistar:pima:1822", "What happened?", read).records.length, 1);
  assert.equal(minutesSummaryEvidenceFor(body, "legistar:pima:1822", "How did its members vote?", read).records.length, 0);
  assert.equal(minutesSummaryEvidenceFor("wrong-body", "legistar:pima:1822", "What happened?", read).records.length, 0);
  assert.equal(minutesSummaryEvidenceFor(body, "iqm2:morriscountynj:2236", "What happened?", read).records.length, 0);
});

test("standing comment rules require the exact body and division and never inherit a sibling policy", () => {
  const division = "ocd-division/country:us/state:az/place:tucson";
  assert.ok(commentAccessEvidenceFor(`${division}#planning-commission`, division, "Planning Commission").records.length > 0);
  assert.equal(commentAccessEvidenceFor(`${division}#unheld-advisory-body`, division, "Planning Commission").records.length, 0);
  assert.equal(commentAccessEvidenceFor(`${division}#planning-commission`, null, "Planning Commission").records.length, 0);
});
