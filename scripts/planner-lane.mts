import { readerFactDb } from "../lib/facts/db.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { controlPlaneQuery, workList } from "../lib/core/work.ts";
import { BLANK_PAGE, FREE_TRIES_PER_RUN, PLANNER_PAGES_PER_RUN, keepPlannerList, planBlankChanges, runFreeTries } from "../lib/hunt/blank-planner.ts";
import { routineProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";

prepareProductionCivicDataWrite();
const stopRequested = (): boolean => Date.now() >= passDeadlineFromEnv();
const release = await routineProcessSlots({ admissionsOpen: () => !stopRequested() }).acquire("planner-lane.mts", Date.now() + 60_000);
try {
  const facts = readerFactDb();
  const list = workList(controlPlaneQuery(), { owner: `planner:${process.pid}`, leaseMs: 300_000 });
  let changed = 0, added = 0;
  // A big catch-up is read a page at a time; a run reads a few pages and the next run goes on from the cursor.
  for (let page = 0; page < PLANNER_PAGES_PER_RUN && !stopRequested(); page += 1) {
    const pass = await planBlankChanges({ facts: facts.query, list, now: () => new Date().toISOString() });
    changed += pass.changed;
    added += pass.added;
    if (pass.changed < BLANK_PAGE) break;
  }
  const kept = await keepPlannerList(list, Date.now());
  const free = stopRequested() ? { tried: 0, pages: 0 } : await runFreeTries({ facts: facts.query, list, now: () => new Date().toISOString() }, FREE_TRIES_PER_RUN);
  console.log(`planner: ${changed} changed blank(s) read, ${added} standing hunt(s) added, ${kept.spawned} repeating hunt(s) started again, ${kept.retired} finished row(s) retired; free tries: ${free.tried} place(s), ${free.pages} page(s) to read`);
} finally { release(); }
