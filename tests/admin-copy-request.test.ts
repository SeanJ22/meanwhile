import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { ZERO_COST, type Attempt } from "../lib/control-plane/attempt.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { artifactId } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import { adminEvidenceKey, type AdminEvidenceBlob, type AdminEvidenceRemote } from "../lib/control-plane/evidence/admin-bridge.ts";
import { originalEvidenceAttachment } from "../lib/control-plane/evidence/admin-bridge-http.ts";
import { pollAdminEvidenceCopyRequests, readAdminEvidenceCopyStatus, requestAdminEvidenceCopy,
  requeueUnavailableAdminCopy, adminCopyRequestId } from "../lib/control-plane/evidence/admin-copy-request.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";

class Remote implements AdminEvidenceRemote {
  readonly copies = new Map<string, AdminEvidenceBlob>();
  writes = 0;
  async read(key: string) { return this.copies.get(key) ?? null; }
  async create(key: string, blob: AdminEvidenceBlob) {
    this.writes++;
    if (this.copies.has(key)) return false;
    this.copies.set(key, blob);
    return true;
  }
}

async function fixture(t: { after: (fn: () => Promise<void>) => void }, held = true) {
  const vaultRoot = await mkdtemp(join(tmpdir(), "admin-copy-request-"));
  t.after(() => rm(vaultRoot, { recursive: true, force: true }));
  const repos = createMemoryRepositories();
  const now = "2026-09-28T12:00:00.000Z";
  const owner = createWorkItem({ project: "freshness", subject: "city", obligation: "official-roster", why: "source proof", now });
  const body = "<html><body>Public city council roster</body></html>";
  const bytes = new TextEncoder().encode(body);
  const { artifact } = recordAcquisition({ canonicalUrl: "https://city.example.gov/council", retrievedAt: now,
    httpStatus: 200, contentType: "text/html", sourceId: "city", methodRouteId: "official-page",
    workItemId: owner.id, attemptId: "at-copy1", permission: "ALLOWED", transport: "REACHABLE" }, body);
  const record: ArtifactRecord = { artifactId: artifact.id, workItemId: owner.id, routeTaskId: null,
    attemptId: "at-copy1", tier: "RAW", contentHash: artifact.contentHash,
    byteLength: bytes.byteLength, contentType: "text/html", canonicalUrl: artifact.canonicalUrl,
    partial: false, recordedAt: now };
  const attempt: Attempt = { id: record.attemptId, routeTaskId: "rt-copy1", workItemId: owner.id,
    worker: { role: "ACQUIRER", provider: "deterministic", version: "test", instance: "test" },
    leaseId: "ls-copy1", startedAt: now, endedAt: now, outcome: "COMPLETED", abortReason: null,
    artifactIds: [record.artifactId], cost: ZERO_COST, methodVersion: 1, policyVersion: "test" };
  await repos.workItems.put(owner.id, owner, now);
  await repos.attempts.put(attempt.id, attempt, now);
  await repos.artifacts.append(owner.id, record.artifactId, record, now);
  if (held) await putArtifact(new DurableEvidenceStore(vaultRoot), "freshness", artifact, bytes);
  return { repos, owner, attempt, record, vaultRoot, remote: new Remote(), now, artifact, bytes };
}

test("exact request is idempotent, CAS-leased copier verifies bytes, then attachment is original", async t => {
  const f = await fixture(t);
  assert.equal((await readAdminEvidenceCopyStatus(f)).state, "UNREQUESTED");
  const requests = await Promise.all(Array.from({ length: 8 }, () => requestAdminEvidenceCopy(f)));
  assert.ok(requests.every(row => row.state === "PENDING"));
  assert.equal((await f.repos.adminEvidenceCopyRequests.list()).length, 1);
  const at = Date.parse(f.now);
  const polls = await Promise.all(Array.from({ length: 4 }, () => pollAdminEvidenceCopyRequests({
    repos: f.repos, vaultRoot: f.vaultRoot, remote: f.remote, now: () => at, deadlineMs: at + 5_000 })));
  assert.equal(polls.reduce((n, row) => n + row.copied, 0), 1);
  assert.equal(f.remote.writes, 1);
  assert.equal((await readAdminEvidenceCopyStatus(f)).state, "AVAILABLE");
  const response = originalEvidenceAttachment(f.record, (await f.remote.read(adminEvidenceKey(f.record)))!);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), f.bytes);
});

test("missing sidecar remains pending and resumes after a real held capture appears", async t => {
  const f = await fixture(t, false);
  await requestAdminEvidenceCopy(f);
  let at = Date.parse(f.now);
  const first = await pollAdminEvidenceCopyRequests({ repos: f.repos, vaultRoot: f.vaultRoot,
    remote: f.remote, now: () => at, deadlineMs: at + 5_000 });
  assert.equal(first.copied, 0);
  assert.deepEqual((await readAdminEvidenceCopyStatus(f)).state, "PENDING");
  assert.equal(f.remote.writes, 0);
  await putArtifact(new DurableEvidenceStore(f.vaultRoot), "freshness", f.artifact, f.bytes);
  at += 61_000;
  const second = await pollAdminEvidenceCopyRequests({ repos: f.repos, vaultRoot: f.vaultRoot,
    remote: f.remote, now: () => at, deadlineMs: at + 5_000 });
  assert.equal(second.copied, 1);
  assert.equal((await readAdminEvidenceCopyStatus(f)).state, "AVAILABLE");
});

