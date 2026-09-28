/**
 * **THE EVIDENCE VAULT, READ AND NEVER WRITTEN.** (C16, 2026-09-24.)
 *
 * The standing runner's routine children may not reach a filesystem writer
 * (the civic-data firewall's ROUTINE_PATH_WRITES_REPOSITORY), so the derived
 * wiring child cannot import `DurableEvidenceStore`, which carries the write
 * path. This is the read half of the same on-disk layout, with nothing else:
 *
 * - every committed object is a body beside its `<key>.meta.json` sidecar, and
 *   a body with no sidecar is an incomplete write that is never listed;
 * - an artifact's id is `artifactId(tier, contentHash)`, recomputed from its
 *   sidecar, so an index lookup cannot be pointed at other bytes;
 * - every read recomputes the body's sha256 and refuses a mismatch: a bad
 *   sector is a failed read, never a document.
 *
 * `root` is the vault root (`<checkout>/data/control-plane/vault`, the
 * scheduler's `VAULT_DIR`). An absent root is an empty vault, a true statement
 * about a checkout nothing has written to; any other failure is thrown.
 */
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { ARTIFACT_TIERS, artifactId, type ArtifactTier } from "./artifact.ts";
import type { ArtifactRecord } from "../repository/types.ts";

/** The project every standing-runner artifact is filed under (`FRESHNESS_PROJECT`). */
export const READ_ONLY_VAULT_PROJECT = "freshness";
const SIDECAR_SUFFIX = ".meta.json";
const TEMP_PREFIX = ".wtp-evidence-tmp-";

export interface HeldVaultArtifact {
  readonly id: string;
  readonly tier: ArtifactTier;
  /** `sha256-<hex>`, the vault's own form. */
  readonly contentHash: string;
  readonly contentType: string;
  readonly canonicalUrl: string | null;
  readonly retrievalUrl: string | null;
  readonly retrievedAt: string | null;
  readonly httpStatus: number | null;
  readonly sourceId: string | null;
  readonly workItemId: string | null;
  /** The Attempt that retrieved the bytes, and the route it ran, as the sidecar recorded them. */
  readonly attemptId: string | null;
  readonly methodRouteId: string | null;
  /** The robots verdict the retrieval ran under (`ALLOWED`…), as the sidecar recorded it. */
  readonly permission: string | null;
  /** Retention travels with the sidecar; a private copy cannot extend a limited lifetime. */
  readonly retentionPolicy?: string | null;
  readonly bodyPath: string;
  readonly bodySha256: string;
}

export interface VaultIndex {
  readonly byId: ReadonlyMap<string, HeldVaultArtifact>;
  /** By the bare hex of the bytes' sha256. */
  readonly byHash: ReadonlyMap<string, HeldVaultArtifact>;
  /** By the work item they were filed under: how evidence names the page a sanitized derivative was made from. */
  readonly byWorkItem: ReadonlyMap<string, readonly HeldVaultArtifact[]>;
}

interface Sidecar {
  readonly meta?: {
    readonly contentType?: string;
    readonly contentHash?: string;
    readonly custom?: Readonly<Record<string, string>>;
  };
  readonly bodySha256?: string;
}

const TIERS: readonly string[] = ARTIFACT_TIERS;

/** Index every committed artifact under the project, by id and by content. */
export async function indexVault(root: string, project: string = READ_ONLY_VAULT_PROJECT): Promise<VaultIndex> {
  const byId = new Map<string, HeldVaultArtifact>();
  const byHash = new Map<string, HeldVaultArtifact>();
  const byWorkItem = new Map<string, HeldVaultArtifact[]>();
  const walk = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(TEMP_PREFIX)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.name.endsWith(SIDECAR_SUFFIX)) continue;
      const sidecar = JSON.parse(await readFile(path, "utf8")) as Sidecar;
      const meta = sidecar.meta;
      const tier = meta?.custom?.tier;
      const hash = meta?.contentHash;
      if (!meta || typeof hash !== "string" || !/^sha256-[0-9a-f]{64}$/.test(hash) || typeof tier !== "string" || !TIERS.includes(tier)) continue;
      if (typeof sidecar.bodySha256 !== "string") continue;
      const status = Number(meta.custom?.httpStatus);
      const held: HeldVaultArtifact = {
        id: artifactId(tier as ArtifactTier, hash),
        tier: tier as ArtifactTier,
        contentHash: hash,
        contentType: meta.contentType ?? "",
        canonicalUrl: meta.custom?.canonicalUrl ?? null,
        retrievalUrl: meta.custom?.retrievalUrl ?? null,
        retrievedAt: meta.custom?.retrievedAt ?? null,
        httpStatus: Number.isInteger(status) ? status : null,
        sourceId: meta.custom?.sourceId ?? null,
        workItemId: meta.custom?.workItemId ?? null,
        attemptId: meta.custom?.attemptId ?? null,
        methodRouteId: meta.custom?.methodRouteId ?? null,
        permission: meta.custom?.permission ?? null,
        retentionPolicy: meta.custom?.retentionPolicy ?? null,
        bodyPath: path.slice(0, -SIDECAR_SUFFIX.length),
        bodySha256: sidecar.bodySha256,
      };
      byId.set(held.id, held);
      byHash.set(hash.slice("sha256-".length), held);
      if (held.workItemId !== null) byWorkItem.set(held.workItemId, [...(byWorkItem.get(held.workItemId) ?? []), held]);
    }
  };
  await walk(join(root, "project", project));
  return { byId, byHash, byWorkItem };
}

