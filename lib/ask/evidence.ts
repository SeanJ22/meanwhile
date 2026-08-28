import type { AskIntent, AskTemporal } from "./intent.ts";

/**
 * **THE EVIDENCE PACK — everything the synthesis rung is allowed to know.**
 *
 * This is the boundary that makes a generated civic sentence safe to show. The
 * synthesis model is given this object and NOTHING ELSE: no corpus access, no
 * tools, no web, no second question. Whatever is not in here cannot appear in
 * the answer, and `validate.ts` checks that afterwards rather than trusting it.
 *
 * Two properties matter more than the shape:
 *
 * 1. **Every record carries its own provenance.** Not a bibliography at the
 *    bottom — a `sourceUrl` and `sourceOrg` on the record itself, so a
 *    sentence about an agenda item is traceable to the document that item was
 *    read out of. A record with no source is a record the answer may not
 *    assert.
 *
 * 2. **The gaps travel with the records.** `gaps` is not error handling; it is
 *    evidence of the same standing as the records, and it is what lets the
 *    answer say *"we hold no record of X"* without that being a claim about
 *    the government. A pack with two records and four named gaps is a
 *    different and more honest answer than a pack with two records and
 *    silence.
 */

export interface EvidenceRecord {
  kind:
    | "MEETING"
    | "AGENDA_ITEM"
    | "AGENDA_DOCUMENT"
    | "OFFICEHOLDER"
    | "OFFICE"
    | "BODY";
  /** Stable id where one exists — the validation rung matches on it. */
  id: string;
  /** The record's own words, or a mechanical read of its fields. Never a summary. */
  text: string;
  /** ISO date this record is ABOUT, where that is meaningful. */
  occurredAt?: string | null;
  sourceUrl?: string | null;
  sourceOrg?: string | null;
  retrievedAt?: string | null;
}

/**
 * A gap NAMED, and named as whose it is.
 *
 * `OURS` and `THEIRS` are not a style choice. "We have not recorded this yet"
 * is a fact about this product; "the district has not published an agenda for
 * that sitting yet" is a fact about a government. Rendering them as the same
 * sentence is the render defect the constitution names, and a synthesis model
 * handed an unlabelled gap will pick one at random.
 */
export interface EvidenceGap {
  whose: "OURS" | "THEIRS";
  /** Plain language, reader-safe. This is the sentence the answer may use. */
  statement: string;
}

/** What the question resolved to. Null means nothing canonical was bound. */
export interface EvidenceSubject {
  kind: "BODY" | "PERSON" | "MEASURE";
  id: string;
  name: string;
  /** The office, for a person. Identity is person AND office, never either. */
  office?: string | null;
}

export interface EvidencePack {
  question: string;
  intent: AskIntent;
  temporal: AskTemporal;
  subject: EvidenceSubject | null;
  records: EvidenceRecord[];
  gaps: EvidenceGap[];
  /**
   * What was searched to produce this, so the answer can state a denominator
   * rather than implying completeness. A search over nine readable agendas
   * that found nothing is a different sentence from a search over zero.
   */
  denominators: Record<string, number>;
  /** `YYYY-MM-DD`, supplied. This module is not a clock. */
  today: string;
}

/** Every source URL the pack actually contains — the allow-list for the answer. */
export function packSourceUrls(pack: EvidencePack): Set<string> {
  const urls = new Set<string>();
  for (const record of pack.records) {
    if (record.sourceUrl) urls.add(record.sourceUrl);
  }
  return urls;
}

/**
 * Is there enough here to be worth a generated sentence at all?
 *
 * A pack with no records is not a failure of this product and it is not a
 * question for a model: the honest structured statement of the gap IS the
 * answer, and running synthesis over an empty pack invites exactly the
 * plausible-prose failure the whole pipeline is built to prevent.
 */
export function packHasEvidence(pack: EvidencePack): boolean {
  return pack.records.length > 0;
}
