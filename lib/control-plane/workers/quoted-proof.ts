/**
 * **THE QUOTE PROOF — PURE, SO THE PARSER, THE VALIDATOR AND THE AUDITOR RUN THE SAME CODE.**
 *
 * A model proposes records with the exact passage each field came from
 * (model-parser.ts). Nothing the model says is a fact until this module has
 * checked it against the saved document: the quote is in the document character
 * for character, the value is inside its quote, and the record carries every
 * required and identity field. The Validator re-runs `quotedSourceFindings` and
 * the post-publication Auditor re-runs `quotesHoldAgainst` on the immutable
 * artifact, with no model in the loop.
 *
 * No host imports: this module is bundled into the isolated worker realm with
 * the Validator, so it may import only types and other pure modules.
 */

import { personNameField, recordBlockAt } from "./record-block.ts";
import { escapePointer, recordIdentity, RecordEvidenceRefusal } from "./record-evidence.ts";
import type { EvidenceSpan, ExtractedRecord, FieldValue, GeneralizedCivicExtractionContract, ParserResult, ParserWorkerInput, WorkerEvidence, WorkerFinding } from "./types.ts";

export const MODEL_PARSER_IMPLEMENTATION = "model-quoted-extraction";
export const MAX_QUOTE_CHARS = 600;

const stable = (fields: Readonly<Record<string, FieldValue>>): string => JSON.stringify(Object.keys(fields).sort().map((k) => [k, fields[k]]));

/* ------------------------------------------------------- the proof */

