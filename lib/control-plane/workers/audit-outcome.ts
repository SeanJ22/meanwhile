/**
 * **WHAT AN AUDIT BROKE, AND HOW MUCH IT COVERED — TWO SEPARATE ANSWERS.**
 *
 * Rulings section 3: other sources not yet checked never hold back a verified
 * fact, and a sample re-check that finds something wrong pulls what is wrong.
 * So the audit answers two questions and never mixes them:
 *
 * - **Broken records.** A record is broken when a BLOCKING finding names it (its
 *   value is not on the saved page, its identity does not bind, an official
 *   source contradicts it). A BLOCKING finding that names no record makes the
 *   whole capture untrustworthy, so every record in it is broken. These are the
 *   records to pull.
 * - **Coverage.** How many of the official sources and records that apply have
 *   been checked. A source not yet checked, or a record the extraction has not
 *   reached, lowers the number and breaks nothing.
 *
 * Pure and dependency-free: it is bundled into the isolated auditor realm.
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
