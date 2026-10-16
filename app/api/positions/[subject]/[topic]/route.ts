import { readerRoute } from "@/lib/api/reader-route";
import { readRegistryPlace } from "@/lib/registry/reader-place";
import { withRegistryPlaceRead } from "@/lib/registry/runtime-read-model";
import type { ReaderAuthorityManifest } from "@/lib/meetings/edge-artifacts";
import { ensureReaderAuthorityEdge, readReaderAuthorityManifest } from "@/lib/meetings/edge-serving";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { readerPositionsForKeys, type ReaderPositionAnswer } from "@/lib/corpus/reader-positions";
import { ReaderPersonIdentityError } from "@/lib/identity/reader-person";
import { verifiedReaderPersonKeys } from "@/lib/identity/reader-person";
import { positionIdentityKeys } from "@/lib/identity/position-identity-keys";
import { unifiedCorpusFromHoldings } from "@/lib/corpus/unified";
import type { StatementCorpus } from "@/lib/corpus/types";
import type { CandidateCorpus } from "@/lib/candidates/corpus";
import { getCandidateCorpus } from "@/lib/candidates/positions";
import { refreshCandidateCorpusFromPromoted } from "@/lib/civic-data/manual-read-models";
import { ballotStatesForDivisions, readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";
import { ballotPlaceFromRequest } from "@/lib/ballot/reader-place";
import { refreshOfficeholderStatementsFromPromoted } from "@/lib/corpus/data-plane";
import { currentOfficeholderStatements } from "@/lib/corpus/data-plane";
import { settleFederalDirectoryRead, settleRegistryAuthorityReads } from "@/lib/registry/server";
import { getRegistryRuntimeReadModel } from "@/lib/registry/runtime-read-model";

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

function currentPositionIdentityKeys(subject: string, divisions: readonly string[]): Promise<string[]> {
  return positionIdentityKeys(subject, {
    refreshRegistry: () => settleRegistryAuthorityReads("REGISTRY"),
    refreshFederal: settleFederalDirectoryRead,
    refreshBallot: async () => {
      for (const { source } of await readerBallotSourcesForDivisions(divisions)) source.normalize(await source.fetch());
    },
    relatedAuthorities: (id) => ({
      federal: getRegistryRuntimeReadModel().officialCandidacies.rows.some(row =>
        (row.holder.id === id || row.candidacy?.candidacyId === id) && row.holder.authority === "FEDERAL_DIRECTORY"),
      ballot: divisions.length > 0,
    }),
    personKeys: verifiedReaderPersonKeys,
  });
}

function defaultReadersFor(subject: string, divisions: readonly string[], manifest?: ReaderAuthorityManifest | null): PositionHoldingReaders {
  const identity = readRegistryPlace(divisions, [subject], manifest).then(registry =>
    withRegistryPlaceRead(registry, () => currentPositionIdentityKeys(subject, divisions)));
  identity.catch(() => undefined);
  return {
    candidateCorpus: async () => {
      const keys = new Set(await identity);
      const corpora = await Promise.all(ballotStatesForDivisions(divisions).map(async state => {
        await refreshCandidateCorpusFromPromoted(state);
        return getCandidateCorpus(state);
      }));
      return { formatVersion: 1, attempted: corpora.reduce((n, corpus) => n + corpus.attempted, 0),
        fetchedAt: corpora.map(corpus => corpus.fetchedAt).sort().at(-1) ?? "",
        documents: corpora.flatMap(corpus => corpus.documents.filter(document => keys.has(document.candidateKey))),
        failures: corpora.flatMap(corpus => corpus.failures.filter(failure => keys.has(failure.candidateKey))) };
    },
    officeholderStatements: async () => {
      await refreshOfficeholderStatementsFromPromoted();
      const keys = new Set(await identity);
      return { snapshots: currentOfficeholderStatements().snapshots.filter(snapshot => keys.has(snapshot.subjectId)) };
    },
    identityKeys: () => identity,
  };
}

/** Settle independent corpora and exact-target identity without false absence. */
export async function settlePositionHoldingAnswer(
  subject: string,
  topic: string,
  readers?: PositionHoldingReaders,
  divisions: readonly string[] = [],
): Promise<PositionHoldingSettlement> {
  readers ??= defaultReadersFor(subject, divisions);
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

export const GET = readerRoute("/api/positions/[subject]/[topic]", async function GET(
  request: Request,
  { params }: { params: Promise<{ subject: string; topic: string }> },
) {
  const { subject: rawSubject, topic: rawTopic } = await params;
  const subject = decodeURIComponent(rawSubject);
  const topic = decodeURIComponent(rawTopic).slice(0, MAX_TOPIC_CHARS);

  if (!subject || !topic.trim()) {
    return Response.json({ error: "subject and topic are required" }, { status: 400 });
  }

  const manifest = await readReaderAuthorityManifest().catch(() => null);
  if (manifest) {
    const edge = await ensureReaderAuthorityEdge(manifest, undefined, ["federal-directory", "ballot-contests", "candidate-publications", "officeholder-statements"]).catch(() => null);
    if (edge) enterReaderAuthorityEdge(edge);
  }
  const divisions = await ballotPlaceFromRequest(request);
  const settled = await settlePositionHoldingAnswer(subject, topic, defaultReadersFor(subject, divisions, manifest), divisions);
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
});
