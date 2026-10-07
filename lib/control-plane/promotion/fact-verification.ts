/** A check that cannot be measured is a FAIL with the reason, never NOT_IMPLEMENTED. Controls are planted from an independent parse of the same bytes. */
import { formatMeetingTime, TIME_NOT_POSTED } from "../../map/format.ts";
import { snapshotCounts, validateSnapshot, type MeetingsSnapshot } from "../../meetings/snapshot.ts";
import type { Meeting } from "../../sources/types.ts";
import { contentHash } from "../ids.ts";
import type { ArtifactRecord } from "../repository/types.ts";
import type { ExtractedRecord, ParserResult } from "../workers/types.ts";
import { factAgreementIn, sourceRows, type MeetingFact, type NormalizedSource } from "./meeting-facts.ts";
import { VERIFICATION_CHECKS, type ControlFact, type ControlObservation, type ControlScore, type VerificationCheck, type VerificationCheckName } from "./types.ts";

export const FACT_VERIFICATION_VERSION = "fact-verification/1";

/** The row fields each fact class rests on, per source. */
const RESTING_FIELDS: Readonly<Record<"legistar" | "civicclerk", Readonly<Record<"meeting-times" | "agendas", readonly string[]>>>> = {
  legistar: {
    "meeting-times": ["EventId", "EventBodyId", "EventBodyName", "EventDate", "EventTime", "EventLocation", "EventInSiteURL"],
    agendas: ["EventId", "EventBodyName", "EventDate", "EventAgendaFile"],
  },
  civicclerk: {
    "meeting-times": ["id", "eventName", "startDateTime", "eventDate", "eventCategoryName"],
    agendas: ["id", "eventName", "startDateTime", "hasAgenda"],
  },
};

export interface FactVerificationInput {
  readonly fact: MeetingFact;
  readonly parser: ParserResult;
  readonly artifact: ArtifactRecord;
  /** The immutable bytes, re-read from the vault. */
  readonly text: string;
  /** Every fact bridged from the same artifact, this one included. */
  readonly siblings: readonly MeetingFact[];
  /** The newest reading of the same source recorded AFTER this artifact, when one exists. */
  readonly newerSameSource: NormalizedSource | null;
  readonly registryBodyIds: ReadonlySet<string>;
  readonly now: string;
  /** The row the fact came from; resolved from the bytes when absent. */
  readonly row?: Record<string, unknown>;
}

function check(name: VerificationCheckName, failures: readonly string[], measured: string): VerificationCheck {
  return failures.length === 0
    ? { name, result: "PASS", detail: `${FACT_VERIFICATION_VERSION}: ${measured}` }
    : { name, result: "FAIL", detail: `${FACT_VERIFICATION_VERSION}: ${failures.join("; ")}` };
}

function zoneIsKnown(zone: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}

function rowFor(input: FactVerificationInput): Record<string, unknown> | null {
  if (input.row) return input.row;
  const parsed = sourceRows(input.text);
  if ("refusal" in parsed) return null;
  const sourceId = input.fact.source.sourceId;
  return parsed.rows.find((r) => `${sourceId}:${input.fact.source.publisherSlug}:${String(sourceId === "legistar" ? r.EventId : r.id)}` === input.fact.meetingId) ?? null;
}

function recordFor(input: FactVerificationInput): ExtractedRecord | null {
  return input.parser.records.find((r) => r.id === input.fact.chain.extractedRecordId) ?? null;
}

