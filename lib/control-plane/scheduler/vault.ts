/** The vault seam the scheduler writes through: a per-cycle key ledger over `DurableEvidenceStore`, not a second store. A RESTRICTED_RAW refusal is reported in the disposition note, not thrown. */

import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import { putArtifact } from "../evidence/store.ts";
import type { Artifact } from "../evidence/artifact.ts";
import type { ArtifactRecord } from "../repository/types.ts";

import { FRESHNESS_PROJECT } from "./durable.ts";
import type { VaultPut } from "./route-executor.ts";

/** Where the freshness vault lives. Named once, in one place. */
export const VAULT_DIR = ["data", "control-plane", "vault"] as const;

export interface VaultLedgerEntry {
  readonly artifactId: string;
  readonly key: string;
  readonly byteLength: number;
  readonly tier: string;
  readonly canonicalUrl: string;
}

export interface CycleVault {
  readonly put: VaultPut;
  /** Raw bytes (a PDF, an image) that cannot round-trip through a string; same store, ledger and verification. */
  readonly putBytes: (
    artifact: Artifact,
    bytes: Uint8Array,
  ) => Promise<{ readonly stored: boolean; readonly where: string; readonly why: string }>;
  /** Every artifact this cycle persisted, by artifact id. */
  readonly ledger: ReadonlyMap<string, VaultLedgerEntry>;
  /** Read a stored body back. Null when the key holds nothing. */
  readBack(key: string): Promise<string | null>;
  /** Read back the body of an artifact an earlier cycle vaulted; a key is read only when its metadata names the record's own Attempt, URL and tier. Null when none matches. */
  readHeld(
    record: Pick<ArtifactRecord, "artifactId" | "workItemId" | "attemptId" | "contentHash" | "canonicalUrl" | "tier">,
  ): Promise<string | null>;
}

/** Build the vault for one cycle. `root` is explicit; nothing here reads the environment or invents a path. */
export function cycleVault(vaultRoot: string): CycleVault {
  const store = new DurableEvidenceStore(vaultRoot);
  const ledger = new Map<string, VaultLedgerEntry>();

  const putBytes = async (artifact: Artifact, bytes: Uint8Array) => {
    const { key, written } = await putArtifact(store, FRESHNESS_PROJECT, artifact, bytes);
    ledger.set(artifact.id, {
      artifactId: artifact.id,
      key,
      byteLength: artifact.byteLength,
      tier: artifact.tier,
      canonicalUrl: artifact.canonicalUrl,
    });
    return {
      stored: true,
      where: key,
      why: written
        ? "written"
        : "already held at this key with identical metadata, so the write was a no-op success",
    };
  };

  const put: VaultPut = async (artifact: Artifact, body: string) =>
    putBytes(artifact, Buffer.from(body, "utf8"));

  const readBack = async (key: string): Promise<string | null> => {
    const object = await store.get(key);
    if (object === null) return null;
    return Buffer.from(object.bytes).toString("utf8");
  };

  let heldKeys: Promise<string[]> | null = null;
  const readHeld: CycleVault["readHeld"] = async (record) => {
    /* A failed listing is not cached: the next recovered artifact asks again. */
    heldKeys ??= store.list(`project/${FRESHNESS_PROJECT}/`).catch((error: unknown) => {
      heldKeys = null;
      throw error;
    });
    const suffix = `/${record.workItemId}/${record.contentHash}.`;
    for (const key of await heldKeys) {
      if (!key.includes(suffix)) continue;
      const meta = await store.head(key);
      const custom = meta?.custom;
      if (
        !meta ||
        !custom ||
        meta.contentHash !== record.contentHash ||
        custom.attemptId !== record.attemptId ||
        custom.canonicalUrl !== record.canonicalUrl ||
        custom.tier !== record.tier
      ) {
        continue;
      }
      return readBack(key);
    }
    return null;
  };

  return { put, putBytes, ledger, readBack, readHeld };
}
