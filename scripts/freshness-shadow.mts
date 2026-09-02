/**
 * `pnpm freshness:shadow` — ONE UNATTENDED CYCLE OF THE FRESHNESS SCHEDULER.
 * (Session B, W3.5, 2026-08-30. Rewritten Session B resume, W3.B/C/E/F,
 * 2026-08-31. Rewritten again Session C, PART D, 2026-08-31.)
 *
 * It observes, ACQUIRES for real, records, normalizes, STAGES — and **promotes
 * nothing to canonical reader truth**. `runCycle` has no parameter that could,
 * and the promotion tail writes only under `data/control-plane/staging/`.
 *
 * ## What changed in Session C, and why the previous version could not be right
 *
 * **The corpus was meetings and could only ever be meetings.** This script
 * imported `freshnessObligationsFromMeetings`, built its whole corpus from it,
 * and built its route map by reading `sourceUrl` out of
 * `data/meetings-snapshot.json`. So the unattended loop hunted calendars and
 * nothing else, while a modelled Arizona campaign-finance obligation sat in
 * `lib/control-plane/campaign-finance/obligations.ts` reachable from its own
 * test and from nothing operational. **A domain obligation reachable only from
 * tests is a failure.**
 *
 * The input is now an OBLIGATION-PROVIDER REGISTRY
 * (`lib/control-plane/scheduler/registry.ts`). Meetings is one provider.
 * Campaign finance is the second. Tracker intake is the third, and reports
 * ABSENT rather than EMPTY until a converting lane ships its handoff file.
 *
 * **The scheduled unit is (RECORD x REPRESENTATION).** A campaign-finance
 * record carries several materially distinct routes and every one gets its own
 * occurrence, RouteTask, Attempt, disposition, debt and next-due — which is
 * `ONE ROUTE SUCCESS != SOURCE UNIVERSE COMPLETE` expressed as state rather
 * than as a sentence in a report.
 *
 * **The lane is decided per route, not per cycle.** A DataTables POST is
 * deterministic; an FTP drop this process holds no client for is not walked at
 * all and disposes REQUIRES_NEW_ADAPTER. `runCycle` therefore takes a function.
 *
 * **The bytes reach a real vault**, through `DurableEvidenceStore`, and the
 * promotion tail reads them back out by key. The previous executor recorded
 * artifact metadata and stored no body while claiming "captured to the vault".
 *
 * **The tail runs automatically** (RULING 224): acquire, vault, normalize,
 * snapshot, STAGED. Promotion itself stays OFF and a session carries the last
 * mile.
 *
 * ## Flags
 *
 * ```
 *   --provider=postgres   the durable control plane named by
 *                         WTP_CONTROL_PLANE_DATABASE_URL; default is the file store
 *   --dry                 a recorded executor instead of the network. Labelled
 *                         SIMULATED, and by construction discharges nothing
 *   --max=N               the stated dispatch ceiling for this cycle
 *   --only=<prefix>       work only obligations whose id starts with <prefix>.
 *                         A DIAGNOSTIC filter: the count it skipped is printed,
 *                         so a filtered cycle can never read as a full one
 * ```
 *
 * Env var names only, never values.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { digestLines, runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import { retryable } from "../lib/control-plane/scheduler/debt.ts";
import { buildRegistry, registryLines } from "../lib/control-plane/scheduler/registry.ts";
import { meetingsProvider } from "../lib/control-plane/scheduler/providers/meetings.ts";
import { campaignFinanceProvider } from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import { trackerIntakeProvider } from "../lib/control-plane/scheduler/providers/tracker-intake.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { candidateEnrichmentProvider } from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import { methodMaturityFrom } from "../lib/control-plane/scheduler/maturity.ts";
import {
  closeOccurrence,
  loadDebts,
  openOccurrence,
  resumeOpenOccurrence,
  persistDebts,
  recordNextDue,
  syncObligations,
} from "../lib/control-plane/scheduler/durable.ts";
import { hostSpacer } from "../lib/control-plane/scheduler/http-executor.ts";
import { routeExecutor } from "../lib/control-plane/scheduler/route-executor.ts";
import { cycleVault, VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import {
  promotionLines,
  stageOne,
  writeStagingManifest,
  type StagedEntry,
} from "../lib/control-plane/scheduler/promotion-tail.ts";
import type { DeclaredExecutor, RunWork } from "../lib/control-plane/scheduler/dispatch.ts";
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
const onlyArg = argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length) : null;

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

/* ----------------------------------------------------------- the registry --- */

