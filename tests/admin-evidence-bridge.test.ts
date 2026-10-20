import test from "node:test";
import assert from "node:assert/strict";
import { contentHash } from "../lib/control-plane/ids.ts";
import { artifactId } from "../lib/control-plane/evidence/artifact.ts";
import { assertOriginalCapture, adminEvidenceKey, mirrorOriginalCapture, verifyAdminEvidenceBlob,
  ADMIN_EVIDENCE_MAX_BYTES, type AdminEvidenceBlob, type AdminEvidenceRemote } from "../lib/control-plane/evidence/admin-bridge.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { ZERO_COST, type Attempt } from "../lib/control-plane/attempt.ts";
import type { HeldVaultArtifact } from "../lib/control-plane/evidence/read-only-vault.ts";
import { runAdminEvidenceMirror } from "../lib/control-plane/evidence/admin-bridge-runner.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import { withScopeSet } from "../lib/control-plane/expansion/scopes.ts";
import { ADMIN_CONFIG_ID } from "../lib/control-plane/gateway/admin-config.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { mkdtemp, rm, writeFile, appendFile, open, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAdminMirrorCursor } from "../lib/control-plane/evidence/admin-mirror-cursor.ts";

const bytes = new TextEncoder().encode("<html><body>Official public meeting record</body></html>");
const hash = contentHash(bytes);
const id = artifactId("RAW", hash);
const record: ArtifactRecord = { artifactId: id, workItemId: "wi-1234", attemptId: "at-5678",
  routeTaskId: "rt-1234", tier: "RAW", contentHash: hash, byteLength: bytes.byteLength,
  contentType: "text/html", canonicalUrl: "https://city.example.gov/meeting", partial: false,
  recordedAt: "2026-09-28T00:00:00.000Z" };
const attempt: Attempt = { id: record.attemptId, routeTaskId: record.routeTaskId!, workItemId: record.workItemId,
  worker: { role: "ACQUIRER", provider: "deterministic", version: "test", instance: "test" }, leaseId: "ls-1",
  startedAt: record.recordedAt, endedAt: record.recordedAt, outcome: "COMPLETED", abortReason: null,
  artifactIds: [id], cost: ZERO_COST, methodVersion: 1, policyVersion: "test" };
const held: HeldVaultArtifact = { id, tier: "RAW", contentHash: hash, contentType: "text/html",
  canonicalUrl: record.canonicalUrl, retrievalUrl: record.canonicalUrl,
  retrievedAt: record.recordedAt, httpStatus: 200, sourceId: "official-city", workItemId: record.workItemId,
  attemptId: record.attemptId, methodRouteId: "official-html", permission: "ALLOWED",
  retentionPolicy: "EVIDENCE_PERMANENT", bodyPath: "unused", bodySha256: hash };

class MemoryPrivateStore implements AdminEvidenceRemote {
  readonly rows = new Map<string, AdminEvidenceBlob>();
  async read(key: string) { return this.rows.get(key) ?? null; }
  async create(key: string, blob: AdminEvidenceBlob) {
    if (this.rows.has(key)) return false;
    this.rows.set(key, blob);
    return true;
  }
}

test("exact complete raw capture is copied once under work, attempt, artifact and hash, then verified", async () => {
  const remote = new MemoryPrivateStore();
  assert.match(adminEvidenceKey(record), /^freshness\/wi-1234\/at-5678\/ar-[a-f0-9]+\/sha256-[a-f0-9]{64}$/);
  assert.equal(await mirrorOriginalCapture({ record, attempt, held, bytes, remote }), "COPIED");
  assert.equal(await mirrorOriginalCapture({ record, attempt, held, bytes, remote }), "ALREADY_VERIFIED");
  assert.deepEqual(verifyAdminEvidenceBlob(record, (await remote.read(adminEvidenceKey(record)))!), bytes);
});

