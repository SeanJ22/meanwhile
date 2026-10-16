import { censusDistrictEdgeVersion, type CensusDistrictEdge } from "../../lib/census-geography/district-edge.ts";
import type { PublishAuthorityCarried, PublishAuthorityValue } from "../../lib/meetings/edge-serving.ts";

export async function censusEdgePublication(input: {
  state: string;
  servedVersion: string | null;
  readVersion: () => Promise<string | null>;
  readIndex: (versionId: string) => Promise<CensusDistrictEdge>;
  onFailure: (failure: unknown) => void;
}): Promise<PublishAuthorityCarried | PublishAuthorityValue | undefined> {
  const carried: PublishAuthorityCarried | undefined = input.servedVersion?.startsWith(censusDistrictEdgeVersion(""))
    ? { versionId: input.servedVersion, carried: true } : undefined;
  try {
    const current = await input.readVersion();
    if (current === null) throw new Error("Census replacement is not published");
    const versionId = censusDistrictEdgeVersion(current);
    if (versionId === input.servedVersion) return carried;
    const value = await input.readIndex(current);
    if (value.formatVersion !== 2 || !value.states || !value.zipPrefixes || Object.keys(value.states).length !== 1 || !Object.hasOwn(value.states, input.state)) throw new Error("Census replacement must contain exactly its selected state");
    return { value, versionId };
  } catch (error) {
    input.onFailure(error);
    return carried;
  }
}
