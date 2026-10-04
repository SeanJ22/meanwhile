import { emptyFieldManual, newFieldManualEntry, type FieldManualRepos } from "./field-manual.ts";

/** Separate aggregate key: contention rewriting the live Bank must not lose its error count. */
export const BANK_WRITE_HEALTH_ID = "write-errors";
const pending = new WeakMap<FieldManualRepos["fieldManual"], number>();

export async function recordBankWriteFailure(repos: FieldManualRepos, now: string): Promise<void> {
  pending.set(repos.fieldManual, (pending.get(repos.fieldManual) ?? 0) + 1);
  await flushBankWriteFailures(repos, now);
}

/** Recover buffered counts after a temporary store outage, without recursively writing the Bank. */
export async function flushBankWriteFailures(repos: FieldManualRepos, now: string): Promise<void> {
  const count = pending.get(repos.fieldManual) ?? 0;
  if (!count) return;
  // Claim the local buffer before awaiting; concurrent flushes cannot count it twice.
  pending.set(repos.fieldManual, 0);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const current = await repos.fieldManual.read(BANK_WRITE_HEALTH_ID);
      const previous = current?.value.entries[0]?.payload as { count?: number } | undefined;
      const entry = newFieldManualEntry("bank-health", "write-errors", { role: "SHARED", kind: "WRITE_HEALTH",
        title: "Bank write errors", summary: "Write failures after retries", outcome: "REFERENCE", observedAt: now,
        payload: { count: (previous?.count ?? 0) + count } });
      const next = { ...emptyFieldManual(), updatedOn: now, entries: [entry] };
      if (current) await repos.fieldManual.compareAndSet(BANK_WRITE_HEALTH_ID, current.revision, next, now);
      else await repos.fieldManual.put(BANK_WRITE_HEALTH_ID, next, now);
      return;
    } catch {
      if (attempt === 3) {
        pending.set(repos.fieldManual, (pending.get(repos.fieldManual) ?? 0) + count);
        console.error("[Bank] write-error count could not be saved; it remains buffered until this process can reach the store.");
      }
    }
  }
}
