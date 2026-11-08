import type { TestContext } from "node:test";
import { createElectionResultFeedStore, installElectionResultFeedStore } from "../../lib/election-results/feed-store.ts";
import { installReaderDatabaseQuery } from "../../lib/reader/database.ts";

/** A traced blob store and database tripwire shared by the native and Next transports. */
export function electionFeedFixture(context: TestContext, readFailure?: string) {
  const documents = new Map<string, unknown>(), reads: string[] = [];
  const store = createElectionResultFeedStore({ read: async key => {
    reads.push(key);
    if (readFailure) throw new Error(readFailure);
    return documents.get(key) ?? null;
  },
    write: async (key, value) => { documents.set(key, structuredClone(value)); } });
  let databaseReads = 0;
  installReaderDatabaseQuery(async () => { databaseReads++; throw new Error("Results must never open a database connection"); });
  installElectionResultFeedStore(store);
  context.after(() => { installReaderDatabaseQuery(undefined); installElectionResultFeedStore(undefined); });
  return { store, reads, documents, databaseReads: () => databaseReads };
}

export function preserveFeedEnvironment(context: TestContext, names: readonly string[]): void {
  const prior = new Map(names.map(name => [name, process.env[name]]));
  context.after(() => {
    for (const [name, value] of prior) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  });
}
