import "server-only";
import { neon } from "@neondatabase/serverless";
import { HUNT_SOURCE_PROGRESS_LOG_KEY, type HuntSourceProgress } from "@/lib/control-plane/owner-surface.ts";
import { sharedRead } from "./shared-read.ts";

type Read = { ok: true; at: string; rows: readonly HuntSourceProgress[] } | { ok: false; reason: string };
export type HuntSourceProgressRead = Read & { stale: boolean };
const caches = new Map<string, ReturnType<typeof sharedRead<Read>>>();
const stages = new Set(["QUEUED", "COLLECTING_AND_VERIFYING", "PUBLISHED", "REUSED", "HELD", "FAILED"]);

export async function loadHuntSourceProgress(instructionId: string): Promise<HuntSourceProgressRead> {
  let cache = caches.get(instructionId);
  if (!cache) {
    cache = sharedRead<Read>({ freshMs: 2000, staleMs: 12_000, deadlineMs: 1800, keep: value => value.ok,
      late: () => ({ ok: false, reason: "Shared source activity did not answer in time. Earlier results retain their original timestamps." }) });
    if (caches.size >= 32) caches.delete(caches.keys().next().value!);
    caches.set(instructionId, cache);
  }
  const reading = await cache.read(async () => {
    const url = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
    if (!url) return { ok: false, reason: "Shared source activity storage is unavailable." };
    try {
      const sql = neon(url, { fetchOptions: { signal: AbortSignal.timeout(1800) } });
      const rows = await sql.query(`SELECT DISTINCT ON (record->'huntSourceProgress'->>'taskId')
        record->'huntSourceProgress' AS progress FROM cp_log_owner_digests
        WHERE log_key=$1 AND record->'huntSourceProgress'->'instructionIds' ? $2
        ORDER BY record->'huntSourceProgress'->>'taskId', position DESC`, [HUNT_SOURCE_PROGRESS_LOG_KEY, instructionId]);
      const progress = rows.map(row => row.progress as HuntSourceProgress);
      if (progress.some(row => !row || !stages.has(row.stage) || !row.instructionIds?.includes(instructionId) ||
        typeof row.taskId !== "string" || typeof row.detail !== "string" || !Number.isFinite(Date.parse(row.at)) ||
        !Array.isArray(row.readerPaths) || row.readerPaths.some(path => typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")))) {
        return { ok: false, reason: "A shared source activity receipt is malformed; it was not treated as verified work." };
      }
      return { ok: true, at: new Date().toISOString(), rows: progress };
    } catch { return { ok: false, reason: "Shared source activity could not be read. This does not mean there is no work." }; }
  });
  return { ...reading, stale: reading.ok && Date.now() - Date.parse(reading.at) > 12_000 };
}
