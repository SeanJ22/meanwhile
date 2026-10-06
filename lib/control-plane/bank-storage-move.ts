/** DB-39 one-time move and explicit rollback, run by River while writers are stopped.
 * Uses normal repositories, preserves a named checkpoint, performs no DDL.
 */
import { emptyFieldManual, upsertEntries, type FieldManualRepos, type FieldManualStore } from "./field-manual.ts";
import type { BankEntryStore } from "./bank-entry-store.ts";

export async function moveBankToEntryRows(input: { repos: FieldManualRepos; entries: BankEntryStore; checkpointId: string; now: string }) {
  if (!input.checkpointId.startsWith("db39-checkpoint-")) throw new Error("BANK_MOVE_CHECKPOINT_REQUIRED");
  const original = await input.repos.fieldManual.read("live");
  if (!original) throw new Error("BANK_MOVE_SOURCE_MISSING");
  await input.repos.fieldManual.put(input.checkpointId, original.value, input.now);
  for (let offset = 0; offset < original.value.entries.length; offset += 100) {
    await input.entries.importEntries(original.value.entries.slice(offset, offset + 100), input.now);
  }
  // Caller enables the provider switch only after equality/brief checks.
  return { checkpointId: input.checkpointId, sourceRevision: original.revision, entries: original.value.entries.length };
}

export async function moveBankBackToAggregate(input: { repos: FieldManualRepos; entries: BankEntryStore; checkpointId: string; now: string }) {
  if (!input.checkpointId.startsWith("db39-checkpoint-")) throw new Error("BANK_MOVE_CHECKPOINT_REQUIRED");
  const original = await input.repos.fieldManual.read("live");
  if (!original) throw new Error("BANK_MOVE_SOURCE_MISSING");
  let store: FieldManualStore = emptyFieldManual(); let afterId: string | undefined;
  while (true) {
    const page = await input.entries.scanEntries(afterId, 100);
    if (!page.length) break;
    store = upsertEntries(store, page, input.now);
    afterId = page.at(-1)!.id;
  }
  if (!store.entries.length && original.value.entries.length) throw new Error("BANK_MOVE_ROWS_MISSING");
  // A rollback includes learning written since cutover, never just the stale original.
  const restored = upsertEntries(original.value, store.entries, input.now);
  await input.repos.fieldManual.put(input.checkpointId, restored, input.now);
  await input.repos.fieldManual.compareAndSet("live", original.revision, restored, input.now);
  return { checkpointId: input.checkpointId, entries: restored.entries.length };
}
