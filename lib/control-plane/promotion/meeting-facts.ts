import { createHash } from "node:crypto";

import type { AgendaDocument } from "../../meetings/agenda-documents.ts";
import { activeWiring, type BodySourceWiring } from "../../registry/source-wiring.ts";
import { makeCivicClerkSource, type CivicClerkEvent } from "../../sources/civicclerk/index.ts";
import { findClient } from "../../sources/legistar/client-registry.ts";
import { normalizeWithDrops as normalizeLegistarEvents, type LegistarEventWithClient } from "../../sources/legistar/index.ts";
import type { LegistarEvent } from "../../sources/legistar/types.ts";
import type { Meeting, NormalizeDropCounts } from "../../sources/types.ts";
import { contentHash } from "../ids.ts";
import type { ArtifactRecord } from "../repository/types.ts";
import { isFieldValue, type LegacyCivicExtractionContract, type WorkerResultRecord } from "../workers/types.ts";

export const MEETING_FACT_BRIDGE_VERSION = "meeting-facts/1";

/** The only two record classes this bridge produces. */
export const MEETING_FACT_CLASSES = ["meeting-times", "agendas"] as const;
export type MeetingFactClass = (typeof MEETING_FACT_CLASSES)[number];

export function isMeetingFactClass(value: string): value is MeetingFactClass {
  return (MEETING_FACT_CLASSES as readonly string[]).includes(value);
}

export const MEETING_FACT_SOURCE_CLASSES = ["LEGISTAR_EVENTS", "CIVICCLERK_EVENTS"] as const;
export type MeetingFactSourceClass = (typeof MEETING_FACT_SOURCE_CLASSES)[number];

export function isMeetingFactSourceClass(value: string): value is MeetingFactSourceClass {
  return (MEETING_FACT_SOURCE_CLASSES as readonly string[]).includes(value);
}

export interface FactBodyIdentity {
  readonly bodyId: string;
  readonly ocdId: string | null;
  /** The body as the source names it — a Legistar body name, a CivicClerk category. */
  readonly bodyName: string;
  readonly jurisdiction: string;
  readonly publishingOrg: string;
  readonly resolvedBy: "LEGISTAR_CLIENT_REGISTRY" | "MEETING_DOORS";
}

export interface FactSourceIdentity {
  readonly sourceId: "legistar" | "civicclerk";
  readonly publisherSlug: string;
  /** `<sourceId>:<publisherSlug>` — one feed, for grouping and freshness. */
  readonly sourceKey: string;
  readonly canonicalUrl: string;
  readonly artifactId: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly acquiredAt: string;
  readonly acquiredByAttemptId: string;
  readonly workItemId: string;
}

export interface FactChainIdentity {
  readonly parserResultId: string;
  readonly parserAttemptId: string;
  readonly validatorResultId: string | null;
  readonly auditorResultId: string | null;
  readonly extractedRecordId: string;
  readonly evidenceSpanIds: readonly string[];
  readonly sourceRecordClass: MeetingFactSourceClass;
  readonly completenessScope: string;
}

export interface FactTime {
  /** ISO 8601 with the body's offset, as the adapter wrote it. */
  readonly startsAt: string;
  /** The same instant in UTC. */
  readonly instant: string;
  readonly timeZone: string;
  readonly precision: "MINUTE" | "DAY";
  /** Neither source publishes an end time; null is the fact, not a gap to fill. */
  readonly endsAt: null;
  /** The wall clock exactly as the source wrote it, for the rendering symmetry check. */
  readonly sourceWallClock: string | null;
}

interface FactBase {
  readonly bridgeVersion: typeof MEETING_FACT_BRIDGE_VERSION;
  readonly factKey: string;
  readonly meetingId: string;
  readonly body: FactBodyIdentity;
  readonly time: FactTime;
  readonly meeting: Meeting;
  readonly source: FactSourceIdentity;
  readonly chain: FactChainIdentity;
  /** The instant the fact applies to: the meeting start. */
  readonly applicableAt: string;
  readonly observedAt: string;
  readonly status: Meeting["status"];
}

export interface MeetingTimeFact extends FactBase {
  readonly recordClass: "meeting-times";
}

