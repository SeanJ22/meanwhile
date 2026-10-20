/** Percentage over facts the audit could judge; an unreadable page is counted apart; a fact audited twice counts once; nothing audited reads "—", never 0%. */
import type { AuditCoverageReport } from "../workers/audit-sampling.ts";
import type { PickReason } from "../workers/live-audit.ts";

export const AUDIT_WEEK_DAYS = 7;

export interface AuditCorrection {
  readonly factId: string;
  readonly action: "FIXED" | "PULLED";
  readonly at: string;
  readonly summary: string;
}

export interface FixedFact {
  readonly factId: string;
  readonly family: string;
  readonly area: string;
  readonly action: "FIXED" | "PULLED";
  readonly at: string;
  readonly summary: string;
}

export interface AuditAccuracyReading {
  readonly from: string;
  readonly to: string;
  readonly audited: number;
  readonly stillRight: number;
  readonly wrong: number;
  /** Facts whose page could not be read or that had nothing to look for. Not in N. */
  readonly couldNotJudge: number;
  readonly fixed: number;
  readonly pulled: number;
  /** Whole percent still accurate; null when nothing was judged. */
  readonly accuratePercent: number | null;
  readonly fixedFacts: readonly FixedFact[];
  readonly byReason: Readonly<Record<PickReason, number>>;
  readonly sentence: string;
  readonly notMeasured: string | null;
  readonly coverageLine: string | null;
}

export function coverageLineFrom(report: AuditCoverageReport | null | undefined): string | null {
  if (!report || report.validated === 0 || report.auditedPercent === null) return null;
  const parts = [`${report.auditedPercent}% of the ${report.validated} checked results were audited`];
  if (report.modelReviewedPercent !== null) parts.push(`${report.modelReviewedPercent}% had a closer second look`);
  return `${parts.join(", ")}.`;
}

/** Counts and the week's correction metadata; saved source values never need to enter this reading. */
export function auditAccuracyFromCounts(input: Pick<AuditAccuracyReading, "audited"|"stillRight"|"wrong"|"couldNotJudge"|"fixed"|"pulled"|"fixedFacts"|"byReason"> & {
  readonly now: string; readonly coverage?: AuditCoverageReport|null;
}): AuditAccuracyReading {
  const {audited, stillRight, wrong, couldNotJudge, fixed, pulled, fixedFacts, byReason} = input;
  const to = input.now, from = new Date(Date.parse(to) - AUDIT_WEEK_DAYS * 86_400_000).toISOString();
  const accuratePercent = audited > 0 ? Math.round((100 * stillRight) / audited) : null;
  const handled = fixed + pulled;
  const sentence = accuratePercent === null
    ? "—"
    : `Of ${audited} fact${audited === 1 ? "" : "s"} audited this week, ${accuratePercent}% are still accurate.` +
      (handled > 0 ? ` Here ${handled === 1 ? "is the one" : `are the ${handled}`} we ${pulled === 0 ? "fixed" : fixed === 0 ? "pulled" : "fixed or pulled"}.` : "");
  return {
    from, to, audited, stillRight, wrong, couldNotJudge, fixed, pulled, accuratePercent, fixedFacts, byReason, sentence,
    notMeasured: accuratePercent === null
      ? (couldNotJudge > 0 ? "Facts were checked this week but none could be judged." : "No published fact has been audited this week.")
      : null,
    coverageLine: coverageLineFrom(input.coverage),
  };
}
