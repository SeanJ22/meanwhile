import type { SeatHolder } from "../officials/lookup.ts";
import type { EvidenceRecord } from "./evidence.ts";

/** One identity/office answer, including verbatim sourced roster wording. */
export function officeholderEvidence(seat: SeatHolder, recordId = seat.id): EvidenceRecord {
  return { kind: "OFFICEHOLDER", id: recordId, canonicalSubjectId: seat.id,
    text: `${seat.name} holds the office of ${seat.officeTitle}${seat.selectionMethod === "APPOINTED" ? ", appointed" : seat.selectionMethod === "ELECTED_STATEWIDE" ? ", elected statewide" : ""}${seat.partyLabel ? `, ${seat.partyLabel}` : ""}${seat.termEnd ? `, in seat until ${seat.termEnd}` : ""}.${seat.termNote ? ` The source roster states: “${seat.termNote}”` : ""}`,
    sourceUrl: seat.sourceUrl, sourceOrg: seat.provenance?.sourceOrg ?? null, retrievedAt: seat.provenance?.collectedAt ?? null,
    officeholder: { officialId: seat.id, termNote: seat.termNote ?? null } };
}
