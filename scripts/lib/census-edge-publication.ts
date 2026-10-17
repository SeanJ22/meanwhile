import { buildCensusDistrictEdge, censusDistrictEdgeVersion } from "../../lib/census-geography/district-edge.ts";
import type { BuiltDataset } from "../../lib/census-geography/dataset.ts";
import type { CivicDataReadResult } from "../../lib/civic-data/read-model.ts";
import type { PublishAuthorityValue } from "../../lib/meetings/edge-serving.ts";

/** Null keeps the immutable, previously proved copy: the served one is current, or a refresh
 * could not establish a replacement. A failed refresh is reported; it is never a new promotion. */
export async function censusEdgePublication(input: {
  servedVersion: string | null;
  readVersion: () => Promise<string | null>;
  readProjection: () => Promise<CivicDataReadResult<BuiltDataset>>;
  onFailure: (failure: unknown) => void;
}): Promise<PublishAuthorityValue | null> {
  try {
    const current = await input.readVersion();
    if (current !== null && censusDistrictEdgeVersion(current) === input.servedVersion) return null;
    const result = await input.readProjection();
    if (result.kind === "PROMOTED" && result.metadata.versionId) {
      const value = buildCensusDistrictEdge(result.value, result.metadata.versionId);
      return { value, versionId: value.versionId };
    }
    input.onFailure(new Error(`Census replacement not proved: ${result.kind}`));
  } catch (error) {
    input.onFailure(error);
  }
  return null;
}
