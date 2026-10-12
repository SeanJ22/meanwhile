/** Newest supervisor outcomes the provider frontier reads; a task considered at all recurs well inside this window. */
export const ROUTINE_SUPERVISOR_HISTORY_WINDOW = 288;

/** The only outcome fields the history reads; the store drops the rest. `tests/routine-civic-data-frontier.test.ts` fails if a field is missing. */
export const ROUTINE_SUPERVISOR_HISTORY_FIELDS = {
  digestId: true,
  runtimeOutcome: [
    "kind",
    "state",
    "cycleId",
    "startedAt",
    "finishedAt",
    "testedSha",
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
