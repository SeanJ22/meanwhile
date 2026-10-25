import { neon } from "../db/client.ts";
import { crosswalkEvidenceWorkItem, findHeldCapture, indexVault, READ_ONLY_VAULT_PROJECT, type HeldVaultArtifact } from "../control-plane/evidence/read-only-vault.ts";
import type { ArtifactRecord } from "../control-plane/repository/types.ts";

/** Read only the attributed records the caller cites, then locate those captures.
 * Unrelated vault objects never need listing or describing. Repeated IDs share
 * a lookup; each record still has to match its original sidecar. */
export async function heldArtifactCaptures(root: string, artifactIds: readonly string[], controlPlane: string) {
  const ids = [...new Set(artifactIds)];
  const rows = ids.length === 0 ? [] : await neon(controlPlane).query(
    `SELECT record FROM cp_log_artifacts WHERE record->>'artifactId' = ANY($1::text[])
     ORDER BY record->>'recordedAt' DESC, log_key, position DESC`, [ids],
  ) as { record: ArtifactRecord | string }[];
  return heldArtifactCaptureLookup(root, rows.map(row => typeof row.record === "string" ? JSON.parse(row.record) as ArtifactRecord : row.record));
}

export function heldArtifactCaptureLookup(root: string, records: readonly ArtifactRecord[],
  locate: typeof findHeldCapture = findHeldCapture,
): (artifactId: string) => Promise<HeldVaultArtifact | null> {
  const byId = new Map<string, ArtifactRecord[]>();
  for (const record of records) {
    const captures = byId.get(record.artifactId) ?? [];
    captures.push(record);
    byId.set(record.artifactId, captures);
  }
  const pending = new Map<string, Promise<HeldVaultArtifact | null>>();
  return artifactId => {
    let read = pending.get(artifactId);
    if (!read) {
      read = (async () => {
        for (const record of byId.get(artifactId) ?? []) {
          const held = await locate(root, record);
          if (held) return held;
        }
        return null;
      })();
      pending.set(artifactId, read);
    }
    return read;
  };
}

/** Older manual crosswalk packages predate the artifact log. Their exact
 * source/day/work-item directory is known from the reviewed evidence, including
 * sanitized derivatives whose hash differs from the cited raw document. */
export async function heldManualCrosswalkCapture(root: string, sha256: string, readAt: string): Promise<HeldVaultArtifact | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256) || !Number.isFinite(Date.parse(readAt))) throw new Error("CROSSWALK_CAPTURE_IDENTITY_INVALID");
  const workItem = crosswalkEvidenceWorkItem(sha256);
  const day = new Date(readAt).toISOString().slice(0, 10).replaceAll("-", "/");
  // The local vault percent-encodes ':' in path segments; remote object keys
  // retain it. This work-item form contains no other unsafe characters.
  const directory = process.env.WTP_VAULT_PROVIDER === "netlify" ? workItem : workItem.replaceAll(":", "%3A");
  const exact = await indexVault(root, `${READ_ONLY_VAULT_PROJECT}/source/meeting-body-crosswalk/${day}/${directory}`);
  const raw = exact.byHash.get(sha256);
  return raw && raw.tier !== "RESTRICTED_RAW" ? raw :
    exact.byWorkItem.get(workItem)?.find(held => held.tier === "SANITIZED_DERIVED") ?? null;
}