function claimResolvesToSourceSpan(input: FactVerificationInput, row: Record<string, unknown> | null, record: ExtractedRecord | null): VerificationCheck {
  const failures: string[] = [];
  const hash = contentHash(input.text);
  if (hash !== input.artifact.contentHash) failures.push(`the re-read bytes hash ${hash}, not the artifact's ${input.artifact.contentHash}`);
  if (record === null) failures.push(`the parser result holds no record ${input.fact.chain.extractedRecordId}`);
  if (row === null) failures.push(`the bytes carry no row for ${input.fact.meetingId}`);
  let resolved = 0;
  if (record !== null && row !== null) {
    const fields = RESTING_FIELDS[input.fact.source.sourceId][input.fact.recordClass].filter((field) => Object.hasOwn(row, field));
    for (const field of fields) {
      const span = input.parser.spans.find((s) => s.recordId === record.id && s.field === field);
      if (!span) { failures.push(`no evidence span for ${field}`); continue; }
      if (span.contentHash !== input.artifact.contentHash) { failures.push(`${field}'s span cites ${span.contentHash}, not this artifact`); continue; }
      const quoted = input.text.slice(span.start, span.end);
      if (quoted !== span.quote) { failures.push(`${field}'s span offsets ${span.start}-${span.end} re-read as ${JSON.stringify(quoted).slice(0, 60)}, not the recorded quote`); continue; }
      let value: unknown;
      try { value = JSON.parse(quoted); } catch { failures.push(`${field}'s quote is not a JSON scalar`); continue; }
      if (value !== record.fields[field] || value !== row[field]) { failures.push(`${field} resolves to ${JSON.stringify(value)}; the record states ${JSON.stringify(record.fields[field])} and the row ${JSON.stringify(row[field])}`); continue; }
      resolved += 1;
    }
    if (resolved === 0) failures.push("no resting field resolved to a span");
  }
  return check("CLAIM_RESOLVES_TO_SOURCE_SPAN", failures, `${resolved} resting field(s) of ${input.fact.meetingId} re-read from the immutable bytes at their recorded offsets and equal both the validated record and the row`);
}

function canonicalIdentityUnique(input: FactVerificationInput): VerificationCheck {
  const failures: string[] = [];
  const fact = input.fact;
  if (!input.registryBodyIds.has(fact.body.bodyId)) failures.push(`body ${fact.body.bodyId} is not a registry body`);
  if (fact.meeting.bodyId !== fact.body.bodyId) failures.push(`the meeting carries bodyId ${fact.meeting.bodyId ?? "(none)"}, not ${fact.body.bodyId}`);
  const namespace = fact.meetingId.split(":")[0];
  if (namespace !== fact.source.sourceId) failures.push(`meeting id ${fact.meetingId} is not namespaced by source ${fact.source.sourceId}`);
  const sameIdentity = input.siblings.filter((s) => s.recordClass === fact.recordClass && s.meetingId === fact.meetingId);
  if (sameIdentity.length !== 1) failures.push(`${sameIdentity.length} ${fact.recordClass} facts in this artifact share meeting id ${fact.meetingId}`);
  const sameKey = input.siblings.filter((s) => s.factKey === fact.factKey);
  if (sameKey.length !== 1) failures.push(`${sameKey.length} facts in this artifact share key ${fact.factKey}`);
  let currency = "no later reading of the same source is held";
  if (input.newerSameSource !== null) {
    const agreement = factAgreementIn(fact, input.newerSameSource);
    if (agreement.present && !agreement.sameFact) failures.push(`superseded: ${agreement.detail}`);
    currency = agreement.detail;
  }
  return check("CANONICAL_IDENTITY_UNIQUE", failures, `body ${fact.body.bodyId} is a registry body via ${fact.body.resolvedBy}; ${fact.meetingId} is the one ${fact.recordClass} identity in the artifact; ${currency}`);
}