/** `[Page N]` markers a transcribed PDF carries, so a span can name its page. */
function pageStarts(text: string): { readonly at: number; readonly page: number }[] {
  return [...text.matchAll(/^\[Page (\d+)\]$/gm)].map((m) => ({ at: m.index ?? 0, page: Number(m[1]) }));
}
function pageAt(pages: readonly { at: number; page: number }[], offset: number): number | null {
  let found: number | null = null;
  for (const p of pages) { if (p.at <= offset) found = p.page; else break; }
  return found;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

export interface ProposedField { readonly name: string; readonly value: string; readonly quote: string }
export interface ProposedRecord { readonly fields: readonly ProposedField[] }

/** Where a quote sits in the document: the first occurrence at or after `from`, else the first anywhere; null if it is not in the document. */
export function locateQuote(text: string, quote: string, from: number): number | null {
  const at = text.indexOf(quote, Math.max(0, from));
  if (at >= 0) return at;
  const any = text.indexOf(quote);
  return any >= 0 ? any : null;
}

export type RejectionCode =
  | "FIELD_NAME_INVALID" | "QUOTE_NOT_IN_DOCUMENT" | "VALUE_NOT_IN_QUOTE" | "QUOTE_TOO_LONG" | "FIELD_REPEATED"
  | "REQUIRED_FIELD_UNCONFIRMED" | "IDENTITY_UNCONFIRMED" | "FIELD_OUTSIDE_RECORD_BLOCK";

export interface Rejection { readonly code: RejectionCode; readonly recordIndex: number; readonly field?: string }

export interface ConfirmedExtraction {
  readonly records: readonly ExtractedRecord[];
  readonly spans: readonly EvidenceSpan[];
  readonly rejections: readonly Rejection[];
  readonly warnings: readonly WorkerFinding[];
  readonly proposed: number;
}

/**
 * **THE PROOF.** Every kept field is a value that sits inside a quote that sits,
 * character for character, in the saved document. Pure and deterministic: the
 * same document and the same claims always give the same records, and the
 * Validator and Auditor re-run it against the immutable artifact.
 */
export function confirmQuotedRecords(
  input: Pick<ParserWorkerInput, "evidence"> & { readonly contract: GeneralizedCivicExtractionContract },
  proposals: readonly (ProposedRecord & { readonly windowStart: number })[],
): ConfirmedExtraction {
  const { evidence, contract } = input;
  const text = evidence.text;
  const pages = pageStarts(text);
  const required = [...new Set([...contract.requiredFields, ...contract.identity.keyFields])];
  const records: ExtractedRecord[] = [];
  const spans: EvidenceSpan[] = [];
  const rejections: Rejection[] = [];
  const warnings: WorkerFinding[] = [];
  const seenIds = new Map<string, string>();
  // Each window's records come in document order: the next record is searched from where the previous one began.
  const recordFrom = new Map<number, number>();
  proposals.forEach((proposal, recordIndex) => {
    const fields: Record<string, FieldValue> = Object.create(null);
    const kept: { field: string; start: number; end: number; quote: string }[] = [];
    const from = recordFrom.get(proposal.windowStart) ?? proposal.windowStart;
    const nameField = personNameField(Object.fromEntries(proposal.fields.map(claim => [claim.name, claim.value])), contract.recordClass);
    const nameClaim = proposal.fields.find(claim => claim.name === nameField);
    const nameAt = nameClaim && collapse(nameClaim.quote).includes(collapse(nameClaim.value)) ? locateQuote(text, nameClaim.quote, from) : null;
    const withinQuote = nameClaim?.quote.indexOf(nameClaim.value) ?? -1;
    const anchorAt = nameAt !== null ? nameAt + Math.max(0, withinQuote) : null;
    const block = anchorAt !== null && nameClaim ? recordBlockAt(text, anchorAt,
      anchorAt + (withinQuote >= 0 ? nameClaim.value.length : nameClaim.quote.length)) : null;
    for (const claim of proposal.fields) {
      const reject = (code: RejectionCode) => rejections.push({ code, recordIndex, field: claim.name });
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(claim.name)) { reject("FIELD_NAME_INVALID"); continue; }
      if (Object.hasOwn(fields, claim.name)) { reject("FIELD_REPEATED"); continue; }
      if (claim.quote.length > MAX_QUOTE_CHARS) { reject("QUOTE_TOO_LONG"); continue; }
      let at = claim.quote.trim() === "" ? null : locateQuote(text, claim.quote, from);
      if (nameField && at !== null) {
        const local = block ? text.indexOf(claim.quote, block.start) : -1;
        if (!block || local < block.start || local + claim.quote.length > block.end) {
          reject("FIELD_OUTSIDE_RECORD_BLOCK");
          warnings.push({ code: "FIELD_OUTSIDE_RECORD_BLOCK", severity: "INFO", field: claim.name,
            detail: JSON.stringify({ recordIndex, name: nameClaim?.value, value: claim.value, quote: claim.quote,
              sourceUrl: evidence.canonicalUrl, artifactId: evidence.artifactId, contentHash: evidence.contentHash,
              reason: "The field is outside the named person's record; investigate the saved finding." }) });
          continue;
        }
        at = local;
      }
      if (at === null) { reject("QUOTE_NOT_IN_DOCUMENT"); continue; }
      let value = claim.value;
      if (value.trim() === "" || !claim.quote.includes(value)) {
        // Whitespace differences alone (a line break inside a name) are not a different value.
        if (value.trim() !== "" && collapse(claim.quote).includes(collapse(value))) value = collapse(value);
        else { reject("VALUE_NOT_IN_QUOTE"); continue; }
      }
      fields[claim.name] = value;
      kept.push({ field: claim.name, start: at, end: at + claim.quote.length, quote: claim.quote });
    }
    if (kept.length) recordFrom.set(proposal.windowStart, Math.min(...kept.map((k) => k.start)) + 1);
    const missing = required.filter((f) => fields[f] === undefined || fields[f] === "");
    if (missing.length) { for (const f of missing) rejections.push({ code: "REQUIRED_FIELD_UNCONFIRMED", recordIndex, field: f }); return; }
    let id: string;
    try { id = recordIdentity(fields, contract.identity); }
    catch (error) { if (!(error instanceof RecordEvidenceRefusal)) throw error; rejections.push({ code: "IDENTITY_UNCONFIRMED", recordIndex }); return; }
    const signature = stable(fields);
    const prior = seenIds.get(id);
    if (prior !== undefined) {
      // An overlap between windows lists the same item twice: identical is one record, different is a conflict left for a person.
      if (prior !== signature) warnings.push({ code: "DUPLICATE_SOURCE_RECORD_ID", severity: "WARNING", recordId: id, detail: "Two quoted records share a stable identity but differ; neither is dropped." });
      else return;
    }
    seenIds.set(id, signature);
    const evidenceSpanIds: string[] = [];
    for (const k of kept) {
      const page = pageAt(pages, k.start);
      const spanId = `span:${evidence.artifactId}:q:${records.length}:${k.field}`;
      evidenceSpanIds.push(spanId);
      spans.push({
        id: spanId, artifactId: evidence.artifactId, contentHash: evidence.contentHash, recordId: id, field: k.field,
        jsonPointer: `${page === null ? "" : `/pages/${page}`}/quoted/${records.length}/${escapePointer(k.field)}`,
        sourceFormat: "UNSUPPORTED", start: k.start, end: k.end, offsetUnit: "UTF16_CODE_UNITS", quote: k.quote,
      });
    }
    records.push({ id, subjectId: contract.subjectId, fields, evidenceSpanIds });
  });
  return { records, spans, rejections, warnings, proposed: proposals.length };
}

/** One field of one record that the document no longer supports. */
export interface QuoteFailure { readonly recordId: string; readonly field: string; readonly detail: string }

/**
 * Re-prove a quoted extraction against the immutable document: every span's
 * quote is at its recorded range, and every value is inside its quote. This is
 * what the Validator and the post-publication Auditor run; it needs no model.
 */