export interface AgendaFact extends FactBase {
  readonly recordClass: "agendas";
  readonly agenda: {
    readonly documentUrl: string;
    /** `<meetingId>#agenda@<urlHash>` — a changed link is a different fact. */
    readonly documentKey: string;
    /** Legistar states the file URL; CivicClerk states a flag and the adapter derives the portal permalink. */
    readonly observedHow: "OBSERVED_FIELD" | "CANONICAL_ADAPTER_DERIVATION";
    /** The Events feeds expose no items; null means nobody asked, never "none". */
    readonly items: null;
    readonly itemsExposed: false;
    readonly document: AgendaDocument | null;
  };
}

export type MeetingFact = MeetingTimeFact | AgendaFact;

export interface FactRefusal {
  readonly code: string;
  readonly detail: string;
  /** The extracted record the refusal is about, or null for the whole artifact. */
  readonly recordId: string | null;
}

export interface NormalizedSource {
  readonly sourceId: "legistar" | "civicclerk";
  readonly publisherSlug: string;
  readonly sourceKey: string;
  readonly body: Omit<FactBodyIdentity, "bodyName"> | null;
  readonly meetings: readonly Meeting[];
  readonly rows: readonly Record<string, unknown>[];
  readonly rowById: ReadonlyMap<string, Record<string, unknown>>;
  readonly drops: NormalizeDropCounts | null;
  readonly considered: number;
  readonly refusal: FactRefusal | null;
}

const ZERO_DROPS: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };

function sourceIdFor(recordClass: MeetingFactSourceClass): "legistar" | "civicclerk" {
  return recordClass === "LEGISTAR_EVENTS" ? "legistar" : "civicclerk";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Rows as the artifact publishes them: a bare array or an OData `value` array. */
export function sourceRows(text: string): { rows: readonly Record<string, unknown>[] } | { refusal: FactRefusal } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch (error) {
    return { refusal: { code: "SOURCE_JSON_MALFORMED", detail: `the artifact is not a complete JSON document: ${error instanceof Error ? error.message : String(error)}`, recordId: null } };
  }
  const rows = Array.isArray(decoded) ? decoded : isObject(decoded) && Array.isArray(decoded.value) ? decoded.value : null;
  if (rows === null) return { refusal: { code: "SOURCE_SHAPE_UNSUPPORTED", detail: "expected an Event array or an OData value array", recordId: null } };
  if (!rows.every(isObject)) return { refusal: { code: "SOURCE_ROW_NOT_A_RECORD", detail: "a source row is not a record object", recordId: null } };
  return { rows };
}

function meetingIdFor(sourceId: "legistar" | "civicclerk", slug: string, row: Record<string, unknown>): string | null {
  const id = sourceId === "legistar" ? row.EventId : row.id;
  return typeof id === "number" && Number.isSafeInteger(id) ? `${sourceId}:${slug}:${id}` : null;
}

