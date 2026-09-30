/** Runner-only private-copy poller. The Admin API must not import vault filesystem reads. */
import { randomUUID } from "node:crypto";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { mirrorOriginalCapture, type AdminEvidenceRemote } from "./admin-bridge.ts";
import { findHeldCapture, readHeldBytes } from "./read-only-vault.ts";
import type { AdminCopyState, AdminEvidenceCopyRequest } from "./admin-copy-request.ts";
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
