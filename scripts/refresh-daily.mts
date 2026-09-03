#!/usr/bin/env tsx
/**
 * THE ONE DAILY REFRESH — RULING 124 items 3 and 4.
 *
 * Runs every source that is DUE today (`lib/ops/refresh-cadence.ts`), in
 * per-source isolation, and records what each one did. It commits nothing and
 * gates nothing — the workflow around it owns the diff, the gate and the single
 * commit, because those are one decision made once for all sources rather than
 * five decisions made five times.
 *
 * ## PER-SOURCE ISOLATION IS THE POINT, AND IT IS NH31's RULING
 *
 * Consolidating five workflows into one creates exactly the failure NH31 was
 * adopted over, one size larger: a single throwing source would now discard
 * FOUR healthy sources' work instead of one vendor's. So a source that fails is
 * caught, named, and the others continue — and the exit code carries the
 * distinction the meetings ingest already draws:
 *
 *   0  every due source ran clean.
 *   1  NOTHING ran — the orchestrator itself could not work. Commit nothing.
 *   2  some sources produced output and at least one FAILED. Commit the
 *      survivors, THEN go red.
 *
 * ## THE RECORD IS DATA, AND THE GATE FINISHES IT (2026-09-02)
 *
 * `docs/refresh-run.json` is this run as data — one typed outcome per source
 * (`lib/ops/refresh-report.ts`) — and `docs/refresh-run.md` is rendered from
 * it. This script writes the record with the gate's verdict at NOT_RUN;
 * `scripts/refresh-gate.mts` runs the suite, attributes any refusal to the
 * source whose data caused it, and rewrites the record with the final outcomes.
 * Both files live under `docs/`, a non-shipping prefix, and are committed only
 * alongside data that moved.
 *
 * A source whose command fails is written to `data/ops/refresh-debt.json` here,
 * because the gate never sees a source that produced nothing; a source the gate
 * refuses is written there by the gate. Either way the source is DUE on the
 * next run whatever its cadence says, until it lands.
 *
 * ## AND A QUIET DAY COSTS NOTHING
 *
 * The workflow commits only alongside data that actually moved: a quiet night
 * is zero commits and zero builds, not a ceremonial deploy. The debt file is
 * written only when its content moves, for the same reason.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { regenerateStaleDependents, spawningRunner } from "../lib/ops/generated-freshness.ts";
import {
  CATCH_UP_MAX_DAYS,
  REFRESH_SOURCES,
  cadenceOn,
  catchUpSlots,
  dueDecisions,
  utcDay,
  type RefreshSource,
} from "../lib/ops/refresh-cadence.ts";
import {
  REFRESH_REPORT_PATH,
  clearDebt,
  dayAfter,
  nextCadenceDay,
  readDebt,
  recordDebt,
  writeDebtIfChanged,
  writeRefreshRun,
  type RefreshRun,
  type RefreshSourceRun,
  type SourceOutcome,
} from "../lib/ops/refresh-report.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(ROOT, REFRESH_REPORT_PATH);

const argv = process.argv.slice(2);
const forceAll = argv.includes("--all");
const dryRun = argv.includes("--dry-run");
const dateArg = argv.find((a) => a.startsWith("--date="))?.slice("--date=".length);

const startedAt = new Date().toISOString();

/**
 * The run date. Supplied explicitly by the workflow so the report and the
 * cadence decision agree with each other, and so a dispatch can be replayed for
 * a specific day.
 */