test("a partial, mismatched owner, stale hash, restricted tier or reclassified credential never leaves the vault", async () => {
  const remote = new MemoryPrivateStore();
  for (const altered of [
    { record: { ...record, partial: true }, attempt, held, bytes },
    { record, attempt: { ...attempt, workItemId: "wi-other" }, held, bytes },
    { record, attempt, held: { ...held, attemptId: "at-other" }, bytes },
    { record, attempt, held: { ...held, httpStatus: 206 }, bytes },
    { record, attempt, held: { ...held, retentionPolicy: "LICENCE_LIMITED" }, bytes },
    { record, attempt, held, bytes: new TextEncoder().encode("altered source") },
    { record: { ...record, tier: "RESTRICTED_RAW" as const }, attempt, held, bytes },
    { record: { ...record, contentType: "application/octet-stream" }, attempt, held, bytes },
  ]) await assert.rejects(mirrorOriginalCapture({ ...altered, remote }));
  assert.equal(remote.rows.size, 0);
  const fakeKey = ["AI", "za"].join("") + "SyD4mQ8vX1nR7pLbT2wCzE0jHfGuY5aKs_-3xNp".slice(0, 35);
  const credential = new TextEncoder().encode(`<html><script>window.__B='{"k":"${fakeKey}"}'</script></html>`);
  const credentialRecord = { ...record, contentHash: contentHash(credential), byteLength: credential.length };
  const credentialHeld = { ...held, contentHash: credentialRecord.contentHash, bodySha256: credentialRecord.contentHash };
  // Even if a forged old metadata row says RAW, the current scanner is the final gate.
  assert.throws(() => assertOriginalCapture(credentialRecord, attempt, credentialHeld, credential));
});

test("an occupied immutable key with different bytes is refused, not overwritten", async () => {
  const remote = new MemoryPrivateStore();
  const copy = assertOriginalCapture(record, attempt, held, bytes);
  remote.rows.set(adminEvidenceKey(record), { copy, bytes: new TextEncoder().encode("wrong") });
  await assert.rejects(mirrorOriginalCapture({ record, attempt, held, bytes, remote }), /REMOTE_COPY_MISMATCH/);
  assert.equal(new TextDecoder().decode(remote.rows.get(adminEvidenceKey(record))!.bytes), "wrong");
});

test("an oversized original has an explicit private-copy limit reason", () => {
  const oversized = { ...record, byteLength: ADMIN_EVIDENCE_MAX_BYTES + 1 };
  assert.throws(() => assertOriginalCapture(oversized, attempt, held, bytes), /EXCEEDS_PRIVATE_COPY_LIMIT_32_MIB/);
  const copy = { artifactId: oversized.artifactId, workItemId: oversized.workItemId, attemptId: oversized.attemptId,
    contentHash: oversized.contentHash, byteLength: oversized.byteLength, tier: "RAW" as const, source: "VERIFIED_ORIGINAL_CAPTURE" as const };
  assert.throws(() => verifyAdminEvidenceBlob(oversized, { copy, bytes }), /EXCEEDS_PRIVATE_COPY_LIMIT_32_MIB/);
});

test("complete RAW PDF bytes use the established binary tier contract and remain byte-exact", async () => {
  const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 0, 255, 128, 10]);
  const pdfHash = contentHash(pdf);
  const pdfId = artifactId("RAW", pdfHash);
  const pdfRecord = { ...record, artifactId: pdfId, contentHash: pdfHash, byteLength: pdf.length,
    contentType: "application/pdf", canonicalUrl: "https://city.example.gov/agenda.pdf" };
  const pdfHeld = { ...held, id: pdfId, contentHash: pdfHash, bodySha256: pdfHash,
    contentType: "application/pdf", canonicalUrl: pdfRecord.canonicalUrl };
  const pdfAttempt = { ...attempt, artifactIds: [pdfId] };
  const remote = new MemoryPrivateStore();
  assert.equal(await mirrorOriginalCapture({ record: pdfRecord, attempt: pdfAttempt, held: pdfHeld, bytes: pdf, remote }), "COPIED");
  assert.deepEqual(verifyAdminEvidenceBlob(pdfRecord, (await remote.read(adminEvidenceKey(pdfRecord)))!), pdf);
});

