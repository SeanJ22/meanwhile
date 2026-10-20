import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { deriveSanitized, recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import {
  crosswalkEvidenceWorkItem,
  findHeldCapture,
  indexVault,
  includeVaultCapture,
  READ_ONLY_VAULT_PROJECT,
  readHeldBytes,
} from "../lib/control-plane/evidence/read-only-vault.ts";
import { artifactMeta, objectKey, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { NetlifyEvidenceStore } from "../lib/control-plane/evidence/netlify-store.ts";
import type { Store } from "@netlify/blobs";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { heldArtifactCaptureLookup, heldManualCrosswalkCapture } from "../lib/civic-data/held-artifact-captures.ts";
import { contentHash } from "../lib/control-plane/ids.ts";

test("the read-only vault finds what the durable store committed, by id, content and work item, and proves the bytes", async () => {
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

test("manual crosswalk evidence reads the cited directory without describing unrelated vault objects", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-crosswalk-cited-"));
  try {
    const body = "Official board calendar";
    const hash = contentHash(body).slice("sha256-".length);
    const at = "2026-09-24T20:00:00.000Z";
    const { artifact } = recordAcquisition({
      canonicalUrl: "https://www.example.gov/calendar", retrievedAt: at, httpStatus: 200,
      contentType: "text/html", sourceId: "meeting-body-crosswalk", methodRouteId: "crosswalk:evidence",
      workItemId: crosswalkEvidenceWorkItem(hash), attemptId: "crosswalk:x", permission: "ALLOWED", transport: "REACHABLE",
    }, body);
    const store = new DurableEvidenceStore(root);
    await putArtifact(store, READ_ONLY_VAULT_PROJECT, artifact, Buffer.from(body));
    const unrelated = { ...artifact, workItemId: "wi-unrelated", sourceId: "unrelated.example.gov" };
    const { key } = await putArtifact(store, READ_ONLY_VAULT_PROJECT, unrelated, Buffer.from(body));
    writeFileSync(join(root, key + ".meta.json"), "{broken unrelated sidecar");
    await assert.rejects(indexVault(root), SyntaxError, "the replaced whole-vault path visits unrelated metadata");
    const exact = await heldManualCrosswalkCapture(root, hash, at);
    assert.equal(exact?.id, artifact.id);
    assert.equal(new TextDecoder().decode(await readHeldBytes(exact!)), body);
    assert.equal(await heldManualCrosswalkCapture(root, "f".repeat(64), at), null);
    const credentialPage = "<p>Official board calendar</p><input type='password' value='example-test-value'>";
    const rawHash = contentHash(credentialPage).slice("sha256-".length);
    const { artifact: raw } = recordAcquisition({
      canonicalUrl: artifact.canonicalUrl, retrievedAt: at, httpStatus: 200, contentType: "text/html",
      sourceId: "meeting-body-crosswalk", methodRouteId: "crosswalk:evidence",
      workItemId: crosswalkEvidenceWorkItem(rawHash), attemptId: "crosswalk:sanitized", permission: "ALLOWED", transport: "REACHABLE",
    }, credentialPage);
    const sanitized = deriveSanitized(raw, credentialPage, at);
    await putArtifact(store, READ_ONLY_VAULT_PROJECT, sanitized.artifact, Buffer.from(sanitized.text));
    const derivative = await heldManualCrosswalkCapture(root, rawHash, at);
    assert.equal(derivative?.tier, "SANITIZED_DERIVED");
    assert.equal(derivative?.id, sanitized.artifact.id, "the raw citation still locates its saved sanitized derivative");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("vault metadata indexing uses a bounded pool and retains key order at thousands of pages", async t => {
  const held = Array.from({length: 2000}, (_, i) => {
    const {artifact} = recordAcquisition({canonicalUrl:`https://example.gov/page-${i}`,retrievedAt:"2026-10-02T00:00:00.000Z",httpStatus:200,
      contentType:"text/html",sourceId:"fixture",methodRouteId:"fixture",workItemId:`work-${i}`,attemptId:`attempt-${i}`,permission:"ALLOWED",transport:"REACHABLE"},`<p>${i}</p>`);
    return {artifact,key:objectKey(READ_ONLY_VAULT_PROJECT,artifact),metadata:{meta:artifactMeta(artifact),bodySha256:artifact.contentHash}};
  }).sort((a,b)=>a.key.localeCompare(b.key));
  const envKeys=["WTP_VAULT_PROVIDER","WTP_BLOBS_SITE_ID","WTP_BLOBS_TOKEN"];
  const previous=envKeys.map(key=>process.env[key]);
  Object.assign(process.env,{WTP_VAULT_PROVIDER:"netlify",WTP_BLOBS_SITE_ID:"offline-vault-fixture",WTP_BLOBS_TOKEN:"offline-fixture"});
  t.after(()=>envKeys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}));
  const byKey=new Map(held.map(row=>[row.key,row]));
  let active=0,peak=0,bodyReads=0;
  t.mock.method(globalThis,"fetch",async (url:RequestInfo|URL,options?:RequestInit)=>{
    const parsed=new URL(String(url));
    if(parsed.searchParams.has("prefix")) return Response.json({blobs:held.map(row=>({key:row.key})),directories:[]});
    if(options?.method?.toLowerCase()!=="head") bodyReads++;
    assert.equal(options?.method?.toLowerCase(),"head","metadata indexing must not download page bodies");
    const row=byKey.get(parsed.pathname.slice(parsed.pathname.indexOf("project/")));
    assert.ok(row);
    active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,1));
    active--;
    return new Response(null,{headers:{"netlify-blobs-metadata":"b64;"+Buffer.from(JSON.stringify(row.metadata)).toString("base64")}});
  });
  const start=performance.now(),index=await indexVault("unused-local-root");
  console.log(`VAULT_POOL pages=${held.length} peak=${peak} elapsedMs=${(performance.now()-start).toFixed(2)} bodyReads=${bodyReads}`);
  assert.ok(peak>1 && peak<=16,`expected a pool of at most16; observed${peak}`);
  assert.equal(bodyReads,0);
  assert.deepEqual([...index.byId.values()].map(row=>row.canonicalUrl),held.map(row=>row.artifact.canonicalUrl));
  for(const row of held) assert.equal(index.byHash.get(row.artifact.contentHash.slice(7))?.id,row.artifact.id);
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
    async getWithMetadata(_key: string, options: { type: string }) {
      return data === null ? null : { data: options.type === "stream"
        ? new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(data!)); controller.close(); } })
        : data, metadata };
    },
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

