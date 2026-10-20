/** The vault seam the scheduler writes through: a per-cycle key ledger over `DurableEvidenceStore`, not a second store. A RESTRICTED_RAW refusal is reported in the disposition note, not thrown. */

import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import { putArtifact } from "../evidence/store.ts";
import type { Artifact } from "../evidence/artifact.ts";
import type { ArtifactRecord } from "../repository/types.ts";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import { openHistoryIndex } from "../workers/streamed-history.ts";
import { DiskRows } from "./disk-rows.ts";

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
  readonly ledger: DiskRows<VaultLedgerEntry> & {
    readonly size: number;
    get(artifactId: string): VaultLedgerEntry | undefined;
  };
  /** Release this cycle's temporary metadata after its report has been written. */
  close(): Promise<void>;
  /** Read a stored body back. Null when the key holds nothing. */
  readBack(key: string): Promise<string | null>;
  /** Read back the body of an artifact an earlier cycle vaulted; a key is read only when its metadata names the record's own Attempt, URL and tier. Null when none matches. */
  readHeld(
    record: Pick<ArtifactRecord, "artifactId" | "workItemId" | "attemptId" | "contentHash" | "canonicalUrl" | "tier">,
  ): Promise<string | null>;
}

type VaultIndex = Awaited<ReturnType<typeof openHistoryIndex>>;
let activeIndex: VaultIndex | null = null;
let openingIndex: Promise<VaultIndex> | null = null;
function vaultIndex(): Promise<VaultIndex> {
  openingIndex ??= openHistoryIndex().then(index => {
    index.db.exec("CREATE TABLE vault_ledger(scope TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope,id)); CREATE TABLE held_keys(scope TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(scope,key))");
    activeIndex = index;
    process.once("exit", () => {
      index.db.close(); rmSync(temporaryPath(index.directory), { recursive: true, force: true });
    });
    return index;
  });
  return openingIndex;
}

/** Build the vault for one cycle. `root` is explicit; nothing here reads the environment or invents a path. */
export function cycleVault(vaultRoot: string): CycleVault {
  const store = new DurableEvidenceStore(vaultRoot);
  const scope = randomUUID();
  const rows = new DiskRows<VaultLedgerEntry>(function* () {
    if (activeIndex) for (const row of activeIndex.db.prepare("SELECT body FROM vault_ledger WHERE scope=? ORDER BY rowid").iterate(scope)) {
      yield JSON.parse(row.body) as VaultLedgerEntry;
    }
  }, () => Number(activeIndex?.db.prepare("SELECT count(*) AS n FROM vault_ledger WHERE scope=?").get(scope)?.n ?? 0));
  const ledger = Object.assign(rows, {
    get(artifactId: string): VaultLedgerEntry | undefined {
      const row = activeIndex?.db.prepare("SELECT body FROM vault_ledger WHERE scope=? AND id=?").get(scope, artifactId);
      return row ? JSON.parse(row.body) as VaultLedgerEntry : undefined;
    },
  });
  Object.defineProperty(ledger, "size", { get: () => ledger.length });

  const putBytes = async (artifact: Artifact, bytes: Uint8Array) => {
    const { key, written } = await putArtifact(store, FRESHNESS_PROJECT, artifact, bytes);
    const { db } = await vaultIndex();
    db.prepare("INSERT INTO vault_ledger VALUES(?,?,?) ON CONFLICT(scope,id) DO UPDATE SET body=excluded.body").run(scope, artifact.id, JSON.stringify({
      artifactId: artifact.id,
      key,
      byteLength: artifact.byteLength,
      tier: artifact.tier,
      canonicalUrl: artifact.canonicalUrl,
    } satisfies VaultLedgerEntry));
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

  let heldKeys: Promise<void> | null = null;
  const readHeld: CycleVault["readHeld"] = async (record) => {
    /* A failed listing is not cached: the next recovered artifact asks again. */
    const { db } = await vaultIndex();
    heldKeys ??= (async () => {
      db.prepare("DELETE FROM held_keys WHERE scope=?").run(scope);
      const insert = db.prepare("INSERT OR IGNORE INTO held_keys VALUES(?,?)");
      await store.visitKeys(`project/${FRESHNESS_PROJECT}/`, key => { insert.run(scope, key); });
    })().catch((error: unknown) => {
      heldKeys = null;
      throw error;
    });
    await heldKeys;
    const suffix = `/${record.workItemId}/${record.contentHash}.`;
    for (const row of db.prepare("SELECT key FROM held_keys WHERE scope=? ORDER BY key").iterate(scope)) {
      const key = row.key;
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

  const close = async () => {
    if (!openingIndex) return;
    const { db } = await openingIndex;
    db.prepare("DELETE FROM vault_ledger WHERE scope=?").run(scope);
    db.prepare("DELETE FROM held_keys WHERE scope=?").run(scope);
  };
  return { put, putBytes, ledger: ledger as CycleVault["ledger"], readBack, readHeld, close };
}