/**
 * The work item a crosswalk's evidence page is filed under, named by the raw page's sha256: a page that carries a
 * credential is held only as its sanitized derivative, whose own hash differs, so the raw hash names it here.
 */
export function crosswalkEvidenceWorkItem(rawSha256: string): string {
  return `crosswalk-evidence:${rawSha256}`;
}

/** The held bytes, proved to be the bytes the sidecar committed. */
export async function readHeldBytes(artifact: HeldVaultArtifact): Promise<Uint8Array> {
  const bytes = await readFile(artifact.bodyPath);
  const actual = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== artifact.bodySha256) {
    throw new Error(`VAULT_BODY_CORRUPTED:${artifact.id}: the sidecar committed ${artifact.bodySha256}, the body hashes to ${actual}`);
  }
  return new Uint8Array(bytes);
}

/** Locate one attributed capture without rescanning every sidecar in the vault.
 * The record supplies date/work/hash; source directories are trusted names read
 * from the vault root, never a caller-supplied path. A missing sidecar is a miss,
 * while unreadable or malformed matching metadata is a failed read. */
export async function findHeldCapture(root: string, record: ArtifactRecord): Promise<HeldVaultArtifact | null> {
  if (!/^sha256-[0-9a-f]{64}$/.test(record.contentHash) || !/^[a-z][a-z0-9-]{1,120}$/.test(record.workItemId) ||
      !Number.isFinite(Date.parse(record.recordedAt))) throw new Error("VAULT_CAPTURE_LOOKUP_IDENTITY_INVALID");
  const sourceRoot = join(root, "project", READ_ONLY_VAULT_PROJECT, "source");
  let sources: string[];
  try { sources = (await readdir(sourceRoot, { withFileTypes: true })).filter(row => row.isDirectory()).map(row => row.name); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  let host: string | null = null;
  try { host = new URL(record.canonicalUrl).hostname; } catch { /* Other registered source IDs are still searched. */ }
  if (host && sources.includes(host)) sources = [host, ...sources.filter(source => source !== host)];
  const day = new Date(record.recordedAt).toISOString().slice(0, 10).replaceAll("-", "/");
  for (const source of sources) {
    const directory = join(sourceRoot, source, day, record.workItemId);
    let entries: string[];
    try { entries = await readdir(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    for (const name of entries.filter(name => name.startsWith(`${record.contentHash}.`) && name.endsWith(SIDECAR_SUFFIX))) {
      const sidecarPath = join(directory, name);
      const sidecar = JSON.parse(await readFile(sidecarPath, "utf8")) as Sidecar;
      const meta = sidecar.meta;
      // The same bytes can be captured by two Attempts. A sibling sidecar is
      // not this record's provenance, even when the hash and WorkItem match.
      if (meta?.custom?.attemptId !== record.attemptId) continue;
      if (!meta || meta.contentHash !== record.contentHash || meta.custom?.tier !== record.tier ||
          meta.custom?.workItemId !== record.workItemId ||
          meta.custom?.canonicalUrl !== record.canonicalUrl || meta.custom?.retrievedAt !== record.recordedAt ||
          typeof sidecar.bodySha256 !== "string") throw new Error(`VAULT_CAPTURE_SIDECAR_MISMATCH:${record.artifactId}`);
      const status = Number(meta.custom?.httpStatus);
      return { id: artifactId(record.tier, record.contentHash), tier: record.tier, contentHash: record.contentHash,
        contentType: meta.contentType ?? "", canonicalUrl: meta.custom.canonicalUrl,
        retrievalUrl: meta.custom.retrievalUrl ?? null, retrievedAt: meta.custom.retrievedAt,
        httpStatus: Number.isInteger(status) ? status : null, sourceId: meta.custom.sourceId ?? null,
        workItemId: meta.custom.workItemId, attemptId: meta.custom.attemptId,
        methodRouteId: meta.custom.methodRouteId ?? null, permission: meta.custom.permission ?? null,
        retentionPolicy: meta.custom.retentionPolicy ?? null,
        bodyPath: sidecarPath.slice(0, -SIDECAR_SUFFIX.length), bodySha256: sidecar.bodySha256 };
    }
  }
  return null;
}
