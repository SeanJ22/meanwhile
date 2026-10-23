import type { ReaderArtifactStore } from "../../lib/meetings/edge-store.ts";
import { installReaderValues, type ReaderValues } from "./canonical-reader-fixtures.ts";
export type PublishAuthorityValue = import("./canonical-reader-fixtures.ts").ReaderValue;
/** Canonical reader fixtures need no publication or artifact preparation. */
export async function publishPointers(_store: ReaderArtifactStore, input: ReaderValues, _now?: string): Promise<string[]> {
  installReaderValues(input);
  return [];
}
