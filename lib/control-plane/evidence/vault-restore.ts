/**
 * RESTORE HELD EVIDENCE THE RUNTIME VAULT CANNOT SEE. (2026-09-22.)
 *
 * ## The split
 *
 * A vault root is `<checkout>/data/control-plane/vault` (`VAULT_DIR`), and the
 * standing runner moved to its own checkout (`wtp-production-runtime`) on
 * 2026-09-15. Bodies vaulted before the move are held only in the main
 * checkout's vault, while the control plane's artifact records still name them.
 * Every resolver the runtime reads through (`CycleVault.readHeld`,
 * `workerVaultResolver`, `researchVaultResolver`) lists only the runtime root, so
 * those records read as missing: a worker Attempt aborts
 * `WORKER_ARTIFACT_NOT_IN_VAULT`, and a recovered INGESTED record stages as still
 * owed.
 *
 * ## What this does
 *
 * It copies, from one vault into another, exactly the objects a control-plane
 * artifact record names by HELD IDENTITY, and nothing else. Held identity is the
 * rule `CycleVault.readHeld` resolves by: a key under `project/<project>/` that
 * contains `/<workItemId>/<contentHash>.`, whose sidecar records the record's own
 * content hash, Attempt, canonical URL and tier.
 *
 *   - **Nothing is re-acquired.** The bytes are the bytes the source vault holds.
 *   - **Nothing is overwritten.** A target key that already holds another object
 *     is a CONFLICT, reported and never written. A target key that holds the same
 *     object is a no-op.
 *   - **Nothing is deleted.** The source is only listed and read.
 *   - **Provenance is kept.** The metadata written is the metadata read from the
 *     source sidecar, verbatim, through the target store's own `put`, which
 *     re-checks the content address and the immutability rule. Every write is
 *     read back and its bytes, metadata and sidecar compared with the source.
 *   - **The bytes are checked before they are offered.** The source `get`
 *     re-hashes them against the sidecar, and their length and hash must equal
 *     the sidecar's and every naming record's.
 *
 * Planning is separate from execution, and the plan has a digest, so what is
 * copied is exactly what a reviewer approved: a plan that no longer matches the
 * approved digest is refused, not re-scoped.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { contentHash } from "../ids.ts";
import { DurableEvidenceStore, SIDECAR_SUFFIX, keyToRelativePath } from "./durable-store.ts";
import { objectClassOf, sameBytes, type ObjectMeta } from "./store.ts";

/** The fields of one `cp_log_artifacts` record the held-identity rule reads, plus where it sits. */
export interface HeldRecord {
  readonly artifactId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly contentHash: string;
  readonly canonicalUrl: string;
  readonly tier: string;
  readonly byteLength: number;
  /** The owning WorkItem's project: the key's `project/<project>/` segment. */
  readonly project: string;
  /** The record's own identity in `cp_log_artifacts`, so a reviewer can find it. */
  readonly logKey: string;
  readonly recordId: string;
}

/** `CycleVault.readHeld`'s rule, for one key and its sidecar metadata. */
export function holdsRecord(key: string, meta: ObjectMeta | null, record: HeldRecord): boolean {
  const custom = meta?.custom;
  return (
    key.startsWith(`project/${record.project}/`) &&
    key.includes(`/${record.workItemId}/${record.contentHash}.`) &&
    meta !== null &&
    custom !== undefined &&
    meta.contentHash === record.contentHash &&
    custom.attemptId === record.attemptId &&
    custom.canonicalUrl === record.canonicalUrl &&
    custom.tier === record.tier
  );
}

/** One object to copy, and every record it satisfies. */
export interface RestoreCopy {
  readonly key: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly records: readonly HeldRecord[];
}

