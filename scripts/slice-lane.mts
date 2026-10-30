/** The slice lane's turn, started by the standing runner with its production write handle: rebuilds the slices the Slide marked, then gives every place its first slices. */
import { readerFactDb } from "../lib/facts/db.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { routineProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { controlPlaneQuery, workList } from "../lib/core/work.ts";
import { runSliceLane, SLICE_JOB } from "../lib/reader/slice-lane.ts";

const facts = readerFactDb(prepareProductionCivicDataWrite().connection);
let drain = false;
process.on("SIGTERM", () => { drain = true; });
process.on("message", message => { if (message && typeof message === "object" && "kind" in message && message.kind === "RUNTIME_RELEASE_DRAIN") drain = true; });
const deadlineMs = passDeadlineFromEnv();
const release = await routineProcessSlots({ admissionsOpen: () => !drain }).acquire("slice-lane.mts", Date.now() + 60_000);
try {
  const total = await runSliceLane({ list: workList(controlPlaneQuery(), { owner: SLICE_JOB.id, leaseMs: 120_000 }), facts: facts.query, deadlineMs,
    stopRequested: () => drain, log: console.log });
  console.log(`Slices: turn ended; ${total.built} places read, ${total.written} slices written, ${total.backfilled} places given their first slices`);
} finally { release(); }
