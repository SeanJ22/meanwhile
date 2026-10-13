import { bindNamedEntity, type BindableEntity } from "../routing/named-entity.ts";
import { fecRegistrationLabel } from "../funding/fec-discovery.ts";
import { getFundingSnapshot } from "../funding/snapshot.ts";
import type { FundingCandidate, FundingSnapshot } from "../funding/types.ts";
import { surnameDisplayCase } from "../ballot/name-case.ts";
import { displayPersonName } from "../officials/person-name.ts";
import type { EvidencePack, EvidenceRecord } from "./evidence.ts";

export const fecPersonId = (row: FundingCandidate): string => row.targetKeys.find(key => key.startsWith("congress:")) ?? `fec:${row.fecCandidateId}`;
export function fecPersonName(name: string): string {
  if (!name.trim()) return displayPersonName(name);
  const [family, given, ...suffixes] = name.split(",").map(part => part.trim()).filter(Boolean);
  return surnameDisplayCase(given ? [given, family, ...suffixes].join(" ") : family);
}
export function fecRegistrationRecord(row: FundingCandidate, personId = fecPersonId(row)): EvidenceRecord {
  const name = fecPersonName(row.name);
  return { kind: "CANDIDACY", id: `fec-registration:${row.fecCandidateId}`, subjectId: personId,
    text: `${name} is ${fecRegistrationLabel(row)} for the ${row.registration?.electionYear ?? row.cycle} election.`,
    sourceUrl: row.provenance.sourceUrl, sourceOrg: row.provenance.sourceOrg,
    retrievedAt: row.registration?.collectedAt ?? row.provenance.collectedAt,
    fecProfile: { candidateId: row.fecCandidateId, name, personId } };
}
export function requestedFecSubjects(question: string, explicitIds: readonly string[], snapshot: FundingSnapshot = getFundingSnapshot()): { entity: BindableEntity; record: EvidenceRecord }[] {
  const all = snapshot.candidates.map(row => ({ entity: { id: fecPersonId(row), name: fecPersonName(row.name),
    nameClass: "person" as const, divisionType: "person" }, record: fecRegistrationRecord(row), row }));
  const binding = bindNamedEntity(question, all.map(row => row.entity));
  const named = new Set(binding.kind === "BOUND" ? [binding.entity.id] : binding.kind === "AMBIGUOUS" ? binding.candidates.map(row => row.id) : []);
  const explicit = new Set(explicitIds);
  return all.filter(({ entity, row }) => named.has(entity.id) || explicit.has(entity.id) || explicit.has(`fec:${row.fecCandidateId}`))
    .map(({ entity, record }) => ({ entity, record }));
}

/** This query is a FEC registration scope; it creates no ballot contest. */
export function fecRaceMoneyQuestion(question: string): { state: string; district: string } | null {
  const match = /^who (?:is raising|has raised|raised) the most(?: (?:money|campaign money))? (?:for|in) ([a-z]{2})[-–](\d{1,2})\??$/i.exec(question.trim());
  return match ? { state: match[1].toUpperCase(), district: match[2].padStart(2, "0") } : null;
}
export function fecRaceMoneyAnswer(question: string, today: string, snapshot: FundingSnapshot = getFundingSnapshot()): { pack: EvidencePack; answer: string; citedUrls: string[] } | null {
  const scope = fecRaceMoneyQuestion(question); if (!scope) return null;
  const rows = snapshot.candidates.filter(row => row.cycle === snapshot.cycle && row.office === "H" && row.state === scope.state && row.district === scope.district);
  if (!rows.length) return null;
  const filed = rows.filter(row => row.totals.receipts !== null).sort((a, b) => b.totals.receipts! - a.totals.receipts! || a.fecCandidateId.localeCompare(b.fecCandidateId));
  if (!filed.length) return null;
  const leaders = filed.filter(row => row.totals.receipts === filed[0].totals.receipts);
  const money = (row: FundingCandidate) => `$${row.totals.receipts!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const names = leaders.map(row => fecPersonName(row.name)).join(" and ");
  const answer = `Of ${rows.length} FEC registrations for House ${scope.state}-${scope.district}, ${filed.length} have filed receipts in the ${snapshot.cycle - 1}–${String(snapshot.cycle).slice(-2)} cycle. ${names} reported ${leaders.length > 1 ? "the joint highest receipts" : "the most raised"}: ${money(leaders[0])}${leaders.length > 1 ? " each" : ""}. Filed with the Federal Election Commission; each record lists its reporting date.`;
  const records = rows.flatMap(row => [fecRegistrationRecord(row), { kind: "FINANCE_SUMMARY" as const, id: `fec:${row.fecCandidateId}`,
    subjectId: fecPersonId(row), text: row.totals.receipts === null ? `Filed receipts for ${fecPersonName(row.name)} are not held.` :
      `${fecPersonName(row.name)} reported receipts of ${money(row)} for the ${snapshot.cycle} cycle, through ${row.totals.coverageEndDate ?? "the recorded filing period"}.`,
    sourceUrl: row.provenance.sourceUrl, sourceOrg: row.provenance.sourceOrg, retrievedAt: row.provenance.collectedAt }]);
  const pack: EvidencePack = { question, today, intent: "PERSON_RECORD", temporal: { kind: "NONE" }, subject: null, records,
    gaps: rows.length === filed.length ? [] : [{ whose: "OURS", statement: `Filed receipts are not held for ${rows.length - filed.length} of these FEC registrations.` }],
    denominators: { fecRegisteredCandidates: rows.length, fecCandidatesWithFiledReceipts: filed.length } };
  return { pack, answer, citedUrls: leaders.flatMap(row => row.provenance.sourceUrl ? [row.provenance.sourceUrl] : []) };
}
