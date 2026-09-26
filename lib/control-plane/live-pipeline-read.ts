import { neon } from "@neondatabase/serverless";
import { pipelineStatesOf } from "./assignment-read.ts";
import type { PipelineItemState } from "./promotion/types.ts";

export type LivePipelineRead = { ok: true; at: string; states: readonly PipelineItemState[] } | { ok: false; reason: string };

/** The existing log's presentation fields in original order; no evidence bodies or vaulted bytes cross the wire. */
export async function readLivePipeline(url: string | undefined): Promise<LivePipelineRead> {
  if (!url) return { ok: false, reason: "Live pipeline storage is not configured; the published trail is retained." };
  try {
    const sql = neon(url, { fetchOptions: { signal: AbortSignal.timeout(1800) } });
    const rows = await sql.query(`SELECT jsonb_strip_nulls(jsonb_build_object(
      'formatVersion',record->'formatVersion','stage',record->'stage','itemId',record->'itemId',
      'recordId',record->'recordId','recordClass',record->'recordClass','subjectId',record->'subjectId',
      'at',record->'at','atStage',record->'atStage','reasons',record->'reasons',
      'chain',record->'chain','source',record->'source','summary',record->'summary',
      'canonicalUrl',record->'canonicalUrl','sameFact',record->'sameFact')) AS record
      FROM cp_log_promotion_pipeline ORDER BY log_key, position`);
    return { ok: true, at: new Date().toISOString(), states: pipelineStatesOf(rows.map(r => r.record)) };
  } catch { return { ok: false, reason: "Live pipeline storage could not be read; the published trail is retained." }; }
}
