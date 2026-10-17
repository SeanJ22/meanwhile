import { readerPositionsForKeys, type ReaderPositionAnswer } from "../corpus/reader-positions.ts";
import { ReaderPersonIdentityError } from "../identity/reader-person.ts";
import { unifiedCorpusFromHoldings } from "../corpus/unified.ts";
import type { StatementCorpus } from "../corpus/types.ts";
import type { CandidateCorpus } from "./corpus.ts";

export interface PositionHoldingReaders {
  readonly candidateCorpus: () => Promise<CandidateCorpus>;
  readonly officeholderStatements: () => Promise<StatementCorpus>;
  readonly identityKeys: (subject: string) => Promise<string[]>;
}

type PositionHoldingSettlement =
  | { readonly kind: "ANSWER"; readonly answer: ReaderPositionAnswer; readonly holdingStatus: "HELD" | "PARTIAL"; readonly unavailableAuthorities: string[] }
  | { readonly kind: "IDENTITY_UNRESOLVED"; readonly error: ReaderPersonIdentityError }
  | { readonly kind: "HOLDING_UNAVAILABLE"; readonly unavailableAuthorities: string[] };

/** Settle independent corpora and exact-target identity without false absence. */
export async function settlePositionHoldingAnswer(
  subject: string,
  topic: string,
  readers: PositionHoldingReaders,
): Promise<PositionHoldingSettlement> {
  const [candidateResult, statementResult, identityResult] = await Promise.allSettled([
    Promise.resolve().then(() => readers.candidateCorpus()),
    Promise.resolve().then(() => readers.officeholderStatements()),
    Promise.resolve().then(() => readers.identityKeys(subject)),
  ]);
  if (identityResult.status === "rejected" && identityResult.reason instanceof ReaderPersonIdentityError) {
    return { kind: "IDENTITY_UNRESOLVED", error: identityResult.reason };
  }
  const unavailableAuthorities: string[] = [];
  if (candidateResult.status === "rejected") unavailableAuthorities.push("CANDIDATE_PUBLICATION");
  if (statementResult.status === "rejected") unavailableAuthorities.push("OFFICEHOLDER_STATEMENT");
  if (identityResult.status === "rejected") unavailableAuthorities.push("PERSON_IDENTITY");
  if (candidateResult.status === "rejected" && statementResult.status === "rejected") {
    return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities };
  }
  const corpus = unifiedCorpusFromHoldings({
    candidateCorpus: candidateResult.status === "fulfilled" ? candidateResult.value : undefined,
    officeholderStatements: statementResult.status === "fulfilled" ? statementResult.value : undefined,
  });
  const answer = readerPositionsForKeys(
    subject,
    topic,
    corpus,
    identityResult.status === "fulfilled" ? identityResult.value : [subject],
  );
  // A partial index can prove a passage it actually holds, but it cannot prove
  // that nothing matched or that nothing has been collected.
  if (unavailableAuthorities.length > 0 && answer.kind !== "MATCHED") {
    return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities };
  }
  return {
    kind: "ANSWER",
    answer,
    holdingStatus: unavailableAuthorities.length ? "PARTIAL" : "HELD",
    unavailableAuthorities,
  };
}
