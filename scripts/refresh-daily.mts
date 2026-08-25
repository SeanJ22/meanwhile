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
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REFRESH_SOURCES,
  cadenceOn,
  dueSources,
  isDue,
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

interface Outcome {
  source: RefreshSource;
  ran: boolean;
  ok: boolean;
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

const due = forceAll ? [...REFRESH_SOURCES] : dueSources(runDate);
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
console.log(`  ${due.length} of ${REFRESH_SOURCES.length} source(s) due${forceAll ? " (--all: cadence overridden)" : ""}\n`);

const outcomes: Outcome[] = [];

for (const source of REFRESH_SOURCES) {
  const dueToday = forceAll || isDue(source, runDate);
  const cadence = cadenceOn(source, runDate);
  if (!dueToday) {
    console.log(`  SKIP  ${source.id.padEnd(12)} ${cadence} — not due today`);
    outcomes.push({
      source,
      ran: false,
      ok: true,
      skippedWhy: `${cadence}, not due on ${dayName}`,
    });
    continue;
  }

  console.log(`  RUN   ${source.id.padEnd(12)} ${cadence}`);
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
  outcomes.push({ source, ran: true, ok, partial, failedCommand, exitCode });
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
function declareFutureDates(line: string, asOf: Date): string {
  const today = asOf.toISOString().slice(0, 10);
  const dates = line.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const future = [...new Set(dates.filter((d) => d > today))];
  if (future.length === 0) return line;
  return `${line} <!-- expected-future: ${future.join(", ")} — an election date carried in a cadence reason, not a stamp -->`;
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
lines.push("| Source | Cadence today | Ran | Result | Governs |");
lines.push("|---|---|:---:|---|---|");
for (const o of outcomes) {
  const cad = cadenceOn(o.source, runDate);
  const result = !o.ran
    ? `not due — ${o.skippedWhy}`
    : o.ok
      ? "clean"
      : o.partial
        ? `**FAILED, output kept** at \`pnpm ${o.failedCommand}\` (exit ${o.exitCode} — usable rows were on disk and are committed)`
      : `**FAILED** at \`pnpm ${o.failedCommand}\` (exit ${o.exitCode})`;
  lines.push(
    `| \`${o.source.id}\` | ${cad} | ${o.ran ? "yes" : "no"} | ${result} | ${o.source.governs.map((g) => `\`${g}\``).join(", ")} |`,
  );
}
lines.push("");
lines.push("## Why each source sits on the cadence it does");
lines.push("");
for (const s of REFRESH_SOURCES) {
  const elevated = s.elevatedUntil
    ? ` (elevated to ${s.elevatedUntil.cadence} until ${s.elevatedUntil.until})`
    : "";
  lines.push(declareFutureDates(`- **\`${s.id}\`** — ${s.cadence}${elevated}. ${s.why}`, runDate));
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