export interface RestorePlan {
  readonly copies: readonly RestoreCopy[];
  /** Records the target already holds. Nothing to do. */
  readonly heldInTarget: readonly HeldRecord[];
  /** Records neither vault holds. No copy can help them; they are reported, never guessed at. */
  readonly heldInNeither: readonly HeldRecord[];
  /** The source holds the record at a key the target already uses for another object. Never written. */
  readonly conflicts: readonly RestoreCopy[];
  /** Source objects no record names. Never copied. */
  readonly unreferencedSourceKeys: readonly string[];
  /** Digest over the copy set, so an approval names exactly what will be written. */
  readonly digest: string;
}

/** The `<workItemId>` and `<contentHash>` a key is named by, the pair held identity starts from. */
function pairOfKey(key: string): string {
  const segments = key.split("/");
  const name = segments[segments.length - 1];
  const dot = name.indexOf(".");
  return `${segments[segments.length - 2]}\u0000${dot < 0 ? name : name.slice(0, dot)}`;
}

const pairOfRecord = (record: HeldRecord) => `${record.workItemId}\u0000${record.contentHash}`;

/** Every committed key under `project/`, with its metadata read once. */
async function heldIndex(store: DurableEvidenceStore) {
  const entries: { key: string; pair: string; meta: ObjectMeta | null }[] = [];
  for (const key of await store.list("project/")) entries.push({ key, pair: pairOfKey(key), meta: await store.head(key) });
  const byPair = new Map<string, typeof entries>();
  for (const entry of entries) byPair.set(entry.pair, [...(byPair.get(entry.pair) ?? []), entry]);
  return {
    entries,
    keys: new Set(entries.map((e) => e.key)),
    find: (record: HeldRecord) => (byPair.get(pairOfRecord(record)) ?? []).find((e) => holdsRecord(e.key, e.meta, record)),
  };
}

/** The digest an approval names: every key, hash, length and naming record, in key order. */
export function restoreDigest(copies: readonly RestoreCopy[]): string {
  return contentHash(
    [...copies]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((c) => [c.key, c.contentHash, String(c.byteLength), ...c.records.map((r) => `${r.logKey}/${r.recordId}`).sort()].join("\u001f"))
      .join("\n"),
  );
}

/**
 * Plan a restore. Reads both vaults (list and head) and writes nothing.
 *
 * A record the target already holds is left alone even when the source holds it
 * too. A record the source holds at a key the target already uses for another
 * object is a conflict: an evidence key holds one body for its life.
 */
export async function planVaultRestore(
  source: DurableEvidenceStore,
  target: DurableEvidenceStore,
  records: readonly HeldRecord[],
): Promise<RestorePlan> {
  const [from, into] = [await heldIndex(source), await heldIndex(target)];
  const copies = new Map<string, { key: string; meta: ObjectMeta; records: HeldRecord[] }>();
  const heldInTarget: HeldRecord[] = [];
  const heldInNeither: HeldRecord[] = [];
  for (const record of records) {
    if (into.find(record)) {
      heldInTarget.push(record);
      continue;
    }
    const held = from.find(record);
    if (!held || !held.meta) {
      heldInNeither.push(record);
      continue;
    }
    const entry = copies.get(held.key) ?? { key: held.key, meta: held.meta, records: [] };
    entry.records.push(record);
    copies.set(held.key, entry);
  }
  const all = [...copies.values()].map((c) => ({
    key: c.key,
    contentHash: c.meta.contentHash,
    byteLength: c.meta.byteLength,
    records: c.records,
  }));
  const planned = all.filter((c) => !into.keys.has(c.key));
  const recordsByPair = new Map<string, HeldRecord[]>();
  for (const record of records) recordsByPair.set(pairOfRecord(record), [...(recordsByPair.get(pairOfRecord(record)) ?? []), record]);
  return {
    copies: planned,
    heldInTarget,
    heldInNeither,
    conflicts: all.filter((c) => into.keys.has(c.key)),
    unreferencedSourceKeys: from.entries
      .filter((e) => !(recordsByPair.get(e.pair) ?? []).some((record) => holdsRecord(e.key, e.meta, record)))
      .map((e) => e.key),
    digest: restoreDigest(planned),
  };
}

