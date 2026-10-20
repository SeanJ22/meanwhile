import { settlePositionHoldingAnswer, type PositionHoldingReaders } from "@/lib/candidates/position-holding";
import { readerRoute } from "@/lib/api/reader-route";
import { verifiedReaderPersonKeys } from "@/lib/identity/reader-person";
import { positionIdentityKeys } from "@/lib/identity/position-identity-keys";
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

function defaultReadersFor(subject: string, divisions: readonly string[]): PositionHoldingReaders {
  const identity = currentPositionIdentityKeys(subject, divisions);
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

  const divisions = await ballotPlaceFromRequest(request);
  const settled = await settlePositionHoldingAnswer(subject, topic, defaultReadersFor(subject, divisions));
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