test("envelope describe reads only a split metadata header and cancels the unread body", async () => {
  const bytes = new TextEncoder().encode("original body");
  const meta = { contentType: "text/plain", contentHash: contentHash(bytes), byteLength: bytes.length };
  const json = new TextEncoder().encode(JSON.stringify({ meta, bodySha256: contentHash(bytes) }));
  const header = new Uint8Array(4 + json.length);
  new DataView(header.buffer).setUint32(0, json.length);
  header.set(json, 4);
  const chunks = [header.subarray(0, 2), header.subarray(2, 7), header.subarray(7)];
  let reads = 0, cancelled = false;
  const remote = new NetlifyEvidenceStore({
    async getMetadata() { return { metadata: { format: "evidence-envelope@1" } }; },
    async getWithMetadata(_key: string, options: { type: string }) {
      assert.equal(options.type, "stream");
      return { data: new ReadableStream({
        pull(controller) {
          assert.ok(reads < chunks.length, "must not pull the page body");
          controller.enqueue(chunks[reads++]);
        },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 }), metadata: { format: "evidence-envelope@1" } };
    },
  } as unknown as Store);
  assert.deepEqual(await remote.describe("enveloped-page"), { meta, bodySha256: contentHash(bytes) });
  assert.equal(reads, 3);
  assert.equal(cancelled, true);
});

test("vault indexing propagates its deadline to every real SDK request", async t => {
  const keys = ["WTP_VAULT_PROVIDER", "WTP_BLOBS_SITE_ID", "WTP_BLOBS_TOKEN"];
  const previous = keys.map(key => process.env[key]);
  Object.assign(process.env, { WTP_VAULT_PROVIDER: "netlify", WTP_BLOBS_SITE_ID: "offline-vault-fixture", WTP_BLOBS_TOKEN: "offline-fixture" });
  t.after(() => keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }));
  const requests: AbortSignal[] = [];
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, options?: RequestInit) => {
    if (new URL(String(url)).searchParams.has("prefix")) {
      return Response.json({ blobs: Array.from({ length: 100 }, (_, i) => ({ key: `project/freshness/${i}` })), directories: [] });
    }
    assert.ok(options?.signal);
    requests.push(options.signal);
    return new Promise<Response>((_, reject) => {
      options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    });
  });
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("fixture deadline")), 40);
  t.after(() => clearTimeout(timer));
  const start = performance.now();
  await assert.rejects(indexVault("unused-local-root", READ_ONLY_VAULT_PROJECT, { signal: deadline.signal }), /fixture deadline/);
  assert.equal(requests.length, 16, "only the first pool starts before the deadline");
  assert.ok(requests.every(signal => signal.aborted));
  assert.ok(performance.now() - start < 1000, "does not wait for SDK retries");
});

