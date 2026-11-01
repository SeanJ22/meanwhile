import { storedKeyValue } from "../../core/keys-values.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { NetlifyAdminEvidenceRemote } from "./admin-bridge-netlify.ts";
import type { AdminEvidenceRemote } from "./admin-bridge.ts";
import { pollAdminEvidenceCopyRequests } from "./admin-copy-poller.ts";

export const ADMIN_COPY_POLL_MS = 2_000;
export const ADMIN_COPY_OPERATION_TIMEOUT_MS = 8_000;

function boundedRemote(remote: AdminEvidenceRemote, timeoutMs: number): AdminEvidenceRemote {
  const withTimeout = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("PRIVATE_COPY_REMOTE_TIMEOUT")), timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  // A timed-out immutable create may finish later. The pending request's next
  // poll reads and verifies that same key; no alternate URL or overwrite exists.
  return {
    read: key => withTimeout(remote.read(key)),
    create: (key, blob) => withTimeout(remote.create(key, blob)),
  };
}

/** One exact Admin request at most; never scans or uploads unrequested captures. */
export async function runAuthorizedAdminCopyTick(input: {
  readonly repos: ControlPlaneRepositories;
  readonly vaultRoot: string;
  readonly env: Readonly<{ WTP_ADMIN_EVIDENCE_REQUESTS_ENABLED?: string;
    NETLIFY_SITE_ID?: string; NETLIFY_BLOBS_TOKEN?: string }>;
  readonly now?: () => number;
  /** Local fixture only; the permanent runner constructs the private Netlify adapter. */
  readonly remote?: AdminEvidenceRemote;
}): Promise<{ readonly state: "DISABLED" | "NOT_CONFIGURED" | "RAN";
  readonly examined: number; readonly copied: number; readonly pending: number; readonly refused: number }> {
  const empty = (state: "DISABLED" | "NOT_CONFIGURED") => ({ state, examined: 0, copied: 0, pending: 0, refused: 0 } as const);
  if (input.env.WTP_ADMIN_EVIDENCE_REQUESTS_ENABLED !== "1")
    return empty("DISABLED");
  if (!input.remote && (!input.env.NETLIFY_SITE_ID || !storedKeyValue("NETLIFY_BLOBS_TOKEN", input.env))) return empty("NOT_CONFIGURED");
  const remote = input.remote ?? new NetlifyAdminEvidenceRemote({
    siteID: input.env.NETLIFY_SITE_ID, token: storedKeyValue("NETLIFY_BLOBS_TOKEN", input.env) });
  const now = input.now ?? Date.now;
  const result = await pollAdminEvidenceCopyRequests({ repos: input.repos, vaultRoot: input.vaultRoot,
    remote: boundedRemote(remote, ADMIN_COPY_OPERATION_TIMEOUT_MS), now,
    deadlineMs: now() + ADMIN_COPY_OPERATION_TIMEOUT_MS + 2_000 });
  return { state: "RAN", ...result };
}