/** Pure apart from the clock the adapter needs for SCHEDULED/CONCLUDED. */
export function normalizeFactsFromBytes(input: {
  readonly contract: LegacyCivicExtractionContract;
  readonly artifact: ArtifactRecord;
  readonly text: string;
  readonly now: string;
  readonly wiring?: readonly BodySourceWiring[];
}): NormalizedSource {
  const sourceId = sourceIdFor(input.contract.recordClass);
  const slug = input.contract.publisherSlug;
  const sourceKey = `${sourceId}:${slug}`;
  const base = { sourceId, publisherSlug: slug, sourceKey, meetings: [], rows: [], rowById: new Map(), drops: null, considered: 0 } as const;
  const parsed = sourceRows(input.text);
  if ("refusal" in parsed) return { ...base, body: null, refusal: parsed.refusal };
  const rows = parsed.rows;
  const rowById = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = meetingIdFor(sourceId, slug, row);
    if (id !== null && !rowById.has(id)) rowById.set(id, row);
  }
  const collectedAt = input.artifact.recordedAt;
  const now = new Date(input.now);

  if (sourceId === "legistar") {
    const client = findClient(slug);
    if (!client) {
      return { ...base, rows, rowById, body: null, considered: rows.length,
        refusal: { code: "BODY_IDENTITY_UNRESOLVED", detail: `no Legistar client is registered for slug ${slug}; the canonical body cannot be named`, recordId: null } };
    }
    const raw: LegistarEventWithClient[] = rows.map((row) => ({ event: row as unknown as LegistarEvent, slug, collectedAt, items: null }));
    const out = normalizeLegistarEvents(raw, now);
    return { ...base, rows, rowById, considered: rows.length, meetings: out.meetings, drops: { ...out.drops },
      body: { bodyId: client.bodyId, ocdId: client.ocdId, jurisdiction: client.jurisdiction, publishingOrg: client.publishingOrg, resolvedBy: "LEGISTAR_CLIENT_REGISTRY" },
      refusal: null };
  }

  const wired = (input.wiring ?? activeWiring()).filter((row) => row.agendaSourceType === "CIVICCLERK" && row.config.slug === slug);
  if (wired.length === 0) {
    return { ...base, rows, rowById, body: null, considered: rows.length,
      refusal: { code: "BODY_IDENTITY_UNRESOLVED", detail: `no meeting door serves CivicClerk tenant ${slug}; the canonical body cannot be named`, recordId: null } };
  }
  if (wired.length > 1) {
    return { ...base, rows, rowById, body: null, considered: rows.length,
      refusal: { code: "BODY_IDENTITY_AMBIGUOUS", detail: `${wired.length} meeting doors serve CivicClerk tenant ${slug}; one feed row would attribute to more than one body`, recordId: null } };
  }
  const wiring = wired[0];
  let apiHost: string | null = null;
  try { apiHost = new URL(input.artifact.canonicalUrl).hostname.toLowerCase(); } catch { apiHost = null; }
  let wiredHost: string | null = null;
  try { wiredHost = new URL(wiring.config.apiBase).hostname.toLowerCase(); } catch { wiredHost = null; }
  if (apiHost === null || wiredHost === null || apiHost !== wiredHost) {
    return { ...base, rows, rowById, body: null, considered: rows.length,
      refusal: { code: "SOURCE_HOST_MISMATCH", detail: `the artifact was read from ${apiHost ?? "an unreadable URL"} and the wiring row's API host is ${wiredHost ?? "unreadable"}`, recordId: null } };
  }
  const out = makeCivicClerkSource([wiring]).normalizeWithDrops([{ wiring, events: rows as unknown as CivicClerkEvent[], collectedAt }], now);
  return { ...base, rows, rowById, considered: rows.length, meetings: out.meetings, drops: { ...out.drops },
    body: { bodyId: wiring.bodyId, ocdId: wiring.ocdId, jurisdiction: wiring.jurisdiction, publishingOrg: wiring.publishingOrg, resolvedBy: "MEETING_DOORS" },
    refusal: null };
}

export function meetingFactContract(result: WorkerResultRecord): LegacyCivicExtractionContract | null {
  const contract = result.completion?.completedTask?.workerTask?.contract;
  if (!contract || contract.schemaVersion !== 1) return null;
  if (!isMeetingFactSourceClass(contract.recordClass)) return null;
  return contract;
}

export function meetingTimeFactKey(meeting: Pick<Meeting, "id" | "startsAt">): string {
  return `${meeting.id}@${meeting.startsAt}`;
}

export function agendaFactKey(meetingId: string, documentUrl: string): string {
  return `${meetingId}#agenda@${createHash("sha256").update(documentUrl).digest("hex").slice(0, 16)}`;
}

export interface FactBridgeInput {
  readonly parser: WorkerResultRecord;
  readonly validator: WorkerResultRecord | null;
  readonly auditor: WorkerResultRecord | null;
  readonly artifact: ArtifactRecord;
  /** The immutable bytes, re-read from the vault — never the parser's copy. */
  readonly text: string;
  readonly now: string;
  readonly wiring?: readonly BodySourceWiring[];
  readonly agendaDocuments?: readonly AgendaDocument[];
}

export interface FactBridge {
  readonly facts: readonly MeetingFact[];
  readonly refusals: readonly FactRefusal[];
  readonly source: NormalizedSource | null;
  readonly contract: LegacyCivicExtractionContract | null;
}

function refusalOnly(refusals: FactRefusal[], source: NormalizedSource | null = null, contract: LegacyCivicExtractionContract | null = null): FactBridge {
  return { facts: [], refusals, source, contract };
}