test("adding vaulted captures keeps the shared maps identical to a fresh scan", async () => {
  const root = mkdtempSync(join(tmpdir(), "wtp-shared-vault-"));
  try {
    const store = new DurableEvidenceStore(root);
    const capture = (sourceId: string, workItemId: string, body: string) => recordAcquisition({
      canonicalUrl: `https://${sourceId}/page`, retrievedAt: "2026-10-02T00:00:00.000Z", httpStatus: 200,
      contentType: "text/html", sourceId, methodRouteId: "fixture", workItemId, attemptId: `attempt-${workItemId}`,
      permission: "ALLOWED", transport: "REACHABLE",
    }, body).artifact;
    const original = capture("middle.example.gov", "work-middle", "same body");
    await putArtifact(store, READ_ONLY_VAULT_PROJECT, original, Buffer.from("same body"));
    const shared = await indexVault(root);
    const maps = [shared.byId, shared.byHash, shared.byWorkItem];
    for (const [source, work, body] of [["z.example.gov", "work-last", "same body"], ["a.example.gov", "work-first", "same body"], ["other.example.gov", "work-other", "new body"]]) {
      const artifact = capture(source, work, body);
      const { key } = await putArtifact(store, READ_ONLY_VAULT_PROJECT, artifact, Buffer.from(body));
      includeVaultCapture(shared, artifact, key, root);
      const fresh = await indexVault(root);
      assert.deepEqual(shared, fresh, "all capture owners and duplicate-id precedence match rescanning");
    }
    assert.deepEqual([shared.byId, shared.byHash, shared.byWorkItem], maps, "existing consumers retain the same maps");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the derived wiring child's closure reaches no filesystem writer", () => {
  const vault = readFileSync("lib/control-plane/evidence/read-only-vault.ts", "utf8");
  assert.doesNotMatch(vault, /\b(writeFile|rename|mkdir|rm|appendFile|unlink)\b\s*\(/);
  assert.doesNotMatch(vault, /durable-store/);
  const child = readFileSync("scripts/derive-meeting-source-wiring.mts", "utf8");
  assert.doesNotMatch(child, /durable-store|DurableEvidenceStore|writeFile|appendFile/);
  const reviewer = readFileSync("scripts/derive-meeting-body-crosswalk.mts", "utf8");
  assert.doesNotMatch(reviewer, /durable-store|DurableEvidenceStore|writeFile|appendFile/);
  assert.match(reviewer, /read-only-vault\.ts/);
});

test("derived captures read only cited IDs, reuse concurrent lookups, and keep attributed misses distinct", async () => {
  const first = { artifactId: "ar-first", attemptId: "at-new" } as ArtifactRecord;
  const older = { ...first, attemptId: "at-old" };
  const other = { artifactId: "ar-other", attemptId: "at-other" } as ArtifactRecord;
  const calls: string[] = [];
  const held = { id: first.artifactId } as Awaited<ReturnType<typeof findHeldCapture>>;
  const capture = heldArtifactCaptureLookup("vault", [first, older, other], async (_root, record) => {
    calls.push(record.attemptId);
    return record.attemptId === "at-old" ? held : null;
  });
  assert.deepEqual(await Promise.all([capture(first.artifactId), capture(first.artifactId)]), [held, held]);
  assert.deepEqual(calls, ["at-new", "at-old"]);
  assert.equal(await capture("ar-absent"), null);
  assert.deepEqual(calls, ["at-new", "at-old"], "neither unrelated nor absent captures are looked up");
  const corrupt = heldArtifactCaptureLookup("vault", [first], async () => { throw new Error("VAULT_CAPTURE_SIDECAR_MISMATCH"); });
  await assert.rejects(corrupt(first.artifactId), /VAULT_CAPTURE_SIDECAR_MISMATCH/);
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
