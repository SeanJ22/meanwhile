import type { GlobalAuthorityFamily, GlobalPromotedAuthorityFamily, PromotedFamilyArtifactValue, StateAuthorityFamily } from "../../lib/meetings/edge-artifacts.ts";
import { authorityPlaceOfScope, authorityPointerKey, PLACE_SPLIT_FAMILIES, prepareStateAuthorityArtifact, readServedPointer, writeAuthorityPointer,
  type AuthorityPointerFamily, type PublishAuthorityValue } from "../../lib/meetings/edge-serving.ts";
import type { ReaderArtifactStore } from "../../lib/meetings/edge-store.ts";

/** Writes each family's pointer as the runner does; a pointer already at the given version is left alone. Returns the pointers written. */
export async function publishPointers(store: ReaderArtifactStore, input: {
  readonly authority?: Partial<Record<GlobalAuthorityFamily, PublishAuthorityValue>>;
  readonly stateAuthorities?: Partial<Record<StateAuthorityFamily, Readonly<Record<string, PublishAuthorityValue>>>>;
  readonly registrations?: Readonly<Record<string, PublishAuthorityValue>>;
  readonly stateLegislators?: Readonly<Record<string, PublishAuthorityValue>>;
}, now = "2026-10-17T00:00:00.000Z"): Promise<string[]> {
  const written: string[] = [];
  const place = async (family: AuthorityPointerFamily, at: string | undefined, entry: PublishAuthorityValue) => {
    const served = await readServedPointer(store, authorityPointerKey(family, at));
    if (served?.ref.version === entry.versionId) return;
    if (await writeAuthorityPointer(store, family, at, entry, served, now)) written.push(at === undefined ? family : `${family}/${at}`);
  };
  for (const [family, entry] of Object.entries(input.authority ?? {})) {
    if (!PLACE_SPLIT_FAMILIES.has(family as GlobalPromotedAuthorityFamily)) { await place(family as GlobalAuthorityFamily, undefined, entry); continue; }
    const places = Map.groupBy((entry.value as PromotedFamilyArtifactValue).entries, row => authorityPlaceOfScope(row.kind === "PROMOTED" ? row.projection.scope : row.scope));
    for (const [at, entries] of places) await place(family as GlobalAuthorityFamily, at, { versionId: `${entry.versionId}/${at}`, value: { kind: "PROMOTED_POINTERS", entries } });
  }
  for (const [state, entry] of Object.entries(input.registrations ?? {})) await place("registrations", state, entry);
  for (const [jurisdiction, entry] of Object.entries(input.stateLegislators ?? {})) await place("state-legislators", jurisdiction, entry);
  for (const [family, states] of Object.entries(input.stateAuthorities ?? {})) for (const [state, entry] of Object.entries(states)) {
    const key = authorityPointerKey(family as StateAuthorityFamily, state), served = await readServedPointer(store, key);
    if (served?.ref.version === entry.versionId) continue;
    const { artifact } = await prepareStateAuthorityArtifact(family as StateAuthorityFamily, state, entry, store, now);
    if ((await store.writeJsonPointer(key, artifact, served?.etag ?? null)).modified) written.push(`${family}/${state}`);
  }
  return written;
}
