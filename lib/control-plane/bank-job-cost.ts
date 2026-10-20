import { newFieldManualEntry, type FieldManualEntry } from "./field-manual.ts";
import type { FieldManualRepository } from "./repository/types.ts";
import { spendScratch } from "./spend-scratch.ts";

interface JobCost {
  readonly platform: string; readonly recordClass: string; readonly attemptId: string;
  readonly durationMs: number; readonly usd: number | null; readonly requestCount: number | null; readonly success: boolean;
}

/** Derive profiles from saved observations, so retrying a write cannot count an attempt twice. */
export function jobCostProfiles(entries: Iterable<FieldManualEntry>, affected: readonly FieldManualEntry[], now: string): FieldManualEntry[] {
  const keys = new Set(affected.filter(e => e.kind === "JOB_COST").map(e => {
    const p = e.payload as JobCost; return `${p.platform}:${p.recordClass}`;
  }));
  const totals = new Map<string, {first: JobCost; attempts: number; successes: number; requests: number | null; ms: number; usd: number | null}>();
  for (const entry of entries) {
    if (entry.kind !== "JOB_COST") continue;
    const p = entry.payload as JobCost, key = `${p.platform}:${p.recordClass}`;
    if (!keys.has(key)) continue;
    let total = totals.get(key);
    if (!total) { total = {first: p, attempts: 0, successes: 0, requests: 0, ms: 0, usd: 0}; totals.set(key, total); }
    total.attempts++; if (p.success) total.successes++;
    total.requests = total.requests === null || p.requestCount === null ? null : total.requests + p.requestCount;
    total.usd = total.usd === null || p.usd === null ? null : total.usd + p.usd;
    total.ms += p.durationMs;
  }
  return [...keys].map(key => {
    const {first, successes, attempts, requests: totalRequests, ms: totalMs, usd: totalUsd} = totals.get(key)!;
    const usd = totalUsd !== null && successes ? totalUsd / successes : null;
    const requests = successes && totalRequests !== null ? Math.round(totalRequests / successes * 10) / 10 : null;
    return newFieldManualEntry("job-cost-profile", key, { role: "SHARED", kind: "COST_PROFILE", title: key,
      summary: successes ? `typically ${requests === null ? "request count not recorded" : requests + " requests"}, ${usd === null ? "cost not fully recorded" : "$" + usd.toFixed(2)} per success; ${Math.round(totalMs / successes)} ms` : "No successful attempt recorded yet",
      platforms: [first.platform], recordClasses: [first.recordClass], observedAt: now, outcome: "REFERENCE",
      payload: { platform: first.platform, recordClass: first.recordClass, attempts, successes, typicalRequests: requests,
        usdPerSuccess: usd, durationMsPerSuccess: successes ? totalMs / successes : null },
    });
  });
}

/** A profile folds the saved attempt observations, keeping its identity join on disk. */
export async function savedJobCostProfiles(repo: FieldManualRepository, affected: readonly FieldManualEntry[], now: string): Promise<FieldManualEntry[]> {
  const keys = new Map(affected.filter(entry => entry.kind === "JOB_COST").map(entry => {
    const p = entry.payload as JobCost; return [`${p.platform}|${p.recordClass}`, p] as const;
  }));
  const scratch = spendScratch(), insert = scratch.db.prepare("INSERT OR IGNORE INTO charges(owner,id,job,body) VALUES(?,?,?,?)");
  try {
    for (const p of keys.values()) await repo.visitSlice({ kinds: ["JOB_COST"], platform: p.platform, recordClass: p.recordClass, everywhere: true }, async row => {
      if (scratch.db.prepare("SELECT 1 FROM charges WHERE owner=? AND id=?").get(scratch.owner, row.id)) return;
      insert.run(scratch.owner, row.id, "cost-profile", JSON.stringify(row.value));
    }, {kind: true, payload: ["platform", "recordClass", "attemptId", "durationMs", "usd", "requestCount", "success"]});
    const entries: Iterable<FieldManualEntry> = {[Symbol.iterator]: function* () {
      for (const row of scratch.db.prepare("SELECT body FROM charges WHERE owner=? ORDER BY sequence").iterate(scratch.owner)) yield JSON.parse(String(row.body)) as FieldManualEntry;
    }};
    return jobCostProfiles(entries, affected, now);
  } finally { scratch.release(); }
}
