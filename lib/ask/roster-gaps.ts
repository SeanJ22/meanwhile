import { rosterGapForBody } from "../registry/body-rosters.ts";
import { currentBodyRosters } from "../registry/runtime-read-model.ts";
import type { AskContact } from "./contacts.ts";
import type { EvidenceGap, EvidenceRecord, EvidenceSubject } from "./evidence.ts";

export function rosterGapEvidenceFor(subject: EvidenceSubject | null, contacts: readonly AskContact[], canonicalOfficialIds: ReadonlySet<string>) {
  const records: EvidenceRecord[] = [];
  const gaps: EvidenceGap[] = [];
  const denominators: Record<string, number> = {};
  if (!subject) return { records, gaps, denominators };
  const ids = new Set([...canonicalOfficialIds, ...contacts.filter((contact) => contact.basis !== "READER_REPRESENTATIVE").map((contact) => contact.id.startsWith("office:") ? contact.id.slice(7) : contact.id)]);
  const bodies = new Set(subject.kind === "BODY" ? [subject.id] : []);
  for (const roster of currentBodyRosters()) if (roster.members.some((member) => ids.has(member.id))) bodies.add(roster.bodyId);
  for (const bodyId of bodies) {
    const gap = rosterGapForBody(bodyId);
    if (!gap) continue;
    gaps.push({ whose: "OURS", statement: gap.statement });
    records.push({ kind: "ROSTER_IDENTITY_GAP", id: `${bodyId}#roster-identity-gap`, bodyId, subjectId: subject.id,
      text: gap.statement, sourceUrl: gap.sourceUrl, sourceOrg: gap.sourceOrg, retrievedAt: gap.readAt, rosterGap: gap });
    denominators.rosterExpectedMembers = (denominators.rosterExpectedMembers ?? 0) + gap.expectedMembers;
    denominators.rosterVerifiedMembers = (denominators.rosterVerifiedMembers ?? 0) + gap.verifiedMembers;
    denominators.rosterUnresolvedIdentities = (denominators.rosterUnresolvedIdentities ?? 0) + gap.unresolvedSlots;
  }
  return { records, gaps, denominators };
}