test("ordinary reconciliation rotates past a failed first capture and copies the next held original", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "admin-evidence-bridge-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repos = createMemoryRepositories();
  const remote = new MemoryPrivateStore();
  const now = "2026-09-28T00:00:00.000Z";
  const work = createWorkItem({ project: "freshness", subject: "city", obligation: "official-source", why: "test", now });
  await repos.workItems.put(work.id, work, now);
  for (let n = 0; n < 2; n++) {
    const at = `at-${n + 1}`;
    const body = `<html><body>Official document ${n + 1}</body></html>`;
    const { artifact } = recordAcquisition({ canonicalUrl: `https://city.example.gov/document-${n + 1}`,
      retrievedAt: now, httpStatus: 200, contentType: "text/html", sourceId: "city", methodRouteId: "source",
      workItemId: work.id, attemptId: at, permission: "ALLOWED", transport: "REACHABLE" }, body);
    await putArtifact(new DurableEvidenceStore(root), "freshness", artifact, new TextEncoder().encode(body));
    await repos.attempts.put(at, { ...attempt, id: at, workItemId: work.id, artifactIds: [artifact.id] }, now);
    await repos.artifacts.append(work.id, artifact.id, { ...record, artifactId: artifact.id, workItemId: work.id,
      attemptId: at, canonicalUrl: artifact.canonicalUrl, contentHash: artifact.contentHash,
      byteLength: artifact.byteLength }, now);
  }
  const cursorPath = join(root, "cursor.json");
  const originalCreate = remote.create.bind(remote);
  let first = true;
  remote.create = async (key, blob) => {
    if (first) { first = false; throw new Error("REMOTE_TEMPORARILY_UNAVAILABLE"); }
    return originalCreate(key, blob);
  };
  const input = { repos, vaultRoot: root, cursorPath, remote,
    env: { WTP_ADMIN_EVIDENCE_MIRROR_ENABLED: "1" }, maxExamined: 1 };
  repos.artifacts.readAll = async () => { throw new Error("country artifact read forbidden"); };
  repos.attempts.list = async () => { throw new Error("country attempt read forbidden"); };
  repos.workItems.list = async () => { throw new Error("country work read forbidden"); };
  const readOwner = repos.workItems.readNarrowed.bind(repos.workItems);
  const readAttempt = repos.attempts.read.bind(repos.attempts);
  const selectedAttempts: string[] = [];
  repos.workItems.readNarrowed = async (id, projection) => {
    assert.equal(id, work.id, "only the capture's exact work routing fields cross the repository");
    assert.ok(!Object.hasOwn(projection, "id"));
    return readOwner(id, projection);
  };
  repos.attempts.read = async id => { selectedAttempts.push(id); return readAttempt(id); };
  const failed = await runAdminEvidenceMirror(input);
  assert.equal(failed.refused, 1);
  assert.equal(selectedAttempts.length, 1, "queue construction does not fetch the country's attempts");
  const next = await runAdminEvidenceMirror(input);
  assert.equal(next.copied, 1, "a first failing capture cannot starve the next capture");
  assert.equal(remote.rows.size, 1);
});

