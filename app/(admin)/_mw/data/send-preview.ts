import "server-only";

/**
 * **WHAT A SEND WOULD CREATE, PER STATE, BEFORE IT IS SENT.** (2026-09-25.)
 *
 * For each state a geography reaches: its reviewed registry's name, or — for a state with none — the governments
 * its promoted registration places here, counted by the runner's own rule (`lib/control-plane/expansion/
 * send-preview.ts`: those it must place, and those at the edge) from the slice Postgres cuts out of the
 * registration pointer: only the bodies on the divisions reaching these codes cross the wire. A registration that
 * cannot be read is named, never counted as zero.
 */
import { registrationGovernments, type ReadOnlyQuery } from "@/lib/control-plane/admin-view/promoted-slices.ts";
import { hasReviewedRegistry } from "@/lib/civic-data/reviewed-registry-states.ts";
import { registrationGovernmentsPlaced, reviewedGovernmentsPlaced, type PreviewCode, type StateSendPreview } from "@/lib/control-plane/expansion/send-preview.ts";
import type { JurisdictionRegistry } from "@/lib/hunt/jurisdiction-universe.ts";
import type { TerritoryIndex } from "@/lib/control-plane/expansion/membership.ts";

const territoryCache = new Map<string, { versionId: string; index: TerritoryIndex }>();

async function reviewedPreview(st: string, codes: readonly PreviewCode[], query: ReadOnlyQuery | null): Promise<StateSendPreview> {
  if (query === null) return { kind: "NOT_READ", state: st, why: "this deployment names no reader store" };
  try {
    const [rows] = await query([{ text: "SELECT current_version_id AS version_id, payload->'registries'->$3 AS registry FROM civic_data_promotions WHERE record_class = $1 AND scope = $2", params: ["OPERATIONAL_REFERENCE", "US:covered-jurisdiction-routing:v1", st.toLowerCase()] }]);
    const row = rows?.[0];
    const registry = row?.registry as JurisdictionRegistry | undefined;
    if (typeof row?.version_id !== "string" || registry?.stateCode.toUpperCase() !== st || !Array.isArray(registry.jurisdictions) || registry.jurisdictions.length === 0) {
      return { kind: "NOT_READ", state: st, why: "its promoted operational registry is absent or invalid" };
    }
    let cached = territoryCache.get(st);
    if (!cached || cached.versionId !== row.version_id) {
      const { readTerritoryIndex } = await import("@/lib/control-plane/expansion/runner-load.ts");
      cached = { versionId: row.version_id, index: readTerritoryIndex(process.cwd(), [registry]) };
      territoryCache.set(st, cached);
    }
    return { kind: "REVIEWED_REGISTRY", state: st, versionId: cached.versionId, ...reviewedGovernmentsPlaced(codes, registry, cached.index) };
  } catch (error) {
    return { kind: "NOT_READ", state: st, why: `dispatch territory could not be read (${error instanceof Error ? error.name : "error"})` };
  }
}

export async function sendPreviewFor(state: string, codes: readonly PreviewCode[], query: ReadOnlyQuery | null): Promise<StateSendPreview> {
  const st = state.toUpperCase();
  if (hasReviewedRegistry(st)) return reviewedPreview(st, codes, query);
  const divisions = [...new Set(codes.flatMap((c) => c.divisions))];
  const slice = await registrationGovernments(st, divisions, query);
  if (slice.kind === "NOT_PUBLISHED") return { kind: "NOT_READ", state: st, why: "its registration is not promoted in this store yet" };
  if (slice.kind === "UNREAD") return { kind: "NOT_READ", state: st, why: slice.detail };
  const placed = registrationGovernmentsPlaced(codes, slice.value);
  return { kind: "REGISTRATION", state: st, versionId: slice.versionId, governments: placed.certain, edge: placed.edge };
}
