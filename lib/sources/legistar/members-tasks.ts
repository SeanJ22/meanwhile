import { neon } from "@neondatabase/serverless";
import type { RoutineSourceTask, RoutineTaskClock } from "../../civic-data/runner.ts";
import { LEGISTAR_TENANT_SQL } from "../../doors/legistar-tenant.ts";
import type { Query } from "../../facts/publish.ts";
import type { RoutineRunnerReceipt } from "../../civic-data/runner-receipt.ts";

export function legistarDoorQuery(): Query {
  const url = process.env.WTP_CONTROL_PLANE_DATABASE_URL?.trim();
  if (!url) throw new Error("LEGISTAR_MEMBERS_DOORS_UNAVAILABLE");
  const sql = neon(url);
  return async (text, params = []) => await sql.query(text, [...params]) as Record<string, unknown>[];
}

export function legistarMemberTasks(slugs: readonly string[]): RoutineSourceTask[] {
  return [...new Set(slugs)].map(slug => {
    if (!/^[a-z0-9_-]+$/.test(slug)) throw new Error("LEGISTAR_MEMBERS_CLIENT_INVALID");
    return { id: `legistar-members:${slug}`,
      sourceId: "registry-reviewed-bindings", recordClass: "REGISTRY_RUNTIME_BINDING", scope: `legistar-members:${slug}`,
      acquisitionFailureDomain: `legistar:${slug}`, requestedUrl: `https://webapi.legistar.com/v1/${slug}/officerecords`,
      authorityMode: "REGISTERED_SOURCE_ROUTES", parserVersion: "registry-runtime-bindings/3",
      command: [process.execPath, "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "scripts/legistar-members-refresh.mts", `--legistar-client=${slug}`], cadenceMs: 12 * 60 * 60_000, retryMs: 60 * 60_000,
      contract: { readerProjection: null, cadence: { defaultEveryMs: 12 * 60 * 60_000, description: "Twice-daily public members and terms" } } };
  });
}

export async function heldLegistarMemberTasks(query: Query = legistarDoorQuery()): Promise<RoutineSourceTask[]> {
  const rows = await query(`SELECT DISTINCT (${LEGISTAR_TENANT_SQL}) AS slug FROM cp_doors
    WHERE value->>'status' <> 'SUSPENDED' AND (${LEGISTAR_TENANT_SQL}) IS NOT NULL`);
  return legistarMemberTasks(rows.map(row => String(row.slug)));
}

export async function legistarMemberClocks(query: Query, taskIds: readonly string[]): Promise<ReadonlyMap<string, RoutineTaskClock>> {
  const rows = await query("SELECT source, loaded_at FROM fact_store_load WHERE source = ANY($1::text[])", [taskIds]);
  return new Map(rows.map(row => {
    const at = new Date(row.loaded_at as string).toISOString();
    return [String(row.source), { lastAttemptedAt: at, lastSucceededAt: at, lastSucceededObservedAt: at }];
  }));
}

export async function legistarMemberReceiptIssue(query: Query, receipt: RoutineRunnerReceipt, taskId: string): Promise<string | null> {
  if (receipt.source !== taskId || receipt.state !== "PROMOTED" || receipt.decision !== "GOOD" || !receipt.acquisitionSucceeded ||
    receipt.promotedVersion !== receipt.candidateId || receipt.lastKnownGoodVersion !== receipt.candidateId) return "The tenant fact check did not succeed";
  const [row] = await query("SELECT sha256, loaded_at FROM fact_store_load WHERE source = $1", [taskId]);
  return row && receipt.candidateId === `${taskId}:${row.sha256}` && receipt.confirmedAt === new Date(row.loaded_at as string).toISOString()
    ? null : "The tenant fact check differs from its durable checkpoint";
}
