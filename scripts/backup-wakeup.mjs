#!/usr/bin/env node
/**
 * `pnpm refresh:wakeup` — **DOES THE HOSTED BACKUP HAVE ANYTHING TO DO TONIGHT?**
 * (FCP-1 / FCP-5, 2026-09-07.)
 *
 * ## What this is, and what it deliberately is not
 *
 * It is NOT the transfer of freshness authority. That transfer is gated on
 * conditions RULING 216 says the implementing session cannot supply, and
 * `lib/control-plane/freshness/authority.ts` is where the gate lives. This is
 * the cost half of FCP-5, which is available now and independent of it:
 *
 * > a quiet day costs **0 GitHub Actions minutes for freshness**
 *
 * `refresh-daily.yml` currently spends a checkout, a Node setup, a full
 * dependency install and a sweep of every due source before it can discover
 * that there was nothing to do. On a night when the cadence says no source is
 * due and no source is in debt, every one of those minutes buys an answer this
 * step already has — from a calendar function and one committed JSON file, with
 * bare Node, in about a second.
 *
 * ## The three questions, in the order that makes the cheap answer possible
 *
 * ```
 *   1  is any source DUE today, or carrying debt?     data/ops/refresh-debt.json
 *                                                     + lib/ops/refresh-cadence.ts
 *   2  has freshness authority transferred?           the activation gate
 *   3  if it has: is the standing runner alive?       its last completed cycle
 * ```
 *
 * Question 1 alone can end the run, and it is the one that pays today.
 * Questions 2 and 3 are inert until the gate opens, and then they take effect
 * with nobody having to remember to change anything — which is the point of
 * writing them now rather than later.
 *
 * ## Every unanswerable question does the work
 *
 * The debt file will not parse, the cadence module will not import, the
 * activation gate cannot be read, the runner's heartbeat is missing — every one
 * of those prints `run_the_work=yes` and the full refresh runs. A backup that
 * skipped its work on its own confusion is a backup that silently stops being
 * one, and the failure would look exactly like a quiet night. A wasted refresh
 * is the cheap failure here and it is the only one this can produce.
 *
 *   node scripts/backup-wakeup.mjs                decide for today
 *   node scripts/backup-wakeup.mjs --date=<D>     decide for a named day
 *   node scripts/backup-wakeup.mjs --explain      print the full reasoning
 *
 * Exit 0 always. The workflow reads the output; this decides nothing by dying.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { today } from "./doc-dates.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const log = (line) => console.log(`backup-wakeup · ${line}`);

function emit(line) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, `${line}\n`, "utf8");
}

/** Run the work, and say why. The only exit that can be reached by an error. */
function doTheWork(reason) {
  log(`RUN THE WORK — ${reason}`);
  emit("run_the_work=yes");
  emit(`wakeup_reason=${reason.replace(/\n/g, " ").slice(0, 400)}`);
}

