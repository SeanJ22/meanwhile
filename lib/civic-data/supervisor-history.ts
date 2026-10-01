/**
 * What the routine runner's admission and provider frontier read of supervisor
 * history (`routineUnreceiptedSupervisorAttemptHistory` in `./runner.ts`), and
 * how much of it.
 */

/**
 * How many of the newest supervisor outcomes the provider frontier reads.
 *
 * An unreceipted supervisor attempt applies the task's existing retry interval
 * and orders it behind same-provider siblings, only while newer than the
 * task's own durable attempt. The frontier admits one task per failure domain
 * per pass and writes one outcome per pass, so a task considered at all is
 * considered again within one rotation of its domain, far inside this window
 * (a day of five-minute passes). Reading every outcome ever written moved the
 * whole history on every pass: 2,595 outcomes, 428 MB of JSON, about 4 GB an
 * hour of billed transfer on 2026-09-24.
 */
export const ROUTINE_SUPERVISOR_HISTORY_WINDOW = 288;

/**
 * The only parts of a supervisor outcome that
 * `routineUnreceiptedSupervisorAttemptHistory` reads. The store drops the rest
 * before a row leaves it, above all the per-contract Reader readback
 * references (92% of each outcome). Widening this is a cost decision a reviewer
 * sees; `tests/routine-civic-data-frontier.test.ts` fails if the history reads
 * a field that is not here.
 */
export const ROUTINE_SUPERVISOR_HISTORY_FIELDS = {
  digestId: true,
  runtimeOutcome: [
    "kind",
    "state",
    "cycleId",
    "startedAt",
    "finishedAt",
    "host",
    "provider",
    "durable",
    "attemptedTasks",
    "verifiedSourceSuccesses",
    "verifiedSourceFailures",
    "failures",
    "taskReceipts",
    "taskReceiptEvidence",
  ],
} as const;
