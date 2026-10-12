import assert from "node:assert/strict";
import test from "node:test";

import { PIMA_EVENTS_TEXT, pimaArtifact } from "./pima-fact-fixtures.ts";

import { parseLegistarEvents, PARSER_VERSION } from "../lib/control-plane/workers/parser.ts";
import type { LegacyCivicExtractionContract, ParserResult, ParserWorkerInput } from "../lib/control-plane/workers/types.ts";
import { bridgeMeetingFacts, normalizeFactsFromBytes, type MeetingFact } from "../lib/control-plane/promotion/meeting-facts.ts";
import {
  controlsClean,
  measureFactControls,
  singleFactSnapshot,
  verifyMeetingFact,
  type FactVerificationInput,
} from "../lib/control-plane/promotion/fact-verification.ts";
import { VERIFICATION_CHECKS } from "../lib/control-plane/promotion/types.ts";
import { validateSnapshot } from "../lib/meetings/snapshot.ts";

/**
 * The five checks run and the controls are measured: every check has a positive control (the real capture passes all
 * five) and a seeded failure that names what it measured.
 */

const TEXT = PIMA_EVENTS_TEXT;
const artifact = pimaArtifact;
const NOW = "2026-09-06T12:00:00.000Z";
const CONTRACT: LegacyCivicExtractionContract = {
  recordClass: "LEGISTAR_EVENTS", schemaVersion: 1,
  subjectId: "ocd-division/country:us/state:az/county:pima#governing",
  sourceBodyId: 138, sourceBodyName: "Board of Supervisors", publisherSlug: "pima",
  requiredFields: ["EventId", "EventBodyId", "EventBodyName", "EventDate"],
  completenessScope: "The 18 Event rows in the already-held capture; no claim about all future meetings.",
  expectedSourceDate: null,
};
const REGISTRY_BODIES = new Set(["ocd-division/country:us/state:az/county:pima#governing"]);

function parse(text = TEXT, art = artifact(text)): ParserResult {
  const input: ParserWorkerInput = {
    attemptId: "at-parser-1", worker: { role: "PARSER", provider: "deterministic", version: PARSER_VERSION, instance: "parser-1" },
    evidence: { artifactId: art.artifactId, contentHash: art.contentHash, text, acquiredByAttemptId: art.attemptId, canonicalUrl: art.canonicalUrl, retrievedAt: art.recordedAt, sourceId: "legistar", methodRouteId: "LEGISTAR_WEBAPI_EVENTS" },
    contract: CONTRACT,
  };
  return parseLegistarEvents(input);
}

function facts(text = TEXT, art = artifact(text)): { parser: ParserResult; facts: readonly MeetingFact[] } {
  const parser = parse(text, art);
  const record = { id: "wr-parser-1", attemptId: "at-parser-1", result: parser, completion: { completedTask: { workerTask: { contract: CONTRACT } } } } as never;
  const bridge = bridgeMeetingFacts({ parser: record, validator: null, auditor: null, artifact: art, text, now: NOW });
  assert.deepEqual(bridge.refusals, []);
  return { parser, facts: bridge.facts };
}

function input(fact: MeetingFact, all: readonly MeetingFact[], parser: ParserResult, overrides: Partial<FactVerificationInput> = {}): FactVerificationInput {
  return { fact, parser, artifact: artifact(), text: TEXT, siblings: all, newerSameSource: null, registryBodyIds: REGISTRY_BODIES, now: NOW, ...overrides };
}

