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

/**
 * GET /api/positions/<subject>/<topic>
 *
 * Subject and topic are path segments because both vary the body and every cache keys on the path; the
 * response is also `no-store`. Returns the corpus's own words with URL and read date, or a named gap. No model.
 */

export const runtime = "nodejs";

/** A topic longer than this is not a topic. The cap is stated, not implied. */
const MAX_TOPIC_CHARS = 120;

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ subject: string; topic: string }> },
) {
  const { subject: rawSubject, topic: rawTopic } = await params;
  const subject = decodeURIComponent(rawSubject);
  const topic = decodeURIComponent(rawTopic).slice(0, MAX_TOPIC_CHARS);

  if (!subject || !topic.trim()) {
    return Response.json({ error: "subject and topic are required" }, { status: 400 });
  }

  const settled = await settlePositionHoldingAnswer(subject, topic);
  if (settled.kind === "IDENTITY_UNRESOLVED") {
    return Response.json({ error: settled.error.message, holdingStatus: "IDENTITY_UNRESOLVED" }, { status: 409 });
  }
  if (settled.kind === "HOLDING_UNAVAILABLE") {
    return Response.json({ error: "the statement corpus could not be read", holdingStatus: "HOLDING_UNAVAILABLE", unavailableAuthorities: settled.unavailableAuthorities }, { status: 503 });
  }
  const { answer } = settled;

  return Response.json(
    {
      ...answer,
      holdingStatus: settled.holdingStatus,
      unavailableAuthorities: settled.unavailableAuthorities,
      // Stated N equals rendered rows, and the denominator rides with it.
      totalMatches: answer.passages.length,
    },
    {
      status: 200,
      headers: {
        // Varies by two path inputs and is cheap to recompute; nothing here
        // is worth a shared cache getting subtly wrong.
        "Cache-Control": "private, no-store",
      },
    },
  );
}