/*
 * FIVE PROVIDERS. (Session C3, lane C, 2026-09-01. RULING 229.)
 *
 * The fourth and fifth are what "acquire to the AUTHORITATIVE SOURCE UNIVERSE"
 * looks like from the scheduler's side: `local-jurisdictions` gives every named
 * filing officer and election custodian a clock, and `candidate-enrichment`
 * makes campaign sites, positions, bios, photos and contact standing
 * obligations against each state's CANONICAL CANDIDATE ACQUISITION DENOMINATOR
 * — labelled by `lib/candidates/population-label.ts`, never assumed statewide
 * (R-C9) — rather than against whichever ZIPs happen to be enabled.
 */
const registry = buildRegistry(
  [
    meetingsProvider(),
    campaignFinanceProvider(),
    trackerIntakeProvider(),
    localJurisdictionsProvider(),
    candidateEnrichmentProvider(),
  ],
  { root: ROOT, nowIso: NOW },
);

const allUnits = registry.units;
const units = ONLY === null ? allUnits : allUnits.filter((u) => u.obligation.id.startsWith(ONLY));
const corpus = units.map((u) => u.obligation);

console.log(
  `freshness:shadow · ${corpus.length} obligation(s) from the obligation-provider registry\n` +
    `  provider: ${repos.describe()}\n` +
    `  executor: ${dry ? "SIMULATED (--dry, no retrieval)" : "route-aware (real retrieval)"}`,
);
for (const line of registryLines(registry)) console.log(line);
if (ONLY !== null) {
  console.log(
    `  --only=${ONLY} FILTERED this cycle to ${units.length} of ${allUnits.length} registered ` +
      `unit(s); ${allUnits.length - units.length} were not looked at. A filtered cycle is a ` +
      "diagnostic and is never a reading of the whole corpus.",
  );
}

/* ---------------------------------------------- non-meeting share, stated --- */

const nonMeeting = units.filter((u) => u.providerId !== "meetings");
console.log(
  `  ${floorLine(
    floored(
      "scheduled units that are NOT meetings",
      "the obligation-provider registry",
      units.length,
      nonMeeting.length,
      units.length === 0 ? "the registry produced no units at all this cycle" : undefined,
    ),
  )}`,
);

const sync = await syncObligations(repos, corpus, NOW);
console.log(
  `  ${floorLine(
    floored(
      "obligations already durable from an earlier cycle",
      "the freshness control plane",
      corpus.length,
      sync.alreadyDurable.length,
      corpus.length === 0 ? "the registry yielded no obligations to register" : undefined,
    ),
  )} · ${sync.registered.length} newly registered this cycle`,
);
if (sync.refreshed.length > 0) {
  console.log(
    `  provider signals REFRESHED on ${sync.refreshed.length} durable row(s) — a corrected ` +
      "derivation reaching rows that were registered under the old one:",
  );
  for (const r of sync.refreshed.slice(0, 5)) {
    console.log(`      ${r.id}  ->  ${r.changed.join(", ")}`);
  }
  if (sync.refreshed.length > 5) console.log(`      … and ${sync.refreshed.length - 5} more`);
}

/* ------------------------------------------------------- the occurrences --- */

const nowMs = Date.parse(NOW);
const occurrenceByObligation = new Map<string, { id: string; routeTaskId: string }>();
const nextDueByObligation = new Map<string, string>();
let opened = 0;
/** Due obligations this cycle deliberately did not START. Never silent. */
let deferredForCeiling = 0;
/** Occurrences a previous cycle opened and did not reach, picked back up. */
let resumedCount = 0;
/** Everything due, collected before any occurrence is opened, so it can be
 *  sorted into the dispatcher's own oldest-first order. */
const dueThisCycle: { obligation: (typeof sync.all)[number]; nextDueAt: string }[] = [];

const debtsIn = await loadDebts(repos);
const debtIds = new Set(debtsIn.filter((d) => d.consecutiveFailures > 0).map((d) => d.obligationId));
/*
 * An obligation whose backoff has NOT elapsed gets no occurrence this cycle.
 * `runCycle` holds it out of the due set for the same reason; opening a
 * WorkItem and a RouteTask for it here would leave an occurrence nothing
 * dispatches, which reads back as a worker that abandoned it.
 */
const retryNow = new Set(retryable(debtsIn, nowMs).map((d) => d.obligationId));
const backedOff = new Set([...debtIds].filter((id) => !retryNow.has(id)));
console.log(
  `  freshness debt inherited from earlier processes: ${debtIds.size} open row(s)` +
    (debtIds.size === 0 ? "" : ` — ${[...debtIds].slice(0, 3).join(", ")}${debtIds.size > 3 ? " …" : ""}`),
);

