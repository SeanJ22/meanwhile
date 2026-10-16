import { ballotQuestionShape, composeBallotSummary, composeOfficeField } from "./ballot-summary.ts";
import type { BallotForDivisions } from "./server-sources.ts";
import type { EvidencePack } from "./evidence.ts";
import { validateAnswer } from "./validate.ts";

/** A general ballot's field needs no calendars, biographies, money or votes. */
export function composeBallotOnlyAnswer(ballot: BallotForDivisions, question: string, today: string) {
  if (ballot.authorityKind !== "GENERAL" || !ballot.set || ballot.loaderFailures.length) return null;
  const shape = ballotQuestionShape(question, ballot.contests);
  if (!shape) return null;
  const composed = shape.kind === "SUMMARY"
    ? composeBallotSummary({ contests: ballot.contests, election: ballot.set.election })
    : composeOfficeField({ ...shape, contests: ballot.contests, election: ballot.set.election,
      nominees: ballot.nominees, candidacies: ballot.set.candidacies,
      removedCandidacyIds: new Set((ballot.set.removals ?? []).map(row => row.id)) });
  if (!composed) return null;
  const pack: EvidencePack = { question, intent: "UNKNOWN", temporal: { kind: "NONE" }, subject: null,
    records: composed.records, gaps: composed.gaps.map(statement => ({ whose: "OURS", statement })),
    denominators: { ballotLoaderFailures: 0 }, today };
  const verdict = validateAnswer(composed.answer, composed.citedUrls, pack);
  if (verdict.kind !== "PASSED") return null;
  return { composed, pack, verdict, shape };
}
