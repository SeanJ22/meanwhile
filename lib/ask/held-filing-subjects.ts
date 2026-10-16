import { currentAzBallotProjection } from "../civic-data/manual-read-models.ts";
import { bindNamedEntity, type BindableEntity } from "../routing/named-entity.ts";
import type { EvidenceRecord } from "./evidence.ts";


export interface HeldFilingSubject {
  readonly entity: BindableEntity;
  readonly ocdId: string;
  readonly heldCandidacyId: string | null;
  readonly record: EvidenceRecord;
}

export function azHeldFilingSubjects(value: unknown = currentAzBallotProjection().candidateFilings): HeldFilingSubject[] {
  const doc = value as { contests?: unknown[]; candidacies?: unknown[] } | null;
  if (!Array.isArray(doc?.contests) || !Array.isArray(doc?.candidacies)) throw new Error("The promoted Arizona filing identity corpus is unreadable.");
  const contests = new Map(doc.contests.map(value => {
    const c = value as { id: string; title: string; ocdId: string };
    return [c.id, c];
  }));
  return doc.candidacies.map(value => {
    const c = value as { id: string; contestId: string; givenName: string; familyName: string; heldIdentityJoin?: { heldCandidacyId?: string } | null; provenance?: { sourceUrl?: string; sourceOrg?: string; collectedAt?: string } };
    const contest = contests.get(c.contestId);
    if (!c.id?.startsWith("az-sos-") || !c.givenName || !c.familyName || !contest?.ocdId || !contest.title || !c.provenance?.sourceUrl) throw new Error("A promoted Arizona filing lacks its identity or source.");
    const name = `${c.givenName} ${c.familyName}`;
    return { entity: { id: c.id, name, nameClass: "person", divisionType: "person" }, ocdId: contest.ocdId,
      heldCandidacyId: c.heldIdentityJoin?.heldCandidacyId ?? null,
      record: { kind: "CANDIDACY", id: `held-filing:${c.id}`, subjectId: c.id,
        text: `${name} is recorded in the source filing for ${contest.title}. This filing alone does not establish a current general-election ballot position.`,
        sourceUrl: c.provenance.sourceUrl, sourceOrg: c.provenance.sourceOrg ?? null, retrievedAt: c.provenance.collectedAt ?? null } };
  });
}

/** Explicit source IDs remain answerable; a named existing ballot identity wins
 * over its joined source filing, avoiding a duplicate person in the binder. */
export function requestedHeldFilings(rows: readonly HeldFilingSubject[], question: string, explicitIds: readonly string[], representedIds: ReadonlySet<string>): HeldFilingSubject[] {
  const explicit = new Set(explicitIds);
  const binding = bindNamedEntity(question, rows.map(row => row.entity));
  const named = new Set(binding.kind === "BOUND" ? [binding.entity.id] : binding.kind === "AMBIGUOUS" ? binding.candidates.map(c => c.id) : []);
  return rows.filter(row => explicit.has(row.entity.id) || (named.has(row.entity.id) && !(row.heldCandidacyId && representedIds.has(row.heldCandidacyId))));
}