export type RestoreOutcome =
  | { readonly key: string; readonly status: "COPIED"; readonly sidecarBytesIdentical: boolean }
  | { readonly key: string; readonly status: "ALREADY_PRESENT" }
  | { readonly key: string; readonly status: "REFUSED"; readonly reason: string };

/** The raw sidecar file for a key, for the verbatim comparison. */
function sidecarFile(store: DurableEvidenceStore, key: string): Promise<Buffer> {
  return readFile(`${join(store.root, keyToRelativePath(key))}${SIDECAR_SUFFIX}`);
}

/**
 * Copy one planned object, or refuse it by name. Never throws for one object's
 * refusal, so one bad key cannot leave the rest of an approved plan unwritten.
 */
async function restoreOne(copy: RestoreCopy, source: DurableEvidenceStore, target: DurableEvidenceStore): Promise<RestoreOutcome> {
  const refuse = (reason: string): RestoreOutcome => ({ key: copy.key, status: "REFUSED", reason });
  try {
    /* `get` re-hashes the body against the sidecar; a corrupted body throws here. */
    const object = await source.get(copy.key);
    if (!object) return refuse("the source vault no longer holds this key");
    const { bytes, meta } = object;
    if (objectClassOf(meta) !== "IMMUTABLE_BODY") return refuse(`the source object is ${objectClassOf(meta)}, not an evidence body`);
    const actual = contentHash(bytes);
    if (bytes.byteLength !== meta.byteLength || actual !== meta.contentHash) {
      return refuse(`the source holds ${bytes.byteLength} byte(s) hashing to ${actual}; its sidecar records ${meta.byteLength} and ${meta.contentHash}`);
    }
    if (meta.contentHash !== copy.contentHash || meta.byteLength !== copy.byteLength) {
      return refuse("the source object changed after the plan was made");
    }
    for (const record of copy.records) {
      if (!holdsRecord(copy.key, meta, record) || record.byteLength !== bytes.byteLength) {
        return refuse(`the source object is not held identity for record ${record.recordId}`);
      }
    }

    /*
     * Add-only: an occupied key is a no-op only when it holds this object with this
     * metadata. The same bytes under another Attempt's identity are compatible to
     * the store (attempt-scoped fields are first-writer-wins) and still do not
     * satisfy these records, so they are refused like any other occupant.
     */
    const existing = await target.head(copy.key);
    if (existing) {
      const held = await target.get(copy.key);
      return held && JSON.stringify(existing) === JSON.stringify(meta) && sameBytes(held.bytes, bytes)
        ? { key: copy.key, status: "ALREADY_PRESENT" }
        : refuse("the target already holds a different object at this key, and an evidence key is never overwritten");
    }

    await target.put(copy.key, bytes, meta);

    const back = await target.get(copy.key);
    if (!back || !sameBytes(back.bytes, bytes) || JSON.stringify(back.meta) !== JSON.stringify(meta)) {
      return refuse("the written object did not read back as the source object");
    }
    return {
      key: copy.key,
      status: "COPIED",
      sidecarBytesIdentical: sameBytes(await sidecarFile(source, copy.key), await sidecarFile(target, copy.key)),
    };
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  }
}

/** Execute a plan, one object at a time, in key order. */
export async function executeVaultRestore(
  plan: RestorePlan,
  source: DurableEvidenceStore,
  target: DurableEvidenceStore,
): Promise<readonly RestoreOutcome[]> {
  if (source.root === target.root) throw new Error("VAULT_RESTORE_SOURCE_IS_TARGET: a vault cannot be restored from itself");
  if (restoreDigest(plan.copies) !== plan.digest) throw new Error("VAULT_RESTORE_PLAN_ALTERED: the copy set does not match its digest");
  const outcomes: RestoreOutcome[] = [];
  for (const copy of [...plan.copies].sort((a, b) => a.key.localeCompare(b.key))) {
    outcomes.push(await restoreOne(copy, source, target));
  }
  return outcomes;
}
