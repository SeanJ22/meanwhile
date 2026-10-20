import { currentReaderSelection } from "../db/reader-route.ts";
import type { CivicDataReadStore, PromotedEdgeEntry } from "../civic-data/read-model.ts";
import type { RoutineRecordClass } from "../civic-data/types.ts";

type Context = { entries: Map<string, PromotedEdgeEntry>; reads: Map<string, Promise<PromotedEdgeEntry>> };
const requests = new WeakMap<object, Context>();

/** Reuse the canonical batch in this request, including its streamed card components. */
export function primeReaderCanonicalStore(entries: readonly { recordClass: RoutineRecordClass; scope: string }[], store: CivicDataReadStore | Promise<CivicDataReadStore>): Promise<void> {
  const selection = currentReaderSelection();
  if (!selection) return Promise.resolve();
  const held = requests.get(selection) ?? { entries: new Map(), reads: new Map() };
  const reads = entries.map(entry => {
    const key = `${entry.recordClass}:${entry.scope}`;
    const read = Promise.resolve(store).then(async value => {
      if (!value.readPromotedEntry) throw new Error("READER_CANONICAL_ENTRIES_REQUIRED");
      const result = await value.readPromotedEntry(entry.recordClass, entry.scope);
      held.entries.set(key, result);
      return result;
    });
    held.reads.set(key, read);
    return read;
  });
  const read = Promise.all(reads).then(() => undefined);
  requests.set(selection, held);
  void read.catch(() => undefined);
  return read;
}

export function readerCanonicalEntries(): ReadonlyMap<string, PromotedEdgeEntry> {
  const selection = currentReaderSelection();
  return selection ? requests.get(selection)?.entries ?? new Map() : new Map();
}

export function readerCanonicalEntry(recordClass: RoutineRecordClass, scope: string): Promise<PromotedEdgeEntry> | undefined {
  const selection = currentReaderSelection(), key = `${recordClass}:${scope}`;
  const held = selection ? requests.get(selection) : undefined;
  return held?.reads.get(key);
}
