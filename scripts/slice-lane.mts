/** The slice lane's turn, started by the standing runner with its production write handle: rebuilds the slices the Slide marked, then gives every place its first slices. */
import { readerFactDb } from "../lib/facts/db.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { controlPlaneQuery, workList } from "../lib/core/work.ts";
import { askOnRelease, laneEnds, laneTurn, slotOrLeave } from "../lib/ops/lane-turn.ts";
import { runSliceLane, SLICE_JOB } from "../lib/reader/slice-lane.ts";

const facts = readerFactDb(prepareProductionCivicDataWrite().connection);
const total = { built: 0, written: 0, backfilled: 0 };
const turn = laneTurn(() => `Slices: ${total.built} places read, ${total.written} slices written, ${total.backfilled} places given their first slices`);
askOnRelease(turn.ask);
const { claimEnd, stopRequested, turnEnd } = laneEnds(turn);
const release = await slotOrLeave(turn, "slice-lane.mts", claimEnd);
try {
  setInterval(() => turn.beat(), 60_000);
  await runSliceLane({ list: workList(controlPlaneQuery(), { owner: SLICE_JOB.id, leaseMs: 120_000 }), facts: facts.query, turnEnd, total,
    stopRequested, log: console.log });
  turn.beat();
} finally { release(); }
process.exit(0); // cut-off work may still hold a connection