async function main() {
  const runDate = arg("date") ? new Date(`${arg("date")}T00:00:00Z`) : new Date();
  if (Number.isNaN(runDate.getTime())) {
    doTheWork(`--date=${arg("date")} is not a date, so the decision cannot be made`);
    return;
  }

  /* ── 1. Is anything due, or owed? ─────────────────────────────────────── */

  let due;
  let population = 0;
  try {
    const { dueDecisions } = await import("../lib/ops/refresh-cadence.ts");
    const { readDebt } = await import("../lib/ops/refresh-report.ts");

    let openDebt = [];
    try {
      /*
       * THE CANONICAL DAY, NOT A UTC SLICE. `toISOString().slice(0, 10)` reads
       * a day ahead of America/Phoenix after 5pm local, so anything stamped
       * that way claims to describe tomorrow — the defect
       * tests/generated-doc-dates.test.ts exists to catch, and it caught this.
       */
      const debt = readDebt(ROOT, today(runDate));
      openDebt = (debt.debts ?? []).map((d) => ({
        sourceId: d.sourceId,
        firstFailedOn: d.firstFailedOn,
      }));
    } catch (error) {
      doTheWork(`the debt file would not read (${error.message}) — a source may be owed`);
      return;
    }

    /*
     * THE LAST LANDED RUN DATE, READ FROM THE COMMITTED REPORT.
     *
     * An earlier draft passed null here, reasoning that the catch-up window it
     * feeds only ever makes MORE sources due — safe, and useless: with no
     * anchor the window covers its full ${"CATCH_UP_MAX_DAYS"} days and EVERY
     * source is due on EVERY day, so the quiet-day exit below could never be
     * reached and the saving it claims would be a saving nobody ever takes.
     * A cost law that cannot fire is not a cost law.
     *
     * `docs/refresh-run.json` is the committed record of the last run, it is on
     * the ops-only list, and it carries the run date. An unreadable or absent
     * report falls back to null, which is the old behaviour and does the work.
     */
    let lastLanded = null;
    try {
      const report = JSON.parse(
        readFileSync(join(ROOT, "docs", "refresh-run.json"), "utf8"),
      );
      const parsed = new Date(`${report.runDate}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) lastLanded = parsed;
    } catch {
      /* No report, or an unreadable one: fall back to the widest window. */
    }

    const decisions = dueDecisions(lastLanded, runDate, undefined, openDebt);
    /*
     * THE AUDIT COUNTS BOTH TERMS (RULING 159). "4 sources due" is unreadable
     * without knowing whether the cadence holds five sources or fifty, and a
     * cadence table that resolved to nothing would otherwise print a confident
     * "0 due" and skip the whole night.
     */
    population = decisions.length;
    due = decisions.filter((d) => d.due);
  } catch (error) {
    doTheWork(`the cadence could not be computed (${error.message})`);
    return;
  }

  const { floored, floorLine } = await import("../lib/ops/denominator-floor.ts");
  const count = floored("sources due", "lib/ops/refresh-cadence.ts", population, due.length);
  log(floorLine(count));

  if (due.length === 0) {
    /*
     * THE QUIET DAY. No source is due by the calendar and none is in debt, so
     * there is nothing for the install, the sweep, the gate or the commit to
     * act on. This is a STATED early exit, not a silent one, and it is not a
     * pass of anything: nothing was checked because nothing was owed.
     */
    log("NOTHING IS DUE — no source is due by the cadence and none is carrying debt.");
    log("");
    log("SKIPPED: the dependency install, the source sweep, the gate and the commit.");
    log("COMMITS THIS RUN: 0.  PRODUCTION BUILDS THIS RUN: 0.  MINUTES SPENT: a checkout.");
    log("");
    log("A quiet day costs nothing — RULING 124, and FCP-5's cost law.");
    emit("run_the_work=no");
    emit("wakeup_reason=NOTHING_DUE");
    return;
  }

  const names = due.map((d) => d.source.id).join(", ");

  /* ── 2. Has freshness authority transferred? ──────────────────────────── */

  let authority;
  try {
    const { readAuthority } = await import("../lib/control-plane/freshness/authority.ts");
    const { readActivationGate } = await import(
      "../lib/control-plane/promotion/activation-gate.ts"
    );
    const gate = readActivationGate(ROOT);
    authority = readAuthority({
      reader: gate.contracts.READER,
      truth: gate.contracts.TRUTH,
      freshness: gate.contracts.FRESHNESS,
      independentlyReproduced: gate.independentlyReproduced,
      readFrom: gate.readFrom,
    });
  } catch (error) {
    doTheWork(
      `${due.length} source(s) due (${names}) and the authority gate could not be read ` +
        `(${error.message}) — an unread gate is never read as transferred`,
    );
    return;
  }

  if (!authority.transferred) {
    /*
     * The honest state as of this file's writing, and the one the transition
     * rule requires. The GitHub workflow IS the freshness clock until the gate
     * opens, so it does its own work — the whole of it, exactly as before.
     */
    log(`${due.length} source(s) due: ${names}`);
    log(`AUTHORITY: ${authority.authoritative} — ${authority.unmet.length} transfer condition(s) unmet`);
    log(`  unmet: ${authority.unmet.join(", ")}`);
    log("");
    log("This workflow is still the freshness clock, so it does the full refresh. When the");
    log("transfer gate opens, this same step becomes a liveness probe and a night the standing");
    log("runner has already served costs a checkout instead of a sweep. Nothing has to be");
    log("remembered for that to happen.");
    doTheWork(`${due.length} source(s) due and this workflow still holds freshness authority`);
    return;
  }

  /* ── 3. Authority has transferred: is the standing runner alive? ──────── */

  const hours = Number(process.env.WTP_HOURS_SINCE_RUNNER_CYCLE ?? "");
  let decision;
  try {
    const { decideBackup } = await import("../lib/control-plane/freshness/authority.ts");
    decision = decideBackup({
      hoursSinceAuthoritativeCycle: Number.isFinite(hours) ? hours : null,
      authoritative: authority.authoritative,
    });
  } catch (error) {
    doTheWork(`the backup predicate would not load (${error.message})`);
    return;
  }

  if (decision.runTheWork) {
    doTheWork(`${due.length} source(s) due (${names}); ${decision.reason}`);
    return;
  }
  log(`NOTHING TO DO — ${decision.reason}`);
  log(`${due.length} source(s) were due (${names}) and the standing runner has already served them.`);
  emit("run_the_work=no");
  emit("wakeup_reason=AUTHORITATIVE_CLOCK_ALREADY_RAN");
}

await main();
