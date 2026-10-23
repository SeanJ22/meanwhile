import { redactDiagnosticText } from "../ops/error-diagnostic.ts";
import { writeSync } from "node:fs";
import type { RoutineCivicDataSupervisorDigestInput } from "./freshness-cycle-outcome.ts";
import type { RoutineCivicDataSupervisorOutcome } from "./owner-surface.ts";

/** A pass's diagnostic must fit even when every board fails. Candidate/event rows retain the original evidence. */
export const ROUTINE_OUTCOME_MAX_BYTES = 128 * 1024;
const CONTENT_MAX_BYTES = ROUTINE_OUTCOME_MAX_BYTES - 4_096;
export const ROUTINE_FAILURE_EXAMPLES = 16;
export const ROUTINE_FAILURE_DETAIL_CHARS = 1_200;
export const ROUTINE_FAILURE_SUMMARY_PREFIX = "RCD_SUPERVISOR_FAILURE_SUMMARY=";

export interface RoutineSupervisorFailureSummary {
  readonly cycleId: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly total: number;
  readonly examples: RoutineCivicDataSupervisorOutcome["failures"];
}

const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const diagnostic = (value: string, max = ROUTINE_FAILURE_DETAIL_CHARS) => redactDiagnosticText(value).slice(0, max);

export function routineFailureCounts(failures: RoutineCivicDataSupervisorOutcome["failures"]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = Object.create(null);
  for (const failure of failures) counts[failure.code] = (counts[failure.code] ?? 0) + 1;
  return counts;
}

/** Keep the first cause of each kind before taking more examples of repeated causes. */
function failureExamples(failures: RoutineCivicDataSupervisorOutcome["failures"]): RoutineCivicDataSupervisorOutcome["failures"] {
  const picked = new Set<number>(), codes = new Set<string>();
  for (const [index, failure] of failures.entries()) {
    if (codes.has(failure.code)) continue;
    codes.add(failure.code); picked.add(index);
    if (picked.size === ROUTINE_FAILURE_EXAMPLES) break;
  }
  for (let index = 0; index < failures.length && picked.size < ROUTINE_FAILURE_EXAMPLES; index++) picked.add(index);
  return [...picked].map(index => {
    const row = failures[index]!;
    return { taskId: row.taskId, code: row.code, detail: diagnostic(row.detail) };
  });
}

