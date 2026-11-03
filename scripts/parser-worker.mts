import { join } from "node:path";
import { readerFactDb, preparedStatement } from "../lib/facts/db.ts";
import { adminClocks } from "../lib/facts/clocks.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { pacedProbeFetch } from "../lib/doors/probe-fetch.ts";
import type { ProbeFetch } from "../lib/doors/probe.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { moveBoxLeads } from "../lib/core/leads.ts";
import { controlPlaneQuery, workList } from "../lib/core/work.ts";
import { askOnRelease, laneEnds, laneTurn, slotOrLeave } from "../lib/ops/lane-turn.ts";
import { loadParsers } from "../lib/sources/parser-hook.ts";
import { LEAD_LEASE_MS, parserStats, runParserWorkers } from "../lib/sources/parser-worker.ts";

prepareProductionCivicDataWrite();
const stats = parserStats();
/** Links the old Box held are put on the work list this many at a time, one page between each turn of reading. */
const MOVE_PAGE = 1_000;
const MOVE_CURSOR = "box-leads-moved";
const turn = laneTurn(() => `Page readers: ${stats.claimed} claimed, ${stats.read} read, ${stats.again} sent back, ${stats.released} released, ${stats.failed} failed`);
askOnRelease(turn.ask);
const { claimEnd, stopRequested, turnEnd } = laneEnds(turn);
const release = await slotOrLeave(turn, "parser-worker.mts", claimEnd);
try {
  const url = controlPlaneUrlFromEnv();
  if (url === null) throw new Error("parser lane: the control-plane URL is not set");
  const repos = await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true });
  const query = controlPlaneQuery(), connection = readerFactDb();
  const facts = { query: connection.query, transaction: <T,>(work: (query: typeof connection.query) => Promise<T>) =>
    connection.transaction(query => work((text, params) => query(preparedStatement(text), params))) };
  const parsers = await loadParsers();
  const vault = new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR));
  // A small local government (under 10,000 people) or school district (under 5,000 students) is asked ten times an hour; its size comes from the holdings of its own state.
  const readers = new Map<string, ProbeFetch>();
  const fetchFor = (state: string): ProbeFetch => {
    const key = state.toLowerCase();
    if (!readers.has(key)) { const sizeFor = websiteSizeFromHoldings([key]); readers.set(key, pacedProbeFetch({ pacing: repos.websitePacing, sizeFor })); }
    return readers.get(key)!;
  };
  let moved = false;
  const heartbeat = setInterval(() => turn.beat(), 60_000);
  try {
    const admin = adminClocks(query);
    let clocksAt = 0; // a setting Sean changes holds within the minute
    while (!stopRequested()) {
      if (Date.now() - clocksAt >= 60_000) { await admin.refresh(); clocksAt = Date.now(); }
      const before = stats.claimed;
      if (!moved) {
        const cursor = await repos.passCursors.read(MOVE_CURSOR);
        const page = await moveBoxLeads(query, cursor?.value.through ?? "", MOVE_PAGE);
        moved = page.next === null;
        if (page.next !== null) {
          if (cursor) await repos.passCursors.compareAndSet(MOVE_CURSOR, cursor.revision, { through: page.next }, new Date().toISOString());
          else await repos.passCursors.put(MOVE_CURSOR, { through: page.next }, new Date().toISOString());
        }
        if (page.filed) console.error(`Box links moved: ${page.filed} of ${page.read} rows read`);
      }
      await runParserWorkers({ concurrency: 4, maxClaims: 100, stats, stopRequested, turnEnd, log: console.error, deps: {
        list: workList(query, { owner: `parser:${process.pid}`, leaseMs: LEAD_LEASE_MS }), facts, repos, parsers, clocks: admin.clocks(), vault, fetchFor, now: () => new Date() } });
      if (stats.claimed === before) await new Promise(done => setTimeout(done, 5_000));
    }
  } finally { clearInterval(heartbeat); }
} finally { release(); }
process.exit(0); // cut-off work may still hold a connection
