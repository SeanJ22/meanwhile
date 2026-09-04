import type { AskContact } from "./contacts.ts";
import type { EvidenceRecord, EvidenceSubject } from "./evidence.ts";

/**
 * **THE RELEVANCE GATE — nothing outside the question's subject reaches the
 * pack.** (ASK-24, the owner's Prop 141 report, 2026-09-02.)
 *
 * ## The defect, stated as the owner stated it
 *
 * *"Explain Prop 141 to me."* The reader got the measure explained — and then a
 * final bullet about the U.S. Senate seat on the 2026 ballot, which has nothing
 * to do with Prop 141, and three people (the reader's own legislators) listed
 * under WHO THIS IS with no stated connection to the measure at all. Both were
 * real, sourced records. Both were retrieved for the reader's BALLOT, not for
 * the measure — and both reached the synthesis rung, which is why a bullet about
 * a Senate seat got written under a question about a tax measure.
 *
 * The retrieval sites each added something defensible on its own terms: a ballot
 * subject's division carries a "no U.S. Senate race" absence, and a measure with
 * no governing roster of its own falls back to the reader's representatives. But
 * a measure is a single yes/no question, and neither of those is ABOUT it.
 *
 * ## Why this is a gate BEFORE synthesis, not a trim after
 *
 * A record the model can see is a record the model can build a sentence from,
 * and `validate.ts` cannot catch "this true, sourced fact is about the wrong
 * thing" — it checks invented URLs, foreign governments and length, none of
 * which a Senate-seat bullet trips. So the fix is upstream: a record that is not
 * linked to the resolved subject is EXCLUDED from the pack the model is handed,
 * exactly as the empty-pack refusal keeps the model from writing about nothing.
 *
 * ## What "linked to the subject" means, at the id level where it can
 *
 * The gate never reads prose. It decides linkage from ids and kinds:
 *
 * - **The positive half.** A record retrieved as the bound subject's own
 *   evidence carries `subjectId === subject.id` (or, for a body, the matching
 *   `bodyId`). It is kept. A record stamped for a DIFFERENT subject is dropped —
 *   the same id comparison `record-belongs-to-resolved-body` runs for bodies,
 *   generalised to every subject kind.
 * - **The kind half, for a MEASURE.** A ballot measure has exactly one shape of
 *   own evidence — the contest row, the official question and statement, the
 *   plain-language summary, the provisions, and its own campaign finance. A
 *   ballot-at-large record (an absence about another race) or an agenda sweep
 *   mention (about a government) is not about the measure and is dropped. A
 *   record with neither an id link nor a measure-own kind is dropped, because on
 *   a measure the honest default is that an unlinked record is off-subject.
 *
 * Body, person, contest and office subjects keep their existing retrieval: those
 * paths already scope themselves (a body by `bodyId`, a person by exact
 * identity), and their held reader questions are the proof of it. This gate adds
 * the id-level foreign-subject drop everywhere and the kind rule for measures,
 * which is the case the owner reported.
 */

/** A ballot MEASURE's own evidence kinds — the closed set that IS about it. */
const MEASURE_OWN_KINDS: ReadonlySet<EvidenceRecord["kind"]> = new Set([
  "CONTEST",
  "MEASURE_QUESTION",
  "MEASURE_STATEMENT",
  "MEASURE_ANALYSIS",
  "MEASURE_SUMMARY",
  "MEASURE_PROVISION",
  /* A "who funded this measure" question is a real measure question, and the
     finance records it retrieves are about the measure's committees. Kept so the
     gate narrows the answer without amputating a question the reader may ask. */
  "FINANCE_COMMITTEE",
  "FINANCE_TRANSACTION",
  /*
   * A CONTACT record has ALREADY been filtered by `gateContactsToSubject`
   * before it reaches this gate: for Prop 141 the reader-representative fallback
   * is gone and no CONTACT survives, and for Prop 423 the survivors ARE the
   * measure's own district board, which governs the jurisdiction the measure is
   * about. So this gate keeps CONTACT rather than dropping the very contacts the
   * basis gate just decided were connected — the two gates own different
   * questions and must not overrule each other.
   */
  "CONTACT",
]);

