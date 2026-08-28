#!/usr/bin/env tsx
/**
 * THE ONE DAILY REFRESH — RULING 124 items 3 and 4.
 *
 * Session: 2026-08-24, the state-campaign-money session. Serves Sean's
 * instruction that deploys be cut to the floor.
 *
 * Runs every source that is DUE today (`lib/ops/refresh-cadence.ts`), in
 * per-source isolation, and reports what each one did. It commits nothing and
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
 * Code 2 is the one that matters: the run is still red, the broken source is
 * still named, and the healthy sources' rows still reach `main`. RULING 12
 * holds — a job failure is our stopwatch running out, and committing the
 * survivors is not compiling it into a skip.
 *
 * ## AND A QUIET DAY COSTS NOTHING
 *
 * The report is written to `docs/refresh-run.md`, which is a NON-SHIPPING path
 * under `lib/ops/deploy-paths.ts`, so it can never by itself cost a build. The
 * workflow commits it only alongside data that actually moved: Sean's
 * instruction is that a quiet night is zero commits and zero builds, not a
 * ceremonial deploy.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CATCH_UP_MAX_DAYS,
  REFRESH_SOURCES,
  cadenceOn,
  catchUpSlots,
  dueDecisions,
  utcDay,
  type RefreshSource,
} from "../lib/ops/refresh-cadence.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(ROOT, "docs", "refresh-run.md");

const argv = process.argv.slice(2);
const forceAll = argv.includes("--all");
const dryRun = argv.includes("--dry-run");
const dateArg = argv.find((a) => a.startsWith("--date="))?.slice("--date=".length);

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
 * would find today's date and conclude nothing was ever missed — a state file
 * that reports the state of the process reading it.
 *
 * **IT IS FILE CONTENT, NEVER `git log`.** Per-file history is exactly what
 * this module's header refuses: in a shallow clone `git log -1 -- <path>`
 * returns the tip date for every file, with no error, and a weekly source would
 * read as refreshed-today forever. The workflow commits this report only
 * alongside data that moved, so the date inside the committed file IS the last
 * landed refresh, and it is available in any clone at any depth.
 *
 * **WHAT IT CANNOT TELL, SAID PLAINLY.** A day whose run happened and found
 * nothing commits nothing, so from `main` it is indistinguishable from a day
 * with no run at all. This treats both as uncovered. That is the safe
 * direction — re-reading a source that already had nothing to say costs one API
 * call and lands nothing, while skipping a day that was genuinely missed costs
 * up to fourteen days of federal filings — and `CATCH_UP_MAX_DAYS` is the cap
 * that stops the safe direction becoming a daily cadence for weekly sources.
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

const lastLanded = noCatchUp || forceAll ? { date: null, where: "catch-up off" } : lastLandedFromReport();
const catchUpDays = catchUpSlots(lastLanded.date, runDate);
const decisions = dueDecisions(noCatchUp || forceAll ? null : lastLanded.date, runDate);

interface Outcome {
  source: RefreshSource;
  ran: boolean;
  ok: boolean;
  /**
   * The earlier calendar day(s) this source is being recovered for, when it is
   * running for a reason other than today's own cadence.
   */
  recoveredFrom?: readonly string[];
  /**
   * The child said it wrote usable output and then failed — exit 2.
   *
   * ## The orchestrator was speaking a language it could not hear
   *
   * The header above states the three-valued vocabulary this file uses toward
   * its own caller, and says in as many words that it is "the distinction the
   * meetings ingest already draws". It did not LISTEN for that distinction:
   * `runCommand` asked `status === 0`, so a child exiting 2 to mean *partial
   * progress is on disk, commit it, then go red* was recorded identically to a
   * child exiting 1 to mean *nothing usable exists*.
   *
   * The cost, measured on run 32833989579 (2026-08-25). `pnpm ingest composite`
   * printed, in its own words, "PARTIAL PROGRESS IS ON DISK AND MUST BE
   * COMMITTED: 451 row(s) from 10 of 11 source(s) were written before this
   * failure. Exiting 2 (not 1) so the caller commits them". Both due sources
   * were then marked plain failures, `succeeded.length` was 0, the
   * every-due-source-failed branch fired, and the workflow printed "nothing
   * usable was written — there is nothing to commit". Four hundred and
   * fifty-one meeting rows from ten healthy sources were written to disk and
   * thrown away, and nothing anywhere said so.
   *
   * A source that is PARTIAL is still FAILED — `ok` stays false, it is named in
   * the report, and the run still exits 2 and goes red. What changes is that it
   * no longer counts toward "every due source failed", which is the only
   * question whose answer decides whether the healthy rows reach `main`.
   */
  partial?: boolean;
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

const due = forceAll ? [...REFRESH_SOURCES] : decisions.filter((d) => d.due).map((d) => d.source);
/*
 * TWO DIFFERENT DAYS, and they are deliberately computed differently.
 *
 * The CADENCE question — is this source due — is UTC, because the cron that
 * fires this is UTC and a cadence disagreeing with its own trigger would skip
 * or double a run at the month boundary. `isDue` uses `getUTCDay`/`getUTCDate`.
 *
 * The DOCUMENT DAY written into the report is America/Phoenix, from the same
 * `today()` every other stamp in this project comes from. A UTC slice reads a
 * day ahead after 5pm local, and a document stamped that way claims to describe
 * tomorrow.
 */
