/**
 * **HOW ACCURATE ARE THE FACTS WE PUBLISHED, THIS WEEK?** (DP-18; design §19.)
 *
 * The Scoreboard row that answers it: "Of N facts audited this week, X% are
 * still accurate. Here are the K we fixed." Built from the live-audit results
 * (`workers/live-audit.ts`) and the corrections red flags led to (a fact fixed,
 * or pulled from the live page). PURE: results in, one reading out.
 *
 * - The percentage is over facts the audit could judge (green or red). A fact
 *   whose page could not be read is counted apart; it is not "accurate" and it
 *   is not "wrong".
 * - A fact audited more than once in the week counts once, by its latest result.
 * - Nothing audited reads "—", never 0%.
 * - The older pre-publication coverage line (how much of what the pipeline
 *   validated an auditor looked at) rides underneath as a second line.
 */
import type { AuditCoverageReport } from "../workers/audit-sampling.ts";
import type { LiveAuditResult, PickReason } from "../workers/live-audit.ts";

export const AUDIT_WEEK_DAYS = 7;

/** What a red flag led to. Written by the red-flag handler (DP-14). */
export interface AuditCorrection {
  readonly factId: string;
  readonly action: "FIXED" | "PULLED";
  readonly at: string;
  /** Plain words about what changed. */
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
  /** Facts the audit could judge this week: still right plus wrong. The N in the sentence. */
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
  /** Why the week's sample was picked, so the card can split it. */
  readonly byReason: Readonly<Record<PickReason, number>>;
  /** One plain sentence for the row; "—" when nothing was audited. */
  readonly sentence: string;
  /** Why there is no value, when there is none. */
  readonly notMeasured: string | null;
  /** The older coverage line, when the pipeline's coverage is known. */
  readonly coverageLine: string | null;
}

/** The coverage report as one plain line, or null with no denominator. */
export function coverageLineFrom(report: AuditCoverageReport | null | undefined): string | null {
  if (!report || report.validated === 0 || report.auditedPercent === null) return null;
  const parts = [`${report.auditedPercent}% of the ${report.validated} checked results were audited`];
  if (report.modelReviewedPercent !== null) parts.push(`${report.modelReviewedPercent}% had a closer second look`);
  return `${parts.join(", ")}.`;
}

export function weeklyAuditAccuracy(input: {
  readonly results: readonly LiveAuditResult[];
  readonly corrections: readonly AuditCorrection[];
  readonly now: string;
  readonly coverage?: AuditCoverageReport | null;
}): AuditAccuracyReading {
  const to = input.now;
  const fromMs = Date.parse(to) - AUDIT_WEEK_DAYS * 86_400_000;
  const from = new Date(fromMs).toISOString();
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

  const accuratePercent = audited > 0 ? Math.round((100 * stillRight) / audited) : null;
  const fixed = fixedFacts.filter((f) => f.action === "FIXED").length;
  const pulled = fixedFacts.filter((f) => f.action === "PULLED").length;
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
