/**
 * What an audit broke and how much it covered, kept separate. A record is broken when a BLOCKING finding names
 * it (a BLOCKING finding naming no record breaks the whole capture); coverage counts the applicable sources and
 * records checked, and an unchecked one lowers coverage without breaking anything. Pure and dependency-free:
 * it is bundled into the isolated auditor realm.
 */

import type { AuditCoverage, WorkerFinding } from "./types.ts";

export function recordOutcome(
  recordIds: readonly string[],
  findings: readonly WorkerFinding[],
  alsoBroken: ReadonlySet<string> = new Set(),
): { readonly brokenRecordIds: string[]; readonly survivingRecordIds: string[] } {
  const blocking = findings.filter((f) => f.severity === "BLOCKING");
  const wholeCapture = blocking.some((f) => !f.recordId);
  const broken = new Set<string>(alsoBroken);
  for (const f of blocking) if (f.recordId) broken.add(f.recordId);
  const brokenRecordIds = recordIds.filter((id) => wholeCapture || broken.has(id));
  return { brokenRecordIds, survivingRecordIds: recordIds.filter((id) => !brokenRecordIds.includes(id)) };
}

const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((100 * Math.min(part, whole)) / whole) : null);

/** The coverage number: official sources checked of those that apply, and source records extracted of those the audited sources hold. */
export function auditCoverage(input: {
  readonly routesApplicable: number;
  readonly routesChecked: number;
  readonly sourceRecords: number | null;
  readonly extractedRecords: number;
}): AuditCoverage {
  return {
    routesApplicable: input.routesApplicable,
    routesChecked: input.routesChecked,
    sourceRecords: input.sourceRecords,
    extractedRecords: input.extractedRecords,
    sourcesPercent: percent(input.routesChecked, input.routesApplicable),
    recordsPercent: input.sourceRecords === null ? null : percent(input.extractedRecords, input.sourceRecords),
  };
}
