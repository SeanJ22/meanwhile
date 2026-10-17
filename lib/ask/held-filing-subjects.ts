import type { BallotSet } from "../ballot/types.ts";
import { bindNamedEntity, type BindableEntity } from "../routing/named-entity.ts";
import type { EvidenceRecord } from "./evidence.ts";

export interface HeldFilingSubject {
  readonly entity: BindableEntity;
  readonly ocdId: string;
  readonly heldCandidacyId: string | null;
  readonly candidacyId: string;
  readonly record: EvidenceRecord;
}

export function heldFilingSubjects(ballot: BallotSet | null): HeldFilingSubject[] {
  if (!ballot) return [];
  const contests = new Map(ballot.contests.map(contest => [contest.id, contest]));
  const current = new Set(ballot.candidacies.map(candidate => candidate.id));
  return [...ballot.candidacies, ...ballot.filingCandidacies ?? []].flatMap(candidate => {
    const filing = candidate.filing;
    const contest = contests.get(candidate.contestId);
    if (!filing || !contest) return [];
    const name = `${candidate.givenName} ${candidate.familyName}`;
    return [{ entity: { id: filing.id, name, nameClass: "person" as const, divisionType: "person" }, ocdId: contest.ocdId,
      candidacyId: candidate.id, heldCandidacyId: current.has(candidate.id) ? candidate.id : null,
      record: { kind: "CANDIDACY" as const, id: `held-filing:${filing.id}`, subjectId: filing.id,
        text: `${name} is recorded in the source filing for ${contest.title}. This filing alone does not establish a current general-election ballot position.`,
        sourceUrl: filing.provenance.sourceUrl, sourceOrg: filing.provenance.sourceOrg, retrievedAt: filing.provenance.collectedAt } }];
  });
}

/** Explicit source IDs remain answerable; a named existing ballot identity wins
 * over its joined source filing, avoiding a duplicate person in the binder. */
export function requestedHeldFilings(rows: readonly HeldFilingSubject[], question: string, explicitIds: readonly string[], representedIds: ReadonlySet<string>): HeldFilingSubject[] {
  const explicit = new Set(explicitIds);
  const binding = bindNamedEntity(question, rows.map(row => row.entity));
  const named = new Set(binding.kind === "BOUND" ? [binding.entity.id] : binding.kind === "AMBIGUOUS" ? binding.candidates.map(c => c.id) : []);
  return rows.filter(row => explicit.has(row.entity.id) || explicit.has(row.candidacyId) ||
    (named.has(row.entity.id) && !(row.heldCandidacyId && representedIds.has(row.heldCandidacyId))))
    .map(row => explicit.has(row.candidacyId) && row.candidacyId !== row.entity.id ? { ...row, entity: { ...row.entity, id: row.candidacyId },
      record: { ...row.record, subjectId: row.candidacyId, canonicalSubjectId: row.candidacyId } } : row);
}
