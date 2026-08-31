/**
 * `pnpm freshness:shadow` — ONE UNATTENDED CYCLE OF THE FRESHNESS SCHEDULER.
 * (Session B, W3.5, 2026-08-30. Rewritten Session B resume, W3.B/C/E/F,
 * 2026-08-31.)
 *
 * It observes, ACQUIRES for real, records, and **promotes nothing to canonical
 * reader truth** — `runCycle` has no parameter that could.
 *
 * ## What changed, and why the previous version could not have been right
 *
 * Three things, and each was invisible while the others held:
 *
 * 1. **The executor did not fetch.** It was `async () => ({ ok: true })`, and
 *    under the old seam that `ok: true` became WORKED and cleared the
 *    obligation's freshness debt. Eight dispatches were reported as having
 *    worked routes nothing opened. It is now `httpExecutor`, which opens the
 *    publisher's own surface and maps what it got to an honest disposition.
 *
 * 2. **Debt was not durable.** `runCycle` accepted `debts` and this script
 *    passed `debts: []` on every invocation, so a route that failed today was
 *    not retried tomorrow by a fresh process. Debt now loads from and persists
 *    to the control plane, and `pnpm control-plane:proof`'s P6 proves the
 *    inheritance across two real processes.
 *
 * 3. **One RouteTask was reused for every occurrence.** That only appeared to
 *    work because the fake executor never disposed of anything. A disposed
 *    RouteTask is settled and cannot be the container for the next reading, so
 *    fixing (1) breaks (3) immediately. Each due occurrence now opens its own
 *    WorkItem and RouteTask through `openOccurrence`, and the standing
 *    obligation survives them all.
 *
 * ## The provider
 *
 * `--provider=postgres` runs against the dedicated control-plane database named
 * by `WTP_CONTROL_PLANE_DATABASE_URL`; the default is the durable file store.
 * The loop is provider-neutral by construction — it takes
 * `ControlPlaneRepositories` and never a connection — so the flag changes where
 * state lives and nothing about what the cycle does.
 *
 * `--dry` uses a recorded executor instead of the network, for a cycle that
 * exercises the lifecycle without opening a route. It is labelled SIMULATED in
 * the digest and, by construction, discharges nothing.
 *
 * Env var names only, never values.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { digestLines, runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import { freshnessObligationsFromMeetings } from "../lib/control-plane/scheduler/obligations-from-corpus.ts";
import { methodMaturityFrom } from "../lib/control-plane/scheduler/maturity.ts";
import {
  closeOccurrence,
  loadDebts,
  openOccurrence,
  persistDebts,
  recordNextDue,
  syncObligations,
} from "../lib/control-plane/scheduler/durable.ts";
import { hostSpacer, httpExecutor } from "../lib/control-plane/scheduler/http-executor.ts";
import type { RunWork } from "../lib/control-plane/scheduler/dispatch.ts";
import { readRunProvenance } from "../lib/ops/run-provenance.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const CONTROL_PLANE_ROOT = join(ROOT, "data", "control-plane", "freshness-shadow");
const RUNS_DIR = join(ROOT, "data", "health", "freshness-shadow-runs");
const NOW = new Date().toISOString();

const argv = process.argv.slice(2);
const wantsPostgres = argv.includes("--provider=postgres");
const dry = argv.includes("--dry");
const ceilingArg = argv.find((a) => a.startsWith("--max="));
const MAX_DISPATCHES = ceilingArg ? Number(ceilingArg.slice("--max=".length)) : 50;

/* ------------------------------------------------------------- provider --- */

let repos: ControlPlaneRepositories;
if (wantsPostgres) {
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    console.error(
      `freshness:shadow · --provider=postgres was asked for and ${CONTROL_PLANE_URL_VAR} is not ` +
        "set. Refusing to silently fall back to the file store: a run that changed provider " +
        "without saying so would attribute this cycle's state to the wrong place.",
    );
    process.exit(1);
  }
  repos = await createPgRepositories(url, NOW);
} else {
  mkdirSync(CONTROL_PLANE_ROOT, { recursive: true });
  repos = await createFileRepositories(CONTROL_PLANE_ROOT);
}

/* ---------------------------------------------------------- obligations --- */

const corpus: FreshnessObligation[] = freshnessObligationsFromMeetings(ROOT, NOW);

console.log(
  `freshness:shadow · ${corpus.length} obligation(s) derived from the committed corpus\n` +
    `  provider: ${repos.describe()}\n` +
    `  executor: ${dry ? "SIMULATED (--dry, no retrieval)" : "http (real retrieval)"}`,
);

const sync = await syncObligations(repos, corpus, NOW);
console.log(
  `  ${floorLine(
    floored(
      "obligations already durable from an earlier cycle",
      "the freshness control plane",
      corpus.length,
      sync.alreadyDurable.length,
      corpus.length === 0
        ? "the committed meetings corpus yielded no obligations to register"
        : undefined,
    ),
  )} · ${sync.registered.length} newly registered this cycle`,
);

/* ------------------------------------------------- the source URL lookup --- */

/**
 * The publisher surface each obligation is worked through.
 *
 * Built from the snapshot's own provenance rather than carried on the
 * obligation, because an obligation names a SUBJECT and a route class. An
 * obligation carrying a URL would be a route list with a clock attached, which
 * is exactly what `VENDOR != RECORD` refuses.
 */
