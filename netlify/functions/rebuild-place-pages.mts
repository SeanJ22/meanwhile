import { readerFactDb } from "../../lib/facts/db.ts";
import { resolveProductionWriteHandle } from "../../lib/db/write-handle.ts";
import { rebuildPlacePages } from "../../lib/reader/place-builder.ts";

/** Netlify invokes this on the published production deploy, including when the runner is offline. */
// Four real body builds peaked at 403 MiB; 2 GiB leaves the required 0.75 GiB spare.
export const config = { schedule: "* * * * *", background: true, memory: 2048 };

export default async function rebuildPages(): Promise<void> {
  const handle = resolveProductionWriteHandle();
  const result = await rebuildPlacePages({
    db: readerFactDb(handle.connection),
    limit: Number.MAX_SAFE_INTEGER,
    concurrency: 4,
    timeBudgetMs: 240_000,
  });
  console.log(JSON.stringify({ placePages: "scheduled", ...result }));
  if (result.failed) throw new Error(`${result.failed} place page rebuilds failed; their requests remain queued`);
}
