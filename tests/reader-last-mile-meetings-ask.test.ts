import assert from "node:assert/strict";

import test from "node:test";

import { meetingDateInQuestion } from "../lib/ask/meeting-date.ts";

import { selectSitting } from "../lib/ask/select.ts";

import { meetingOutcomeEvidenceFor } from "../lib/ask/meeting-outcomes.ts";

import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { installPimaOutcomes } from "./helpers/reader-fixtures.ts";

await installRegistryAuthority();
const outcomes = await installPimaOutcomes();

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
  const sitting = outcomes.sittings.find((row) => row.agenda.length > 0 && row.outcomes.length > 0)!;
  const held = meetingOutcomeEvidenceFor({ bodyId: "ocd-division/country:us/state:az/county:pima#governing", meetingId: sitting.meetingId, startsAt: sitting.startsAt, question: "What was on the agenda?" });
  assert.ok(held.records.length > 0);
  assert.ok(held.records.every((record) => record.kind === "AGENDA_ITEM" && record.id.endsWith("#agenda")));
  assert.equal(held.denominators.structuredAgendaItemsForThatMeeting, held.records.length);
});
