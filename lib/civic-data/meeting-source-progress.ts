import { runtimeCivicReadCache, type CivicReadCache } from "../db/civic-read-cache.ts";
import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { RetainedSourceResponse } from "./retained-meeting-bytes.ts";

/** What the scheduler asks of a meeting source between passes. It holds no file reads, so reader routes that load the
 * scheduler never trace the probe's implementation hash or the worker publication vault. */
export interface ProgressPage { readonly response: Omit<RetainedSourceResponse, "bytes">; readonly vaultKey: string }
export interface MeetingSourceProgress { readonly context: string; readonly pages: Readonly<Record<string, ProgressPage>>; readonly deferred?: boolean }
export const MEETING_SOURCE_PROGRESS = "meeting-source-probe:v1";

/** Only the current immutable candidate's remaining work makes its source due. Unaccepted candidates cannot reopen it. */
export async function meetingFactPublicationPending(query: Query, scope: string): Promise<boolean> {
  const [row] = await query(`SELECT coalesce((SELECT position::jsonb->>'complete'='false' FROM pass_cursor
    WHERE name='meeting-facts:'||(SELECT current_version_id FROM civic_data_promotions WHERE key=$1)),false) AS pending`, [`MEETING:${scope}`]);
  return row?.pending === true;
}

export async function meetingSourceContinuationPending(scope: string,
  checkpoint: Pick<CivicReadCache, "readCheckpoint"> = runtimeCivicReadCache().jobState(), query:Query|null=factReader()): Promise<boolean> {
  const progress = await checkpoint.readCheckpoint<MeetingSourceProgress>(MEETING_SOURCE_PROGRESS, scope);
  return progress?.deferred === true || (query ? await meetingFactPublicationPending(query,scope) : false);
}
