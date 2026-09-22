/**
 * **THE VAULT SEAM THE SCHEDULER ACTUALLY WRITES THROUGH.**
 * (Session C, PART D2/D4, 2026-08-31.)
 *
 * ## The gap this closes
 *
 * `http-executor.ts` returned artifact METADATA and wrote the bytes NOWHERE,
 * while its own disposition note said "captured to the vault". Every citation
 * it produced pointed at a body no store held. That is survivable while nothing
 * downstream reads the bytes — and RULING 224's promotion tail is exactly a
 * thing downstream that reads the bytes, so it stops being survivable the
 * moment the tail exists.
 *
 * This module is the join: it wraps the already-proven `DurableEvidenceStore`
 * and `putArtifact` — which verify the offered length and hash against the
 * artifact record, refuse an immutability conflict, and re-verify on every read
 * — and hands the executor a `VaultPut` and the tail a way to read the same
 * bytes back by key.
 *
 * ## It is NOT a second store
 *
 * One control plane. Nothing here implements content addressing, atomic writes,
 * sidecars or corruption detection; all four live in
 * `lib/control-plane/evidence/durable-store.ts` and are used as they are. What
 * this adds is the per-cycle KEY LEDGER, so the tail can find the body an
 * Attempt produced without guessing at a path.
 *
 * ## RESTRICTED_RAW is refused, and the refusal is reported rather than thrown
 *
 * A body carrying a confirmed third-party credential is quarantined by the
 * shipped scanner and the durable store refuses it without an encrypted,
 * access-controlled provider. That refusal is CORRECT. It is surfaced into the
 * disposition note — "the vault REFUSED these bytes" — instead of aborting an
 * Attempt whose retrieval genuinely succeeded.
 */

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
  /**
   * Raw bytes — a PDF, an image — that cannot round-trip through a string.
   * (Level 1 activation, 2026-09-01.) Same store, same key ledger, same
   * verification of length and hash against the artifact record.
   */
  readonly putBytes: (
    artifact: Artifact,
    bytes: Uint8Array,
  ) => Promise<{ readonly stored: boolean; readonly where: string; readonly why: string }>;
  /** Every artifact this cycle persisted, by artifact id. */
  readonly ledger: ReadonlyMap<string, VaultLedgerEntry>;
  /** Read a stored body back. Null when the key holds nothing. */
  readBack(key: string): Promise<string | null>;
  /**
   * Read back the body of an artifact an EARLIER cycle vaulted. (2026-09-22.)
   *
   * `ledger` holds only this cycle's puts. A settled occurrence recovered from
   * an interrupted cycle reaches the promotion tail with bytes that cycle
   * vaulted, and without this its INGESTED record would stage as though nothing
   * had been retrieved. The key embeds the work item and the content hash, so
   * the store is listed at most once per cycle and a key is read only when its
   * stored metadata names the artifact record's own Attempt, URL and tier. Null
   * when no key matches; the tail then stages the record as still owed.
   */
  readHeld(
    record: Pick<ArtifactRecord, "artifactId" | "workItemId" | "attemptId" | "contentHash" | "canonicalUrl" | "tier">,
  ): Promise<string | null>;
}

/**
 * Build the vault for one cycle.
 *
 * `root` is explicit and nothing here reads an environment variable or invents
 * a path: a store that picks its own location is a store two processes can
 * disagree about, and the disagreement reads back as missing evidence.
 */
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