export function boundedRoutineSupervisorDigest(input: RoutineCivicDataSupervisorDigestInput): RoutineCivicDataSupervisorDigestInput {
  const source = input.outcome;
  const counts = source.summary?.failuresByCode ?? routineFailureCounts(source.failures);
  const failureCount = source.summary?.failureCount ?? source.failures.length;
  const failures = failureExamples(source.failures);
  const lines = input.lines.slice(0, 8).map(line => diagnostic(line));
  const summary = {
    failureCount, failuresByCode: counts, failuresOmitted: failureCount - failures.length,
    readerReadbacksOmitted: source.summary?.readerReadbacksOmitted ?? 0,
    taskReceiptsOmitted: source.summary?.taskReceiptsOmitted ?? 0,
    crashedTasksOmitted: source.summary?.crashedTasksOmitted ?? 0,
    linesOmitted: (source.summary?.linesOmitted ?? 0) + input.lines.length - lines.length,
  };
  let outcome: RoutineCivicDataSupervisorOutcome = { ...source, failures, summary };
  const result = () => ({ outcome, lines: [...lines,
    `Supervisor failures: ${failureCount}; counts by code: ${Object.entries(counts).map(([code, n]) => `${code}=${n}`).join(", ")}.`,
    `${summary.failuresOmitted} further failure example(s), ${summary.readerReadbacksOmitted} Reader reference(s), ` +
      `${summary.taskReceiptsOmitted} task receipt(s), ${summary.crashedTasksOmitted} crash detail(s) and ${summary.linesOmitted} line(s) summarized; canonical source evidence is retained in its original records.`,
  ] });
  if (size(result()) > CONTENT_MAX_BYTES && source.readerReadbackEvidence === "EXACT") {
    summary.readerReadbacksOmitted = source.readerReadbackDenominator;
    outcome = { ...outcome, readerReadbacks: [], readerReadbackEvidence: "SUMMARY" };
  }
  if (size(result()) > CONTENT_MAX_BYTES) {
    summary.taskReceiptsOmitted += outcome.taskReceipts.length;
    outcome = { ...outcome, taskReceipts: [], taskReceiptEvidence: "UNAVAILABLE_OUTER_SUPERVISOR" };
  }
  if (size(result()) > CONTENT_MAX_BYTES) {
    summary.crashedTasksOmitted += outcome.crashedTasks?.length ?? 0;
    outcome = { ...outcome, crashedTasks: [], taskReceiptEvidence: "UNAVAILABLE_OUTER_SUPERVISOR" };
  }
  // Failure codes are the runner's finite vocabulary. An unexpected pathological caller still gets a saved reason.
  if (size(result()) > CONTENT_MAX_BYTES) {
    const failure = { taskId: "routine-civic-data-supervisor", code: "SUPERVISOR_OUTCOME_OVERSIZED",
      detail: `The pass produced ${size(input)} diagnostic bytes. ${failureCount} failures were summarized; inspect the canonical source/event records.` };
    return { outcome: { kind: source.kind, state: "FAILED", lane: source.lane,
      cycleId: source.cycleId.slice(0, 600), startedAt: source.startedAt, finishedAt: source.finishedAt,
      testedSha: source.testedSha, host: source.host.slice(0, 200), provider: source.provider.slice(0, 200), durable: source.durable,
      attemptedTasks: source.attemptedTasks, verifiedSourceSuccesses: source.verifiedSourceSuccesses, verifiedSourceFailures: source.verifiedSourceFailures,
      taskReceiptEvidence: "UNAVAILABLE_OUTER_SUPERVISOR", taskReceipts: [], readerReadbackEvidence: "UNAVAILABLE_OUTER_SUPERVISOR",
      readerReadbackDenominator: source.readerReadbackDenominator, readerReadbacksRecordedPass: source.readerReadbacksRecordedPass,
      readerReadbacksRecordedFail: source.readerReadbacksRecordedFail, readerReadbacksCurrentFail: source.readerReadbacksCurrentFail,
      readerReadbackNoops: source.readerReadbackNoops, readerReadbackRepairFailures: source.readerReadbackRepairFailures,
      readerReadbacks: [], failures: [failure], attributionBoundary: source.attributionBoundary,
      summary: { ...summary, failureCount: failureCount + 1,
        failuresByCode: { SUPERVISOR_OUTCOME_OVERSIZED: 1, OTHER_REPORTED_FAILURES: failureCount }, failuresOmitted: failureCount,
        readerReadbacksOmitted: source.readerReadbackDenominator, taskReceiptsOmitted: source.taskReceipts.length,
        crashedTasksOmitted: source.crashedTasks?.length ?? 0 },
    }, lines: [failure.detail] };
  }
  return result();
}

export function routineSupervisorFailureSummary(input: RoutineCivicDataSupervisorDigestInput): string {
  const { outcome } = boundedRoutineSupervisorDigest(input);
  return ROUTINE_FAILURE_SUMMARY_PREFIX + JSON.stringify({ cycleId: outcome.cycleId,
    counts: outcome.summary!.failuresByCode, total: outcome.summary!.failureCount, examples: outcome.failures });
}

/** Synchronous output survives the entry point's final process.exit, including a fatal error. */
export function writeRoutineSupervisorFailureSummary(input: RoutineCivicDataSupervisorDigestInput): void {
  try { writeSync(1, routineSupervisorFailureSummary(input) + "\n"); }
  catch { /* The durable record is still written when the parent's output pipe is unavailable. */ }
}

/** The standing parent can recover the child's own causes even if the canonical append was unavailable. */
export function parseRoutineSupervisorFailureSummary(output: string, cycleId: string): RoutineSupervisorFailureSummary | null {
  for (const line of output.split(/\r?\n/).reverse()) {
    if (!line.startsWith(ROUTINE_FAILURE_SUMMARY_PREFIX) || Buffer.byteLength(line) > ROUTINE_OUTCOME_MAX_BYTES) continue;
    try {
      const row = JSON.parse(line.slice(ROUTINE_FAILURE_SUMMARY_PREFIX.length)) as RoutineSupervisorFailureSummary;
      if (row.cycleId !== cycleId || !Number.isSafeInteger(row.total) || row.total < 0 ||
          !row.counts || typeof row.counts !== "object" || Array.isArray(row.counts) ||
          Object.values(row.counts).some(count => !Number.isSafeInteger(count) || count < 0) ||
          Object.values(row.counts).reduce((sum, count) => sum + count, 0) !== row.total ||
          !Array.isArray(row.examples) || row.examples.length > ROUTINE_FAILURE_EXAMPLES || row.examples.length > row.total ||
          row.examples.some(example => !example || typeof example.taskId !== "string" || typeof example.code !== "string" ||
            typeof example.detail !== "string" || !(example.code in row.counts))) continue;
      return { ...row, examples: failureExamples(row.examples) };
    } catch { /* A malformed line never replaces the outer supervisor's own ending. */ }
  }
  return null;
}
