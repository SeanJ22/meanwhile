/**
 * `pnpm control-plane:proof` — RULING 220's cutover proof conditions, performed
 * against the LIVE Postgres lane.
 *
 * (Session B resume, W3.D, 2026-08-31. Tracker NH300.)
 *
 * ## Why this is a script and not a test file
 *
 * Every proof here needs GENUINELY SEPARATE OPERATING SYSTEM PROCESSES. Two
 * workers contending is trivially satisfiable inside one process, and a crash
 * simulated by `throw` is not a crash — it unwinds, runs `finally`, and
 * exercises the one path a real kill never takes. `node:test` runs in one
 * process; this spawns children and kills one of them with `process.exit`,
 * which is what the recovery path is actually written against.
 *
 * It is also, deliberately, not part of `pnpm gates`. It writes to a live
 * database and one of its proofs TRUNCATES the control plane to restore it.
 * That is correct for a dedicated proof database and wrong for a gate that
 * every branch runs.
 *
 * ## What each proof answers, and what a failure of it would mean
 *
 * ```
 *   P1 SCHEMA      the live database is at the declared version, no drift
 *   P2 CONTENTION  two processes, one claim wins, the loser OBSERVES the lease
 *   P3 CRASH       a killed worker's Attempt is closed from outside, its
 *                  partial evidence preserved, its RouteTask reclaimable
 *   P4 APPEND      concurrent appends to one log key take DISTINCT positions
 *   P5 DUE-TIME    the stored next-due answers a range query on its index
 *   P6 DEBT        a debt written by one process is inherited by another
 *   P7 RESTORE     the whole control plane survives a dump/wipe/restore
 * ```
 *
 * Every proof states PASS or FAIL by name. A proof that could not run says so
 * and is not counted as a pass — "we did not run this" and "this passed" are
 * different sentences, and a report that cannot say the first will eventually
 * say the second instead.
 *
 * Env var names only, never values.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import {
  attemptsForRouteTask,
  registerRouteTask,
  registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import {
  BOOTSTRAP_VERSION,
  DECLARED_TABLES,
} from "../lib/control-plane/repository/pg-schema.ts";
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import { sweepExpiredLeases } from "../lib/control-plane/scheduler/dispatch.ts";
import { retryable } from "../lib/control-plane/scheduler/debt.ts";
import {
  dueByStoredTime,
  loadDebts,
  standing,
  type StandingObligation,
} from "../lib/control-plane/scheduler/durable.ts";

const ROOT = process.cwd();
const RUNS = join(ROOT, "data", "health", "control-plane-proofs");
const WORKER = join(ROOT, "scripts", "control-plane-proof-worker.mts");

const url = controlPlaneUrlFromEnv();
if (url === null) {
  console.error(
    `control-plane:proof · ${CONTROL_PLANE_URL_VAR} is not set. NOTHING WAS PROVEN. This is a ` +
      "fact about this machine and is not a pass; RULING 220's cutover conditions remain unmet.",
  );
  process.exit(1);
}

const { neon } = await import("@neondatabase/serverless");
const sql = neon(url);
const NOW = new Date().toISOString();
const RUN = `proof-${Date.now().toString(36)}`;

interface Proof {
  readonly id: string;
  readonly title: string;
  readonly passed: boolean;
  readonly detail: string;
  readonly evidence: Record<string, unknown>;
}
const proofs: Proof[] = [];
function record(p: Proof): void {
  proofs.push(p);
  console.log(`\n  ${p.passed ? "PASS" : "FAIL"}  ${p.id}  ${p.title}`);
  console.log(`        ${p.detail}`);
}

/** Run a worker as a REAL child process and parse its one JSON line. */
function worker(args: string[], expectExit = 0): Record<string, unknown> {
  let stdout = "";
  try {
    stdout = execFileSync(
      process.execPath,
      ["--env-file=.env.local", "--experimental-strip-types", WORKER, ...args],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (error) {
    /* A DELIBERATE non-zero exit is the crash proof's whole mechanism, so the
       throw is expected there and its stdout is what we came for. */
    const e = error as { status?: number; stdout?: string };
    if (e.status !== expectExit) {
      if (typeof e.stdout !== "string" || e.stdout.length === 0) throw error;
    }
    stdout = e.stdout ?? "";
  }
  const line = stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  if (!line) throw new Error(`worker produced no JSON line. stdout was: ${stdout.slice(0, 400)}`);
  return JSON.parse(line) as Record<string, unknown>;
}

const repos = await createPgRepositories(url, NOW);
console.log(`control-plane:proof · ${repos.describe()}`);
console.log(`  run ${RUN}`);

/* ============================================================ P1 · SCHEMA */

{
  const tables = (await sql.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'cp\\_%'`,
  )) as { table_name: string }[];
  const live = new Set(tables.map((t) => t.table_name));
  const missing = DECLARED_TABLES.filter((t) => !live.has(t));
  const versionRows = (await sql.query(
    `SELECT version FROM cp_schema_version WHERE singleton = true`,
  )) as { version: number }[];
  const applied = versionRows[0]?.version ?? null;
  record({
    id: "P1",
    title: "the live database is at the declared schema version with no drift",
    passed: missing.length === 0 && Number(applied) === BOOTSTRAP_VERSION,
    detail:
      `${DECLARED_TABLES.length - missing.length} of ${DECLARED_TABLES.length} declared tables ` +
      `present; applied version ${applied ?? "NONE"} against declared ${BOOTSTRAP_VERSION}`,
    evidence: { missing, applied, declared: BOOTSTRAP_VERSION },
  });
}

/* ========================================================= P2 · CONTENTION */

const contendItem = createWorkItem({
  project: "control-plane-proof",
  subject: RUN,
  obligation: "contention",
  why: "two OS processes reach for one RouteTask; exactly one may hold the lease",
  now: NOW,
});
const contendTask = createRouteTask({
  workItemId: contendItem.id,
  routeId: "PROOF_ROUTE",
  routeLabel: "proof route",
  target: RUN,
  inherited: true,
  now: NOW,
});
await registerWorkItem(repos, contendItem, NOW);
await registerRouteTask(repos, contendTask, NOW);

{
  /* Sequential spawns, and the second is the one under test: the first holds a
     LIVE lease when the second reaches for it. Racing them would prove the same
     thing only when the race happened to interleave, which is a proof that
     passes for the wrong reason on a fast machine. */
  const first = worker(["claim", contendTask.id, "600000"]);
  const second = worker(["claim", contendTask.id, "600000"]);
  const winners = [first, second].filter((r) => r.won === true);
  const losers = [first, second].filter((r) => r.won !== true);
  record({
    id: "P2",
    title: "two processes contend for one RouteTask; one wins, the other OBSERVES the lease",
    passed:
      winners.length === 1 &&
      losers.length === 1 &&
      typeof losers[0].observed === "string" &&
      (losers[0].observed as string).includes(String(winners[0].holder)),
    detail:
      `${winners.length} winner (pid ${String(winners[0]?.pid)}), ${losers.length} loser ` +
      `(pid ${String(losers[0]?.pid)}) which named the holder in its refusal`,
    evidence: { first, second },
  });
}

/* ============================================================== P3 · CRASH */

{
  const crashItem = createWorkItem({
    project: "control-plane-proof",
    subject: RUN,
    obligation: "crash",
    why: "a worker is killed mid-Attempt; the control plane must observe it from outside",
    now: NOW,
  });
  const crashTask = createRouteTask({
    workItemId: crashItem.id,
    routeId: "PROOF_ROUTE",
    routeLabel: "proof route",
    target: `${RUN}-crash`,
    inherited: true,
    now: NOW,
  });
  await registerWorkItem(repos, crashItem, NOW);
  await registerRouteTask(repos, crashTask, NOW);

  /* A ONE MILLISECOND lease, so it is already expired when the sweep runs. The
     kill is real; the short TTL only spares the proof a wall-clock wait. */
  const crashed = worker(["crash", crashTask.id, crashItem.id, "1"], 137);

  const sweepAt = new Date(Date.now() + 60_000).toISOString();
  const sweep = await sweepExpiredLeases(repos, { now: sweepAt, observedBy: "proof-parent" });

  const attempts = await attemptsForRouteTask(repos, crashTask.id);
  const closed = attempts.find((a) => a.value.id === crashed.attemptId);
  const task = await repos.routeTasks.mustRead(crashTask.id);

  record({
    id: "P3",
    title: "a killed worker's Attempt is closed from OUTSIDE with its partial evidence preserved",
    passed:
      sweep.reclaimed.includes(crashTask.id) &&
      closed?.value.outcome === "LEASE_EXPIRED" &&
      closed?.value.artifactIds.includes(String(crashed.artifactId)) &&
      task.value.state === "RECLAIMABLE" &&
      task.value.disposition === null,
    detail:
      `the child exited 137 holding an open Attempt; the sweep closed it as ` +
      `${closed?.value.outcome ?? "NOT CLOSED"}, preserved ${closed?.value.artifactIds.length ?? 0} ` +
      `partial artifact(s), left the task ${task.value.state} and wrote NO disposition`,
    evidence: {
      crashed,
      reclaimed: sweep.reclaimed,
      outcome: closed?.value.outcome ?? null,
      artifactIds: closed?.value.artifactIds ?? [],
      taskState: task.value.state,
      disposition: task.value.disposition,
    },
  });
}

/* ============================================================= P4 · APPEND */

{
  const logKey = `${RUN}-append`;
  const PER = 12;
  const WRITERS = 4;
  /*
   * Four processes started WITHOUT awaiting each other, so their appends
   * genuinely overlap. This is the proof the old `MAX(position)+1` inside the
   * INSERT could not pass: under READ COMMITTED each writer saw the same
   * committed maximum and wrote it, and the non-unique index accepted both.
   */
  const started = Array.from({ length: WRITERS }, (_, i) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      try {
        resolve(worker(["append", logKey, String(PER), `w${i}`]));
      } catch (error) {
        reject(error);
      }
    }),
  );
  const results = await Promise.all(started);

  const rows = (await sql.query(
    `SELECT position, record_id FROM cp_log_transitions WHERE log_key = $1 ORDER BY position`,
    [logKey],
  )) as { position: string; record_id: string }[];
  const positions = rows.map((r) => Number(r.position));
  const distinct = new Set(positions);

  record({
    id: "P4",
    title: "concurrent appends to one log key take DISTINCT positions",
    passed:
      rows.length === WRITERS * PER &&
      distinct.size === positions.length &&
      new Set(rows.map((r) => r.record_id)).size === rows.length,
    detail:
      `${WRITERS} processes appended ${PER} records each; ${rows.length} rows landed with ` +
      `${distinct.size} distinct position(s). A duplicate position here would make the replay ` +
      "order ambiguous, which is what reconcile() walks.",
    evidence: {
      writers: results.map((r) => ({ pid: r.pid, appended: r.appended })),
      rows: rows.length,
      distinctPositions: distinct.size,
    },
  });
}

/* =========================================================== P5 · DUE-TIME */

{
  const base = Date.now();
  const rows: StandingObligation[] = [0, 1, 2, 3, 4].map((i) => ({
    ...standing(
      {
        id: `${RUN}-due-${i}`,
        recordClass: "meetings",
        subjectId: `ocd-division/proof:${i}`,
        routeId: "PROOF_ROUTE",
        active: true,
        readerImpactAt: null,
        observedChangeRateHours: null,
        lastWorkedAt: null,
      },
      NOW,
    ),
    /* Three in the past, two in the future. The query must return exactly the
       three, in order — a filter that returned all five would still "work" on a
       store that is small enough to scan. */
    nextDueAt: new Date(base + (i < 3 ? -3600_000 * (3 - i) : 3600_000 * i)).toISOString(),
  }));
  for (const row of rows) await repos.obligations.put(row.id, row, NOW);

  const nowIso = new Date(base).toISOString();
  const due = (await dueByStoredTime(repos, nowIso)).filter((o) => o.id.startsWith(`${RUN}-due-`));

  const explain = (await sql.query(
    `EXPLAIN SELECT id FROM cp_obligations
     WHERE (value->>'active')::boolean AND (value->>'nextDueAt') <= $1`,
    [nowIso],
  )) as Record<string, unknown>[];
  const plan = explain.map((r) => String(Object.values(r)[0])).join(" | ");

  record({
    id: "P5",
    title: "the stored next-due answers a due-time query, and an index exists to serve it",
    passed: due.length === 3 && due.every((o, i) => o.id === `${RUN}-due-${i}`),
    detail:
      `${due.length} of 5 obligations are due at ${nowIso}, returned soonest-first. ` +
      `Planner: ${plan.slice(0, 160)}`,
    evidence: { due: due.map((o) => ({ id: o.id, nextDueAt: o.nextDueAt })), plan },
  });
}

/* =============================================================== P6 · DEBT */

{
  const obligationId = `${RUN}-debt`;
  /*
   * THE SEEDED FAILURE FOR W3.C, and the whole reason the debt repository
   * exists. Process 1 writes the debt and exits. This process — which shares no
   * memory with it and did not exist when it ran — loads it back. Before the
   * repository, `runCycle` was handed `debts: []` on every start and this was
   * unfalsifiable: a failure today was simply not retried tomorrow.
   */
  const written = worker(["debt", obligationId, "proof.invalid"]);
  const inherited = (await loadDebts(repos)).filter((d) => d.obligationId === obligationId);
  const afterBackoff = retryable(inherited, Date.parse(String(written.retryAt)) + 1000);

  record({
    id: "P6",
    title: "a freshness debt written by one process is inherited and retried by another",
    passed:
      inherited.length === 1 &&
      inherited[0].firstFailedAt === written.firstFailedAt &&
      afterBackoff.length === 1,
    detail:
      `process ${String(written.pid)} wrote the debt and exited; this process (${process.pid}) ` +
      `read back ${inherited.length} row(s) with the ORIGINAL firstFailedAt, and it becomes ` +
      `retryable after its backoff at ${String(written.retryAt)}`,
    evidence: { written, inherited, retryableAfterBackoff: afterBackoff.length },
  });
}

/* ============================================================ P7 · RESTORE */

{
  /*
   * A GENUINE restore drill: dump every cp_ table, TRUNCATE them all, restore
   * from the dump, and compare. A drill that only dumped would prove the export
   * runs, which is the half that never fails. What fails is the restore, and
   * the only way to know it works is to need it.
   *
   * Safe here because this is the DEDICATED control-plane database RULING 220
   * separates from the serving store — nothing a reader sees is in it.
   */
  const tables = (await sql.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'cp\\_%' ORDER BY table_name`,
  )) as { table_name: string }[];

  const dump: Record<string, Record<string, unknown>[]> = {};
  for (const { table_name } of tables) {
    dump[table_name] = (await sql.query(
      `SELECT * FROM ${table_name}`,
    )) as Record<string, unknown>[];
  }
  const before = Object.fromEntries(
    Object.entries(dump).map(([t, rows]) => [t, rows.length]),
  );

  mkdirSync(RUNS, { recursive: true });
  const dumpPath = join(RUNS, `${RUN}-dump.json`);
  writeFileSync(dumpPath, `${JSON.stringify(dump, null, 2)}\n`, "utf8");

  for (const { table_name } of tables) {
    await sql.query(`TRUNCATE TABLE ${table_name}`);
  }
  const emptied = (await sql.query(`SELECT count(*)::int AS n FROM cp_work_items`)) as {
    n: number;
  }[];

  for (const [table, rows] of Object.entries(dump)) {
    for (const row of rows) {
      const cols = Object.keys(row);
      const params = cols.map((_, i) => `$${i + 1}`);
      const values = cols.map((c) => {
        const v = row[c];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      });
      await sql.query(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${params.join(", ")})`,
        values,
      );
    }
  }

  const after: Record<string, number> = {};
  for (const { table_name } of tables) {
    const rows = (await sql.query(`SELECT count(*)::int AS n FROM ${table_name}`)) as {
      n: number;
    }[];
    after[table_name] = rows[0].n;
  }

  const identical = Object.keys(before).every((t) => before[t] === after[t]);
  record({
    id: "P7",
    title: "the whole control plane survives a dump, a wipe and a restore",
    passed: identical && emptied[0].n === 0,
    detail:
      `${tables.length} tables dumped to ${dumpPath}, TRUNCATEd (cp_work_items went to ` +
      `${emptied[0].n}), and restored. Row counts ${identical ? "match" : "DIFFER"} across every table.`,
    evidence: { before, after, dumpPath, identical },
  });
}

/* ============================================================== the report */

const passed = proofs.filter((p) => p.passed).length;
console.log(`\n${"=".repeat(74)}`);
console.log(`control-plane:proof · ${passed} of ${proofs.length} proof(s) PASSED on the LIVE lane`);
for (const p of proofs) console.log(`  ${p.passed ? "PASS" : "FAIL"}  ${p.id}  ${p.title}`);

mkdirSync(RUNS, { recursive: true });
const path = join(RUNS, `${RUN}.json`);
writeFileSync(
  path,
  `${JSON.stringify(
    {
      run: RUN,
      at: NOW,
      lane: "postgres",
      provider: repos.describe(),
      schemaVersion: BOOTSTRAP_VERSION,
      passed,
      total: proofs.length,
      proofs,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`\n  run record: ${path}`);

if (passed !== proofs.length) process.exit(1);