const urlByObligation = new Map<string, string>();
try {
  const snapshot = JSON.parse(readFileSync(join(ROOT, "data", "meetings-snapshot.json"), "utf8")) as {
    meetings?: { bodyId?: string; ocdId?: string; provenance?: { sourceUrl?: string } }[];
  };
  for (const m of snapshot.meetings ?? []) {
    const subject = m.bodyId ?? m.ocdId;
    const url = m.provenance?.sourceUrl;
    if (!subject || !url) continue;
    const id = `freshness:meetings:${subject}`;
    if (!urlByObligation.has(id)) urlByObligation.set(id, url);
  }
} catch (error) {
  console.error(
    `  the meetings snapshot could not be read for source URLs: ${
      error instanceof Error ? error.message : String(error)
    }. Obligations will report a provenance gap rather than a publisher fact.`,
  );
}
console.log(
  `  ${floorLine(
    floored(
      "obligations with a held source URL to open",
      "the committed meetings snapshot",
      corpus.length,
      corpus.filter((o) => urlByObligation.has(o.id)).length,
      corpus.length === 0 ? "no obligations exist to look one up for" : undefined,
    ),
  )}`,
);

/* ------------------------------------------------------- the occurrences --- */

/*
 * Open an occurrence for every obligation that is DUE, and hand the cycle a
 * lookup from obligation to THIS occurrence's RouteTask. The obligation that
 * is not due gets no occurrence and no RouteTask, which is why the lookup
 * returns null rather than a stale task id from a previous reading.
 */
const nowMs = Date.parse(NOW);
const occurrenceByObligation = new Map<string, { id: string; routeTaskId: string }>();
let opened = 0;

const debtsIn = await loadDebts(repos);
const debtIds = new Set(debtsIn.filter((d) => d.consecutiveFailures > 0).map((d) => d.obligationId));
console.log(
  `  freshness debt inherited from earlier processes: ${debtIds.size} open row(s)` +
    (debtIds.size === 0 ? "" : ` — ${[...debtIds].slice(0, 3).join(", ")}${debtIds.size > 3 ? " …" : ""}`),
);

for (const o of sync.all) {
  const row = scheduleObligation(o, nowMs);
  if (!isScheduled(row)) continue;
  await recordNextDue(repos, { obligationId: o.id, nextDueAt: row.nextDueAt, now: NOW });
  const isDue = Date.parse(row.nextDueAt) <= nowMs || debtIds.has(o.id);
  if (!isDue) continue;

  const occ = await openOccurrence(repos, { obligation: o, dueAt: row.nextDueAt, now: NOW });
  if (occ === null) continue;
  occurrenceByObligation.set(o.id, { id: occ.occurrence.id, routeTaskId: occ.routeTask.id });
  opened += 1;
}
console.log(`  occurrences opened this cycle: ${opened} (each with its OWN WorkItem and RouteTask)`);

/* ----------------------------------------------------------- the executor --- */

const simulated: RunWork = async ({ executor, routeTaskId }) => ({
  ranAs: "DETERMINISTIC",
  kind: "SIMULATED",
  detail: `--dry: ${executor} decided route task ${routeTaskId.slice(0, 12)} — no retrieval ran`,
});

const run: RunWork = dry
  ? simulated
  : httpExecutor({
      urlFor: (id) => urlByObligation.get(id) ?? null,
      spaceOut: hostSpacer(),
    });

/* --------------------------------------------------------------- the cycle --- */

const cycle = await runCycle({
  repos,
  obligations: sync.all,
  debts: debtsIn,
  routeTaskFor: (id) => occurrenceByObligation.get(id)?.routeTaskId ?? null,
  /* Read from the method store — the project's own record of what it knows how
     to walk — rather than from a string prefix. */
  maturity: methodMaturityFrom(ROOT),
  run,
  workerFor: ({ executor, holder }) =>
    executor === "DETERMINISTIC"
      ? { role: "ACQUIRER", provider: "we-the-people", version: "http-executor/1.0", instance: holder }
      : { role: "SCOUT", provider: "we-the-people", version: "http-executor/1.0", instance: holder },
  holder: `freshness-shadow@${process.pid}`,
  now: NOW,
  leaseTtlMs: 120_000,
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
    reason: "not computed by this run; the truth contract is the control set's to state",
  },
  maxDispatches: MAX_DISPATCHES,
});

/* ------------------------------------------------- close, and persist debt --- */

for (const result of cycle.dispatched) {
  const occ = occurrenceByObligation.get(result.obligationId);
  if (!occ) continue;
  const discharged =
    result.outcome === "WORKED" &&
    result.dispositionCommitted &&
    (result.disposition === "INGESTED" || result.disposition === "WALKED_NO_YIELD");
  await closeOccurrence(repos, {
    occurrenceId: occ.id,
    disposition: discharged ? result.disposition : null,
    unresolvedReason: discharged ? null : result.detail,
    now: NOW,
  });
}

const persisted = await persistDebts(repos, cycle.debts, NOW);
console.log(
  `\n  debt persisted: ${persisted.written} row(s) written, ${persisted.cleared.length} cleared`,
);

const lines = digestLines(cycle);
console.log();
for (const line of lines) console.log(line);

/* --------------------------------------------------------- the run record --- */

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
      executor: dry ? "SIMULATED" : "http",
      obligations: sync.all.length,
      obligationsWithUrl: corpus.filter((o) => urlByObligation.has(o.id)).length,
      occurrencesOpened: opened,
      debtInherited: debtIds.size,
      debtPersisted: persisted.written,
      debtCleared: persisted.cleared,
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
      worked: cycle.worked,
      simulated: cycle.simulated,
      dispositions: cycle.dispatched
        .filter((d) => d.dispositionCommitted)
        .map((d) => ({ obligationId: d.obligationId, disposition: d.disposition, artifacts: d.artifactIds.length })),
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