/** Every refusal names the record it is about. */
export function bridgeMeetingFacts(input: FactBridgeInput): FactBridge {
  const refusals: FactRefusal[] = [];
  const parsed = input.parser.result;
  if (parsed.role !== "PARSER") return refusalOnly([{ code: "NOT_A_PARSER_RESULT", detail: `worker result ${input.parser.id} is a ${parsed.role} result`, recordId: null }]);
  const contract = meetingFactContract(input.parser);
  if (contract === null) {
    const named = input.parser.completion?.completedTask?.workerTask?.contract;
    return refusalOnly([{ code: "RECORD_CLASS_NOT_A_MEETING_FACT",
      detail: `contract class ${named?.recordClass ?? "(none)"} schemaVersion ${named?.schemaVersion ?? "(none)"} is not a meeting-fact source; it keeps its own class and is not renamed`, recordId: null }]);
  }
  if (parsed.verdict !== "EXTRACTED") {
    return refusalOnly([{ code: "EXTRACTION_NOT_CLEAN", detail: `the parser verdict is ${parsed.verdict}: ${parsed.warnings.map((w) => w.code).join(", ") || "no warning code"}`, recordId: null }], null, contract);
  }
  if (parsed.artifactId !== input.artifact.artifactId) {
    return refusalOnly([{ code: "ARTIFACT_IDENTITY_MISMATCH", detail: `the parser extracted ${parsed.artifactId}; the offered artifact is ${input.artifact.artifactId}`, recordId: null }], null, contract);
  }
  const hash = contentHash(input.text);
  if (hash !== input.artifact.contentHash || hash !== parsed.contentHash) {
    return refusalOnly([{ code: "ARTIFACT_BYTES_MISMATCH", detail: `the re-read bytes hash ${hash}; the artifact records ${input.artifact.contentHash} and the parser ${parsed.contentHash}`, recordId: null }], null, contract);
  }

  const source = normalizeFactsFromBytes({ contract, artifact: input.artifact, text: input.text, now: input.now, wiring: input.wiring });
  if (source.refusal !== null) return refusalOnly([source.refusal], source, contract);
  const body = source.body!;

  const producedIds = new Set(source.meetings.map((m) => m.id));
  for (const [id] of source.rowById) {
    if (producedIds.has(id)) continue;
    const drops = source.drops ?? ZERO_DROPS;
    refusals.push({ code: "NORMALIZER_DROPPED", recordId: id,
      detail: `the canonical ${source.sourceId} adapter produced no meeting for this row; this artifact's drops — unknownVenue ${drops.unknownVenue}, unplaceableInTime ${drops.unplaceableInTime}, notConfigured ${drops.notConfigured}, placeless (kept) ${drops.placeless} — are the adapter's own accounting, never an absence` });
  }

  const facts: MeetingFact[] = [];
  const chainBase = {
    parserResultId: input.parser.id,
    parserAttemptId: input.parser.attemptId,
    validatorResultId: input.validator?.id ?? null,
    auditorResultId: input.auditor?.id ?? null,
    sourceRecordClass: contract.recordClass,
    completenessScope: contract.completenessScope,
  };
  const sourceIdentity: FactSourceIdentity = {
    sourceId: source.sourceId,
    publisherSlug: source.publisherSlug,
    sourceKey: source.sourceKey,
    canonicalUrl: input.artifact.canonicalUrl,
    artifactId: input.artifact.artifactId,
    contentHash: input.artifact.contentHash,
    byteLength: input.artifact.byteLength,
    acquiredAt: input.artifact.recordedAt,
    acquiredByAttemptId: input.artifact.attemptId,
    workItemId: input.artifact.workItemId,
  };

  for (const meeting of source.meetings) {
    const record = parsed.records.find((r) => r.id === meeting.id);
    if (!record) {
      refusals.push({ code: "EXTRACTED_RECORD_MISSING", recordId: meeting.id, detail: "the adapter produced a meeting the validated extraction holds no record for" });
      continue;
    }
    const row = source.rowById.get(meeting.id);
    if (!row) {
      refusals.push({ code: "SOURCE_ROW_MISSING", recordId: meeting.id, detail: "the adapter produced a meeting no source row carries the identity of" });
      continue;
    }
    const mismatched: string[] = [];
    for (const [field, value] of Object.entries(row)) {
      if (!isFieldValue(value)) continue;
      if (!Object.hasOwn(record.fields, field)) { mismatched.push(`${field} (not extracted)`); continue; }
      if (record.fields[field] !== value) mismatched.push(field);
    }
    if (mismatched.length > 0) {
      refusals.push({ code: "EXTRACTION_FIELD_MISMATCH", recordId: meeting.id, detail: `the validated extraction disagrees with the immutable bytes on ${mismatched.join(", ")}` });
      continue;
    }
    const instant = new Date(meeting.startsAt);
    if (!Number.isFinite(instant.getTime())) {
      refusals.push({ code: "START_INSTANT_UNREADABLE", recordId: meeting.id, detail: `the adapter wrote startsAt ${meeting.startsAt}, which does not parse` });
      continue;
    }
    const wallClock = source.sourceId === "legistar"
      ? (typeof row.EventTime === "string" ? row.EventTime : null)
      : (typeof row.startDateTime === "string" ? row.startDateTime : null);
    const time: FactTime = {
      startsAt: meeting.startsAt,
      instant: instant.toISOString(),
      timeZone: meeting.timeZone,
      precision: meeting.startPrecision ?? "MINUTE",
      endsAt: null,
      sourceWallClock: wallClock,
    };
    const shared = {
      bridgeVersion: MEETING_FACT_BRIDGE_VERSION,
      meetingId: meeting.id,
      body: { ...body, bodyName: meeting.bodyName },
      time,
      meeting,
      source: sourceIdentity,
      chain: { ...chainBase, extractedRecordId: record.id, evidenceSpanIds: record.evidenceSpanIds },
      applicableAt: instant.toISOString(),
      observedAt: input.artifact.recordedAt,
      status: meeting.status,
    } as const;
    facts.push({ ...shared, recordClass: "meeting-times", factKey: meetingTimeFactKey(meeting) });
    if (meeting.agendaUrl !== null) {
      const documentUrl = meeting.agendaUrl;
      facts.push({
        ...shared,
        recordClass: "agendas",
        factKey: agendaFactKey(meeting.id, documentUrl),
        agenda: {
          documentUrl,
          documentKey: agendaFactKey(meeting.id, documentUrl),
          observedHow: source.sourceId === "legistar" ? "OBSERVED_FIELD" : "CANONICAL_ADAPTER_DERIVATION",
          items: null,
          itemsExposed: false,
          document: input.agendaDocuments?.find((d) => d.meetingId === meeting.id && d.documentUrl === documentUrl) ?? null,
        },
      });
    }
  }
  return { facts, refusals, source, contract };
}

