import { newFieldManualEntry, type FieldManualEntry } from "./field-manual.ts";

interface JobCost {
  readonly platform: string; readonly recordClass: string; readonly attemptId: string;
  readonly durationMs: number; readonly usd: number | null; readonly requestCount: number | null; readonly success: boolean;
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
    const usd = priced.length === rows.length && successes ? priced.reduce((n, r) => n + r.usd!, 0) / successes : null;
    const requests = successes && totalRequests !== null ? Math.round(totalRequests / successes * 10) / 10 : null;
    return newFieldManualEntry("job-cost-profile", key, { role: "SHARED", kind: "COST_PROFILE", title: key,
      summary: successes ? `typically ${requests === null ? "request count not recorded" : requests + " requests"}, ${usd === null ? "cost not fully recorded" : "$" + usd.toFixed(2)} per success; ${Math.round(totalMs / successes)} ms` : "No successful attempt recorded yet",
      platforms: [first.platform], recordClasses: [first.recordClass], observedAt: now, outcome: "REFERENCE",
      payload: { platform: first.platform, recordClass: first.recordClass, attempts: rows.length, successes, typicalRequests: requests,
        usdPerSuccess: usd, durationMsPerSuccess: successes ? totalMs / successes : null },
    });
  });
}
