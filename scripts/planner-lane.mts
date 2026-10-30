import { readerFactDb } from "../lib/facts/db.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { controlPlaneQuery, workList } from "../lib/core/work.ts";
import { BLANK_PAGE, PLANNER_PAGES_PER_RUN, keepPlannerList, planBlankChanges } from "../lib/hunt/blank-planner.ts";

prepareProductionCivicDataWrite();
const stopRequested = (): boolean => Date.now() >= passDeadlineFromEnv();

const facts = readerFactDb();
const list = workList(controlPlaneQuery(), { owner: `planner:${process.pid}` });
let changed = 0, added = 0;
// A big catch-up is read a page at a time; a run reads a few pages and the next run goes on from the cursor.
for (let page = 0; page < PLANNER_PAGES_PER_RUN && !stopRequested(); page += 1) {
  const pass = await planBlankChanges({ facts: facts.query, list, now: () => new Date().toISOString() });
  changed += pass.changed;
  added += pass.added;
  if (pass.changed < BLANK_PAGE) break;
}
const kept = await keepPlannerList(list, Date.now());
console.log(`planner: ${changed} changed blank(s) read, ${added} standing hunt(s) added, ${kept.spawned} repeating hunt(s) started again, ${kept.retired} finished row(s) retired`);
