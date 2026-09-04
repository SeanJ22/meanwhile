import assert from "node:assert/strict";
import test from "node:test";
import { meetingsAskProof } from "../scripts/lib/reader-ask-meetings-proof.ts";
import { meetingDateInQuestion } from "../lib/ask/meeting-date.ts";
import { selectSitting } from "../lib/ask/select.ts";

test("all held meetings and outcome sittings survive real dated Ask routes with exact record counts and provenance", async () => {
  const proof = await meetingsAskProof();
  assert.equal(proof.unbound.length, 0);
  assert.deepEqual(proof.proofs.filter((row) => row.status !== "PROVEN").map((row) => ({ request: row.request, missing: row.missing, unexpected: row.unexpected })), []);
  const meetings = new Set(proof.proofs.filter((row) => row.family === "meetings-and-agendas").flatMap((row) => row.returnedRecords.filter((record) => record.kind === "MEETING").map((record) => record.id)));
  assert.equal(meetings.size, proof.meetingDenominator);
  assert.equal(new Set(proof.proofs.filter((row) => row.family === "meeting-outcomes").flatMap((row) => row.meetingIds)).size, proof.outcomeSittingDenominator);
  assert.equal(proof.proofs.reduce((n, row) => n + row.returnedRecords.filter((record) => record.kind === "MEETING_ACTION").length, 0), 525);
  assert.equal(proof.proofs.reduce((n, row) => n + row.returnedRecords.filter((record) => record.kind === "MEETING_MEMBER_VOTE").length, 0), 2083);
});

test("invalid, multiple and unheld dates never select a different sitting", () => {
  for (const text of ["February 31, 2026", "2026-02-31", "2026-08-01 and 2026-08-02"]) assert.equal(meetingDateInQuestion(text)?.date, null);
  for (const text of ["May 12, 2026", "May 12th 2026", "12 May 2026", "2026-05-12"]) assert.equal(meetingDateInQuestion(text)?.date, "2026-05-12");
  const held = [{ startsAt: "2026-09-09T02:00:00Z", timeZone: "America/Phoenix" }];
  assert.equal(selectSitting("DATE", held, Date.now(), "2026-09-08"), held[0]);
  assert.equal(selectSitting("DATE", held, Date.now(), "2026-09-09"), null);
  assert.equal(selectSitting("DATE", held, Date.now(), null), null);
});
