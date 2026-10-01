import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import {
  crosswalkEvidenceWorkItem,
  findHeldCapture,
  indexVault,
  READ_ONLY_VAULT_PROJECT,
  readHeldBytes,
} from "../lib/control-plane/evidence/read-only-vault.ts";
import { artifactMeta, objectKey, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { NetlifyEvidenceStore } from "../lib/control-plane/evidence/netlify-store.ts";
import type { Store } from "@netlify/blobs";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { copyVaultObjects } from "../scripts/pilot-runtime-transfer.mts";
import { contentHash } from "../lib/control-plane/ids.ts";

/**
 * **THE VAULT, READ BY A ROUTINE CHILD THAT MAY NOT WRITE.** (C16, 2026-09-24.)
 *
 * The derived wiring child reads the evidence vault through a module with no write verb: what the durable store
 * committed is indexed by artifact id, by content, and by the work item a crosswalk's evidence is filed under, and
 * every read proves its bytes.
 */
test("C16: the read-only vault finds what the durable store committed, by id, content and work item, and proves the bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-ro-vault-"));
  try {
    const body = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
    const { artifact } = recordAcquisition({
      canonicalUrl: "https://www.example.gov/feed.ics", retrievedAt: "2026-09-24T20:00:00.000Z", httpStatus: 200,
      contentType: "text/calendar", sourceId: "meeting-body-crosswalk", methodRouteId: "crosswalk:evidence",
      workItemId: crosswalkEvidenceWorkItem("f".repeat(64)), attemptId: "crosswalk:x", permission: "ALLOWED", transport: "REACHABLE",
    }, body);
    const { key } = await putArtifact(new DurableEvidenceStore(root), READ_ONLY_VAULT_PROJECT, artifact, Buffer.from(body, "utf8"));

    const index = await indexVault(root);
    const held = index.byId.get(artifact.id);
    assert.ok(held, "found by its artifact id");
    assert.equal(index.byHash.get(artifact.contentHash.slice("sha256-".length))?.id, artifact.id);
    assert.equal(index.byWorkItem.get(crosswalkEvidenceWorkItem("f".repeat(64)))?.[0]?.id, artifact.id);
    assert.equal(held.tier, "RAW");
    assert.equal(new TextDecoder().decode(await readHeldBytes(held)), body);

    /* A body that no longer hashes to its commitment is a failed read, never a document. */
    writeFileSync(held.bodyPath, "tampered");
    await assert.rejects(() => readHeldBytes(held), /VAULT_BODY_CORRUPTED/);
    assert.ok(readFileSync(`${held.bodyPath}.meta.json`, "utf8").includes(key));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.deepEqual((await indexVault(join(tmpdir(), "wtp-ro-vault-absent-root"))).byId.size, 0, "an absent root is an empty vault");
});

test("Netlify vault preserves oversized metadata atomically with original bytes", async () => {
  const bytes = new TextEncoder().encode("held evidence bytes");
  const meta = { contentType: "text/plain", contentHash: contentHash(bytes), byteLength: bytes.length,
    objectClass: "IMMUTABLE_BODY" as const, custom: { sourceNote: "government source — ".repeat(800) } };
  let data: ArrayBuffer | null = null;
  let metadata: Record<string, unknown> = {};
  let writes = 0;
  const remote = new NetlifyEvidenceStore({
    async getMetadata() { return data === null ? null : { metadata }; },
    async getWithMetadata() { return data === null ? null : { data, metadata }; },
    async set(_key: string, body: ArrayBuffer, options: { metadata: Record<string, unknown>; onlyIfNew?: boolean }) {
      assert.ok("netlify-blobs-metadata".length + 4 + Buffer.from(JSON.stringify(options.metadata)).toString("base64").length <= 2048);
      if (options.onlyIfNew && data !== null) return { modified: false };
      data = body;
      metadata = options.metadata;
      writes++;
      return { modified: true };
    },
  } as unknown as Store);
  await remote.put("large-note", bytes, meta);
  assert.equal(metadata.format, "evidence-envelope@1");
  assert.deepEqual((await remote.get("large-note"))?.bytes, bytes);
  assert.deepEqual(await remote.head("large-note"), meta);
  assert.equal((await remote.describe("large-note"))?.bodySha256, contentHash(bytes));
  await remote.put("large-note", bytes, meta);
  assert.equal(writes, 1, "healthy oversized immutable reuse is still a no-op");
  new Uint8Array(data!)[data!.byteLength - 1] ^= 1;
  await assert.rejects(remote.get("large-note"), /Stored evidence is corrupt/);
  await assert.rejects(remote.put("large-note", bytes, meta), /Stored evidence is corrupt/);
  assert.equal(writes, 1);
  const indexMeta = { ...meta, objectClass: "MUTABLE_INDEX" as const, contentHash: "manifest:large-note" };
  data = null;
  await remote.put("index.json", bytes, indexMeta);
  new Uint8Array(data!)[data!.byteLength - 1] ^= 1;
  await remote.put("index.json", bytes, indexMeta);
  assert.deepEqual((await remote.get("index.json"))?.meta, indexMeta);
  assert.equal(writes, 3, "a mutable index's damaged body remains rebuildable");
  new DataView(data!).setUint32(0, data!.byteLength);
  await assert.rejects(remote.get("large-note"), /envelope is unreadable/);
  await assert.rejects(remote.describe("large-note"), /envelope is unreadable/);
});

