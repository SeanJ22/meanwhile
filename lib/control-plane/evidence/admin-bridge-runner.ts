import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { mirrorOriginalCapture, type AdminEvidenceRemote } from "./admin-bridge.ts";
import { NetlifyAdminEvidenceRemote } from "./admin-bridge-netlify.ts";
import { indexVault, readHeldBytes } from "./read-only-vault.ts";

export interface AdminMirrorReport {
  readonly state: "DISABLED" | "NOT_CONFIGURED" | "RAN";
  readonly examined: number;
  readonly copied: number;
  readonly alreadyVerified: number;
  readonly refused: number;
  readonly failures: readonly string[];
}

/** Ordinary cycle reconciliation, including older complete captures. Cursor is operational only, never evidence. */
export async function runAdminEvidenceMirror(input: {
  readonly repos: ControlPlaneRepositories;
  readonly vaultRoot: string;
  readonly cursorPath: string;
  readonly env?: Readonly<{ WTP_ADMIN_EVIDENCE_MIRROR_ENABLED?: string; NETLIFY_SITE_ID?: string; NETLIFY_BLOBS_TOKEN?: string }>;
  readonly maxExamined?: number;
  /** Isolated tests only; production uses the configured private Netlify store. */
  readonly remote?: AdminEvidenceRemote;
}): Promise<AdminMirrorReport> {
  const env = input.env ?? process.env;
  const empty = (state: AdminMirrorReport["state"]): AdminMirrorReport =>
    ({ state, examined: 0, copied: 0, alreadyVerified: 0, refused: 0, failures: [] });
  if (env.WTP_ADMIN_EVIDENCE_MIRROR_ENABLED !== "1") return empty("DISABLED");
  if (!input.remote && (!env.NETLIFY_SITE_ID || !env.NETLIFY_BLOBS_TOKEN)) return empty("NOT_CONFIGURED");
  const remote = input.remote ?? new NetlifyAdminEvidenceRemote({ siteID: env.NETLIFY_SITE_ID, token: env.NETLIFY_BLOBS_TOKEN });
  const [records, attempts, workItems, vault] = await Promise.all([
    input.repos.artifacts.readAll(), input.repos.attempts.list(), input.repos.workItems.list(), indexVault(input.vaultRoot),
  ]);
  const eligible = [...records].filter(r => r.tier === "RAW" && !r.partial)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.artifactId.localeCompare(b.artifactId));
  if (!eligible.length) return { ...empty("RAN") };
  const byAttempt = new Map(attempts.map(row => [row.id, row.value]));
  const byWorkItem = new Map(workItems.map(row => [row.id, row.value]));
  let cursor = 0;
  try {
    const parsed = JSON.parse(await readFile(input.cursorPath, "utf8")) as { next?: unknown };
    if (Number.isSafeInteger(parsed.next) && (parsed.next as number) >= 0) cursor = parsed.next as number;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const limit = Math.min(Math.max(input.maxExamined ?? 8, 1), 32, eligible.length);
  let copied = 0, alreadyVerified = 0, refused = 0;
  const failures: string[] = [];
  for (let offset = 0; offset < limit; offset++) {
    const record = eligible[(cursor + offset) % eligible.length];
    try {
      const attempt = byAttempt.get(record.attemptId);
      // Artifact ids are tier+hash, so the same bytes can occur in two Attempts.
      // Never let the index's last byId entry reattribute one capture to another.
      const held = vault.byWorkItem.get(record.workItemId)?.find(row =>
        row.id === record.artifactId && row.attemptId === record.attemptId);
      const owner = byWorkItem.get(record.workItemId);
      if (!attempt || !held || !owner || owner.project !== "freshness") throw new Error("ATTRIBUTION_NOT_HELD");
      const outcome = await mirrorOriginalCapture({ record, attempt, held, bytes: await readHeldBytes(held), remote });
      if (outcome === "COPIED") copied++; else alreadyVerified++;
    } catch (error) {
      refused++;
      failures.push(`${record.artifactId}:${error instanceof Error ? error.message : "UNKNOWN"}`);
    }
  }
  await mkdir(dirname(input.cursorPath), { recursive: true });
  await writeFile(input.cursorPath, JSON.stringify({ next: (cursor + limit) % eligible.length }) + "\n", "utf8");
  return { state: "RAN", examined: limit, copied, alreadyVerified, refused, failures };
}
