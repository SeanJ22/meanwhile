import "server-only";

/**
 * Every registered body, from the reader's own promoted registry pointer (the
 * same record the public site uses to say what governs a place). Kept for a
 * minute in this instance: it changes on promotion, not on a click. A failure
 * is UNREAD with its reason.
 *
 * Production reads the six fields each body shows, cut out of the pointer row
 * by Postgres (`lib/control-plane/admin-view/promoted-slices.ts`: 1,996 bodies
 * in ~0.4 s from a distant host). A cold server used to read the 3.6 MB pointer and prove it against its
 * candidate first (6.1 s, 2026-09-24), and a load over three seconds is not a
 * win (Sean, 2026-09-24). The whole projection is read only outside production
 * where the store holds no pointer: the first-seed bootstrap local work reads.
 */
import { registryBodyOf, type RegistryBody } from "@/lib/control-plane/admin-view/coverage.ts";
import { registryBodies } from "@/lib/control-plane/admin-view/promoted-slices.ts";
import { readRegistryRuntimeProjection } from "@/lib/registry/runtime-read-model.ts";

import { readerQuery } from "./reader-query.ts";
import { ADMIN_READ_DEADLINE_MS, lateWords, sharedRead } from "./shared-read.ts";

export type RegistryRead =
  | { readonly kind: "HELD"; readonly versionId: string; readonly bodies: readonly RegistryBody[]; readonly readAt: string }
  | { readonly kind: "UNREAD"; readonly detail: string };

/* A minute fresh, fifteen recent (see shared-read.ts): it moves only when a registry version is promoted. */
const shared = sharedRead<RegistryRead>({
  freshMs: 60_000,
  staleMs: 15 * 60_000,
  deadlineMs: ADMIN_READ_DEADLINE_MS,
  keep: (r) => r.kind === "HELD",
  late: (ms) => ({ kind: "UNREAD", detail: lateWords("The registry", ms) }),
});

export async function loadRegistryBodies(): Promise<RegistryRead> {
  return shared.read(readRegistryBodies);
}

async function readRegistryBodies(): Promise<RegistryRead> {
  const query = readerQuery();
  if (query !== null) {
    const slice = await registryBodies(query);
    if (slice.kind === "HELD") {
      return { kind: "HELD", versionId: slice.versionId, readAt: new Date().toISOString(), bodies: slice.value.map((b) => registryBodyOf(b)) };
    }
    if (slice.kind === "UNREAD") return { kind: "UNREAD", detail: slice.detail };
    if (process.env.NODE_ENV === "production") {
      return { kind: "UNREAD", detail: "The registry was not read (NOT_RECORDED); no body is counted until it is." };
    }
  }
  return readWholeProjection();
}

/** Outside production only: the whole projection, which carries the first-seed bootstrap. */
async function readWholeProjection(): Promise<RegistryRead> {
  try {
    const r = await readRegistryRuntimeProjection();
    if (r.kind === "PROMOTED" || r.kind === "BOOTSTRAP") {
      const registry = (r.value as unknown as { registry?: { bodies?: readonly Record<string, unknown>[] } }).registry;
      const raw = registry?.bodies ?? [];
      return {
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
    }
    return { kind: "UNREAD", detail: `The registry was not read (${r.kind}); no body is counted until it is.` };
  } catch (error) {
    return { kind: "UNREAD", detail: `The registry read did not complete (${error instanceof Error ? error.name : "error"}).` };
  }
}
