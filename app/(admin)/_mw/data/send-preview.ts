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
import { registrationGovernmentsPlaced, type PreviewCode, type StateSendPreview } from "@/lib/control-plane/expansion/send-preview.ts";

export async function sendPreviewFor(state: string, codes: readonly PreviewCode[], query: ReadOnlyQuery | null): Promise<StateSendPreview> {
  const st = state.toUpperCase();
  if (hasReviewedRegistry(st)) return { kind: "REVIEWED_REGISTRY", state: st };
  const divisions = [...new Set(codes.flatMap((c) => c.divisions))];
  const slice = await registrationGovernments(st, divisions, query);
  if (slice.kind === "NOT_PUBLISHED") return { kind: "NOT_READ", state: st, why: "its registration is not promoted in this store yet" };
  if (slice.kind === "UNREAD") return { kind: "NOT_READ", state: st, why: slice.detail };
  const placed = registrationGovernmentsPlaced(codes, slice.value);
  return { kind: "REGISTRATION", state: st, versionId: slice.versionId, governments: placed.certain, edge: placed.edge };
}