/** Is this record OFF the resolved subject — a positive, id-first decision. */
function recordIsOffSubject(record: EvidenceRecord, subject: EvidenceSubject): boolean {
  /*
   * The general mechanism, and it binds for every subject kind: a record
   * stamped as another subject's evidence is not this answer's, whatever its
   * kind. A null/absent stamp is NOT a foreign stamp — it means the producer did
   * not assert a subject, and the kind rules below decide it.
   */
  if (typeof record.subjectId === "string" && record.subjectId.length > 0) {
    return record.subjectId !== subject.id;
  }

  /*
   * The body id-level check, mirrored from `validate.ts` so the pack the model
   * sees agrees with the pack the validator checks: a record that names a
   * DIFFERENT body than the resolved one is off-subject. A null bodyId is not a
   * foreign body and is decided elsewhere.
   */
  if (
    subject.kind === "BODY" &&
    typeof record.bodyId === "string" &&
    record.bodyId.length > 0 &&
    record.bodyId !== subject.id
  ) {
    return true;
  }

  /*
   * A MEASURE keeps only its own evidence. An unlinked record on a measure — an
   * absence about another race, a sweep hit about a government, a contact with
   * no stated tie to the question — is off-subject by default, which is the
   * owner's rule made mechanical: nothing outside the question's subject.
   */
  if (subject.kind === "MEASURE") {
    return !MEASURE_OWN_KINDS.has(record.kind);
  }

  return false;
}

/**
 * The records that are actually about the resolved subject.
 *
 * A null subject is the ballot-at-large question — *what is on my ballot* — and
 * nothing is gated, because there is no single subject to be off. Otherwise every
 * off-subject record is removed, with the count reported so the trace can say the
 * gate ran rather than leaving an operator to infer it.
 */
export function gateRecordsToSubject(
  subject: EvidenceSubject | null,
  records: readonly EvidenceRecord[],
): { records: EvidenceRecord[]; excluded: EvidenceRecord[] } {
  if (!subject) return { records: [...records], excluded: [] };
  const kept: EvidenceRecord[] = [];
  const excluded: EvidenceRecord[] = [];
  for (const record of records) {
    (recordIsOffSubject(record, subject) ? excluded : kept).push(record);
  }
  return { records: kept, excluded };
}

/**
 * The contacts that carry a stated, sourced connection to the resolved subject.
 *
 * WHO THIS IS may name a person only when their relationship to the SUBJECT is
 * printed — they govern it, staff it, or are the office the question is about.
 * The one basis that fails that on a ballot MEASURE is the reader's own
 * representative: *"Your state senator"* is a connection to the READER, not to
 * Proposition 141, and listing it under a measure is the exact defect the owner
 * met. The measure's OWN district board (BODY_MEMBER / BODY_STAFF) governs the
 * jurisdiction the measure is about and stays — Prop 423's Vail board is the
 * control that a blanket drop would have broken.
 *
 * The reader's representatives remain the honest FALLBACK for a candidate or a
 * contest that has no roster of its own — that relationship is real and it is to
 * the reader — so the drop is scoped to a MEASURE, where a legislator who merely
 * represents the reader's district has no stated relationship to a yes/no
 * question. Every other subject keeps its contacts unchanged.
 */
export function gateContactsToSubject(
  subject: EvidenceSubject | null,
  contacts: readonly AskContact[],
): { contacts: AskContact[]; excluded: AskContact[] } {
  if (!subject || subject.kind !== "MEASURE") {
    return { contacts: [...contacts], excluded: [] };
  }
  const kept: AskContact[] = [];
  const excluded: AskContact[] = [];
  for (const contact of contacts) {
    (contact.basis === "READER_REPRESENTATIVE" ? excluded : kept).push(contact);
  }
  return { contacts: kept, excluded };
}
