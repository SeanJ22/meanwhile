import assert from "node:assert/strict";
import test from "node:test";
import { meetingKnowledgeAskProof } from "../scripts/lib/reader-ask-meeting-knowledge-proof.ts";
import { minutesSummaryEvidenceFor, commentAccessEvidenceFor, noticeSummaryEvidenceFor } from "../lib/ask/meeting-knowledge.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import { NOTICE_SUMMARIES } from "../lib/meetings/notice-summary.ts";

test("every held minutes summary and public-comment rule survives real Ask with exact source fields", async () => {
  const result = await meetingKnowledgeAskProof();
  assert.equal(result.summaryDenominator, 2);
  assert.equal(result.noticeDenominator, 1);
  assert.equal(result.accessDenominator, 18);
  assert.deepEqual(result.proofs.filter((proof) => proof.status !== "PROVEN").map((proof) => ({ nativeId: proof.nativeId, missing: proof.missing, unexpected: proof.unexpected })), []);
});

test("notice summaries require the current exact content hash and cannot answer an outcome question", () => {
  const snapshot = readSnapshot()!;
  const meetingId = NOTICE_SUMMARIES[0].meetingId;
  const meeting = snapshot.meetings.find((row) => row.id === meetingId)!;
  const document = snapshot.agendaDocuments!.find((row) => row.meetingId === meetingId)!;
  assert.equal(noticeSummaryEvidenceFor(meeting.bodyId!, meetingId, "What is in the meeting notice?").records.length, 1);
  assert.equal(noticeSummaryEvidenceFor(meeting.bodyId!, meetingId, "What did the board decide?").records.length, 0);
  assert.equal(noticeSummaryEvidenceFor("wrong-body", meetingId, "What is in the notice?").records.length, 0);
  const originalHash = document.contentHash;
  try {
    document.contentHash = "changed-source-content";
    assert.equal(noticeSummaryEvidenceFor(meeting.bodyId!, meetingId, "What is in the notice?").records.length, 0);
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
  assert.equal(minutesSummaryEvidenceFor(body, "legistar:pima:1822", "What happened?").records.length, 1);
  assert.equal(minutesSummaryEvidenceFor(body, "legistar:pima:1822", "How did its members vote?").records.length, 0);
  assert.equal(minutesSummaryEvidenceFor("wrong-body", "legistar:pima:1822", "What happened?").records.length, 0);
  assert.equal(minutesSummaryEvidenceFor(body, "iqm2:morriscountynj:2236", "What happened?").records.length, 0);
});

test("standing comment rules require the exact body and division and never inherit a sibling policy", () => {
  const division = "ocd-division/country:us/state:az/place:tucson";
  assert.ok(commentAccessEvidenceFor(`${division}#planning-commission`, division, "Planning Commission").records.length > 0);
  assert.equal(commentAccessEvidenceFor(`${division}#unheld-advisory-body`, division, "Planning Commission").records.length, 0);
  assert.equal(commentAccessEvidenceFor(`${division}#planning-commission`, null, "Planning Commission").records.length, 0);
});
