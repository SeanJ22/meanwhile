import { ballotQuestionShape, composeBallotSummary, composeOfficeField, type BallotAsk, type BallotComposition } from "./ballot-summary.ts";
import type { BallotForDivisions } from "./server-sources.ts";
import type { EvidencePack } from "./evidence.ts";
import { validateAnswer } from "./validate.ts";

export function composeSelectedBallots(ballot: BallotForDivisions, shape: BallotAsk): BallotComposition | null {
  const parts = ballot.sets.flatMap(set => {
    const part = shape.kind === "SUMMARY"
      ? composeBallotSummary({ contests: set.contests, election: set.election })
      : composeOfficeField({ ...shape, contests: set.contests, election: set.election,
        nominees: ballot.nominees, candidacies: set.candidacies,
        removedCandidacyIds: new Set((set.removals ?? []).map(row => row.id)) });
    return part ? [{ ...part, answer: ballot.sets.length > 1 ? `${set.election.state}: ${part.answer}` : part.answer }] : [];
  });
  return parts.length ? { answer: parts.map(part => part.answer).join("\n\n"),
    citedUrls: [...new Set(parts.flatMap(part => part.citedUrls))],
    records: parts.flatMap(part => part.records), gaps: parts.flatMap(part => part.gaps) } : null;
}

export function composeBallotOnlyAnswer(ballot: BallotForDivisions, question: string, today: string) {
  if (!ballot.set || ballot.loaderFailures.length) return null;
  const shape = ballotQuestionShape(question, ballot.contests);
  if (!shape) return null;
  const composed = composeSelectedBallots(ballot, shape);
  if (!composed) return null;
  const pack: EvidencePack = { question, intent: "UNKNOWN", temporal: { kind: "NONE" }, subject: null,
    records: composed.records, gaps: composed.gaps.map(statement => ({ whose: "OURS", statement })),
    denominators: { ballotLoaderFailures: 0 }, today };
  const verdict = validateAnswer(composed.answer, composed.citedUrls, pack);
  if (verdict.kind !== "PASSED") return null;
  return { composed, pack, verdict, shape };
}
