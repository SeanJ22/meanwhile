import { readerPositionsForKeys, type ReaderPositionAnswer } from "@/lib/corpus/reader-positions";
import { ReaderPersonIdentityError } from "@/lib/identity/reader-person";
import { verifiedReaderPersonKeys } from "@/lib/identity/reader-person";
import { positionIdentityKeys } from "@/lib/identity/position-identity-keys";
import { unifiedCorpusFromHoldings } from "@/lib/corpus/unified";
import type { StatementCorpus } from "@/lib/corpus/types";
import type { CandidateCorpus } from "@/lib/candidates/corpus";
import { getCandidateCorpus } from "@/lib/candidates/positions";
import {
  refreshAzBallotFromPromoted,
  refreshCandidateCorpusFromPromoted,
} from "@/lib/civic-data/manual-read-models";
import { refreshOfficeholderStatementsFromPromoted } from "@/lib/corpus/data-plane";
import { currentOfficeholderStatements } from "@/lib/corpus/data-plane";
import { refreshFederalDirectoryFromPromoted } from "@/lib/officials/federal-directory-read-model";
import { refreshRegistryRuntimeFromPromoted } from "@/lib/registry/runtime-read-model";
import { getRegistryRuntimeReadModel } from "@/lib/registry/runtime-read-model";

export interface PositionHoldingReaders {
  readonly candidateCorpus: () => Promise<CandidateCorpus>;
  readonly officeholderStatements: () => Promise<StatementCorpus>;
  readonly identityKeys: (subject: string) => Promise<string[]>;
}

export type PositionHoldingSettlement =
  | { readonly kind: "ANSWER"; readonly answer: ReaderPositionAnswer; readonly holdingStatus: "HELD" | "PARTIAL"; readonly unavailableAuthorities: string[] }
  | { readonly kind: "IDENTITY_UNRESOLVED"; readonly error: ReaderPersonIdentityError }
  | { readonly kind: "HOLDING_UNAVAILABLE"; readonly unavailableAuthorities: string[] };

function currentPositionIdentityKeys(subject: string): Promise<string[]> {
  return positionIdentityKeys(subject, {
    refreshRegistry: () => refreshRegistryRuntimeFromPromoted(),
    refreshFederal: () => refreshFederalDirectoryFromPromoted(),
    refreshAz: () => refreshAzBallotFromPromoted(),
    relatedAuthorities: (id) => {
      const related = getRegistryRuntimeReadModel().officialCandidacies.rows.filter((row) =>
        row.holder.id === id || row.candidacy?.candidacyId === id,
      );
      return {
        federal: related.some((row) => row.holder.authority === "FEDERAL_DIRECTORY"),
        az: related.some((row) => row.candidacy?.candidacyId.startsWith("ballot-az-")),
      };
    },
    personKeys: verifiedReaderPersonKeys,
  });
}

const defaultReaders: PositionHoldingReaders = {
  candidateCorpus: async () => {
    await refreshCandidateCorpusFromPromoted();
    return getCandidateCorpus();
  },
  officeholderStatements: async () => {
    await refreshOfficeholderStatementsFromPromoted();
    return currentOfficeholderStatements();
  },
  identityKeys: currentPositionIdentityKeys,
};

/** Settle independent corpora and exact-target identity without false absence. */
export async function settlePositionHoldingAnswer(
  subject: string,
  topic: string,
  readers: PositionHoldingReaders = defaultReaders,
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
