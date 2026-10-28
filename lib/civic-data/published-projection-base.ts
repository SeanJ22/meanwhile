import type { CandidateVersionRecord, RoutineCandidate } from "./types.ts";
import type { RoutineDataStore } from "./store.ts";

export const isTranslationProjection = (recordClass: string, scope: string) =>
  recordClass === "CURATED_READER_RECORD" && scope.startsWith("US:plain-english-translations:");

/** Reuse the payload already read from the pointer; fetch only validation metadata. */
export async function readPublishedProjectionBase(
  store: Partial<Pick<RoutineDataStore, "readPublishedCandidateMetadata" | "readCandidatePath">>,
  versionId: string,
  payload?: unknown,
): Promise<CandidateVersionRecord | null> {
  if (!store.readPublishedCandidateMetadata || !store.readCandidatePath) throw new Error("Published projection metadata reads are required.");
  const row = await store.readPublishedCandidateMetadata(versionId);
  if (!row) return null;
  const normalization = await store.readCandidatePath<RoutineCandidate["normalization"]>(versionId, ["normalization"]);
  const readModel = payload === undefined ? await store.readCandidatePath(versionId, ["readModel"]) : payload;
  if (!normalization || normalization.normalizedPayloadHash !== normalization.normalizedHash) {
    throw new Error("The manual projection's normalized evidence and reader payload differ.");
  }
  return { ...row, candidate: { ...row.candidate, normalization, readModel, normalizedPayload: readModel } } as CandidateVersionRecord;
}
