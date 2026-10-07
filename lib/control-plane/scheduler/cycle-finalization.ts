import type { ControlPlaneRepositories } from "../repository/types.ts";
import { appendFreshnessCycleDigest } from "../freshness-cycle-outcome.ts";
import type { FreshnessCycleOutcome } from "../owner-surface.ts";
import { describePending } from "./cycle-stall.ts";
import type { PendingSnapshot } from "./cycle-stall-report.ts";

export interface FailedCycleInput {
  readonly repos: ControlPlaneRepositories | null;
  readonly error: unknown;
  readonly cycleId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly testedSha: string | null;
  readonly host: string;
  readonly pending: PendingSnapshot | null;
  /**
   * The child's last output lines, when another process (the runner) ended
   * it and cannot read its pending snapshot. They say what was running.
   */
  readonly lastOutput?: readonly string[];
  readonly writeLocalRecord: (record: Record<string, unknown>) => string;
  readonly log: (line: string) => void;
}

export interface FailedCycleRecord {
  readonly canonical: "APPENDED" | "NOT_APPENDED" | "NO_STORE";
  readonly recordPath: string | null;
  readonly lines: readonly string[];
}

/**
 * Record a crashed cycle in the existing canonical owner digest and local record,
 * whatever the append did. Never throws.
 */
export async function recordFailedCycle(input: FailedCycleInput): Promise<FailedCycleRecord> {
  const message = input.error instanceof Error ? (input.error.stack ?? input.error.message) : String(input.error);
  const headline = message.split("\n")[0] ?? "the cycle failed";
  const pendingLine = input.pending === null ? null : describePending(input.pending);
  const lastOutput = (input.lastOutput ?? []).map(line => line.trim()).filter(Boolean);
  const lastOutputBlock = lastOutput.length === 0 ? null : `last output before it stopped:\n${lastOutput.join("\n")}`;
  const detail = [message, pendingLine, lastOutputBlock].filter((part): part is string => part !== null).join("\n");
  const lines = [
    "PILOT HEALTH",
    "  the cycle CRASHED before completing — a failed cycle, never an idle one",
    `      ${headline}`,
    ...(pendingLine === null ? [] : [`      ${pendingLine}`]),
    ...(lastOutput.length === 0 ? [] : ["      last output before it stopped:", ...lastOutput.map(line => `        ${line}`)]),
    "  ROLLUP    NOT GREEN — the cycle did not finish",
  ];

  let canonical: FailedCycleRecord["canonical"] = "NO_STORE";
  if (input.repos !== null) {
      const repos = input.repos;
      const outcome: FreshnessCycleOutcome = {
        kind: "FRESHNESS_CYCLE",
        state: "FAILED",
        cycleId: input.cycleId,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        testedSha: input.testedSha,
        host: input.host,
        provider: repos.describe(),
        durable: repos.durable,
        executor: null,
        registry: null,
        obligations: null,
        occurrencesOpened: null,
        debtInherited: null,
        debtPersisted: null,
        debtCleared: null,
        scheduled: null,
        unscheduled: [],
        dueCount: null,
        dispatched: null,
        worked: [],
        dispositions: [],
        dispatchDetails: [],
        research: null,
        deferred: null,
        debts: null,
        incidents: [],
        risk: null,
        health: null,
        promotedToReaderTruth: false,
        failure: { code: "CYCLE_CRASHED", detail },
      };
      try {
        await appendFreshnessCycleDigest(repos, { outcome, lines });
        canonical = "APPENDED";
        input.log(`\n  canonical outcome: ${input.cycleId}`);
      } catch (recordError) {
        canonical = "NOT_APPENDED";
        input.log(
          `\n  freshness:shadow CRASHED and the canonical outcome append failed (${recordError instanceof Error ? recordError.message : String(recordError)}).`,
        );
      }
  }

  let recordPath: string | null = null;
  try {
    recordPath = input.writeLocalRecord({
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      cycleId: input.cycleId,
      testedSha: input.testedSha,
      crashed: true,
      error: message,
      canonicalOutcome: canonical,
      pending: input.pending,
      ...(lastOutput.length === 0 ? {} : { lastOutput }),
      digest: lines,
    });
  } catch (writeError) {
    input.log(
      `\n  freshness:shadow CRASHED and could not write a run record (${writeError instanceof Error ? writeError.message : String(writeError)}): ${headline}`,
    );
  }
  return { canonical, recordPath, lines };
}

export const LAST_OUTPUT_LINES = 12;

export function lastChildLines(output: string, count = LAST_OUTPUT_LINES): string[] {
  return output.split(/\r?\n/).map(line => line.trim())
    .filter(line => line !== "" && !/ending owned child .* process tree pid/.test(line))
    .slice(-count).map(line => line.length > 300 ? `${line.slice(0, 297)}...` : line);
}
