import assert from "node:assert/strict";
import test from "node:test";
import { meetingsAskProof } from "../scripts/lib/reader-ask-meetings-proof.ts";
import { meetingDateInQuestion } from "../lib/ask/meeting-date.ts";
import { selectSitting } from "../lib/ask/select.ts";
import { meetingOutcomeEvidenceFor } from "../lib/ask/meeting-outcomes.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

test("all held meetings and outcome sittings survive real dated Ask routes with exact record counts and provenance", async () => {
  const snapshot = readSnapshot();
  assert.ok(snapshot);
  const proof = await meetingsAskProof({ snapshot });
  assert.equal(proof.unbound.length, 0);
  assert.deepEqual(proof.proofs.filter((row) => row.status !== "PROVEN").map((row) => ({ request: row.request, missing: row.missing, unexpected: row.unexpected })), []);
  const meetings = new Set(proof.proofs.filter((row) => row.family === "meetings-and-agendas").flatMap((row) => row.returnedRecords.filter((record) => record.kind === "MEETING").map((record) => record.id)));
  assert.equal(meetings.size, proof.meetingDenominator);
  assert.equal(new Set(proof.proofs.filter((row) => row.family === "meeting-outcomes").flatMap((row) => row.meetingIds)).size, proof.outcomeSittingDenominator);
  assert.equal(proof.proofs.reduce((n, row) => n + row.returnedRecords.filter((record) => record.kind === "MEETING_ACTION").length, 0), 525);
  assert.equal(proof.proofs.reduce((n, row) => n + row.returnedRecords.filter((record) => record.kind === "MEETING_MEMBER_VOTE").length, 0), 2083);
  assert.equal(proof.proofs.filter((row) => row.family === "meeting-outcomes").reduce((n, row) => n + row.returnedRecords.filter((record) => record.kind === "AGENDA_ITEM").length, 0), 1360);
});

test("invalid, multiple and unheld dates never select a different sitting", () => {
  for (const text of ["February 31, 2026", "2026-02-31", "2026-08-01 and 2026-08-02"]) assert.equal(meetingDateInQuestion(text)?.date, null);
  for (const text of ["May 12, 2026", "May 12th 2026", "12 May 2026", "2026-05-12"]) assert.equal(meetingDateInQuestion(text)?.date, "2026-05-12");
  const held = [{ startsAt: "2026-09-09T02:00:00Z", timeZone: "America/Phoenix" }];
  assert.equal(selectSitting("DATE", held, Date.now(), "2026-09-08"), held[0]);
  assert.equal(selectSitting("DATE", held, Date.now(), "2026-09-09"), null);
  assert.equal(selectSitting("DATE", held, Date.now(), null), null);
});

test("a structured agenda never supplies an action or member vote, and no structured sitting does not erase another held agenda", () => {
  const absent = meetingOutcomeEvidenceFor({ bodyId: "unheld-body", meetingId: "unheld-meeting", startsAt: "2026-09-04T12:00:00Z", question: "What was on the agenda?" });
  assert.deepEqual(absent.records, []);
  assert.deepEqual(absent.gaps, []);
  const held = meetingOutcomeEvidenceFor({ bodyId: "ocd-division/country:us/state:az/county:pima#governing", meetingId: "legistar:pima:1825", startsAt: "2026-07-07T09:00:00-07:00", question: "What was on the agenda?" });
  assert.ok(held.records.length > 0);
  assert.ok(held.records.every((record) => record.kind === "AGENDA_ITEM" && record.id.endsWith("#agenda")));
  assert.equal(held.denominators.structuredAgendaItemsForThatMeeting, held.records.length);
});
