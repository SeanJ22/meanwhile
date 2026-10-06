import { newFieldManualEntry, type FieldManualEntry } from "./field-manual.ts";
import { detectTenancy } from "../hunt/platform-tenancy.ts";
import type { ScoutResult } from "./scheduler/scout-result.ts";

interface JobCost {
  readonly platform: string; readonly recordClass: string; readonly attemptId: string;
  readonly durationMs: number; readonly usd: number | null; readonly requestCount: number | null; readonly success: boolean;
}

/** Each completed attempt is an idempotent observation, including failed attempts on the same platform. */
export function scoutJobCostEntries(result: ScoutResult): FieldManualEntry[] {
  // Older discovery envelopes carry no attempt measurements. Preserve their discoveries without inventing costs.
  if (!Number.isFinite(result.elapsedMs) || result.elapsedMs < 0) return [];
  const rungs = result.rungs ?? [];
  const usd = typeof result.usd === "number" && Number.isFinite(result.usd) && result.usd >= 0 ? result.usd : null;
  const platforms = [...new Set([...result.candidates.map(c => c.url), ...rungs.map(r => r.target)]
    .flatMap(url => detectTenancy(url, url).map(hit => hit.platform)))];
  return platforms.map(platform => newFieldManualEntry("job-cost", `${platform}:${result.recordClass}:${result.attemptId}`, {
    role: "SHARED", kind: "JOB_COST", title: `${platform}: ${result.recordClass}`, summary: "Measured attempt cost",
    platforms: [platform], recordClasses: [result.recordClass], observedAt: result.recordedAt, outcome: "REFERENCE",
    payload: { platform, recordClass: result.recordClass, attemptId: result.attemptId, durationMs: result.elapsedMs,
      usd, requestCount: rungs.length ? rungs.filter(r => ["fetch_public", "browse", "search", "call_api"].includes(r.tool)).length : null,
      success: result.refusal === null && (result.candidates.length > 0 || (result.findings ?? []).length > 0) } satisfies JobCost,
  }));
}

/** Derive profiles from saved observations, so retrying a write cannot count an attempt twice. */
export function jobCostProfiles(entries: readonly FieldManualEntry[], affected: readonly FieldManualEntry[], now: string): FieldManualEntry[] {
  const keys = new Set(affected.filter(e => e.kind === "JOB_COST").map(e => {
    const p = e.payload as JobCost; return `${p.platform}:${p.recordClass}`;
  }));
  return [...keys].map(key => {
    const rows = entries.filter(e => e.kind === "JOB_COST").map(e => e.payload as JobCost).filter(p => `${p.platform}:${p.recordClass}` === key);
    const first = rows[0]!;
    const successes = rows.filter(r => r.success).length;
    const totalRequests = rows.every(r => r.requestCount !== null) ? rows.reduce((n, r) => n + r.requestCount!, 0) : null;
    const totalMs = rows.reduce((n, r) => n + r.durationMs, 0);
    const priced = rows.filter(r => r.usd !== null);
    return jobCostProfileFromTotals({ platform: first.platform, recordClass: first.recordClass,
      attempts: rows.length, successes, totalMs, totalRequests, totalUsd: priced.length === rows.length ? priced.reduce((n,r)=>n+r.usd!,0) : null }, now);
  });
}

/** Same profile from a small SQL aggregate; no historical payloads cross the network. */
export function jobCostProfileFromTotals(t: {
  platform: string; recordClass: string; attempts: number; successes: number;
  totalMs: number | null; totalRequests: number | null; totalUsd: number | null;
}, now: string): FieldManualEntry {
  const key = `${t.platform}:${t.recordClass}`;
  const usd = t.totalUsd !== null && t.successes ? t.totalUsd / t.successes : null;
  const requests = t.successes && t.totalRequests !== null ? Math.round(t.totalRequests / t.successes * 10) / 10 : null;
  const duration = t.successes && t.totalMs !== null ? t.totalMs / t.successes : null;
  return newFieldManualEntry("job-cost-profile", key, { role: "SHARED", kind: "COST_PROFILE", title: key,
    summary: t.successes ? `typically ${requests === null ? "request count not recorded" : requests + " requests"}, ${usd === null ? "cost not fully recorded" : "$" + usd.toFixed(2)} per success; ${duration === null ? "duration not fully recorded" : Math.round(duration) + " ms"}` : "No successful attempt recorded yet",
    platforms: [t.platform], recordClasses: [t.recordClass], observedAt: now, outcome: "REFERENCE",
    payload: { platform: t.platform, recordClass: t.recordClass, attempts: t.attempts, successes: t.successes, typicalRequests: requests,
      usdPerSuccess: usd, durationMsPerSuccess: duration },
  });
}