test("exact-hunt and recent captures advance with historical backfill across durable slices", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "admin-evidence-priority-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repos = createMemoryRepositories();
  const remote = new MemoryPrivateStore();
  const now = "2026-09-28T14:00:00.000Z";
  const cases = [
    { label: "original", at: "2026-09-27T06:00:00.000Z", original: true },
    { label: "recent", at: "2026-09-28T13:00:00.000Z", original: false },
    { label: "history", at: "2026-09-20T06:00:00.000Z", original: false },
  ] as const;
  const ids: Record<string, string> = {};
  // Any funded Send's work takes the first lane; this one is not the owner's first hunt.
  const funded = withScopeSet([], { geography: { type: "county", geoid: "04019", version: "county:2020", label: "Test County", stateAbbr: "AZ" },
    priority: 1, budgetUsd: 20, huntBudget: true, newHunt: true, note: null, decidedAt: "2026-09-27T05:00:00.000Z", decidedBy: "adm", receiptId: "funded-send-receipt" }).scopes;
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { expansionScopes: funded } as never, "2026-09-27T05:00:00.000Z");
  for (const item of cases) {
    const base = createWorkItem({ project: "freshness", subject: item.label, obligation: "official-source", why: "test", now: item.at });
    const work: WorkItem = item.original ? { ...base, autonomousPlan: {
      ownerInstructions: ["funded-send-receipt"],
    } as unknown as WorkItem["autonomousPlan"] } : base;
    await repos.workItems.put(work.id, work, item.at);
    const at = `at-${item.label}`;
    const body = `<html><body>Official ${item.label} document</body></html>`;
    const { artifact } = recordAcquisition({ canonicalUrl: `https://city.example.gov/${item.label}`,
      retrievedAt: item.at, httpStatus: 200, contentType: "text/html", sourceId: "city", methodRouteId: "source",
      workItemId: work.id, attemptId: at, permission: "ALLOWED", transport: "REACHABLE" }, body);
    await putArtifact(new DurableEvidenceStore(root), "freshness", artifact, new TextEncoder().encode(body));
    await repos.attempts.put(at, { ...attempt, id: at, workItemId: work.id, artifactIds: [artifact.id] }, item.at);
    await repos.artifacts.append(work.id, artifact.id, { ...record, artifactId: artifact.id, workItemId: work.id,
      attemptId: at, canonicalUrl: artifact.canonicalUrl, contentHash: artifact.contentHash,
      byteLength: artifact.byteLength, recordedAt: item.at }, item.at);
    ids[item.label] = artifact.id;
  }
  const input = { repos, vaultRoot: root, cursorPath: join(root, "cursor.json"), remote,
    env: { WTP_ADMIN_EVIDENCE_MIRROR_ENABLED: "1" }, maxExamined: 1, nowMs: Date.parse(now) };
  for (const label of ["original", "recent", "history"]) {
    const result = await runAdminEvidenceMirror(input);
    assert.equal(result.copied, 1, `${label} receives its own bounded slice`);
    assert.equal([...remote.rows.values()].at(-1)?.copy.artifactId, ids[label]);
  }
  assert.equal((await runAdminEvidenceMirror(input)).examined, 0, "verified copies are skipped until scheduled recheck");

  const boundedRemote = new MemoryPrivateStore();
  const create = boundedRemote.create.bind(boundedRemote);
  let clock = Date.now();
  const startedAt = clock;
  t.mock.method(Date, "now", () => clock);
  boundedRemote.create = async (key, blob) => {
    const result = await create(key, blob);
    clock += 30_000;
    return result;
  };
  const boundedInput = { ...input, remote: boundedRemote, maxExamined: undefined,
    cursorPath: join(root, "bounded-cursor.json"), deadlineMs: Number.POSITIVE_INFINITY };
  const slice = await runAdminEvidenceMirror(boundedInput);
  console.log(`ADMIN_MIRROR firstSliceCopied=${slice.copied} elapsedSimulatedMs=${clock - startedAt}`);
  assert.equal(slice.copied, 1, "an infinite caller allowance cannot make the optional mirror own the whole round");
  assert.equal(slice.refused, 1, "a create that consumed the deadline remains unverified");
  const resumed = await runAdminEvidenceMirror(boundedInput);
  assert.equal(resumed.copied, 1, "the ordinary next cycle resumes the untouched remaining capture");
  assert.equal(resumed.alreadyVerified, 1, "the next turn verifies the immutable create whose status was unknown");
  assert.deepEqual(new Set([...boundedRemote.rows.values()].map(row => row.copy.artifactId)), new Set(Object.values(ids)),
    "bounded slices eventually produce exactly the original three verified copies");

  const stalled = new MemoryPrivateStore();
  let reads = 0;
  stalled.read = async () => { reads++; return new Promise(() => {}); };
  const started = performance.now();
  const stopped = await runAdminEvidenceMirror({ ...boundedInput, remote: stalled,
    cursorPath: join(root, "stalled-cursor.json"), deadlineMs: clock + 550 });
  assert.ok(performance.now() - started < 1500, "a stuck private read cannot hold the round open");
  assert.equal(reads, 1);
  assert.equal(stopped.copied, 0);
  assert.match(stopped.failures[0], /ADMIN_EVIDENCE_MIRROR_DEADLINE/);
  console.log(`ADMIN_MIRROR stalledReadElapsedMs=${(performance.now() - started).toFixed(2)} copied=${stopped.copied}`);
});