test("PRDY-3: the real Pima capture passes all five checks for a meeting-time fact and an agenda fact, each detail naming what was measured", () => {
  const { parser, facts: all } = facts();
  const time = all.find((f) => f.recordClass === "meeting-times" && f.meetingId === "legistar:pima:1801")!;
  const verified = verifyMeetingFact(input(time, all, parser));
  assert.equal(verified.passed, true, JSON.stringify(verified.checks, null, 1));
  assert.deepEqual(verified.checks.map((c) => c.name), [...VERIFICATION_CHECKS]);
  assert.ok(verified.checks.every((c) => c.result === "PASS" && c.detail.startsWith("fact-verification/1: ")));
  assert.match(verified.checks[0].detail, /7 resting field\(s\)/);
  assert.match(verified.checks[3].detail, /renders "1:00 PM MST" for the publisher's "1:00 PM"/);
  assert.match(verified.checks[4].detail, /18 of 18 rows read/);

  const agenda = all.find((f) => f.recordClass === "agendas" && f.meetingId === "legistar:pima:1801")!;
  const agendaVerified = verifyMeetingFact(input(agenda, all, parser));
  assert.equal(agendaVerified.passed, true, JSON.stringify(agendaVerified.checks, null, 1));
  assert.match(agendaVerified.checks[2].detail, /agenda OBSERVED_FIELD/);

  const online = all.find((f) => f.recordClass === "meeting-times" && f.meetingId === "legistar:pima:1848")!;
  const onlineVerified = verifyMeetingFact(input(online, all, parser));
  assert.equal(onlineVerified.passed, true, JSON.stringify(onlineVerified.checks, null, 1));
  assert.match(onlineVerified.checks[2].detail, /online: Virtual Meeting/);
  assert.doesNotThrow(() => validateSnapshot(singleFactSnapshot(online, NOW)));
});

test("PRDY-3: a tampered byte fails the span check by offset, a foreign body fails identity, a bad zone fails the class burdens, and a wrong clock fails rendering symmetry", () => {
  const { parser, facts: all } = facts();
  const time = all.find((f) => f.recordClass === "meeting-times" && f.meetingId === "legistar:pima:1801")!;

  const tampered = TEXT.replace("\"EventTime\": \"1:00 PM\"", "\"EventTime\": \"2:00 PM\"");
  const span = verifyMeetingFact(input(time, all, parser, { text: tampered }));
  assert.equal(span.checks[0].result, "FAIL");
  assert.match(span.checks[0].detail, /re-read bytes hash/);

  const foreign = verifyMeetingFact(input(time, all, parser, { registryBodyIds: new Set(["somebody-else"]) }));
  assert.equal(foreign.checks[1].result, "FAIL");
  assert.match(foreign.checks[1].detail, /is not a registry body/);

  const badZone: MeetingFact = { ...time, time: { ...time.time, timeZone: "Mars/Olympus" }, meeting: { ...time.meeting, timeZone: "Mars/Olympus" } };
  const zone = verifyMeetingFact(input(badZone, all, parser));
  assert.equal(zone.checks[2].result, "FAIL");
  assert.match(zone.checks[2].detail, /Mars\/Olympus/);

  const wrongClock: MeetingFact = { ...time, time: { ...time.time, sourceWallClock: "3:00 PM" } };
  const symmetry = verifyMeetingFact(input(wrongClock, all, parser));
  assert.equal(symmetry.checks[3].result, "FAIL");
  assert.match(symmetry.checks[3].detail, /the renderer prints "1:00 PM MST"; the publisher's clock is "3:00 PM"/);

  const duplicate = verifyMeetingFact(input(time, [...all, time], parser));
  assert.equal(duplicate.checks[1].result, "FAIL");
  assert.match(duplicate.checks[1].detail, /2 meeting-times facts in this artifact share meeting id/);
});

test("PRDY-3: a newer reading of the same source that moves the sitting supersedes the fact; one that merely no longer carries it does not", () => {
  const { parser, facts: all } = facts();
  const time = all.find((f) => f.recordClass === "meeting-times" && f.meetingId === "legistar:pima:1801")!;
  const rows = JSON.parse(TEXT) as Record<string, unknown>[];
  const moved = JSON.stringify(rows.map((r) => (r.EventId === 1801 ? { ...r, EventTime: "2:00 PM" } : r)));
  const newer = normalizeFactsFromBytes({ contract: CONTRACT, artifact: artifact(moved, { artifactId: "ar-newer", recordedAt: "2026-09-06T06:00:00.000Z" }), text: moved, now: NOW });
  const superseded = verifyMeetingFact(input(time, all, parser, { newerSameSource: newer }));
  assert.equal(superseded.checks[1].result, "FAIL");
  assert.match(superseded.checks[1].detail, /superseded/);

  const without = JSON.stringify(rows.filter((r) => r.EventId !== 1801));
  const dropped = normalizeFactsFromBytes({ contract: CONTRACT, artifact: artifact(without, { artifactId: "ar-without" }), text: without, now: NOW });
  const still = verifyMeetingFact(input(time, all, parser, { newerSameSource: dropped }));
  assert.equal(still.checks[1].result, "PASS");
  assert.match(still.checks[1].detail, /not evidence the sitting was withdrawn/);
});

test("PRDY-3: FALSE_ZERO refuses a partial capture and a row count the publisher contradicts", () => {
  const { parser, facts: all } = facts();
  const time = all[0];
  const partial = verifyMeetingFact(input(time, all, parser, { artifact: artifact(TEXT, { partial: true }) }));
  assert.equal(partial.checks[4].result, "FAIL");
  assert.match(partial.checks[4].detail, /partial capture/);
  const declared = verifyMeetingFact(input(time, all, { ...parser, declaredRowCount: 40 }));
  assert.equal(declared.checks[4].result, "FAIL");
  assert.match(declared.checks[4].detail, /declares 40 rows; 18 were read/);
});

test("PRDY-3: controls are planted from an independent parse and scored — clean on the real chain, a false absence when a record is dropped, a false presence when a null is filled", () => {
  const { parser } = facts();
  const clean = measureFactControls({ sourceId: "legistar", publisherSlug: "pima", artifact: artifact(), text: TEXT, parser, now: NOW });
  assert.ok(clean.score.knownPresentCount >= 18 * 5, `known-present controls ${clean.score.knownPresentCount}`);
  assert.ok(clean.score.knownAbsenceCount >= 1);
  assert.equal(clean.score.recall, 1);
  assert.equal(clean.score.falseAbsences, 0);
  assert.equal(clean.score.falsePresences, 0);
  assert.equal(clean.score.unobserved, 0);
  assert.equal(controlsClean(clean.score).clean, true);
  assert.match(clean.instrument, /planted from an independent parse/);

  const dropped: ParserResult = { ...parser, records: parser.records.filter((r) => r.id !== "legistar:pima:1801") };
  const falseAbsence = measureFactControls({ sourceId: "legistar", publisherSlug: "pima", artifact: artifact(), text: TEXT, parser: dropped, now: NOW });
  assert.ok(falseAbsence.score.falseAbsences >= 5);
  assert.ok(falseAbsence.score.recall !== null && falseAbsence.score.recall < 1);
  assert.equal(controlsClean(falseAbsence.score).clean, false);

  const filled: ParserResult = { ...parser, records: parser.records.map((r) => (r.id === "legistar:pima:1802" ? { ...r, fields: { ...r.fields, EventComment: "Study Session" } } : r)) };
  const falsePresence = measureFactControls({ sourceId: "legistar", publisherSlug: "pima", artifact: artifact(), text: TEXT, parser: filled, now: NOW });
  assert.equal(falsePresence.score.falsePresences, 1, "row 1802 publishes a null EventComment; a filled value is a false presence");
  assert.equal(controlsClean(falsePresence.score).clean, false);
});
