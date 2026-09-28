import { createHash, randomUUID } from "node:crypto";
import type { Attempt } from "../attempt.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../repository/types.ts";
import type { WorkItem } from "../work-item.ts";
import { ADMIN_EVIDENCE_MAX_BYTES, adminEvidenceKey, adminMirrorableContentType,
  mirrorOriginalCapture, verifyAdminEvidenceBlob, type AdminEvidenceRemote } from "./admin-bridge.ts";
import { findHeldCapture, readHeldBytes } from "./read-only-vault.ts";

export type AdminCopyState = "PENDING" | "AVAILABLE" | "REFUSED";
export interface AdminEvidenceCopyRequest {
  readonly id: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly artifactId: string;
  readonly contentHash: string;
  /** Hashed Admin session reference from the authenticated, same-origin POST. */
  readonly requesterRef: string;
  readonly authorizationKind: "AUTHENTICATED_ADMIN_EXACT_CAPTURE";
  readonly requestedAt: string;
  readonly updatedAt: string;
  readonly state: AdminCopyState;
  readonly code: string | null;
  readonly detail: string | null;
  readonly retryAt: string | null;
  readonly lease: { readonly token: string; readonly until: string } | null;
}
export interface AdminCopyStatus {
  readonly state: "UNREQUESTED" | AdminCopyState;
  readonly code: string | null;
  readonly detail: string | null;
  readonly updatedAt: string | null;
}

const idFor = (workItemId: string, attemptId: string, artifactId: string): string =>
  `admin-copy-${createHash("sha256").update(`${workItemId}\0${attemptId}\0${artifactId}`).digest("hex").slice(0, 32)}`;
export const adminCopyRequestId = idFor;
const status = (row: AdminEvidenceCopyRequest | null): AdminCopyStatus => row
  ? { state: row.state, code: row.code, detail: row.detail, updatedAt: row.updatedAt }
  : { state: "UNREQUESTED", code: null, detail: null, updatedAt: null };

/** The Admin request only queues an already recorded original; it never opens a URL. */
export async function requestAdminEvidenceCopy(input: { readonly repos: ControlPlaneRepositories;
  readonly record: ArtifactRecord; readonly attempt: Attempt; readonly owner: WorkItem; readonly now: string;
  readonly adminSessionRef: string;
}): Promise<AdminCopyStatus> {
  const { record, attempt, owner, repos, now } = input;
  adminEvidenceKey(record);
  if (!input.adminSessionRef || input.adminSessionRef.length > 512)
    return { state: "REFUSED", code: "ADMIN_SESSION_REF_INVALID", detail: "The Admin session could not authorize this request.", updatedAt: now };
  if (owner.project !== "freshness" || owner.id !== record.workItemId || attempt.id !== record.attemptId ||
      attempt.workItemId !== owner.id || !attempt.artifactIds.includes(record.artifactId))
    return { state: "REFUSED", code: "ATTRIBUTION_MISMATCH", detail: "The saved work, attempt and capture do not match.", updatedAt: now };
  if (record.tier !== "RAW" || record.partial || !adminMirrorableContentType(record.contentType))
    return { state: "REFUSED", code: "CAPTURE_NOT_MIRRORABLE", detail: "This capture cannot be copied as an original.", updatedAt: now };
  if (record.byteLength > ADMIN_EVIDENCE_MAX_BYTES)
    return { state: "REFUSED", code: "EXCEEDS_PRIVATE_COPY_LIMIT_32_MIB", detail: "This original exceeds the 32 MiB private-copy limit.", updatedAt: now };
  const id = idFor(record.workItemId, record.attemptId, record.artifactId);
  const previous = await repos.adminEvidenceCopyRequests.read(id);
  if (previous) return previous.value.contentHash === record.contentHash ? status(previous.value) :
    { state: "REFUSED", code: "REQUEST_RECORD_MISMATCH", detail: "The request does not match the recorded capture.", updatedAt: previous.value.updatedAt };
  const request: AdminEvidenceCopyRequest = { id, workItemId: record.workItemId, attemptId: record.attemptId,
    artifactId: record.artifactId, contentHash: record.contentHash,
    requesterRef: createHash("sha256").update(input.adminSessionRef).digest("hex"),
    authorizationKind: "AUTHENTICATED_ADMIN_EXACT_CAPTURE", requestedAt: now, updatedAt: now,
    state: "PENDING", code: null, detail: null, retryAt: null, lease: null };
  try { await repos.adminEvidenceCopyRequests.put(id, request, now); }
  catch (error) {
    const raced = await repos.adminEvidenceCopyRequests.read(id);
    if (!raced) throw error;
    return status(raced.value);
  }
  return status(request);
}

