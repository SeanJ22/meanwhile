import assert from "node:assert/strict";
import test from "node:test";

import { PIMA_EVENTS_TEXT, pimaArtifact } from "./pima-fact-fixtures.ts";

import { parseLegistarEvents, PARSER_VERSION } from "../lib/control-plane/workers/parser.ts";
import type { LegacyCivicExtractionContract, ParserWorkerInput, WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import {
  agendaFactKey,
  bridgeMeetingFacts,
  factAgreementIn,
  meetingTimeFactKey,
  normalizeFactsFromBytes,
  type MeetingFact,
} from "../lib/control-plane/promotion/meeting-facts.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";

/**
 * Held Legistar bytes run through the parser and then the fact bridge, which hands them to the canonical Legistar
 * adapter and cross-checks every scalar against the extraction. A CivicClerk tenant with no wiring row yields no
 * fact and a named refusal.
 */

const TEXT = PIMA_EVENTS_TEXT;
const artifact = pimaArtifact;
const HASH = contentHash(TEXT);
const NOW = "2026-09-06T12:00:00.000Z";
const CONTRACT: LegacyCivicExtractionContract = {
  recordClass: "LEGISTAR_EVENTS", schemaVersion: 1,
  subjectId: "ocd-division/country:us/state:az/county:pima#governing",
  sourceBodyId: 138, sourceBodyName: "Board of Supervisors", publisherSlug: "pima",
  requiredFields: ["EventId", "EventBodyId", "EventBodyName", "EventDate"],
  completenessScope: "The 18 Event rows in the already-held capture; no claim about all future meetings.",
  expectedSourceDate: null,
};

function parserRecord(text = TEXT, contract: LegacyCivicExtractionContract = CONTRACT, art = artifact(text)): WorkerResultRecord {
  const input: ParserWorkerInput = {
    attemptId: "at-parser-1",
    worker: { role: "PARSER", provider: "deterministic", version: PARSER_VERSION, instance: "parser-1" },
    evidence: { artifactId: art.artifactId, contentHash: art.contentHash, text, acquiredByAttemptId: art.attemptId,
      canonicalUrl: art.canonicalUrl, retrievedAt: art.recordedAt, sourceId: "legistar", methodRouteId: "LEGISTAR_WEBAPI_EVENTS" },
    contract,
  };
  const result = parseLegistarEvents(input);
  return {
    id: "wr-parser-1", schemaVersion: 1, workItemId: art.workItemId, routeTaskId: "rt-parser-1", attemptId: "at-parser-1",
    worker: input.worker, grant: {} as never, methodVersion: 72, policyVersion: "test", startedAt: NOW, endedAt: NOW,
    executionMode: "DETERMINISTIC", cost: {} as never, usage: {} as never, inputArtifactIds: [art.artifactId], inputResultIds: [],
    semanticHash: "x", result,
    completion: { closedAttempt: {} as never, completedTask: { workerTask: { contract } } as never, taskRevision: 1, attemptRevision: 1 },
  };
}

test("PRDY-2: real Pima bytes become meeting-time and agenda facts through the canonical adapter, cross-checked against the validated extraction", () => {
  const parser = parserRecord();
  assert.equal(parser.result.verdict, "EXTRACTED");
  const bridge = bridgeMeetingFacts({ parser, validator: null, auditor: null, artifact: artifact(), text: TEXT, now: NOW });
  assert.equal(bridge.refusals.length, 0, JSON.stringify(bridge.refusals));
  assert.equal(bridge.source?.considered, 18);
  const times = bridge.facts.filter((f) => f.recordClass === "meeting-times");
  const agendas = bridge.facts.filter((f) => f.recordClass === "agendas");
  assert.equal(times.length, 18, "every held row has a venue or an honest online label, so every row is a meeting-time fact");
  assert.equal(agendas.length, 18, "every held row states an EventAgendaFile, so every row is also an agenda fact");

  const study = times.find((f) => f.meetingId === "legistar:pima:1801")!;
  assert.equal(study.body.bodyId, "ocd-division/country:us/state:az/county:pima#governing");
  assert.equal(study.body.ocdId, "ocd-division/country:us/state:az/county:pima");
  assert.equal(study.body.resolvedBy, "LEGISTAR_CLIENT_REGISTRY");
  assert.equal(study.body.bodyName, "Board of Supervisors");
  assert.equal(study.time.startsAt, "2026-05-12T13:00:00-07:00", "1:00 PM Phoenix wall clock, through the adapter's own zone path");
  assert.equal(study.time.instant, "2026-05-12T20:00:00.000Z");
  assert.equal(study.time.timeZone, "America/Phoenix");
  assert.equal(study.time.precision, "MINUTE");
  assert.equal(study.time.sourceWallClock, "1:00 PM");
  assert.equal(study.time.endsAt, null);
  assert.equal(study.applicableAt, study.time.instant);
  assert.equal(study.observedAt, "2026-09-05T18:00:00.000Z");
  assert.equal(study.status, "CONCLUDED");
  assert.equal(study.factKey, meetingTimeFactKey(study.meeting));
  assert.equal(study.meeting.id, "legistar:pima:1801");
  assert.equal(study.meeting.bodyId, study.body.bodyId);
  assert.equal(study.meeting.location?.name, "Pima County Administration Building, Board of Supervisors Hearing Room");
  assert.equal(study.meeting.provenance.sourceUrl, "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1801&GID=243&G=7B470E9E-E35C-4698-8FA6-D778FB28F394");
  assert.equal(study.meeting.provenance.sourceOrg, "Pima County Clerk of the Board");
  assert.equal(study.meeting.provenance.collectedAt, "2026-09-05T18:00:00.000Z");
  assert.equal(study.source.sourceKey, "legistar:pima");
  assert.equal(study.source.artifactId, "ar-pima-events");
  assert.equal(study.source.contentHash, HASH);
  assert.equal(study.chain.parserResultId, "wr-parser-1");
  assert.equal(study.chain.extractedRecordId, "legistar:pima:1801");
  assert.ok(study.chain.evidenceSpanIds.length > 5, "the fact names the evidence spans the validated record rests on");
  assert.equal(study.chain.sourceRecordClass, "LEGISTAR_EVENTS");

  const virtual = times.find((f) => f.meetingId === "legistar:pima:1848")!;
  assert.equal(virtual.meeting.location, null, "a virtual sitting is kept with no place, never pinned to a guessed building");
  assert.equal(virtual.meeting.online?.label, "Virtual Meeting");

  const agenda = agendas.find((f) => f.meetingId === "legistar:pima:1801")!;
  assert.equal(agenda.recordClass, "agendas");
  if (agenda.recordClass !== "agendas") return;
  assert.equal(agenda.agenda.documentUrl, "https://legistar.granicus.com/pima/meetings/2026/5/1801_A_Board_of_Supervisors_26-05-12_Online_Agenda.pdf");
  assert.equal(agenda.agenda.observedHow, "OBSERVED_FIELD");
  assert.equal(agenda.agenda.items, null);
  assert.equal(agenda.agenda.itemsExposed, false);
  assert.equal(agenda.agenda.document, null);
  assert.equal(agenda.factKey, agendaFactKey("legistar:pima:1801", agenda.agenda.documentUrl));
  assert.notEqual(agenda.factKey, study.factKey);
});

test("PRDY-2: a URL inventory class, an ambiguous extraction, and mismatched bytes are refused by name — nothing is renamed into a meeting", () => {
  const parser = parserRecord();
  const inventory: WorkerResultRecord = { ...parser, completion: { ...parser.completion, completedTask: { workerTask: { contract: { schemaVersion: 2, recordClass: "OFFICIAL_MEETING_DOCUMENT_INVENTORY" } } } as never } };
  const refusedClass = bridgeMeetingFacts({ parser: inventory, validator: null, auditor: null, artifact: artifact(), text: TEXT, now: NOW });
  assert.equal(refusedClass.facts.length, 0);
  assert.equal(refusedClass.refusals[0].code, "RECORD_CLASS_NOT_A_MEETING_FACT");
  assert.match(refusedClass.refusals[0].detail, /OFFICIAL_MEETING_DOCUMENT_INVENTORY/);

  const tampered = TEXT.replace("\"EventTime\": \"1:00 PM\"", "\"EventTime\": \"2:00 PM\"");
  assert.notEqual(tampered, TEXT);
  const bytes = bridgeMeetingFacts({ parser, validator: null, auditor: null, artifact: artifact(), text: tampered, now: NOW });
  assert.equal(bytes.facts.length, 0);
  assert.equal(bytes.refusals[0].code, "ARTIFACT_BYTES_MISMATCH");

  const ambiguous: WorkerResultRecord = { ...parser, result: { ...parser.result, verdict: "AMBIGUOUS", warnings: [{ code: "DUPLICATE_SOURCE_RECORD_ID", detail: "seeded", severity: "WARNING" }] } as never };
  const notClean = bridgeMeetingFacts({ parser: ambiguous, validator: null, auditor: null, artifact: artifact(), text: TEXT, now: NOW });
  assert.equal(notClean.facts.length, 0);
  assert.equal(notClean.refusals[0].code, "EXTRACTION_NOT_CLEAN");
});

/* An unknown venue never suppresses a meeting: the row is a fact with no place and the county's own words as its venue gap. */
test("PRDY-2: a row the canonical adapter drops is a refusal with the adapter's own accounting, and an unknown venue is a fact with its gap named, never a guessed venue", () => {
  const rows = JSON.parse(TEXT) as Record<string, unknown>[];
  rows[0] = { ...rows[0], EventLocation: "Somewhere the venue table has never heard of" };
  rows[1] = { ...rows[1], EventTime: null };
  const text = JSON.stringify(rows);
  const parser = parserRecord(text, CONTRACT, artifact(text));
  const bridge = bridgeMeetingFacts({ parser, validator: null, auditor: null, artifact: artifact(text), text, now: NOW });
  const dropped = bridge.refusals.filter((r) => r.code === "NORMALIZER_DROPPED").map((r) => r.recordId).sort();
  assert.deepEqual(dropped, ["legistar:pima:1802"]);
  assert.match(bridge.refusals[0].detail, /unknownVenue 1, unplaceableInTime 1/);
  const times = bridge.facts.filter((f) => f.recordClass === "meeting-times");
  assert.equal(times.length, 17);
  const unplaced = times.find((f) => f.meetingId === "legistar:pima:1801")!;
  assert.equal(unplaced.meeting.location, null, "never a guessed venue");
  assert.equal(unplaced.meeting.online, undefined);
  assert.deepEqual(unplaced.meeting.venueGap, {
    kind: "STATED_NOT_PLACED",
    publishedText: "Somewhere the venue table has never heard of",
    publisher: "Pima County Clerk of the Board",
  });
});

const AVONDALE_CONTRACT: LegacyCivicExtractionContract = {
  recordClass: "CIVICCLERK_EVENTS", schemaVersion: 1, subjectId: "az:city:city-of-avondale", sourceBodyId: null, sourceBodyName: null,
  publisherSlug: "avondaleaz", requiredFields: ["id", "eventName", "startDateTime", "eventDate", "categoryId", "eventCategoryName", "isPublished"],
  completenessScope: "All scalar Event rows in this immutable OData response.", expectedSourceDate: null,
};
const AVONDALE_TEXT = JSON.stringify({ "@odata.context": "https://avondaleaz.api.civicclerk.com/v1/$metadata#Events", value: [
  { id: 1404, eventName: "City Council Meeting", eventDate: "2027-12-06T19:00:00", startDateTime: "2027-12-06T19:00:00", categoryId: 4, eventCategoryName: "City Council", isPublished: true, hasAgenda: false, isDeleted: false },
] });
const AVONDALE_ARTIFACT = artifact(AVONDALE_TEXT, { artifactId: "ar-avondale", canonicalUrl: "https://avondaleaz.api.civicclerk.com/v1/Events?$top=5" });

test("PRDY-2: a CivicClerk tenant with no wiring row (the live Avondale shape) yields no fact and BODY_IDENTITY_UNRESOLVED", () => {
  const parser = parserRecord(AVONDALE_TEXT, AVONDALE_CONTRACT, AVONDALE_ARTIFACT);
  assert.equal(parser.result.verdict, "EXTRACTED", JSON.stringify(parser.result));
  const bridge = bridgeMeetingFacts({ parser, validator: null, auditor: null, artifact: AVONDALE_ARTIFACT, text: AVONDALE_TEXT, now: NOW, wiring: [] });
  assert.equal(bridge.facts.length, 0);
  assert.deepEqual(bridge.refusals.map((r) => r.code), ["BODY_IDENTITY_UNRESOLVED"]);
  assert.match(bridge.refusals[0].detail, /avondaleaz/);
});

/* A row with no venue is a fact with the portal's own silence (NOT_STATED_BY_PUBLISHER) as its venue gap. */
test("PRDY-2: with a wiring row the CivicClerk adapter decides — no venue on the row is a fact with the publisher's gap named, and a placed row is a fact whose agenda link is the adapter's own derivation", () => {
  const wiring: BodySourceWiring = {
    bodyId: "ocd-division/country:us/state:az/place:avondale#governing", ocdId: "ocd-division/country:us/state:az/place:avondale",
    agendaSourceType: "CIVICCLERK", jurisdiction: "Avondale, AZ", publishingOrg: "City of Avondale", timeZone: "America/Phoenix",
    config: { slug: "avondaleaz", apiBase: "https://avondaleaz.api.civicclerk.com", portalBase: "https://avondaleaz.portal.civicclerk.com" },
    verifiedAt: "2026-09-06",
  };
  const parser = parserRecord(AVONDALE_TEXT, AVONDALE_CONTRACT, AVONDALE_ARTIFACT);
  const noVenue = bridgeMeetingFacts({ parser, validator: null, auditor: null, artifact: AVONDALE_ARTIFACT, text: AVONDALE_TEXT, now: NOW, wiring: [wiring] });
  assert.deepEqual(noVenue.refusals, []);
  assert.equal(noVenue.facts.length, 1, "one meeting-time fact; the row states no agenda");
  const unplaced = noVenue.facts[0];
  assert.equal(unplaced.meetingId, "civicclerk:avondaleaz:1404");
  assert.equal(unplaced.meeting.location, null);
  assert.equal(unplaced.meeting.online, undefined);
  assert.deepEqual(unplaced.meeting.venueGap, { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher: "City of Avondale" });
  assert.equal(noVenue.source?.drops?.unknownVenue, 1, "still counted as the adapter's own accounting");

  const placed = JSON.stringify({ "@odata.context": "https://avondaleaz.api.civicclerk.com/v1/$metadata#Events", value: [
    { id: 1404, eventName: "City Council Meeting", eventDate: "2027-12-06T19:00:00", startDateTime: "2027-12-06T19:00:00", categoryId: 4, eventCategoryName: "City Council", isPublished: true, hasAgenda: true, isDeleted: false,
      eventLocation: { locationName: "Virtual Meeting" } },
  ] });
  const placedArtifact = artifact(placed, { artifactId: "ar-avondale-2", canonicalUrl: AVONDALE_ARTIFACT.canonicalUrl });
  const placedParser = parserRecord(placed, AVONDALE_CONTRACT, placedArtifact);
  const bridge = bridgeMeetingFacts({ parser: placedParser, validator: null, auditor: null, artifact: placedArtifact, text: placed, now: NOW, wiring: [wiring] });
  assert.deepEqual(bridge.refusals, []);
  assert.equal(bridge.facts.length, 2);
  const fact = bridge.facts.find((f) => f.recordClass === "meeting-times")!;
  assert.equal(fact.meetingId, "civicclerk:avondaleaz:1404");
  assert.equal(fact.time.startsAt, "2027-12-06T19:00:00-07:00");
  assert.equal(fact.body.bodyName, "City Council");
  assert.equal(fact.body.resolvedBy, "MEETING_DOORS");
  assert.equal(fact.status, "SCHEDULED");
  const agenda = bridge.facts.find((f): f is Extract<MeetingFact, { recordClass: "agendas" }> => f.recordClass === "agendas")!;
  assert.equal(agenda.agenda.documentUrl, "https://avondaleaz.portal.civicclerk.com/event/1404");
  assert.equal(agenda.agenda.observedHow, "CANONICAL_ADAPTER_DERIVATION");
});

test("PRDY-2: a later reading of the same source confirms the same fact, contradicts a changed one, and says nothing about a row it no longer carries", () => {
  const parser = parserRecord();
  const first = bridgeMeetingFacts({ parser, validator: null, auditor: null, artifact: artifact(), text: TEXT, now: NOW });
  const study = first.facts.find((f) => f.meetingId === "legistar:pima:1801" && f.recordClass === "meeting-times")!;
  const same = normalizeFactsFromBytes({ contract: CONTRACT, artifact: artifact(TEXT, { artifactId: "ar-second", attemptId: "at-acquire-2" }), text: TEXT, now: NOW });
  assert.deepEqual(factAgreementIn(study, same), { present: true, sameFact: true, detail: "the later reading states the same start 2026-05-12T13:00:00-07:00 America/Phoenix for legistar:pima:1801" });

  const rows = JSON.parse(TEXT) as Record<string, unknown>[];
  const changed = JSON.stringify(rows.map((r) => (r.EventId === 1801 ? { ...r, EventTime: "2:00 PM" } : r)));
  const moved = normalizeFactsFromBytes({ contract: CONTRACT, artifact: artifact(changed, { artifactId: "ar-third" }), text: changed, now: NOW });
  const conflict = factAgreementIn(study, moved);
  assert.equal(conflict.present, true);
  assert.equal(conflict.sameFact, false);
  assert.match(conflict.detail, /2026-05-12T14:00:00-07:00/);

  const without = normalizeFactsFromBytes({ contract: CONTRACT, artifact: artifact("[]", { artifactId: "ar-empty" }), text: JSON.stringify(rows.filter((r) => r.EventId !== 1801)), now: NOW });
  const absent = factAgreementIn(study, without);
  assert.equal(absent.present, false);
  assert.equal(absent.sameFact, false);
  assert.match(absent.detail, /not evidence the sitting was withdrawn/);
});