for (const o of sync.all) {
  const row = scheduleObligation(o, nowMs);
  if (!isScheduled(row)) continue;
  /*
   * DO NOT PAY A ROUND TRIP TO WRITE A VALUE THAT IS ALREADY THERE.
   * (Session C3, lane C, 2026-09-01.)
   *
   * `recordNextDue` already no-ops when the stored value matches — but it
   * discovers that by READING the row, which is one round trip per obligation
   * per cycle. `sync.all` is the row, already in hand. Under RULING 229 the
   * corpus is the authoritative source universe rather than one pilot ballot,
   * so this loop runs over thousands of rows and the difference between "check
   * in memory" and "ask the database" is the difference between a cycle that
   * fits inside the runner's interval and one that does not.
   */
  if (o.nextDueAt !== row.nextDueAt) {
    await recordNextDue(repos, { obligationId: o.id, nextDueAt: row.nextDueAt, now: NOW });
  }
  nextDueByObligation.set(o.id, row.nextDueAt);
  if (backedOff.has(o.id)) continue;
  const isDue = Date.parse(row.nextDueAt) <= nowMs || retryNow.has(o.id);
  if (!isDue) continue;
  dueThisCycle.push({ obligation: o, nextDueAt: row.nextDueAt });
}

/*
 * OLDEST FIRST, which is the dispatcher's own order (`dueNow` sorts ascending
 * by next-due). Opening occurrences in corpus order and dispatching in due
 * order would start work on whatever sorted first by ID while the most overdue
 * route waited — and the two orders only agree by accident.
 */
dueThisCycle.sort((a, b) => (a.nextDueAt < b.nextDueAt ? -1 : a.nextDueAt > b.nextDueAt ? 1 : 0));

for (const { obligation: o, nextDueAt } of dueThisCycle) {
  const row = { nextDueAt };
  /*
   * **DO NOT OPEN AN OCCURRENCE THIS CYCLE CANNOT DISPATCH.**
   * (Session C3, lane C, 2026-09-01.)
   *
   * `runCycle` takes a STATED ceiling and defers the rest with a reason. This
   * loop had no such ceiling, so it opened an occurrence — a WorkItem, a
   * RouteTask and an occurrence row, three durable writes — for every due
   * obligation before the dispatcher had looked at any of them.
   *
   * At 94 obligations that was invisible. Under RULING 229 the corpus is the
   * authoritative source universe and it is 2,358 units, so the first cycle
   * opened thousands of occurrences the ceiling then deferred, and each one is
   * an OPEN occurrence a later cycle has to reconcile or abandon. An abandoned
   * occurrence reads back as a worker that gave up on a route — which is a
   * false statement about a worker, produced by arithmetic in the runner.
   *
   * The ceiling here is deliberately the SAME number the dispatcher uses, and
   * the list was sorted into the dispatcher's own order above, so what is
   * opened is what is oldest — not what happens to sort first by id.
   */
  if (opened >= MAX_DISPATCHES) {
    deferredForCeiling += 1;
    continue;
  }
  /*
   * RESUME BEFORE OPENING. An occurrence a previous cycle opened and did not
   * reach is real work with a real WorkItem and a real RouteTask; opening a
   * second one beside it strands the first, and a stranded open occurrence
   * reads back as a worker that abandoned a route.
   */
  const resumed = await resumeOpenOccurrence(repos, o);
  if (resumed !== null) {
    occurrenceByObligation.set(o.id, resumed);
    resumedCount += 1;
    opened += 1;
    continue;
  }
  const occ = await openOccurrence(repos, { obligation: o, dueAt: row.nextDueAt, now: NOW });
  if (occ === null) continue;
  occurrenceByObligation.set(o.id, { id: occ.occurrence.id, routeTaskId: occ.routeTask.id });
  opened += 1;
}
console.log(
  `  occurrences opened this cycle: ${opened} (each with its OWN WorkItem and RouteTask)` +
    (resumedCount > 0
      ? ` — ${resumedCount} of them RESUMED from an earlier cycle that opened them and did not reach them`
      : ""),
);
if (deferredForCeiling > 0) {
  console.log(
    `  ${deferredForCeiling} due obligation(s) got NO occurrence this cycle: the stated ceiling is ` +
      `${MAX_DISPATCHES} and opening a WorkItem the dispatcher will not reach leaves an occurrence ` +
      "nothing works, which reads back as a worker that abandoned a route. They keep their next-due " +
      "and are opened by a later cycle — the obligation is not discharged, only unstarted.",
  );
}

/* ----------------------------------------------------------- the executor --- */

const vault = cycleVault(join(ROOT, ...VAULT_DIR));