const runDate = dateArg ? new Date(`${dateArg}T00:00:00Z`) : new Date();
if (Number.isNaN(runDate.getTime())) {
  console.error(`refresh-daily · --date=${dateArg} is not a date`);
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* CATCH-UP: THE DAYS NO LANDED REFRESH HAS COVERED                            */
/* -------------------------------------------------------------------------- */

const noCatchUp = argv.includes("--no-catch-up");
const lastLandedArg = argv
  .find((a) => a.startsWith("--last-landed="))
  ?.slice("--last-landed=".length);

/**
 * When a refresh last LANDED, read from the run report already on disk.
 *
 * **THE STAMP IS READ BEFORE THIS RUN OVERWRITES IT.** `docs/refresh-run.md` is
 * rewritten at the bottom of this file on every run, so a read taken later
 * would find today's date and conclude nothing was ever missed.
 *
 * **IT IS FILE CONTENT, NEVER `git log`.** In a shallow clone `git log -1 --
 * <path>` returns the tip date for every file, with no error. The workflow
 * commits this report only alongside data that moved, so the date inside the
 * committed file IS the last landed refresh, at any clone depth.
 *
 * **WHAT IT CANNOT TELL, SAID PLAINLY.** A day whose run happened and found
 * nothing commits nothing, so from `main` it is indistinguishable from a day
 * with no run at all. Both are treated as uncovered — the safe direction — and
 * `CATCH_UP_MAX_DAYS` caps it.
 */
function lastLandedFromReport(): { date: Date | null; where: string } {
  if (lastLandedArg) {
    const d = new Date(`${lastLandedArg}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) {
      console.error(`refresh-daily · --last-landed=${lastLandedArg} is not a date`);
      process.exit(1);
    }
    return { date: d, where: `--last-landed=${lastLandedArg}` };
  }
  if (!existsSync(REPORT)) {
    return { date: null, where: "docs/refresh-run.md does not exist yet — no catch-up is claimed" };
  }
  const text = readFileSync(REPORT, "utf8");
  const m = text.match(/^Run date:\s*\*\*(\d{4}-\d{2}-\d{2})\*\*/m);
  if (!m) {
    // RULING 24: could not read is not the same claim as nothing to read.
    return {
      date: null,
      where: "docs/refresh-run.md carries no parseable `Run date:` line — no catch-up is claimed from it",
    };
  }
  return { date: new Date(`${m[1]}T00:00:00Z`), where: `docs/refresh-run.md, run date ${m[1]}` };
}

/*
 * TWO DIFFERENT DAYS, and they are deliberately computed differently.
 *
 * The CADENCE question — is this source due — is UTC, because the cron that
 * fires this is UTC. The DOCUMENT DAY written into the record is
 * America/Phoenix, from the same `today()` every other stamp comes from: a UTC
 * slice reads a day ahead after 5pm local, and a document stamped that way
 * claims to describe tomorrow.
 */
const dayName = dateArg ?? today();
const utcToday = utcDay(runDate);

const debtFile = readDebt(ROOT, dayName);
const lastLanded = noCatchUp || forceAll ? { date: null, where: "catch-up off" } : lastLandedFromReport();
const catchUpDays = catchUpSlots(lastLanded.date, runDate);
const decisions = dueDecisions(
  noCatchUp || forceAll ? null : lastLanded.date,
  runDate,
  CATCH_UP_MAX_DAYS,
  forceAll ? [] : debtFile.debts,
);

interface Outcome {
  source: RefreshSource;
  ran: boolean;
  ok: boolean;
  recoveredFrom: readonly string[];
  debtSince?: string;
  /**
   * The child said it wrote usable output and then failed — exit 2, this
   * project's contract for PARTIAL PROGRESS IS ON DISK. Measured on run
   * 32833989579 (2026-08-25): 451 meeting rows from ten healthy sources were
   * written and thrown away because the orchestrator asked only `status === 0`.
   * A partial source is still FAILED — it is named, the run goes red — but its
   * rows continue to the gate and the commit.
   */
  partial: boolean;
  skippedWhy?: string;
  failedCommand?: string;
  exitCode?: number;
}

/** Exit 2 is a CONTRACT, not just a non-zero: output exists, and the run failed. */
const PARTIAL_PROGRESS_CODE = 2;

function runCommand(command: string): { ok: boolean; code: number; partial: boolean } {
  console.log(`\n  $ corepack pnpm ${command}`);
  if (dryRun) {
    console.log("    (dry run — not executed)");
    return { ok: true, code: 0, partial: false };
  }
  const r = spawnSync("corepack", ["pnpm", ...command.split(" ")], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const code = r.status ?? -1;
  return { ok: code === 0, code, partial: code === PARTIAL_PROGRESS_CODE };
}

/**
 * The governed paths that differ from HEAD, from git's own status — tracked
 * changes and untracked additions alike. A checkout that cannot answer is a
 * loud failure: a refresh that cannot say what it changed cannot be gated.
 */
function changedUnder(paths: readonly string[]): string[] {
  if (dryRun) return [];
  const r = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all", "--", ...paths], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(`refresh-daily · git status failed under ${paths.join(", ")}: ${r.stderr}`);
    process.exit(1);
  }
  return r.stdout
    .split("\0")
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).replace(/\\/g, "/"))
    .sort();
}

const due = forceAll ? [...REFRESH_SOURCES] : decisions.filter((d) => d.due).map((d) => d.source);

console.log(`refresh-daily · ${dayName} (UTC ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][runDate.getUTCDay()]})`);
// RULING 159: the count carries its denominator, and a cadence table with no
// sources in it throws rather than printing a quiet "0 due".
console.log(`  ${floorLine(floored("sources due", "the cadence table", REFRESH_SOURCES.length, due.length))}${forceAll ? " (--all: cadence overridden)" : ""}`);
if (forceAll || noCatchUp) {
  console.log(`  catch-up: OFF (${forceAll ? "--all overrides the cadence entirely" : "--no-catch-up"})`);
} else {
  console.log(`  last landed refresh: ${lastLanded.where}`);
  console.log(
    `  catch-up window: ${catchUpDays.length} calendar day(s) — ${catchUpDays.map(utcDay).join(", ")} (cap ${CATCH_UP_MAX_DAYS})`,
  );
}
if (debtFile.debts.length > 0) {
  console.log(
    `  open freshness debt: ${debtFile.debts.map((d) => `${d.sourceId} (since ${d.firstFailedOn}, ${d.consecutiveFailures} in a row)`).join(", ")}${forceAll ? " — every source runs under --all" : " — due until it lands"}`,
  );
}
console.log("");

const outcomes: Outcome[] = [];

for (const source of REFRESH_SOURCES) {
  const decision = decisions.find((d) => d.source.id === source.id)!;
  const dueToday = forceAll || decision.due;
  const cadence = cadenceOn(source, runDate);
  const recoveredFrom = forceAll ? [] : decision.recoveredFrom;
  if (!dueToday) {
    console.log(`  SKIP  ${source.id.padEnd(12)} ${cadence} — not due today`);
    outcomes.push({
      source,
      ran: false,
      ok: true,
      partial: false,
      recoveredFrom: [],
      skippedWhy: `${cadence}, not due on ${dayName} or on any uncovered day since the last landed refresh, and carrying no debt`,
    });
    continue;
  }

  // A CATCH-UP OR A DEBT RUN IS ANNOUNCED, NEVER SILENT: an unexplained extra
  // run is how a later session "fixes" the mechanism by deleting it.
  console.log(
    `  RUN   ${source.id.padEnd(12)} ${cadence}` +
      (!decision.dueToday && recoveredFrom.length > 0
        ? `  CATCH-UP for ${recoveredFrom.join(", ")} — no landed refresh covers that day`
        : recoveredFrom.length > 0
          ? `  (also covers ${recoveredFrom.join(", ")})`
          : "") +
      (decision.debtSince ? `  DEBT since ${decision.debtSince} — due until it lands` : ""),
  );
  let ok = true;
  let partial = false;
  let failedCommand: string | undefined;
  let exitCode: number | undefined;
  for (const command of source.commands) {
    const r = runCommand(command);
    if (!r.ok) {
      ok = false;
      partial = r.partial;
      failedCommand = command;
      exitCode = r.code;
      // NH31: the source stops, the ORCHESTRATOR does not.
      const wrote = r.partial
        ? " It exited 2, which is this project's contract for USABLE OUTPUT IS ON DISK — its rows continue to the gate and the commit."
        : "";
      console.log(`\n  ::warning title=refresh source failed::${source.id} failed at 'pnpm ${command}' (exit ${r.code}).${wrote} The other due sources continue; this run will be FAILED at the end, after any healthy data is safely committed.`);
      break;
    }
  }
  outcomes.push({
    source,
    ran: true,
    ok,
    partial,
    failedCommand,
    exitCode,
    recoveredFrom,
    ...(decision.debtSince ? { debtSince: decision.debtSince } : {}),
  });
}

const ranSources = outcomes.filter((o) => o.ran);
const failed = ranSources.filter((o) => !o.ok);
const succeeded = ranSources.filter((o) => o.ok);
/*
 * WHOSE OUTPUT REACHED DISK — a different question from whose run was clean,
 * and the one that decides whether anything is committed. A source that
 * exited 2 PRODUCED and FAILED; it is neither a success nor a plain failure.
 */
const produced = ranSources.filter((o) => o.ok || o.partial);
const partials = ranSources.filter((o) => !o.ok && o.partial);

const exitCode: 0 | 1 | 2 =
  ranSources.length === 0 ? 0 : produced.length === 0 ? 1 : failed.length > 0 ? 2 : 0;

/* -------------------------------------------------------------------------- */
/* THE RECORD                                                                  */
/* -------------------------------------------------------------------------- */

let debt = debtFile;
const rows: RefreshSourceRun[] = outcomes.map((o) => {
  const governs = [...o.source.governs];
  const changedPaths = o.ran ? changedUnder(governs) : [];
  let outcome: SourceOutcome;
  let reason: string;
  if (!o.ran) {
    outcome = "NOT_DUE";
    reason = o.skippedWhy ?? "not due";
  } else if (!o.ok && !o.partial) {
    outcome = "ROUTE_UNREAD";
    reason = `failed at \`pnpm ${o.failedCommand}\` (exit ${o.exitCode}) — nothing usable was written; owed until it lands`;
  } else if (!o.ok && o.partial) {
    outcome = changedPaths.length > 0 ? "INGESTED" : "UNCHANGED";
    reason = `FAILED at \`pnpm ${o.failedCommand}\` (exit ${o.exitCode}) with usable output on disk — its rows continue to the gate; the run goes red and the source is owed until it lands clean`;
  } else if (changedPaths.length > 0) {
    outcome = "INGESTED";
    reason = `ran clean; ${changedPaths.length} governed path(s) changed — awaiting the gate`;
  } else {
    outcome = "UNCHANGED";
    reason = "ran clean; every governed path is byte-identical to HEAD";
  }
  if (o.debtSince) reason += ` (open debt since ${o.debtSince})`;
  if (dryRun && o.ran) reason += " (dry run — nothing executed, paths not compared)";

  const nextDueAt = outcome === "ROUTE_UNREAD" || (o.ran && !o.ok) ? dayAfter(utcToday) : nextCadenceDay(o.source, runDate);

  if (o.ran && !o.ok) {
    debt = recordDebt(debt, {
      sourceId: o.source.id,
      reason: `failed at \`pnpm ${o.failedCommand}\` (exit ${o.exitCode})${o.partial ? " with usable output on disk" : ""}`,
      today: dayName,
      nextDueAt: dayAfter(utcToday),
    });
  } else if (outcome === "UNCHANGED") {
    // Byte-identical to HEAD: the reader already has this source's truth.
    debt = clearDebt(debt, o.source.id);
  }

  return {
    id: o.source.id,
    due: o.ran,
    ran: o.ran,
    outcome,
    reason,
    commands: [...o.source.commands],
    failedCommand: o.failedCommand ?? null,
    exitCode: o.ran ? (o.exitCode ?? 0) : null,
    governs,
    changedPaths,
    recoveredFrom: [...o.recoveredFrom],
    nextDueAt,
  };
});

