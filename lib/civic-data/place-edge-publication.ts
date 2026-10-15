import type { PromotedPointerIdentity } from "./types.ts";
import type { RoutineDataStore } from "./store.ts";
import { promotedEdgeEntryOf, readPromotedCivicData } from "./read-model.ts";
import { promotedPointerVersion, safeReaderEdgeFailure, type ReaderEdgePublicationOutcome } from "./reader-edge-outcome.ts";
import { isTranslationScope, TRANSLATION_SCOPE } from "../translate/records.ts";
import { readTranslationProjection } from "../translate/projection-reader.ts";
import { isPlaceMeasureScope, PLACE_MEASURE_SCOPE, readPlaceMeasureProjection } from "../ballot/place-measures.ts";
import { publishReaderPlaceArtifact, readerPlaceManifestKey, readerPlaceManifestMatches } from "../meetings/place-edge.ts";
import { resolveReaderBlobWriteStore, purgeReaderCacheTags, READER_MANIFEST_CACHE_TAG } from "../meetings/edge-blob-store.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";

type PlacePointer = Pick<PromotedPointerIdentity, "recordClass" | "scope"> & {
  readonly currentIdentity?: Pick<PromotedPointerIdentity, "versionId" | "latestConfirmation">;
};
export function isPlaceEdgePointer(pointer: PlacePointer): boolean {
  return pointer.recordClass === "CURATED_READER_RECORD" && isTranslationScope(pointer.scope) ||
    pointer.recordClass === "BALLOT_CANDIDACY" && isPlaceMeasureScope(pointer.scope);
}

export async function publishPlaceReaderEdgeOutcome(store: RoutineDataStore, observedAt: string,
  selected: readonly PlacePointer[], options: { readonly artifactStore?: ReaderArtifactStore | null } = {},
): Promise<ReaderEdgePublicationOutcome> {
  const artifactStore = options.artifactStore === undefined ? resolveReaderBlobWriteStore() : options.artifactStore;
  const destination = artifactStore?.kind === "local-file" ? "local folder" : artifactStore ? "Netlify Blobs" : "not configured";
  if (!artifactStore) return { ok: false, readerEdge: "SKIPPED_NO_STORE", store: destination, sequence: null,
    detail: "Reader pages could not be updated because their publication store is not configured. Readers are still seeing the older copy." };
  let published = false, failed = false;
  let sequence: number | null = null, detail: string | null = null;
  for (const selectedPointer of selected) try {
    if (!isPlaceEdgePointer(selectedPointer)) throw new Error("Place publication requires one exact place pointer.");
    const family = selectedPointer.recordClass === "BALLOT_CANDIDACY" ? "ballot-measures" : "plain-english-translations";
    const division = selectedPointer.scope.slice((family === "ballot-measures" ? PLACE_MEASURE_SCOPE : TRANSLATION_SCOPE).length + 1);
    if (selectedPointer.currentIdentity) {
      const current = await artifactStore.readManifest(readerPlaceManifestKey(family, division));
      const versionId = promotedPointerVersion(selectedPointer.recordClass, selectedPointer.scope, selectedPointer.currentIdentity);
      if (readerPlaceManifestMatches(current?.manifest, { family, division, versionId })) {
        sequence = current!.manifest.sequence;
        continue;
      }
    }
    const pointer = await store.readPromotionIdentity(selectedPointer.recordClass, selectedPointer.scope);
    if (!pointer) continue;
    const versionId = promotedPointerVersion(selectedPointer.recordClass, selectedPointer.scope, pointer);
    const edge = await publishReaderPlaceArtifact({ family, division, versionId, read: async () => {
      const read = await readPromotedCivicData(selectedPointer.recordClass, selectedPointer.scope, { store, now: observedAt, bypassCache: true });
      const entry = promotedEdgeEntryOf(read, selectedPointer.recordClass, selectedPointer.scope);
      if (entry?.kind !== "PROMOTED") throw new Error(`Place ${selectedPointer.scope} read ${read.kind}`);
      const accepted = family === "ballot-measures"
        ? await readPlaceMeasureProjection(division, { edge: entry, now: observedAt })
        : await readTranslationProjection({ edge: entry, scope: selectedPointer.scope, now: observedAt });
      if (accepted.kind !== "PROMOTED" || accepted.metadata.versionId !== pointer.versionId) throw new Error(`Place ${selectedPointer.scope} failed its typed Reader`);
      return entry;
    } }, { store: artifactStore, now: observedAt });
    if (edge.status === "FAILED") throw new Error(edge.error);
    if (edge.status === "RACED") throw new Error("A concurrent place publication moved the pointer; retry remains owed.");
    published ||= edge.status === "PUBLISHED";
    if ("sequence" in edge) sequence = edge.sequence;
  } catch (error) {
    failed = true;
    detail = safeReaderEdgeFailure(sanitizedErrorDiagnostic(error));
    process.stderr.write(`READER_EDGE_PLACE_SKIPPED: ${selectedPointer.scope} ${detail}\n`);
  }
  if (published && artifactStore.kind === "netlify-blobs") await purgeReaderCacheTags([READER_MANIFEST_CACHE_TAG]);
  const outcome: ReaderEdgePublicationOutcome = { ok: !failed, readerEdge: failed ? "FAILED" : published ? "PUBLISHED" : "CURRENT",
    store: destination, sequence, detail };
  console.log(JSON.stringify(outcome));
  return outcome;
}