const simulated: RunWork = async ({ executor, routeTaskId }) => ({
  ranAs: "DETERMINISTIC",
  kind: "SIMULATED",
  detail: `--dry: ${executor} decided route task ${routeTaskId.slice(0, 12)} — no retrieval ran`,
});

const walk = routeExecutor({
  routeFor: (id) => registry.routeFor(id),
  spaceOut: hostSpacer(),
  vault: vault.put,
});

/**
 * **THE LANE IS DECLARED PER ROUTE.**
 *
 * The registry's descriptor states the class the representation genuinely
 * needs, and that class is what the Attempt is opened under. Neither branch
 * here is a model: `--dry` performs no retrieval, and the route executor is an
 * HTTP GET or POST. A route whose class is BOUNDED_MODEL_WORKER is one nothing
 * has derived a shape for; it is opened by nothing today and disposes
 * REQUIRES_NEW_ADAPTER with the missing adapter named, so no Attempt is
 * persisted under an anthropic worker identity for work no model touched.
 * `WTP_WORKERS_ANTHROPIC_API_KEY` is the variable a bounded model worker would
 * read; no route in this cycle reads one.
 */
const executorFor = (obligation: { obligation: { id: string } }): DeclaredExecutor => {
  const route = registry.routeFor(obligation.obligation.id);
  return {
    lane: "DETERMINISTIC",
    workerFor: ({ holder }) => ({
      role: "ACQUIRER",
      provider: "we-the-people",
      version: dry ? "shadow-decision/1.0" : `route-executor/1.0 (${route?.routeId ?? "unrouted"})`,
      instance: holder,
    }),
    run: dry ? simulated : walk,
  };
};

/* --------------------------------------------------------------- the cycle --- */

const cycle = await runCycle({
  repos,
  obligations: sync.all,
  debts: debtsIn,
  routeTaskFor: (id) => occurrenceByObligation.get(id)?.routeTaskId ?? null,
  /* Read from the method store — the project's own record of what it knows how
     to walk — rather than from a string prefix. */
  maturity: methodMaturityFrom(ROOT),
  executor: executorFor,
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

/* ------------------------------------------------------- the promotion tail --- */

/*
 * RULING 224. Acquisition without promotion is inventory, not product. The tail
 * runs on EVERY cycle with no operator: acquire -> vault -> normalize ->
 * snapshot -> STAGED. Promotion itself is OFF and a session carries the last
 * mile, so nothing below writes outside data/control-plane/staging/.
 *
 * A wall stages TOO, as an honest gap with the obligation still live and its
 * next-due named — the second half of the ruling, and not a lesser outcome.
 */
const staged: StagedEntry[] = [];
for (const result of cycle.dispatched) {
  const unit = units.find((u) => u.obligation.id === result.obligationId);
  if (unit === undefined) continue;
  /* Meetings routes have no normalizer and would stage a gap for every body on
     every cycle. The tail is scoped to the record classes whose promotion is
     what RULING 224 was adopted about; meetings already has a live snapshot
     path of its own through `pnpm ingest`. */
  if (unit.record.recordClass === "meetings") continue;

  let body: string | null = null;
  for (const artifactId of result.artifactIds) {
    const entry = vault.ledger.get(artifactId);
    if (entry === undefined) continue;
    body = await vault.readBack(entry.key);
    if (body !== null) break;
  }

  staged.push(
    stageOne({
      root: ROOT,
      obligationId: result.obligationId,
      providerId: unit.providerId,
      recordClass: unit.record.recordClass,
      subjectId: unit.record.subjectId,
      route: unit.route,
      disposition: result.disposition,
      artifactIds: result.artifactIds,
      body,
      nextDueAt: nextDueByObligation.get(result.obligationId) ?? null,
      detail: result.detail,
      stagedOn: today(),
    }),
  );
}
const manifest = writeStagingManifest(ROOT, staged, today());

/* ------------------------------------------------------------- the digest --- */

const lines = [
  ...digestLines(cycle),
  "",
  ...registryLines(registry),
  "",
  ...promotionLines(staged),
  `  staging manifest   ${manifest.total} entry(ies) held, ${manifest.written} written this cycle`,
];
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
      executor: dry ? "SIMULATED" : "route-aware",
      registry: {
        providers: registry.byProvider,
        registeredUnits: allUnits.length,
        workedUnits: units.length,
        nonMeetingUnits: nonMeeting.length,
        only: ONLY,
      },
      obligations: sync.all.length,
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
      vaulted: [...vault.ledger.values()],
      staged,
      stagingManifest: `${["data", "control-plane", "staging"].join("/")}/manifest.json`,
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
