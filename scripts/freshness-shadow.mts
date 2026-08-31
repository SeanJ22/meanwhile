/**
 * `pnpm freshness:shadow` — ONE UNATTENDED CYCLE OF THE FRESHNESS SCHEDULER.
 * (Session B, W3.5, 2026-08-30.)
 *
 * Runs against the DURABLE file provider and against real obligations derived
 * from the committed meeting corpus. It observes, acquires nothing it has not
 * been given a route for, records, and **promotes nothing to canonical reader
 * truth** — `runCycle` has no parameter that could.
 *
 * ## Why the file provider and not Postgres
 *
 * RULING 220 puts Level-2 scheduling authority on a Postgres provider in a
 * dedicated database named by `WTP_CONTROL_PLANE_DATABASE_URL`. That variable
 * is not provisioned on this machine, so the live proof of that provider —
 * cross-machine contention, crash/reclaim on Postgres, a restore drill — is
 * escalated rather than faked. The shadow loop is provider-neutral by
 * construction: it takes `ControlPlaneRepositories` and never a connection, so
 * running it on the file provider proves the LOOP and proves nothing about the
 * provider, which is exactly what it is allowed to claim.
 *
 * The run writes `data/health/freshness-shadow-runs/<day>-NN.json`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  registerRouteTask,
  registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { digestLines, runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { freshnessObligationsFromMeetings } from "../lib/control-plane/scheduler/obligations-from-corpus.ts";
import { methodMaturityFrom } from "../lib/control-plane/scheduler/maturity.ts";
import { readRunProvenance } from "../lib/ops/run-provenance.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const CONTROL_PLANE_ROOT = join(ROOT, "data", "control-plane", "freshness-shadow");
const RUNS_DIR = join(ROOT, "data", "health", "freshness-shadow-runs");
const NOW = new Date().toISOString();

const obligations: FreshnessObligation[] = freshnessObligationsFromMeetings(ROOT, NOW);

console.log(
  `freshness:shadow · ${obligations.length} obligation(s) derived from the committed corpus · ` +
    `provider: file store at data/control-plane/freshness-shadow`,
);

mkdirSync(CONTROL_PLANE_ROOT, { recursive: true });
const repos = await createFileRepositories(CONTROL_PLANE_ROOT);

/*
 * Register a WorkItem and a RouteTask per obligation that names a route. An
 * obligation with no route is registered as an obligation anyway and reports
 * NO_ROUTE_TASK — a scheduling gap that is COUNTED rather than skipped.
 *
 * **READ BEFORE REGISTERING, and the reason is a defect this script had.**
 *
 * The first version registered unconditionally every cycle. `createWorkItem`
 * stamps `createdAt: now`, and the id is a pure function of (project, subject,
 * obligation) — so the SECOND cycle offered the same id carrying a different
 * `createdAt` and the store raised `IdentityCollision`, correctly. A standing
 * obligation is registered ONCE and scheduled forever after; re-registering it
 * every pass is re-creating it, and the store is right to refuse.
 *
 * `persistDiagnostics` in lib/health/diagnostics.ts carries the same rule for
 * the same reason and states it: an existing item is read first and left alone,
 * because the obligation has not changed — only the sentence describing the
 * latest observation of it, and rewriting history to hold the newest phrasing
 * is what append-only storage exists to prevent.
 */
const routeTaskByObligation = new Map<string, string>();
let registered = 0;
let alreadyHeld = 0;
for (const o of obligations) {
  const item = createWorkItem({
    project: "freshness",
    subject: o.subjectId,
    obligation: `refresh:${o.recordClass}`,
    why:
      `The freshness scheduler owes a fresh reading of ${o.recordClass} for ${o.subjectId}. ` +
      "This item is the durable record of that obligation; the schedule decides when.",
    priority: "P2",
    now: NOW,
  });
  const existing = await repos.workItems.read(item.id);
  if (existing === null) {
    await registerWorkItem(repos, item, NOW);
    registered += 1;
  } else {
    alreadyHeld += 1;
  }
  if (o.routeId === null) continue;
  const task = createRouteTask({
    workItemId: item.id,
    routeId: o.routeId,
    routeLabel: o.routeId,
    target: o.subjectId,
    inherited: true,
    now: NOW,
  });
  if ((await repos.routeTasks.read(task.id)) === null) {
    await registerRouteTask(repos, task, NOW);
  }
  routeTaskByObligation.set(o.id, task.id);
}
/*
 * RULING 159: both counts state their denominator. "0 registered" alone is the
 * same line whether the store already held everything or the corpus was empty,
 * and those are opposite facts about whether this loop is working.
 */
