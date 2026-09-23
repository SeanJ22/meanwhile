import "server-only";

/**
 * Every registered body, from the reader's own promoted registry pointer (the
 * same record the public site uses to say what governs a place). Kept for a
 * minute in this instance: the pointer is ~3.9 MB of text and it changes on
 * promotion, not on a click. A failure is UNREAD with its reason.
 */
import { registryBodyOf, type RegistryBody } from "@/lib/control-plane/admin-view/coverage.ts";
import { readRegistryRuntimeProjection } from "@/lib/registry/runtime-read-model.ts";

export type RegistryRead =
  | { readonly kind: "HELD"; readonly versionId: string; readonly bodies: readonly RegistryBody[]; readonly readAt: string }
  | { readonly kind: "UNREAD"; readonly detail: string };

const TTL_MS = 60_000;
let memo: { readonly at: number; readonly read: RegistryRead } | null = null;

export async function loadRegistryBodies(): Promise<RegistryRead> {
  if (memo && Date.now() - memo.at < TTL_MS && memo.read.kind === "HELD") return memo.read;
  let read: RegistryRead;
  try {
    const r = await readRegistryRuntimeProjection();
    if (r.kind === "PROMOTED" || r.kind === "BOOTSTRAP") {
      const registry = (r.value as unknown as { registry?: { bodies?: readonly Record<string, unknown>[] } }).registry;
      const raw = registry?.bodies ?? [];
      read = {
        kind: "HELD",
        versionId: r.metadata.versionId ?? r.kind,
        readAt: new Date().toISOString(),
        bodies: raw.map((b) =>
          registryBodyOf({
            id: String(b.id),
            name: typeof b.name === "string" ? b.name : null,
            ocdId: typeof b.ocdId === "string" ? b.ocdId : null,
            alsoServesOcdIds: Array.isArray(b.alsoServesOcdIds) ? (b.alsoServesOcdIds as string[]) : [],
            coverageStatus: b.coverageStatus,
            bodyClass: typeof b.bodyClass === "string" ? b.bodyClass : null,
          }),
        ),
      };
    } else {
      read = { kind: "UNREAD", detail: `The registry was not read (${r.kind}); no body is counted until it is.` };
    }
  } catch (error) {
    read = { kind: "UNREAD", detail: `The registry read did not complete (${error instanceof Error ? error.name : "error"}).` };
  }
  if (read.kind === "HELD") memo = { at: Date.now(), read };
  return read;
}