const dayName = dateArg ?? today();

console.log(`refresh-daily · ${dayName} (UTC ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][runDate.getUTCDay()]})`);
console.log(`  ${due.length} of ${REFRESH_SOURCES.length} source(s) due${forceAll ? " (--all: cadence overridden)" : ""}`);
if (forceAll || noCatchUp) {
  console.log(`  catch-up: OFF (${forceAll ? "--all overrides the cadence entirely" : "--no-catch-up"})\n`);
} else {
  console.log(`  last landed refresh: ${lastLanded.where}`);
  console.log(
    `  catch-up window: ${catchUpDays.length} calendar day(s) — ${catchUpDays.map(utcDay).join(", ")} (cap ${CATCH_UP_MAX_DAYS})\n`,
  );
}

const recoveredById = new Map(decisions.map((d) => [d.source.id, d.recoveredFrom]));

const outcomes: Outcome[] = [];

for (const source of REFRESH_SOURCES) {
  const decision = decisions.find((d) => d.source.id === source.id)!;
  const dueToday = forceAll || decision.due;
  const cadence = cadenceOn(source, runDate);
  const recoveredFrom = forceAll ? [] : (recoveredById.get(source.id) ?? []);
  if (!dueToday) {
    console.log(`  SKIP  ${source.id.padEnd(12)} ${cadence} — not due today`);
    outcomes.push({
      source,
      ran: false,
      ok: true,
      skippedWhy: `${cadence}, not due on ${dayName} or on any uncovered day since the last landed refresh`,
    });
    continue;
  }

  /*
   * A CATCH-UP IS ANNOUNCED, NEVER SILENT. A weekly source running on a
   * Wednesday looks like a cadence bug unless the line says which Monday it is
   * recovering — and an unexplained extra run is how a later session "fixes"
   * the mechanism by deleting it.
   */
  console.log(
    `  RUN   ${source.id.padEnd(12)} ${cadence}` +
      (!decision.dueToday && recoveredFrom.length > 0
        ? `  CATCH-UP for ${recoveredFrom.join(", ")} — no landed refresh covers that day`
        : recoveredFrom.length > 0
          ? `  (also covers ${recoveredFrom.join(", ")})`
          : ""),
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
  outcomes.push({ source, ran: true, ok, partial, failedCommand, exitCode, recoveredFrom });
}

const ranSources = outcomes.filter((o) => o.ran);
const failed = ranSources.filter((o) => !o.ok);
const succeeded = ranSources.filter((o) => o.ok);
/*
 * WHOSE OUTPUT REACHED DISK — a different question from whose run was clean,
 * and the one that decides whether anything is committed.
 *
 * A source that exited 2 wrote rows and then failed. Counting it as a plain
 * failure is what discarded 451 meeting rows on 2026-08-25; counting it as a
 * success would hide a red run. It is neither: it PRODUCED, and it FAILED.
 */
const produced = ranSources.filter((o) => o.ok || o.partial);
const partials = ranSources.filter((o) => !o.ok && o.partial);

/**
 * Annotate a generated line that legitimately names a date in the future.
 *
 * **This orchestrator's own report was failing the gate that runs immediately
 * after it** (2026-08-25). Every source whose cadence is elevated through the
 * election carries `2026-11-03` in its reason, `docs/refresh-run.md` printed
 * those reasons verbatim, and `tests/doc-dates.test.ts` — which runs in the
 * `Validate before committing` step — counted three future dates and refused.
 * So the daily refresh could never commit, deterministically and forever, on a
 * red it manufactured between writing its report and being asked to justify it.
 *
 * The date rule is right and is not being loosened: a date not read from the
 * system clock is a fabrication. An ELECTION date is the documented exception,
 * and the exception is declared inline, on the same line, exactly as a person
 * writing the file by hand would have to declare it.
 *
 * It is computed rather than hardcoded on purpose. Pinning `2026-11-03` here
 * would go stale the day the cadence table names a different election, and it
 * would go stale SILENTLY — as a red run at 09:11 UTC that nobody is awake for.
 */
function declareFutureDates(
  line: string,
  asOfDay: string,
  why = "an election date carried in a cadence reason, not a stamp",
): string {
  /*
   * **THE THRESHOLD IS `dayName`, NEVER A UTC SLICE**, and the first version of
   * this used one — caught by `tests/generated-doc-dates.test.ts` before it
   * could ship, which is that guard doing exactly its job.
   *
   * `toISOString().slice(0, 10)` reads a day AHEAD of America/Phoenix after 5pm
   * local, so on those evenings it would have treated today's own date as a
   * future one and annotated a line that needed no annotation. `dayName` is
   * `today()`, the source every other stamp in this project comes from.
   */
  const dates = line.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const future = [...new Set(dates.filter((d) => d > asOfDay))];
  if (future.length === 0) return line;
  return `${line} <!-- expected-future: ${future.join(", ")} — ${why} -->`;
}

const lines: string[] = [];
lines.push("# The daily refresh run");
lines.push("");
lines.push("**GENERATED — `pnpm refresh:daily` (`scripts/refresh-daily.mts`). Never hand-edited (RULING 92).**");
lines.push("");
lines.push(`Run date: **${dayName}** (UTC).`);
lines.push("");
lines.push(
  "One scheduled run a day, one commit at most, and nothing committed when nothing moved — RULING 124. Cadence per source and the reason for each is `lib/ops/refresh-cadence.ts`.",
);
lines.push("");
lines.push(`## ${succeeded.length} ran clean · ${failed.length} failed · ${outcomes.length - ranSources.length} not due`);
lines.push("");
lines.push("| Source | Cadence today | Ran | Why | Result | Governs |");
lines.push("|---|---|:---:|---|---|---|");
for (const o of outcomes) {
  const cad = cadenceOn(o.source, runDate);
  const why = !o.ran
    ? "—"
    : forceAll
      ? "`--all`"
      : (o.recoveredFrom?.length ?? 0) > 0
        ? `CATCH-UP for ${o.recoveredFrom!.join(", ")}`
        : "today's cadence";
  const result = !o.ran
    ? `not due — ${o.skippedWhy}`
    : o.ok
      ? "clean"
      : o.partial
        ? `**FAILED, output kept** at \`pnpm ${o.failedCommand}\` (exit ${o.exitCode} — usable rows were on disk and are committed)`
      : `**FAILED** at \`pnpm ${o.failedCommand}\` (exit ${o.exitCode})`;
  lines.push(
    declareFutureDates(
      `| \`${o.source.id}\` | ${cad} | ${o.ran ? "yes" : "no"} | ${why} | ${result} | ${o.source.governs.map((g) => `\`${g}\``).join(", ")} |`,
      dayName,
      "a UTC calendar day in the catch-up window, one ahead of the America/Phoenix document day",
    ),
  );
}
lines.push("");
lines.push("## Which days this run answered for");
lines.push("");
lines.push(
  declareFutureDates(
    forceAll || noCatchUp
      ? `Catch-up is OFF (${forceAll ? "`--all`" : "`--no-catch-up`"}); this run answered for ${dayName} alone.`
      : `Last landed refresh: ${lastLanded.where}. This run answered for ${catchUpDays.length} calendar day(s) — ` +
        `${catchUpDays.map(utcDay).join(", ")} — capped at ${CATCH_UP_MAX_DAYS} days.`,
    dayName,
    "a UTC calendar day in the catch-up window, one ahead of the America/Phoenix document day",
  ),
);
lines.push("");
lines.push(
  "A late run computes the right cadence on its own, because the cadence is a pure function of the run's calendar date. " +
    "What it cannot do is recover a day that produced NO run at all: `fec` and `legiscan` are Monday-only, so a missed " +
    "Monday would otherwise be a fourteen-day data gap. So this run unions what every uncovered day since the last " +
    "landed refresh asks for. A quiet day commits nothing and is therefore indistinguishable from a missed one from " +
    "`main`, which is why both are treated as uncovered and why the window is capped — an uncapped union would put " +
    "every weekly source on a daily cadence during a quiet fortnight. It adds no runs, no commits and no builds: " +
    "`refresh-daily.yml` still commits at most once, and nothing when nothing moved.",
);
lines.push("");
lines.push("## Why each source sits on the cadence it does");
lines.push("");
for (const s of REFRESH_SOURCES) {
  const elevated = s.elevatedUntil
    ? ` (elevated to ${s.elevatedUntil.cadence} until ${s.elevatedUntil.until})`
    : "";
  lines.push(declareFutureDates(`- **\`${s.id}\`** — ${s.cadence}${elevated}. ${s.why}`, dayName));
}
lines.push("");

if (!dryRun) {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, `${lines.join("\n")}\n`, "utf8");
  console.log(`\nrefresh-daily · wrote docs/refresh-run.md`);
}

console.log(
  `\nrefresh-daily · ${succeeded.length} clean, ${partials.length} failed with output on disk, ${failed.length - partials.length} failed with nothing usable, ${outcomes.length - ranSources.length} not due, of ${REFRESH_SOURCES.length} source(s)`,
);

if (ranSources.length === 0) {
  console.log("refresh-daily · nothing was due today — exit 0, and the workflow will find no diff to commit");
  process.exit(0);
}
/*
 * THE QUESTION IS WHETHER ANYTHING USABLE EXISTS, NOT WHETHER ANY RUN WAS
 * CLEAN. Asking the second question is what threw 451 rows away — see the
 * `partial` field's note above.
 */
if (produced.length === 0) {
  console.log(
    "refresh-daily · EVERY due source failed AND none of them wrote usable output — nothing trustworthy exists. Commit nothing.",
  );
  process.exit(1);
}
if (failed.length > 0) {
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
