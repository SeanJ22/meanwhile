import { fieldManualEntryId, newFieldManualEntry, normalizeEntry, type FieldManualRepos } from "./field-manual.ts";

/** Its own row: the count of manual writes that failed after their retries. */
export const BANK_WRITE_HEALTH_ID = fieldManualEntryId("bank-health", "write-errors");
const pending = new WeakMap<FieldManualRepos["fieldManual"], number>();

export async function recordBankWriteFailure(repos: FieldManualRepos, now: string): Promise<void> {
  pending.set(repos.fieldManual, (pending.get(repos.fieldManual) ?? 0) + 1);
  await flushBankWriteFailures(repos, now);
}

/** Add `count` to the saved count under the row's compare-and-set. */
export async function addBankWriteErrors(repos: FieldManualRepos, count: number, now: string): Promise<void> {
  const current = await repos.fieldManual.read(BANK_WRITE_HEALTH_ID);
  const previous = current?.value.payload as { count?: number } | undefined;
  const entry = normalizeEntry(newFieldManualEntry("bank-health", "write-errors", { role: "SHARED", kind: "WRITE_HEALTH",
    title: "Bank write errors", summary: "Write failures after retries", outcome: "REFERENCE", observedAt: now, portable: true,
    payload: { count: (previous?.count ?? 0) + count } }));
  if (current) await repos.fieldManual.compareAndSet(BANK_WRITE_HEALTH_ID, current.revision, entry, now);
  else await repos.fieldManual.put(BANK_WRITE_HEALTH_ID, entry, now);
}

/** Recover buffered counts after a temporary store outage, without recursively writing the Bank. */
export async function flushBankWriteFailures(repos: FieldManualRepos, now: string): Promise<void> {
  const count = pending.get(repos.fieldManual) ?? 0;
  if (!count) return;
  // Claim the local buffer before awaiting; concurrent flushes cannot count it twice.
  pending.set(repos.fieldManual, 0);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await addBankWriteErrors(repos, count, now);
      return;
    } catch {
      if (attempt === 3) {
        pending.set(repos.fieldManual, (pending.get(repos.fieldManual) ?? 0) + count);
        console.error("[Bank] write-error count could not be saved; it remains buffered until this process can reach the store.");
      }
    }
  }
}