console.log(
  `  ${floorLine(
    floored(
      "obligations already durable from an earlier cycle",
      "the freshness control-plane store",
      obligations.length,
      alreadyHeld,
      obligations.length === 0
        ? "the committed meetings corpus yielded no obligations to register"
        : undefined,
    ),
  )} · ${registered} newly registered this cycle`,
);

/*
 * THE SHADOW EXECUTOR. It does not fetch. This cycle proves the LOOP —
 * scheduling, claiming, dispatch, recording, debt, next-due — and a real
 * retrieval here would be an acquisition run wearing a scheduler test's name,
 * against hosts nobody scheduled a walk of. It reports what it did, and what
 * it did was decide.
 */
const cycle = await runCycle({
  repos,
  obligations,
  debts: [],
  routeTaskFor: (id) => routeTaskByObligation.get(id) ?? null,
  /* Read from the method store — the project's own record of what it knows how
     to walk — rather than from a string prefix. See lib/.../maturity.ts for the
     finding this exposes: nothing joins a meetings publisher to a method route
     today, so the deterministic lane is currently unreachable for this record
     class, and the digest's executor split is where that shows. */
  maturity: methodMaturityFrom(ROOT),
  run: async ({ executor, routeTaskId }) => ({
    ok: true,
    detail: `shadow ${executor} decided route task ${routeTaskId.slice(0, 12)} — no retrieval ran`,
  }),
  holder: `freshness-shadow@${process.pid}`,
  now: NOW,
  leaseTtlMs: 60_000,
  /* The canonical readings come from their own instruments. This script does
     not compute reader or truth health — a scheduler grading its own reader
     contract is the shape RULING 217's rollup exists to prevent. */
  reader: {
    contract: "READER",
    state: "NOT_READY",
    reason:
      "not computed by this run; the reader contract is `pnpm reader:suite`'s to state, and a " +
      "scheduler that computed it would be grading its own homework",
  },
  truth: {
    contract: "TRUTH",
    state: "NOT_READY",
    reason:
      "not computed by this run; the truth contract is the control set's to state",
  },
  maxDispatches: 50,
});

const lines = digestLines(cycle);
console.log();
for (const line of lines) console.log(line);

mkdirSync(RUNS_DIR, { recursive: true });
const path = nextRunRecordPath(RUNS_DIR, today());
writeFileSync(
  path,
  `${JSON.stringify(
    {
      startedAt: cycle.startedAt,
      finishedAt: cycle.finishedAt,
      testedSha: headSha(ROOT),
      provider: repos.describe(),
      durable: repos.durable,
      obligations: obligations.length,
      scheduled: cycle.schedule.scheduled.length,
      unscheduled: cycle.schedule.unscheduled.map((u) => ({
        id: u.obligation.id,
        reason: u.reason,
      })),
      cadenceSources: Object.fromEntries(
        [...new Set(cycle.schedule.scheduled.map((s) => s.cadenceSource))].map((k) => [
          k,
          cycle.schedule.scheduled.filter((s) => s.cadenceSource === k).length,
        ]),
      ),
      dueCount: cycle.dueCount,
      dispatched: cycle.dispatched.length,
      deferred: cycle.deferred.length,
      reclaim: cycle.reclaim,
      debts: cycle.debts.length,
      incidents: cycle.incidents,
      risk: cycle.risk,
      health: cycle.health,
      promotedToReaderTruth: cycle.promotedToReaderTruth,
      digest: lines,
      provenance: readRunProvenance(headSha(ROOT), ROOT),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`\n  run record: ${path}`);