const run: RefreshRun = {
  formatVersion: 1,
  runDate: dayName,
  startedAt,
  finishedAt: new Date().toISOString(),
  mode: forceAll ? "ALL" : "CADENCE",
  exitCode,
  sources: rows,
  catchUp: {
    lastLanded: lastLanded.where,
    days: catchUpDays.map(utcDay),
    cap: CATCH_UP_MAX_DAYS,
    off: forceAll || noCatchUp,
  },
  gate: {
    verdict: "NOT_RUN",
    ranAt: null,
    failingFiles: [],
    attribution: [],
    note: "The gate has not run. `scripts/refresh-gate.mts` runs the suite over the changed data and finalises this record; until it does, INGESTED means 'changed and awaiting the gate'.",
  },
};

if (!dryRun) {
  // REGENERATE PURE DEPENDENTS OF THE FRESHLY-FETCHED DATA, BEFORE THE GATE.
  // (2026-09-03, R6 liveness.)
  //
  // A source that changed a registered PURE generator's INPUT leaves the
  // dependent stale — `meetings` writes data/meetings-snapshot.json, which feeds
  // every docs/states/<xx>.md (lib/holdings/manifest.ts). The workflow's gate
  // (`corepack pnpm test`) runs generated-artifacts.test.ts BEFORE refresh-gate
  // could regenerate anything, so without this the gate would refuse the healthy
  // source on a stale MANIFEST and the change could never land — proven by the
  // controlled run 33786728614, where `meetings` was refused on
  // generated-artifacts.test.ts. Regenerating here, from the data the sources
  // just wrote, lets the gate see a fresh tree and the source survive. It is
  // read-first (only stale dependents are rewritten) and deterministic. A source
  // whose data the gate later refuses is reverted by refresh-gate, which
  // regenerates AGAIN from the survivor tree — the two stages together keep every
  // committed dependent current against whatever actually commits, and the
  // push-door staleness guard is the backstop if either misses.
  const preGate = regenerateStaleDependents({
    runCheck: spawningRunner(ROOT),
    runGen: (command) => spawningRunner(ROOT)(command),
    log: (line) => console.log(line),
  });
  if (preGate.regenerated.length > 0) {
    console.log(`refresh-daily · regenerated ${preGate.regenerated.length} stale dependent path(s) before the gate`);
  }
  for (const f of preGate.failed) {
    console.error(`refresh-daily · a PURE dependent could not be regenerated before the gate: \`${f.command}\`\n${f.output}`);
  }

  writeRefreshRun(ROOT, run, REFRESH_SOURCES);
  console.log(`\nrefresh-daily · wrote docs/refresh-run.json and docs/refresh-run.md`);
  if (writeDebtIfChanged(ROOT, debt, dayName)) {
    console.log(`refresh-daily · wrote data/ops/refresh-debt.json — ${debt.debts.length} source(s) in debt`);
  }
}