/** AVAILABLE is asserted only after the remote bytes pass the original hash gate. */
export async function readAdminEvidenceCopyStatus(input: { readonly repos: ControlPlaneRepositories;
  readonly record: ArtifactRecord; readonly remote: AdminEvidenceRemote;
}): Promise<AdminCopyStatus> {
  const saved = await input.repos.adminEvidenceCopyRequests.read(idFor(input.record.workItemId, input.record.attemptId, input.record.artifactId));
  if (saved && saved.value.contentHash !== input.record.contentHash) return {
    state: "REFUSED", code: "REQUEST_RECORD_MISMATCH", detail: "The request does not match the recorded capture.", updatedAt: saved.value.updatedAt };
  try {
    const blob = await input.remote.read(adminEvidenceKey(input.record));
    if (blob) {
      verifyAdminEvidenceBlob(input.record, blob);
      return { state: "AVAILABLE", code: null, detail: null, updatedAt: saved?.value.updatedAt ?? null };
    }
  } catch {
    if (saved?.value.state === "REFUSED") return status(saved.value);
    return saved ? { state: "PENDING", code: "PRIVATE_COPY_UNVERIFIED", detail: "The private copy could not be verified.", updatedAt: saved.value.updatedAt } :
      { state: "UNREQUESTED", code: "PRIVATE_COPY_STATUS_UNREADABLE", detail: "No saved request was found; private-copy availability could not be checked.", updatedAt: null };
  }
  if (saved?.value.state === "AVAILABLE") return { state: "PENDING", code: "PRIVATE_COPY_UNAVAILABLE",
    detail: "The verified private copy is not currently available.", updatedAt: saved.value.updatedAt };
  return status(saved?.value ?? null);
}

/** A second explicit POST can reopen an unavailable former copy; GET never mutates. */
export async function requeueUnavailableAdminCopy(input: { readonly repos: ControlPlaneRepositories;
  readonly record: ArtifactRecord; readonly now: string;
}): Promise<AdminCopyStatus> {
  const id = idFor(input.record.workItemId, input.record.attemptId, input.record.artifactId);
  const saved = await input.repos.adminEvidenceCopyRequests.read(id);
  if (!saved || saved.value.contentHash !== input.record.contentHash || saved.value.state !== "AVAILABLE")
    return saved ? status(saved.value) : status(null);
  const next: AdminEvidenceCopyRequest = { ...saved.value, state: "PENDING", code: "PRIVATE_COPY_UNAVAILABLE",
    detail: "The former private copy is unavailable; its exact original is queued for re-verification.",
    updatedAt: input.now, retryAt: null, lease: null };
  try { await input.repos.adminEvidenceCopyRequests.compareAndSet(id, saved.revision, next, input.now); return status(next); }
  catch {
    const raced = await input.repos.adminEvidenceCopyRequests.read(id);
    if (!raced) throw new Error("ADMIN_COPY_REQUEST_LOST");
    return status(raced.value);
  }
}

const terminalCodes = new Set(["RAW_ONLY", "UNSCANNABLE_OR_MISMATCHED_CONTENT_TYPE", "RETENTION_NOT_MIRRORABLE",
  "PARTIAL_CAPTURE", "PARTIAL_SOURCE_RESPONSE", "ATTRIBUTION_MISMATCH", "EXCEEDS_PRIVATE_COPY_LIMIT_32_MIB",
  "BYTES_MISMATCH", "RESTRICTED_ON_RESCAN", "INVALID_RECORD_IDENTITY", "REMOTE_COPY_MISMATCH",
  "REQUEST_AUTHORIZATION_MISSING"]);

