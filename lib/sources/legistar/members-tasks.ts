import { neon } from "@neondatabase/serverless";
import { REGISTRY_RUNTIME_PARSER_VERSION } from "../../registry/runtime-version.ts";
import { createHash } from "node:crypto";
import { ZERO_RELEASE_EVENTS } from "../../civic-data/release.ts";
import { canonicalCivicDataJson } from "../../civic-data/changes.ts";
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
      authorityMode: "REGISTERED_SOURCE_ROUTES", parserVersion: REGISTRY_RUNTIME_PARSER_VERSION,
      command: ["scripts/legistar-members-refresh.mts", `--legistar-client=${slug}`], cadenceMs: 12 * 60 * 60_000, retryMs: 60 * 60_000,
      contract: { readerProjection: null, cadence: { defaultEveryMs: 12 * 60 * 60_000, description: "Twice-daily public members and terms" } } };
  });
}

export async function heldLegistarMemberTasks(query: Query = legistarDoorQuery()): Promise<RoutineSourceTask[]> {
  const rows = await query(`SELECT DISTINCT (${LEGISTAR_TENANT_SQL}) AS slug FROM cp_doors
    WHERE value->>'status' <> 'SUSPENDED' AND (${LEGISTAR_TENANT_SQL}) IS NOT NULL`);
  return legistarMemberTasks(rows.map(row => String(row.slug)));
}

export async function legistarMemberClocks(query: Query, taskIds: readonly string[]): Promise<ReadonlyMap<string, RoutineTaskClock>> {
  const rows = await query(`SELECT t.source,l.loaded_at,c.position FROM unnest($1::text[]) t(source)
    LEFT JOIN fact_store_load l ON l.source=t.source LEFT JOIN pass_cursor c ON c.name='source-attempt:'||t.source
    WHERE l.loaded_at IS NOT NULL OR c.position IS NOT NULL`, [taskIds]);
  return new Map(rows.map(row => {
    const at = row.loaded_at == null ? null : new Date(row.loaded_at as string).toISOString();
    const failure = row.position ? JSON.parse(String(row.position)) as { at: string } : null;
    return [String(row.source), { lastAttemptedAt: [at, failure?.at].filter((at): at is string => Boolean(at)).sort().at(-1),
      lastSucceededAt: at ?? undefined, lastSucceededObservedAt: at ?? undefined }];
  }));
}

/** Failed native reads keep their own attempt, leaving the successful fact checkpoint intact. */
export async function recordLegistarMemberFailure(query: Query, source: string, at: string, detail: string): Promise<RoutineRunnerReceipt> {
  if (!/^legistar-members:[a-z0-9_-]+$/.test(source)) throw new Error("LEGISTAR_MEMBERS_CLIENT_INVALID");
  const [prior] = await query("SELECT sha256 FROM fact_store_load WHERE source=$1", [source]);
  const receipt: RoutineRunnerReceipt = { source, candidateId: `attempt:${createHash("sha256").update(`${source}\n${at}\n${detail}`).digest("hex")}`,
    acquisitionSucceeded: false, state: "SOURCE_BLOCKED", decision: "FAIL", promotedVersion: null,
    lastKnownGoodVersion: prior ? `${source}:${prior.sha256}` : null, structuralReleaseContract: ZERO_RELEASE_EVENTS };
  await query("INSERT INTO pass_cursor(name,position) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET position=EXCLUDED.position",
    [`source-attempt:${source}`, JSON.stringify({ at, detail, receipt })]);
  return receipt;
}

export async function legistarMemberReceiptIssue(query: Query, receipt: RoutineRunnerReceipt, taskId: string): Promise<string | null> {
  if (receipt.source === taskId && receipt.state === "SOURCE_BLOCKED" && receipt.decision === "FAIL" && !receipt.acquisitionSucceeded && receipt.promotedVersion === null) {
    const [row] = await query("SELECT position FROM pass_cursor WHERE name=$1", [`source-attempt:${taskId}`]);
    const held = row ? JSON.parse(String(row.position)) as { detail: string; receipt: RoutineRunnerReceipt } : null;
    return held?.detail && canonicalCivicDataJson(held.receipt) === canonicalCivicDataJson(receipt) ? null : "The failed tenant read differs from its durable attempt";
  }
  if (receipt.source !== taskId || receipt.state !== "PROMOTED" || receipt.decision !== "GOOD" || !receipt.acquisitionSucceeded ||
    receipt.promotedVersion !== receipt.candidateId || receipt.lastKnownGoodVersion !== receipt.candidateId) return "The tenant fact check did not succeed";
  const [row] = await query("SELECT sha256, loaded_at FROM fact_store_load WHERE source = $1", [taskId]);
  return row && receipt.candidateId === `${taskId}:${row.sha256}` && receipt.confirmedAt === new Date(row.loaded_at as string).toISOString()
    ? null : "The tenant fact check differs from its durable checkpoint";
}