console.log("");
for (const r of rows) {
  console.log(`  ${r.outcome.padEnd(13)} ${r.id.padEnd(12)} ${r.reason}${r.changedPaths.length > 0 ? ` [${r.changedPaths.join(", ")}]` : ""}`);
}
console.log(
  `\nrefresh-daily · ${succeeded.length} clean, ${partials.length} failed with output on disk, ${failed.length - partials.length} failed with nothing usable, ${outcomes.length - ranSources.length} not due, of ${REFRESH_SOURCES.length} source(s)`,
);

if (ranSources.length === 0) {
  console.log("refresh-daily · nothing was due today — exit 0, and the workflow will find no diff to commit");
  process.exit(0);
}
if (exitCode === 1) {
  console.log(
    "refresh-daily · EVERY due source failed AND none of them wrote usable output — nothing trustworthy exists. Commit nothing.",
  );
  process.exit(1);
}
if (exitCode === 2) {
  if (partials.length > 0) {
    console.log(
      `refresh-daily · ${partials.map((f) => f.source.id).join(", ")} wrote usable output before failing (exit 2). Those rows are committed; the run still goes red.`,
    );
  }
  console.log(
    `refresh-daily · PARTIAL: ${failed.map((f) => f.source.id).join(", ")} failed. Everything usable continues to the gate and the commit; this run goes red afterwards (NH31).`,
  );
  process.exit(2);
}
process.exit(0);