export function quotesHoldAgainst(result: Pick<ParserResult, "records" | "spans">, documentText: string): { readonly ok: boolean; readonly failures: readonly QuoteFailure[] } {
  const failures: QuoteFailure[] = [];
  const spanById = new Map(result.spans.map((s) => [s.id, s] as const));
  for (const record of result.records) {
    const nameField = personNameField(record.fields);
    const nameSpan = nameField ? record.evidenceSpanIds.map(id => spanById.get(id)).find(span => span?.field === nameField) : null;
    const name = nameField ? String(record.fields[nameField]) : "";
    const withinQuote = nameSpan?.quote.indexOf(name) ?? -1;
    const anchorAt = nameSpan && collapse(nameSpan.quote).includes(collapse(name)) ? nameSpan.start + Math.max(0, withinQuote) : null;
    const block = anchorAt !== null && nameSpan ? recordBlockAt(documentText, anchorAt,
      anchorAt + (withinQuote >= 0 ? name.length : nameSpan.quote.length)) : null;
    for (const field of Object.keys(record.fields)) {
      const span = record.evidenceSpanIds.map((id) => spanById.get(id)).find((s) => s?.field === field);
      const value = String(record.fields[field]);
      if (!span) { failures.push({ recordId: record.id, field, detail: `${record.id}/${field}: no span` }); continue; }
      if (nameField && (!block || span.start < block.start || span.end > block.end)) failures.push({ recordId: record.id, field, detail: `${record.id}/${field}: the quote is outside the named person's record` });
      if (documentText.slice(span.start, span.end) !== span.quote) failures.push({ recordId: record.id, field, detail: `${record.id}/${field}: the quote is not at its recorded range` });
      else if (!span.quote.includes(value) && !collapse(span.quote).includes(collapse(value))) failures.push({ recordId: record.id, field, detail: `${record.id}/${field}: the value is not inside its quote` });
    }
  }
  return { ok: failures.length === 0, failures };
}


/** Whether a parser result is a model-quoted extraction of a contract with no parsing rule. */
export function isQuotedExtraction(contract: GeneralizedCivicExtractionContract, candidate: Pick<ParserResult, "implementation">): boolean {
  return contract.extraction.format === "UNSUPPORTED" && candidate.implementation === MODEL_PARSER_IMPLEMENTATION;
}

const blocking = (code: string, detail: string, recordId?: string): WorkerFinding => ({ code, detail, severity: "BLOCKING", ...(recordId ? { recordId } : {}) });

/**
 * **THE VALIDATOR'S REPLAY OF A QUOTED EXTRACTION.** The Validator reads the
 * immutable artifact itself and confirms, without the model: every span belongs
 * to that artifact and hash; every quote is at its recorded range; every value is
 * inside its quote; every required and identity field is present; and each
 * record's id is the identity its own fields give. Any failure is BLOCKING.
 */
export function quotedSourceFindings(candidate: ParserResult, contract: GeneralizedCivicExtractionContract, evidence: WorkerEvidence): WorkerFinding[] {
  const out: WorkerFinding[] = [];
  if (candidate.artifactId !== evidence.artifactId || candidate.contentHash !== evidence.contentHash) {
    out.push(blocking("SPAN_ARTIFACT_MISMATCH", "The extraction names a different artifact or content hash than the immutable evidence."));
  }
  for (const span of candidate.spans) {
    if (span.artifactId !== evidence.artifactId || span.contentHash !== evidence.contentHash) out.push(blocking("SPAN_ARTIFACT_MISMATCH", `Span ${span.id} cites another artifact.`, span.recordId));
  }
  const proof = quotesHoldAgainst(candidate, evidence.text);
  for (const failure of proof.failures) out.push({ ...blocking("QUOTE_NOT_IN_DOCUMENT", failure.detail, failure.recordId), field: failure.field });
  const required = [...new Set([...contract.requiredFields, ...contract.identity.keyFields])];
  for (const record of candidate.records) {
    for (const field of required) {
      if (record.fields[field] === undefined || record.fields[field] === "") out.push(blocking("REQUIRED_FIELD_MISSING", `Record lacks required ${field}.`, record.id));
    }
    try {
      if (recordIdentity(record.fields, contract.identity) !== record.id) out.push(blocking("SOURCE_RECORD_IDENTITY_MISMATCH", "The record id is not the identity its own fields give.", record.id));
    } catch (error) {
      if (!(error instanceof RecordEvidenceRefusal)) throw error;
      out.push(blocking(error.code, error.message, record.id));
    }
  }
  if (candidate.records.length === 0) out.push(blocking("ZERO_ROW_EXTRACTION", "A zero-row extraction is a failed extraction, never publisher absence."));
  return out;
}