test("wrong attempt, partial and over-limit captures refuse before any request is persisted", async t => {
  const f = await fixture(t);
  const wrong = await requestAdminEvidenceCopy({ ...f, attempt: { ...f.attempt, workItemId: "wi-other" } });
  assert.equal(wrong.code, "ATTRIBUTION_MISMATCH");
  const partial = await requestAdminEvidenceCopy({ ...f, record: { ...f.record, partial: true } });
  assert.equal(partial.code, "CAPTURE_NOT_MIRRORABLE");
  const over = await requestAdminEvidenceCopy({ ...f, record: { ...f.record, byteLength: 32 * 1024 * 1024 + 1 } });
  assert.equal(over.code, "EXCEEDS_PRIVATE_COPY_LIMIT_32_MIB");
  assert.equal((await f.repos.adminEvidenceCopyRequests.list()).length, 0);
  const restrictedId = artifactId("RESTRICTED_RAW", f.record.contentHash);
  const restricted = await requestAdminEvidenceCopy({ ...f,
    record: { ...f.record, artifactId: restrictedId, tier: "RESTRICTED_RAW" },
    attempt: { ...f.attempt, artifactIds: [restrictedId] } });
  assert.equal(restricted.code, "CAPTURE_NOT_MIRRORABLE");
  assert.equal(f.remote.writes, 0);
  assert.notEqual(adminCopyRequestId(f.record.workItemId, f.record.attemptId, f.record.artifactId),
    adminCopyRequestId(f.record.workItemId, "at-other", f.record.artifactId));
});

test("an interrupted copier lease expires and one later poll resumes the same request", async t => {
  const f = await fixture(t);
  await requestAdminEvidenceCopy(f);
  const id = adminCopyRequestId(f.record.workItemId, f.record.attemptId, f.record.artifactId);
  const saved = (await f.repos.adminEvidenceCopyRequests.read(id))!;
  const at = Date.parse(f.now);
  await f.repos.adminEvidenceCopyRequests.compareAndSet(id, saved.revision, {
    ...saved.value, lease: { token: "dead-process", until: new Date(at + 60_000).toISOString() },
  }, f.now);
  const blocked = await pollAdminEvidenceCopyRequests({ repos: f.repos, vaultRoot: f.vaultRoot,
    remote: f.remote, now: () => at + 1_000, deadlineMs: at + 6_000 });
  assert.equal(blocked.examined, 0);
  const resumed = await pollAdminEvidenceCopyRequests({ repos: f.repos, vaultRoot: f.vaultRoot,
    remote: f.remote, now: () => at + 61_000, deadlineMs: at + 66_000 });
  assert.equal(resumed.copied, 1);
  assert.equal(f.remote.writes, 1);
});

test("unreadable remote status without a saved request does not pretend a request is pending", async t => {
  const f = await fixture(t);
  f.remote.read = async () => { throw new Error("REMOTE_DOWN"); };
  const status = await readAdminEvidenceCopyStatus(f);
  assert.equal(status.state, "UNREQUESTED");
  assert.equal(status.code, "PRIVATE_COPY_STATUS_UNREADABLE");
});

test("an occupied immutable remote key with wrong bytes refuses the exact request", async t => {
  const f = await fixture(t);
  await requestAdminEvidenceCopy(f);
  f.remote.copies.set(adminEvidenceKey(f.record), { bytes: new TextEncoder().encode("wrong"), copy: {
    artifactId: f.record.artifactId, workItemId: f.record.workItemId, attemptId: f.record.attemptId,
    contentHash: f.record.contentHash, byteLength: f.record.byteLength, tier: "RAW", source: "VERIFIED_ORIGINAL_CAPTURE" } });
  const at = Date.parse(f.now);
  const result = await pollAdminEvidenceCopyRequests({ repos: f.repos, vaultRoot: f.vaultRoot,
    remote: f.remote, now: () => at, deadlineMs: at + 5_000 });
  assert.equal(result.refused, 1);
  assert.equal((await f.repos.adminEvidenceCopyRequests.read(adminCopyRequestId(f.record.workItemId,
    f.record.attemptId, f.record.artifactId)))?.value.code, "REMOTE_COPY_MISMATCH");
  assert.equal((await readAdminEvidenceCopyStatus(f)).state, "REFUSED", "the unsafe collision is terminal, never an available download");
});

test("only an explicit second request requeues a formerly verified copy that went missing", async t => {
  const f = await fixture(t);
  await requestAdminEvidenceCopy(f);
  const at = Date.parse(f.now);
  await pollAdminEvidenceCopyRequests({ repos: f.repos, vaultRoot: f.vaultRoot,
    remote: f.remote, now: () => at, deadlineMs: at + 5_000 });
  f.remote.copies.clear();
  assert.equal((await readAdminEvidenceCopyStatus(f)).code, "PRIVATE_COPY_UNAVAILABLE");
  const id = adminCopyRequestId(f.record.workItemId, f.record.attemptId, f.record.artifactId);
  assert.equal((await f.repos.adminEvidenceCopyRequests.read(id))?.value.state, "AVAILABLE", "status GET has no write side effect");
  const queued = await requeueUnavailableAdminCopy({ repos: f.repos, record: f.record,
    now: "2026-09-28T12:01:00.000Z" });
  assert.equal(queued.state, "PENDING");
  const resumed = await pollAdminEvidenceCopyRequests({ repos: f.repos, vaultRoot: f.vaultRoot,
    remote: f.remote, now: () => at + 61_000, deadlineMs: at + 66_000 });
  assert.equal(resumed.copied, 1);
});