export function factSummary(fact: MeetingFact): string {
  const head = `${fact.recordClass} ${fact.body.bodyName} (${fact.body.bodyId}) ${fact.time.startsAt} ${fact.time.timeZone}`;
  return fact.recordClass === "agendas" ? `${head} agenda ${fact.agenda.documentUrl}` : `${head} at ${fact.meeting.location?.name ?? fact.meeting.online?.label ?? "(no place carried)"}`;
}

/** Does a later reading of the same source state the same fact? Absent is not a contradiction. */
export function factAgreementIn(fact: MeetingFact, later: NormalizedSource): { readonly present: boolean; readonly sameFact: boolean; readonly detail: string } {
  const meeting = later.meetings.find((m) => m.id === fact.meetingId);
  if (!meeting) {
    const row = later.rowById.get(fact.meetingId);
    return { present: false, sameFact: false, detail: row
      ? `artifact ${later.sourceKey} carries the row for ${fact.meetingId} but the adapter produced no meeting for it (dropped), so it neither confirms nor contradicts`
      : `artifact ${later.sourceKey} carries no row for ${fact.meetingId}; a capture window that moved on is not evidence the sitting was withdrawn` };
  }
  if (fact.recordClass === "meeting-times") {
    const same = meeting.startsAt === fact.time.startsAt && meeting.timeZone === fact.time.timeZone;
    return { present: true, sameFact: same, detail: same
      ? `the later reading states the same start ${meeting.startsAt} ${meeting.timeZone} for ${fact.meetingId}`
      : `the later reading states ${meeting.startsAt} ${meeting.timeZone} for ${fact.meetingId}; this fact states ${fact.time.startsAt} ${fact.time.timeZone}` };
  }
  const same = meeting.agendaUrl === fact.agenda.documentUrl;
  return { present: true, sameFact: same, detail: same
    ? `the later reading states the same agenda link for ${fact.meetingId}`
    : `the later reading states agenda link ${meeting.agendaUrl ?? "(none)"} for ${fact.meetingId}; this fact states ${fact.agenda.documentUrl}` };
}