/** One bounded, CAS-leased operation. A process death leaves a retryable lease, not a false copy. */
export async function pollAdminEvidenceCopyRequests(input: { readonly repos: ControlPlaneRepositories;
  readonly vaultRoot: string; readonly remote: AdminEvidenceRemote; readonly now?: () => number;
  readonly deadlineMs: number;
}): Promise<{ readonly examined: number; readonly copied: number; readonly pending: number; readonly refused: number }> {
  const now = input.now ?? Date.now;
  const pending = await input.repos.adminEvidenceCopyRequests.listWhere(["state"], "PENDING");
  const due = pending.filter(row => (!row.value.retryAt || Date.parse(row.value.retryAt) <= now()) &&
    (!row.value.lease || Date.parse(row.value.lease.until) <= now()))
    .sort((a, b) => a.value.requestedAt.localeCompare(b.value.requestedAt) || a.id.localeCompare(b.id));
  if (!due.length || now() >= input.deadlineMs - 500) return { examined: 0, copied: 0, pending: pending.length, refused: 0 };
  const selected = due[0];
  const token = randomUUID();
  const started = new Date(now()).toISOString();
  const claimed: AdminEvidenceCopyRequest = { ...selected.value, lease: { token, until: new Date(now() + 60_000).toISOString() },
    updatedAt: started };
  try { await input.repos.adminEvidenceCopyRequests.compareAndSet(selected.id, selected.revision, claimed, started); }
  catch { return { examined: 0, copied: 0, pending: pending.length, refused: 0 }; }
  let state: AdminCopyState = "PENDING", code: string | null = null, detail: string | null = null;
  try {
    if (claimed.authorizationKind !== "AUTHENTICATED_ADMIN_EXACT_CAPTURE" ||
        !/^[0-9a-f]{64}$/.test(claimed.requesterRef)) throw new Error("REQUEST_AUTHORIZATION_MISSING");
    const [rows, attempt, owner] = await Promise.all([
      input.repos.artifacts.read(claimed.workItemId), input.repos.attempts.read(claimed.attemptId),
      input.repos.workItems.read(claimed.workItemId),
    ]);
    const record = rows.find(row => row.artifactId === claimed.artifactId && row.attemptId === claimed.attemptId);
    if (!record || record.contentHash !== claimed.contentHash || !attempt || !owner || owner.value.project !== "freshness")
      throw new Error("ATTRIBUTION_MISMATCH");
    const held = await findHeldCapture(input.vaultRoot, record);
    if (!held) throw new Error("LOCAL_CAPTURE_UNAVAILABLE");
    await mirrorOriginalCapture({ record, attempt: attempt.value, held, bytes: await readHeldBytes(held), remote: input.remote });
    state = "AVAILABLE";
  } catch (error) {
    code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "COPY_RETRYABLE_FAILURE";
    state = terminalCodes.has(code) ? "REFUSED" : "PENDING";
    detail = state === "REFUSED" ? "The recorded capture failed a private-copy safety or identity gate." :
      "The private copy is still owed; the runner will retry.";
  }
  const current = await input.repos.adminEvidenceCopyRequests.read(selected.id);
  if (!current || current.value.lease?.token !== token) return { examined: 1, copied: 0, pending: pending.length, refused: 0 };
  const ended = new Date(now()).toISOString();
  await input.repos.adminEvidenceCopyRequests.compareAndSet(selected.id, current.revision, {
    ...current.value, state, code, detail, updatedAt: ended, lease: null,
    retryAt: state === "PENDING" ? new Date(now() + 60_000).toISOString() : null,
  }, ended);
  return { examined: 1, copied: Number(state === "AVAILABLE"), pending: pending.length - Number(state !== "PENDING"), refused: Number(state === "REFUSED") };
}
