import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, opendir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { manualProjectionCandidate, readManualProjectionPrior, type ManualProjectionPackage } from "../civic-data/manual-projections.ts";
import { mergeBallotContests } from "../civic-data/worker-ballot-contests.ts";
import { processRegisteredManualCandidate } from "../civic-data/promotion.ts";
import { publishPlaceReaderEdgeOutcome } from "../civic-data/place-edge-publication.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { placeMeasureProblems, placeMeasureScope, type PlaceMeasureProjection } from "./place-measures.ts";
import { requireBallotState } from "./state-scopes.ts";

export async function publishHeldPlaceMeasures(input: {
  readonly root: string;
  readonly state: string;
  readonly store: RoutineDataStore;
  readonly vault: EvidenceStore;
  readonly artifactStore?: ReaderArtifactStore;
  readonly now: () => string;
  readonly report: (line: string) => void;
}) {
  const state = requireBallotState(input.state);
  const directory = join(input.root, "data/ballot/measures/2026-general", state);
  const cacheDirectory = join(input.root, ".runtime/held-place-measures/2026-general", state);
  const result = { state, published: 0, reused: 0, held: 0 };
  const entries = await opendir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!entries) return result;
  for await (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const division = decodeURIComponent(entry.name.slice(0, -5)), scope = placeMeasureScope(division);
      if (entry.name !== `${encodeURIComponent(division)}.json` || jurisdictionFromOcdId(division)?.usps !== state) {
        throw new Error("Held measure filename must name one place in its state.");
      }
      const path = join(directory, entry.name), hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      const inputHash = hash.digest("hex"), cachePath = join(cacheDirectory, entry.name);
      const cached = await readFile(cachePath, "utf8").then(body => JSON.parse(body) as { inputHash?: string; versionId?: string }).catch(() => null);
      const pointer = await input.store.readPromotionIdentity("BALLOT_CANDIDACY", scope);
      let versionId = pointer?.versionId, records = 0;
      const current = Boolean(versionId && cached?.inputHash === inputHash && cached.versionId === versionId);
      if (!current) {
        const body = await readFile(path);
        if (createHash("sha256").update(body).digest("hex") !== inputHash) throw new Error("Held measure input changed while it was being read.");
        const held = JSON.parse(body.toString("utf8")) as ManualProjectionPackage;
        const payload = held.payload as PlaceMeasureProjection;
        if (held.contractId !== "ballot-measures" || payload?.ocdId !== division || placeMeasureProblems(payload).length) {
          throw new Error("Held measure package must match its exact place and ballot contract.");
        }
        const now = input.now(), prior = await readManualProjectionPrior("ballot-measures", input.store, now, scope);
        const temporal = prior ? (await (input.store.readCandidateProof ?? input.store.readCandidate).call(input.store, prior.versionId))?.candidate.temporal : null;
        if (prior && !temporal) throw new Error("Held measure predecessor has no source chronology.");
        const merged = mergeBallotContests(held, prior);
        const sourceThrough = [held.sourceThrough, ...(temporal ? [temporal.sourceThrough] : []), ...merged.sourceReceipt.sources.map(source => source.retrievedAt)]
          .reduce((latest, stamp) => Date.parse(stamp) > Date.parse(latest) ? stamp : latest);
        const candidate = manualProjectionCandidate({ ...merged, version: temporal?.version ?? held.version, sourceThrough,
          sourceReceipt: { ...merged.sourceReceipt, reviewedAt: now, reviewedBy: "publish-held-measures" } });
        const outcome = await processRegisteredManualCandidate(input.store, "ballot-measures", candidate, now, prior?.versionId ?? null, { vault: input.vault });
        if (!outcome.promoted || !outcome.confirmed && outcome.readerReadback?.status !== "PASS") {
          throw new Error(outcome.candidate.failureDetail ?? "Held measure publication did not reach its typed reader.");
        }
        versionId = outcome.promoted.versionId;
        records = Object.values(payload.ballots).reduce((count, ballot) => count + ballot.measures.length, 0);
      }
      const edge = await publishPlaceReaderEdgeOutcome(input.store, input.now(), [{ recordClass: "BALLOT_CANDIDACY", scope }],
        { artifactStore: input.artifactStore });
      if (!edge.ok) throw new Error(edge.detail ?? "Held measures have not reached their place reader.");
      if (current) result.reused++;
      else {
        await mkdir(cacheDirectory, { recursive: true });
        const temporary = `${cachePath}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({ inputHash, versionId }));
        await rename(temporary, cachePath);
        result.published++;
        input.report(`RCD_PROGRESS=${JSON.stringify({ key: versionId, records })}`);
      }
    } catch (error) {
      result.held++;
      input.report(`Held place measures ${state}/${entry.name}: ${sanitizedErrorDiagnostic(error)}`);
    }
  }
  return result;
}
