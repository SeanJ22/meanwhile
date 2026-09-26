/** A new complete approval brings the existing publication task forward.
 * This only changes admission: the normal derived door still rereads vaulted
 * bytes, validates every candidate and preserves the last good version. */
export const CAMPAIGN_PUBLICATION_TASK = "candidate-campaign-sites-derived";

export function campaignPublicationDue(input: {
  readonly taskId: string;
  readonly approvalAt: string | null;
  readonly lastAttemptedAt?: string;
  readonly nowMs: number;
}): boolean {
  if (input.taskId !== CAMPAIGN_PUBLICATION_TASK || input.approvalAt === null) return false;
  const approved = Date.parse(input.approvalAt);
  if (!Number.isFinite(approved) || approved > input.nowMs) return false;
  const attempted = input.lastAttemptedAt ? Date.parse(input.lastAttemptedAt) : NaN;
  return !Number.isFinite(attempted) || approved > attempted;
}

/** Bounded query over approved campaign findings only, never a pipeline scan.
 * An unread log throws; callers retain normal cadence and report the failure. */
export async function readLatestCampaignApprovalAt(query: (sql: string, params: unknown[]) => Promise<unknown>): Promise<string | null> {
  // The chain's evidence timestamp can predate approval admission. Use the
  // durable append clock so recovery of older findings also wakes publication.
  const result = await query("SELECT recorded_at::text AS approved_at FROM cp_log_promotion_pipeline WHERE record->>'stage' = 'APPROVED_FOR_PROMOTION' AND record->'campaignSite' IS NOT NULL ORDER BY recorded_at DESC LIMIT 1", []);
  if (!Array.isArray(result)) throw new Error("CAMPAIGN_APPROVAL_CLOCK_INVALID");
  if (!result.length) return null;
  const value = result[0]?.approved_at;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("CAMPAIGN_APPROVAL_CLOCK_INVALID");
  return new Date(value).toISOString();
}
