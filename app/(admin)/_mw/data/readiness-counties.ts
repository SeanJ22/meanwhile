import "server-only";

/** The Readiness overview and state drilldown use the Reader's one verified
 * Census district serving copy before expanding a state's county, district or
 * metro rows. Without this request-scoped copy, each ZIP can open its own
 * database query and exhaust the Admin function's render deadline. */
import type { GeographyType } from "@/lib/census-geography/contract.ts";
import { ensureReaderAuthorityEdge, readReaderManifest } from "@/lib/meetings/edge-serving.ts";
import { withReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "@/lib/registry/runtime-edge.ts";

import { loadContainersWithCodes, type ContainerWithCodes, type LookupRead } from "./geography.ts";
import { ADMIN_READ_DEADLINE_MS } from "./shared-read.ts";

export async function readReadinessDistrictEdge(): Promise<ReaderAuthorityEdgeBundle | null> {
  try {
    const manifest = await readReaderManifest();
    if (!manifest?.authorityArtifacts?.["census-districts"]) return null;
    const edge = await ensureReaderAuthorityEdge(manifest, undefined, ["census-districts"]);
    return edge.censusDistricts ? edge : null;
  } catch {
    return null;
  }
}

/** All detailed coverage is withheld if the proven district copy is missing;
 * an incomplete ZIP join could misstate which bodies a county contains. */
export async function loadReadinessContainersWithCodes(
  state: string,
  type: GeographyType,
  edgeRead: Promise<ReaderAuthorityEdgeBundle | null> = readReadinessDistrictEdge(),
): Promise<LookupRead<readonly ContainerWithCodes[]>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<LookupRead<readonly ContainerWithCodes[]>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "UNREAD", detail: "The county and district coverage read did not finish within the Admin deadline." }), ADMIN_READ_DEADLINE_MS);
  });
  try {
    return await Promise.race([
      edgeRead.then((edge) => edge === null
        ? { kind: "UNREAD" as const, detail: "The verified Census district serving copy could not be read; detailed coverage cannot be calculated safely." }
        : withReaderAuthorityEdge(edge, () => loadContainersWithCodes(state, type))),
      late,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
