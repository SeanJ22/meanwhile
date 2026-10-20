import { auditAccuracyFromCounts, AUDIT_WEEK_DAYS, type AuditCorrection, type FixedFact, type AuditAccuracyReading } from "../../lib/control-plane/admin-view/v6-audit-read.ts";
import type { AuditCoverageReport } from "../../lib/control-plane/workers/audit-sampling.ts";
import type { LiveAuditResult, PickReason } from "../../lib/control-plane/workers/live-audit.ts";
import { CORRECTIONS_KEY, TASK_ZIPS_KEY, weekDayKeys, type LiveAuditRepos } from "../../lib/control-plane/live-audit-log.ts";

/** Complete fixture readback for assertions; production folds its history on disk. */
export async function readAuditWeek(repos: LiveAuditRepos, now: string) {
  const days = await Promise.all(weekDayKeys(now).map(key => repos.liveAudits.read(key)));
  const corrections = await repos.liveAudits.read(CORRECTIONS_KEY);
  return {results: days.flat().flatMap(row => row.kind === "RESULT" ? [row.result] : []),
    corrections: corrections.flatMap(row => row.kind === "CORRECTION" ? [row.correction] : [])};
}
export async function readTaskZips(repos: LiveAuditRepos): Promise<Set<string>> {
  return new Set((await repos.liveAudits.read(TASK_ZIPS_KEY)).flatMap(row => row.kind === "TASK_ZIP" ? [row.zip] : []));
}

export function weeklyAuditAccuracy(input: {
  readonly results: readonly LiveAuditResult[];
  readonly corrections: readonly AuditCorrection[];
  readonly now: string;
  readonly coverage?: AuditCoverageReport | null;
}): AuditAccuracyReading {
  const to = input.now;
  const fromMs = Date.parse(to) - AUDIT_WEEK_DAYS * 86_400_000;
  const inWeek = (at: string) => Date.parse(at) > fromMs && Date.parse(at) <= Date.parse(to);

  const latest = new Map<string, LiveAuditResult>();
  for (const result of [...input.results].filter((r) => inWeek(r.checkedAt)).sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))) {
    latest.set(result.factId, result);
  }
  const week = [...latest.values()];
  const stillRight = week.filter((r) => r.verdict === "GREEN").length;
  const wrong = week.filter((r) => r.verdict === "RED").length;
  const couldNotJudge = week.filter((r) => r.verdict === "INCONCLUSIVE").length;
  const audited = stillRight + wrong;

  const byFact = new Map(input.results.map((r) => [r.factId, r] as const));
  const corrections = [...input.corrections].filter((c) => inWeek(c.at)).sort((a, b) => a.at.localeCompare(b.at));
  const fixedFacts: FixedFact[] = corrections.map((c) => {
    const known = byFact.get(c.factId);
    return { factId: c.factId, family: known?.family ?? "—", area: known?.area ?? "—", action: c.action, at: c.at, summary: c.summary };
  });
  const byReason: Record<PickReason, number> = { PAST_REFRESH: 0, DEMAND: 0, SINGLE_SOURCE: 0, ROUTINE: 0 };
  for (const r of week) byReason[r.pickedBecause] += 1;

  const fixed = fixedFacts.filter((f) => f.action === "FIXED").length;
  const pulled = fixedFacts.filter((f) => f.action === "PULLED").length;
  return auditAccuracyFromCounts({now: input.now, audited, stillRight, wrong, couldNotJudge, fixed, pulled, fixedFacts, byReason, coverage: input.coverage});
}