test("C16: the derived wiring child's closure reaches no filesystem writer", () => {
  const vault = readFileSync("lib/control-plane/evidence/read-only-vault.ts", "utf8");
  assert.doesNotMatch(vault, /\b(writeFile|rename|mkdir|rm|appendFile|unlink)\b\s*\(/);
  assert.doesNotMatch(vault, /durable-store/);
  const child = readFileSync("scripts/derive-meeting-source-wiring.mts", "utf8");
  assert.doesNotMatch(child, /durable-store|DurableEvidenceStore|writeFile|appendFile/);
  /* The automatic crosswalk's child (C16 option A, 2026-09-25) reads the same vault, the same way. */
  const reviewer = readFileSync("scripts/derive-meeting-body-crosswalk.mts", "utf8");
  assert.doesNotMatch(reviewer, /durable-store|DurableEvidenceStore|writeFile|appendFile/);
  assert.match(reviewer, /read-only-vault\.ts/);
});

test("Admin capture lookup finds remote originals without a local vault or full metadata scan", async () => {
  const { artifact } = recordAcquisition({
    canonicalUrl: "https://city.example.gov/agenda.pdf", retrievedAt: "2026-09-24T20:00:00.000Z", httpStatus: 200,
    contentType: "application/pdf", sourceId: "city.example.gov", methodRouteId: "official-page",
    workItemId: "wi-original", attemptId: "at-original", permission: "ALLOWED", transport: "REACHABLE",
  }, "official agenda");
  const record: ArtifactRecord = { artifactId: artifact.id, workItemId: artifact.workItemId,
    routeTaskId: null, attemptId: artifact.attemptId, tier: artifact.tier, contentHash: artifact.contentHash,
    byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: artifact.canonicalUrl,
    partial: false, recordedAt: artifact.retrievedAt };
  const key = objectKey("freshness", artifact);
  const metadata = { meta: artifactMeta(artifact), bodySha256: artifact.contentHash };
  const described: string[] = [];
  let directoriesRead = 0;
  let source = artifact.sourceId;
  let heldMetadata = metadata;
  const remote = {
    async describe(candidate: string) {
      described.push(candidate);
      return candidate === key.replace("/city.example.gov/", `/${source}/`) ? heldMetadata : null;
    },
    async directories(prefix: string) { directoriesRead++; return [prefix + "city.example.gov", prefix + source]; },
  };
  const held = await findHeldCapture("absent-local-vault", record, remote);
  assert.ok(held);
  assert.equal(held.bodyPath, `netlify:${key}`);
  assert.equal(held.attemptId, record.attemptId);
  assert.equal(held.retrievalUrl, artifact.retrievalUrl);
  assert.equal(held.retentionPolicy, artifact.retentionPolicy);
  assert.deepEqual(described, [key]);
  assert.equal(directoriesRead, 0, "a host-keyed capture needs one metadata read");

  source = "registered-source";
  described.length = 0;
  const registered = await findHeldCapture("absent-local-vault", record, remote);
  assert.equal(registered?.bodyPath, `netlify:${key.replace("/city.example.gov/", "/registered-source/")}`);
  assert.equal(directoriesRead, 1);
  assert.equal(described.length, 2, "only exact capture keys are read across source directories");

  heldMetadata = { ...metadata, meta: { ...metadata.meta,
    custom: { ...metadata.meta.custom, attemptId: "at-another-capture" } } };
  assert.equal(await findHeldCapture("absent-local-vault", record, remote), null);
  heldMetadata = { ...metadata, meta: { ...metadata.meta,
    custom: { ...metadata.meta.custom, canonicalUrl: "https://wrong.example.gov/agenda.pdf" } } };
  await assert.rejects(findHeldCapture("absent-local-vault", record, remote), /VAULT_CAPTURE_SIDECAR_MISMATCH/);
});

test("remote source directory listing paginates without fetching bodies or metadata", async () => {
  const prefix = "project/freshness/source/";
  const store = new NetlifyEvidenceStore({
    async *list(options: unknown) {
      assert.deepEqual(options, { prefix, directories: true, paginate: true });
      yield { directories: [prefix + "city.example.gov/"], blobs: [] };
      yield { directories: ["registered-source"], blobs: [] };
    },
  } as unknown as Store);
  assert.deepEqual(await store.directories(prefix), [prefix + "city.example.gov", prefix + "registered-source"]);
});

test("vault transfer keeps healthy originals moving after a missing body and stops on destination failure", async () => {
  const transferred: string[] = [], failures: string[] = [];
  const bytes = new TextEncoder().encode("held original");
  const source = {
    async list() { return ["missing-body", "healthy-original", "later-original"]; },
    async get(key: string) {
      if (key === "missing-body") throw new Error("ENOENT");
      return { key, bytes, meta: { contentType: "text/plain", contentHash: "sha256-held", byteLength: bytes.length } };
    },
  };
  const result = await copyVaultObjects(source, {
    async put(key, body) { transferred.push(key); assert.deepEqual(body, bytes); },
  }, key => { failures.push(key); });
  assert.deepEqual(result, { transferred: 2, failed: 1 });
  assert.deepEqual(transferred, ["healthy-original", "later-original"]);
  assert.deepEqual(failures, ["missing-body"]);

  let destinationCalls = 0;
  await assert.rejects(copyVaultObjects(source, {
    async put() { destinationCalls++; throw new Error("DESTINATION_UNAVAILABLE"); },
  }, () => {}), /DESTINATION_UNAVAILABLE/);
  assert.equal(destinationCalls, 1);

  // Direct transfer must not count matching destination metadata as copied
  // when the retained body is corrupt. Healthy immutable reuse remains a no-op.
  const meta = { contentType: "text/plain", contentHash: contentHash(bytes), byteLength: bytes.length,
    objectClass: "IMMUTABLE_BODY" as const };
  let storedMeta: typeof meta | (Omit<typeof meta, "objectClass"> & { objectClass: "MUTABLE_INDEX" }) = meta;
  let storedBytes = Uint8Array.from(bytes);
  let writes = 0;
  const remote = new NetlifyEvidenceStore({
    async getMetadata() { return { metadata: { meta: storedMeta, bodySha256: meta.contentHash } }; },
    async getWithMetadata() { return { data: storedBytes.buffer, metadata: { meta: storedMeta, bodySha256: meta.contentHash } }; },
    async set() { writes++; return { modified: true }; },
  } as unknown as Store);
  const retained = { async list() { return ["held-original"]; },
    async get(key: string) { return { key, bytes, meta }; } };
  assert.deepEqual(await copyVaultObjects(retained, remote, () => {}), { transferred: 1, failed: 0 });
  assert.equal(writes, 0, "healthy immutable reuse does not rewrite the object");
  storedBytes = Uint8Array.from(bytes);
  storedBytes[0] ^= 1;
  await assert.rejects(copyVaultObjects(retained, remote, () => {}), /Stored evidence is corrupt/);
  assert.equal(writes, 0, "a corrupt held body cannot be counted as copied or silently replaced");

  storedMeta = { ...meta, objectClass: "MUTABLE_INDEX", contentHash: "manifest:held" };
  await remote.put("manifest.json", bytes, storedMeta);
  assert.equal(writes, 1, "a damaged mutable index remains rebuildable");
});
