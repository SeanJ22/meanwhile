import { openDataDiskIndex } from "./disk-index.ts";
import type { OpenDataPartitionRef } from "./model.ts";

/** Only one state's references leave the disk inventory for its promotion. */
export async function createOpenDataPublicationIndex() {
  const disk = await openDataDiskIndex("CREATE TABLE refs(state TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(state,id))");
  const save = disk.db.prepare("INSERT OR REPLACE INTO refs VALUES(?,?,?)"), read = disk.db.prepare("SELECT value FROM refs WHERE state=? ORDER BY id");
  return {
    append(state: string, reference: OpenDataPartitionRef) { save.run(state, reference.id, JSON.stringify(reference)); },
    *forState(state: string): Iterable<OpenDataPartitionRef> { for (const row of read.iterate(state)) yield JSON.parse(String(row.value)) as OpenDataPartitionRef; },
    dispose: disk.dispose,
  };
}
