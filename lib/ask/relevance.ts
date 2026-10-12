import type { AskContact } from "./contacts.ts";
import type { EvidenceRecord, EvidenceSubject } from "./evidence.ts";

const MEASURE_OWN_KINDS: ReadonlySet<EvidenceRecord["kind"]> = new Set([
  "CONTEST",
  "MEASURE_QUESTION",
  "MEASURE_STATEMENT",
  "MEASURE_ANALYSIS",
  "MEASURE_SUMMARY",
  "MEASURE_PROVISION",
  "FINANCE_COMMITTEE",
  "FINANCE_TRANSACTION",
  "CONTACT",
]);

function recordIsOffSubject(record: EvidenceRecord, subject: EvidenceSubject, alsoAbout: ReadonlySet<string>): boolean {
  if (typeof record.subjectId === "string" && record.subjectId.length > 0) {
    return record.subjectId !== subject.id && !alsoAbout.has(record.subjectId);
  }

  if (
    subject.kind === "BODY" &&
    typeof record.bodyId === "string" &&
    record.bodyId.length > 0 &&
    record.bodyId !== subject.id
  ) {
    return true;
  }

  if (subject.kind === "MEASURE") {
    return !MEASURE_OWN_KINDS.has(record.kind);
  }

  return false;
}

export function gateRecordsToSubject(
  subject: EvidenceSubject | null,
  records: readonly EvidenceRecord[],
  alsoAbout: ReadonlySet<string> = new Set(),
): { records: EvidenceRecord[]; excluded: EvidenceRecord[] } {
  if (!subject) return { records: [...records], excluded: [] };
  const kept: EvidenceRecord[] = [];
  const excluded: EvidenceRecord[] = [];
  for (const record of records) {
    (recordIsOffSubject(record, subject, alsoAbout) ? excluded : kept).push(record);
  }
  return { records: kept, excluded };
}

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