test("the existing cursor streams a national legacy membership file into disk storage and preserves lane turns and rechecks", async t => {
  const root = await mkdtemp(join(tmpdir(), "admin-evidence-cursor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "cursor.json"), now = Date.parse("2026-10-20T12:00:00Z");
  const key = (i: number) => `freshness/work-${i}/${"captured-source-identity-".repeat(20)}`;
  await writeFile(file, '{"version":2,"nextByLane":{"original":4,"recent":5,"history":6},"turn":3,"verifiedAt":{');
  for (let first = 0; first < 6000; first += 100) {
    const chunk = Array.from({ length: 100 }, (_, offset) => {
      const i = first + offset; return `${i ? "," : ""}${JSON.stringify(key(i))}:${i === 0 ? now - 7 * 86_400_000 : now}`;
    }).join("");
    await appendFile(file, chunk);
  }
  await appendFile(file, ',"not-a-freshness-key":1}}');
  const cursor = await openAdminMirrorCursor(file, now);
  assert.deepEqual(cursor.nextByLane, { original: 4, recent: 5, history: 6 });
  assert.equal(cursor.turn, 3);
  assert.equal(cursor.hasVerified(key(0)), false, "the original seven-day recheck boundary is preserved");
  assert.equal(cursor.hasVerified(key(5999)), true);
  assert.equal(cursor.hasVerified("not-a-freshness-key"), false);
  cursor.nextByLane.history = 12; cursor.turn = 4;
  cursor.markVerified("freshness/new/immutable/capture/hash", now); cursor.save(); cursor.close();
  const header = Buffer.alloc(16), handle = await open(file, "r");
  try { await handle.read(header, 0, 16, 0); } finally { await handle.close(); }
  assert.equal(header.toString(), "SQLite format 3\0", "the existing cursor is replaced, with no second durable ledger");
  const resumed = await openAdminMirrorCursor(file, now);
  try { assert.equal(resumed.nextByLane.history, 12); assert.equal(resumed.turn, 4); assert.ok(resumed.hasVerified("freshness/new/immutable/capture/hash")); }
  finally { resumed.close(); }
  const old = join(root, "old.json"); await writeFile(old, '{"next":9}');
  const migratedOld = await openAdminMirrorCursor(old, now);
  try { assert.deepEqual(migratedOld.nextByLane, { original: 0, recent: 0, history: 9 }); } finally { migratedOld.close(); }
  const corrupt = join(root, "corrupt.json"), invalid = '{"version":2,"verifiedAt":{}}'; await writeFile(corrupt, invalid);
  await assert.rejects(openAdminMirrorCursor(corrupt, now), /CURSOR_INVALID/);
  assert.equal(await readFile(corrupt, "utf8"), invalid, "a failed migration keeps the original cursor intact");
});

test("every failed capture diagnostic streams immediately while the mirror retains only a finite report sample", async t => {
  const root = await mkdtemp(join(tmpdir(), "admin-evidence-failures-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repos = createMemoryRepositories(), seen: string[] = [];
  for (let i = 0; i < 40; i++) await repos.artifacts.append("history", `invalid-${i}`,
    { ...record, artifactId: `invalid-${i}` }, record.recordedAt);
  const report = await runAdminEvidenceMirror({ repos, vaultRoot: root, cursorPath: join(root, "cursor.json"),
    remote: new MemoryPrivateStore(), env: { WTP_ADMIN_EVIDENCE_MIRROR_ENABLED: "1" }, onFailure: detail => { seen.push(detail); } });
  assert.equal(report.refused, 40); assert.equal(report.examined, 0);
  assert.equal(seen.length, 40); assert.equal(new Set(seen).size, 40);
  assert.deepEqual(report.failures, seen.slice(0, 8));
  assert.ok(seen.every(detail => detail.endsWith(":INVALID_RECORD_IDENTITY")));
});
