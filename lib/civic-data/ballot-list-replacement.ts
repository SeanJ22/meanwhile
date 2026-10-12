import type { Candidacy, Contest } from "../ballot/types.ts";
import type { BallotCandidateListEvidence, ManualSourceSetReceipt } from "./types.ts";

/** A complete, newer reading can replace only the same publisher's exact contest. */
export function verifiedBallotListReplacement(input: {
  contest: Contest;
  priorContest: Contest | undefined;
  candidates: readonly Candidacy[];
  priorCandidates: readonly Candidacy[];
  evidence: readonly BallotCandidateListEvidence[];
  receipt: ManualSourceSetReceipt;
}): boolean {
  const { contest, priorContest, candidates, priorCandidates, receipt } = input;
  const proofs = input.evidence.filter(row => row && row.contestId === contest.id);
  const proof = proofs[0];
  if (proofs.length !== 1 || !proof || !priorContest || contest.type !== "CANDIDACY" ||
    contest.candidateListComplete !== true || contest.electionId !== priorContest.electionId ||
    contest.ocdId !== priorContest.ocdId || contest.provenance.sourceUrl !== priorContest.provenance.sourceUrl ||
    proof.sourceUrl !== contest.provenance.sourceUrl || proof.retrievedAt !== contest.provenance.collectedAt ||
    !Number.isFinite(Date.parse(proof.retrievedAt)) || !Number.isFinite(Date.parse(priorContest.provenance.collectedAt)) ||
    !/^[a-f0-9]{64}$/.test(proof.rawHash) || !Array.isArray(proof.candidateIds) ||
    !proof.candidateIds.every(id => typeof id === "string" && id.length > 0) ||
    Date.parse(proof.retrievedAt) <= Date.parse(priorContest.provenance.collectedAt)) return false;
  const current = candidates.filter(row => row.contestId === contest.id);
  if (!current.length || new Set(proof.candidateIds).size !== proof.candidateIds.length ||
    current.length !== proof.candidateIds.length || current.some(row => !proof.candidateIds.includes(row.id) ||
      row.provenance.sourceUrl !== proof.sourceUrl || row.provenance.collectedAt !== proof.retrievedAt)) return false;
  if (priorCandidates.filter(row => row.contestId === contest.id && !proof.candidateIds.includes(row.id))
    .some(row => row.provenance.sourceUrl !== proof.sourceUrl ||
      !Number.isFinite(Date.parse(row.provenance.collectedAt)) || Date.parse(row.provenance.collectedAt) >= Date.parse(proof.retrievedAt))) return false;
  return receipt.sources.some(source => source.finalUrl === proof.sourceUrl && source.rawHash === proof.rawHash &&
    source.retrievedAt === proof.retrievedAt && source.reviewOutcome !== "BLOCKED" &&
    source.httpStatus >= 200 && source.httpStatus < 300 &&
    ["ELECTION_AUTHORITY", "OFFICIAL_PUBLISHER"].includes(source.sourceClass));
}