function assertionClassBurdens(input: FactVerificationInput, row: Record<string, unknown> | null): VerificationCheck {
  const failures: string[] = [];
  const { fact } = input;
  const m = fact.meeting;
  if (!/[+-]\d{2}:\d{2}$/.test(fact.time.startsAt)) failures.push(`startsAt ${fact.time.startsAt} carries no offset`);
  if (!Number.isFinite(Date.parse(fact.time.startsAt))) failures.push(`startsAt ${fact.time.startsAt} does not parse`);
  if (!zoneIsKnown(fact.time.timeZone)) failures.push(`time zone ${fact.time.timeZone} is not one this runtime can interpret`);
  if (fact.time.precision !== "MINUTE") failures.push(`precision ${fact.time.precision}: ${fact.source.sourceId} publishes a wall clock, so a DAY-precision fact is not from this source`);
  if (fact.time.sourceWallClock === null) failures.push("the source row carries no wall clock, so a MINUTE start cannot be claimed");
  if (fact.applicableAt !== fact.time.instant) failures.push(`applicableAt ${fact.applicableAt} is not the start instant ${fact.time.instant}`);
  const nowMs = Date.parse(input.now);
  const expectedStatus = m.status === "CANCELED" ? "CANCELED" : Date.parse(fact.time.startsAt) < nowMs ? "CONCLUDED" : "SCHEDULED";
  if (m.status !== expectedStatus) failures.push(`status ${m.status} disagrees with the clock (${expectedStatus} at ${input.now})`);
  if (m.status === "CANCELED" && row !== null) {
    const words = fact.source.sourceId === "legistar" ? [row.EventComment, row.EventAgendaStatusName] : [row.eventName];
    if (!words.some((w) => typeof w === "string" && /\bcancell?ed\b/i.test(w))) failures.push("CANCELED without the publisher's own word for it");
  }
  if (m.location === null && !m.online && !m.venueGap) failures.push("no location, no online access and no named venue gap — a meeting nobody can attend");
  if (m.venueGap && (m.location !== null || m.online)) failures.push("a venue gap alongside a location or an online block; the three must agree");
  if (m.location !== null && m.online) failures.push("both a location and an online block; the two must agree");
  if (m.location !== null && (!Number.isFinite(m.location.lat) || !Number.isFinite(m.location.lng) || !m.location.name)) failures.push("a placed meeting without coordinates or a venue name");
  // Where a record came from is decided by the capture's route authority; the record's own link only has to exist.
  if (m.provenance.sourceUrl === null) failures.push("no source URL on the record");
  if (!m.provenance.sourceOrg.trim()) failures.push("no publishing organisation on the record");
  if (m.provenance.collectedAt !== fact.source.acquiredAt) failures.push(`collectedAt ${m.provenance.collectedAt} is not the acquisition ${fact.source.acquiredAt}`);
  if (m.provenance.verifiedAt !== null) failures.push("verifiedAt is set by a machine bridge; no human or check confirmed this record");
  if (!m.jurisdiction.trim() || !m.bodyName.trim() || !m.title.trim()) failures.push("jurisdiction, body name and title must all be stated");
  if (fact.recordClass === "agendas") {
    const url = fact.agenda.documentUrl;
    if (!/^https:\/\//i.test(url)) failures.push(`agenda link ${url} is not https`);
    if (m.agendaUrl !== url) failures.push("the meeting's agendaUrl and the agenda fact disagree");
    if (row !== null) {
      if (fact.source.sourceId === "legistar") {
        if (row.EventAgendaFile !== url) failures.push("the agenda link is not the publisher's EventAgendaFile");
        if (fact.agenda.observedHow !== "OBSERVED_FIELD") failures.push("a Legistar agenda link is an observed field");
      } else {
        if (row.hasAgenda !== true) failures.push("the publisher's hasAgenda flag is not true");
        if (!url.endsWith(`/event/${String(row.id)}`)) failures.push("the derived portal permalink does not name this event");
        if (fact.agenda.observedHow !== "CANONICAL_ADAPTER_DERIVATION") failures.push("a CivicClerk agenda link is the adapter's derivation from the flag");
      }
    }
    if (fact.agenda.items !== null || fact.agenda.itemsExposed) failures.push("the Events feed exposes no agenda items; a fact claiming them did not come from it");
  } else if (m.agendaUrl !== null && !/^https:\/\//i.test(m.agendaUrl)) {
    failures.push(`agendaUrl ${m.agendaUrl} is not https`);
  }
  return check("ASSERTION_CLASS_BURDENS", failures, `start ${fact.time.startsAt} in ${fact.time.timeZone} (${fact.time.precision}) from wall clock ${JSON.stringify(fact.time.sourceWallClock)}; status ${m.status}; ${m.location ? `venue ${m.location.name}` : `online: ${m.online?.label}`}; source ${m.provenance.sourceUrl} by ${m.provenance.sourceOrg}${fact.recordClass === "agendas" ? `; agenda ${fact.agenda.observedHow}` : ""}`);
}

/** The Reader's renderer, on the fact's own meeting; null when the renderer itself refuses (an unreadable zone). */
export function renderedWallClock(meeting: Meeting): string | null {
  try { return formatMeetingTime(meeting); } catch { return null; }
}

function expectedClockText(fact: MeetingFact): string | null {
  const wall = fact.time.sourceWallClock;
  if (wall === null) return null;
  if (fact.source.sourceId === "legistar") {
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(wall.trim());
    return match ? `${Number(match[1])}:${match[2]} ${match[3].toUpperCase()}` : null;
  }
  const match = /T(\d{2}):(\d{2})/.exec(wall);
  if (!match) return null;
  const hour = Number(match[1]);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

/** A snapshot holding exactly this fact, in the Reader's own shape, for the Reader's own validator. */
export function singleFactSnapshot(fact: MeetingFact, generatedAt: string): MeetingsSnapshot {
  const meeting = fact.meeting;
  return {
    formatVersion: 1,
    generatedAt,
    counts: snapshotCounts([meeting], 0),
    sources: [{ source: fact.source.sourceId, ok: true, error: null, fetched: 1, normalized: 1, drops: { placeless: meeting.location === null ? 1 : 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }],
    meetings: [meeting],
    agendaDocuments: fact.recordClass === "agendas" && fact.agenda.document ? [fact.agenda.document] : [],
  };
}

function neutralityAndRenderingSymmetry(input: FactVerificationInput, row: Record<string, unknown> | null): VerificationCheck {
  const failures: string[] = [];
  const { fact } = input;
  const rendered = renderedWallClock(fact.meeting);
  const expected = expectedClockText(fact);
  if (rendered === null) failures.push(`the Reader's renderer refuses this meeting (zone ${fact.meeting.timeZone})`);
  if (fact.time.precision === "MINUTE" && rendered === TIME_NOT_POSTED) failures.push("the renderer prints TIME_NOT_POSTED for a MINUTE-precision fact");
  if (expected === null) failures.push("the source wall clock could not be read into a clock text");
  else if (rendered !== null && !rendered.startsWith(expected)) failures.push(`the renderer prints ${JSON.stringify(rendered)}; the publisher's clock is ${JSON.stringify(expected)}`);
  try {
    validateSnapshot(singleFactSnapshot(fact, input.now));
  } catch (error) {
    failures.push(`the Reader's own snapshot validator refuses this fact: ${error instanceof Error ? error.message : String(error)}`);
  }
  const m = fact.meeting;
  if (m.agendaSlotObservedEmpty === true) {
    const showedEmptySlot = fact.source.sourceId === "legistar" && row !== null && Object.hasOwn(row, "EventAgendaFile") && row.EventAgendaFile == null;
    if (!showedEmptySlot) failures.push("agendaSlotObservedEmpty is claimed without the publisher's record showing an empty slot");
  }
  if (m.agendaUrl === null && fact.recordClass === "agendas") failures.push("an agendas fact with no agenda link");
  if (m.carried !== undefined) failures.push("a bridged fact is never a carried-forward row");
  return check("NEUTRALITY_AND_RENDERING_SYMMETRY", failures, `formatMeetingTime renders ${JSON.stringify(rendered)} for the publisher's ${JSON.stringify(fact.time.sourceWallClock)}; validateSnapshot accepts a one-fact snapshot; agenda gap ${m.agendaUrl === null ? (m.agendaSlotObservedEmpty ? "is the publisher's empty slot" : "is ours (no link carried)") : "does not arise"}`);
}

function falseZero(input: FactVerificationInput): VerificationCheck {
  const failures: string[] = [];
  const { parser, artifact } = input;
  if (parser.sourceRowCount === null || parser.sourceRowCount <= 0) failures.push(`the parser read ${parser.sourceRowCount ?? "no"} source rows`);
  if (parser.actualRowCount !== parser.records.length) failures.push(`actualRowCount ${parser.actualRowCount} disagrees with ${parser.records.length} records`);
  if (parser.sourceRowCount !== null && parser.actualRowCount !== parser.sourceRowCount) failures.push(`${parser.actualRowCount} of ${parser.sourceRowCount} rows were extracted; a row that vanished is not an absence`);
  if (parser.declaredRowCount !== null && parser.declaredRowCount !== parser.actualRowCount) failures.push(`the publisher declares ${parser.declaredRowCount} rows; ${parser.actualRowCount} were read`);
  if (artifact.partial) failures.push("the artifact is a partial capture");
  if (artifact.byteLength <= 2) failures.push(`the artifact is ${artifact.byteLength} bytes`);
  if (parser.verdict !== "EXTRACTED") failures.push(`parser verdict ${parser.verdict}`);
  const pagination = parser.warnings.some((w) => w.code === "SOURCE_PAGINATION_REMAINS");
  if (!input.fact.chain.completenessScope.trim()) failures.push("the contract states no completeness scope");
  return check("FALSE_ZERO", failures, `${parser.actualRowCount} of ${parser.sourceRowCount} rows read from a complete ${artifact.byteLength}-byte capture${parser.declaredRowCount === null ? "" : ` (publisher declares ${parser.declaredRowCount})`}; ${pagination ? "another page remains and " : ""}the fact claims only this capture: ${input.fact.chain.completenessScope}`);
}

export interface FactVerification {
  readonly checks: readonly VerificationCheck[];
  readonly passed: boolean;
}

/** Run every check; the order is the canonical `VERIFICATION_CHECKS` order. */
export function verifyMeetingFact(input: FactVerificationInput): FactVerification {
  const row = rowFor(input);
  const record = recordFor(input);
  const byName: Record<VerificationCheckName, VerificationCheck> = {
    CLAIM_RESOLVES_TO_SOURCE_SPAN: claimResolvesToSourceSpan(input, row, record),
    CANONICAL_IDENTITY_UNIQUE: canonicalIdentityUnique(input),
    ASSERTION_CLASS_BURDENS: assertionClassBurdens(input, row),
    NEUTRALITY_AND_RENDERING_SYMMETRY: neutralityAndRenderingSymmetry(input, row),
    FALSE_ZERO: falseZero(input),
  };
  const checks = VERIFICATION_CHECKS.map((name) => byName[name]);
  return { checks, passed: checks.every((c) => c.result === "PASS") };
}

const CONTROL_FIELDS: Readonly<Record<"legistar" | "civicclerk", { readonly id: string; readonly present: readonly string[]; readonly nullable: readonly string[] }>> = {
  legistar: { id: "EventId", present: ["EventId", "EventBodyName", "EventDate", "EventTime", "EventLocation", "EventAgendaFile"], nullable: ["EventTime", "EventLocation", "EventAgendaFile", "EventComment"] },
  civicclerk: { id: "id", present: ["id", "eventName", "startDateTime", "eventCategoryName"], nullable: ["eventName", "startDateTime", "eventCategoryName"] },
};

export interface FactControlMeasurement {
  readonly score: ControlScore;
  readonly facts: readonly ControlFact[];
  readonly observations: readonly ControlObservation[];
  readonly instrument: string;
}

/** Observations join facts by `statement`; an unknown or duplicate observation throws. */
function scoreControls(facts: readonly ControlFact[], observations: readonly ControlObservation[]): ControlScore {
  const byStatement = new Map(facts.map((f) => [f.statement, f]));
  if (byStatement.size !== facts.length) {
    throw new Error("two control facts share one statement — identity here is the statement");
  }
  const seen = new Set<string>();
  let recalled = 0;
  let absencesRecalled = 0;
  let falseAbsences = 0;
  let falsePresences = 0;
  for (const observation of observations) {
    const fact = byStatement.get(observation.statement);
    if (!fact) {
      throw new Error(
        `observation about ${JSON.stringify(observation.statement)} matches no loaded control fact`,
      );
    }
    if (seen.has(observation.statement)) {
      throw new Error(`duplicate observation for ${JSON.stringify(observation.statement)}`);
    }
    seen.add(observation.statement);
    if (fact.fact_class === "known_present") {
      if (observation.observed === "FACT_STATED") recalled += 1;
      if (observation.observed === "ABSENCE_ASSERTED") falseAbsences += 1;
    } else {
      if (observation.observed === "FACT_STATED") falsePresences += 1;
      if (observation.observed === "ABSENCE_ASSERTED") absencesRecalled += 1;
    }
  }
  const knownPresentCount = facts.filter((f) => f.fact_class === "known_present").length;
  const knownAbsenceCount = facts.length - knownPresentCount;
  return {
    knownPresentCount,
    knownAbsenceCount,
    recalled,
    absencesRecalled,
    falseAbsences,
    falsePresences,
    unobserved: facts.length - seen.size,
    recall: knownPresentCount === 0 ? null : recalled / knownPresentCount,
    falseAbsenceRate: knownPresentCount === 0 ? null : falseAbsences / knownPresentCount,
    falsePresenceRate: knownAbsenceCount === 0 ? null : falsePresences / knownAbsenceCount,
  };
}

/**
 * Plant controls from an independent parse of the bytes and score what the
 * validated extraction stated about them. Throws only when the bytes cannot
 * be read at all — a control set that could not be planted is not a zero.
 */
export function measureFactControls(input: {
  readonly sourceId: "legistar" | "civicclerk";
  readonly publisherSlug: string;
  readonly artifact: ArtifactRecord;
  readonly text: string;
  readonly parser: ParserResult;
  readonly now: string;
}): FactControlMeasurement {
  const parsed = sourceRows(input.text);
  if ("refusal" in parsed) throw new Error(`CONTROLS_NOT_PLANTABLE: ${parsed.refusal.code}`);
  const spec = CONTROL_FIELDS[input.sourceId];
  const verified = { verification_source: `immutable artifact ${input.artifact.artifactId} (${input.artifact.contentHash}), parsed independently of the worker chain`, verified_by: `${FACT_VERIFICATION_VERSION} independent byte parse`, verified_date: input.now.slice(0, 10) };
  const facts: ControlFact[] = [];
  const observations: ControlObservation[] = [];
  const recordById = new Map(input.parser.records.map((r) => [r.id, r]));
  const seen = new Set<string>();
  let maxId = 0;
  for (const row of parsed.rows) {
    const rawId = row[spec.id];
    if (typeof rawId !== "number" || !Number.isSafeInteger(rawId)) continue;
    maxId = Math.max(maxId, rawId);
    const recordId = `${input.sourceId}:${input.publisherSlug}:${rawId}`;
    if (seen.has(recordId)) continue;
    seen.add(recordId);
    const record = recordById.get(recordId) ?? null;
    for (const field of spec.present) {
      if (!Object.hasOwn(row, field)) continue;
      const value = row[field];
      if (value === null || typeof value === "object") continue;
      const statement = `${recordId} states ${field} = ${JSON.stringify(value)}`;
      facts.push({ statement, fact_class: "known_present", expected_truth: { kind: "value", subject: `${recordId}.${field}`, value: value as string | number | boolean }, ...verified });
      observations.push({ statement, observed: record === null ? "ABSENCE_ASSERTED" : Object.hasOwn(record.fields, field) ? (record.fields[field] === value ? "FACT_STATED" : "ABSENCE_ASSERTED") : "GAP_NAMED" });
    }
    for (const field of spec.nullable) {
      if (!Object.hasOwn(row, field) || row[field] !== null) continue;
      const statement = `${recordId} publishes a null ${field}`;
      facts.push({ statement, fact_class: "known_absence", expected_truth: { kind: "proposition", proposition: `${recordId}.${field} is null in the publisher's own record` },
        authority: "the publisher's own immutable record", period: `this capture, recorded ${input.artifact.recordedAt}`, verified_through: "independent JSON parse of the immutable artifact", ...verified });
      observations.push({ statement, observed: record === null ? "GAP_NAMED" : Object.hasOwn(record.fields, field) && record.fields[field] === null ? "ABSENCE_ASSERTED" : Object.hasOwn(record.fields, field) ? "FACT_STATED" : "GAP_NAMED" });
    }
  }
  const absentId = `${input.sourceId}:${input.publisherSlug}:${maxId + 1}`;
  const absentStatement = `no record ${absentId} exists in this artifact`;
  facts.push({ statement: absentStatement, fact_class: "known_absence", expected_truth: { kind: "proposition", proposition: `${absentId} is not in the capture` },
    authority: "the immutable artifact bytes", period: `this capture, recorded ${input.artifact.recordedAt}`, verified_through: "independent JSON parse of the immutable artifact", ...verified });
  observations.push({ statement: absentStatement, observed: recordById.has(absentId) ? "FACT_STATED" : "ABSENCE_ASSERTED" });
  const score = scoreControls(facts, observations);
  return { score, facts, observations, instrument: `${FACT_VERIFICATION_VERSION}: ${facts.length} control(s) planted from an independent parse of ${input.artifact.artifactId}; ${input.parser.records.length} validated record(s) observed` };
}

export function controlsClean(score: ControlScore): { readonly clean: boolean; readonly detail: string } {
  const clean = score.knownPresentCount > 0 && score.falseAbsences === 0 && score.falsePresences === 0 && score.unobserved === 0 && score.recall === 1;
  return { clean, detail: `recall ${score.recalled} of ${score.knownPresentCount}, absences recalled ${score.absencesRecalled} of ${score.knownAbsenceCount}, false absences ${score.falseAbsences}, false presences ${score.falsePresences}, unobserved ${score.unobserved}` };
}
