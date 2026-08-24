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
  skippedWhy?: string;
  failedCommand?: string;
  exitCode?: number;
}

function runCommand(command: string): { ok: boolean; code: number } {
  console.log(`\n  $ corepack pnpm ${command}`);
  if (dryRun) {
    console.log("    (dry run — not executed)");
    return { ok: true, code: 0 };
  }
  const r = spawnSync("corepack", ["pnpm", ...command.split(" ")], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  return { ok: r.status === 0, code: r.status ?? -1 };
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
  let failedCommand: string | undefined;
  let exitCode: number | undefined;
  for (const command of source.commands) {
    const r = runCommand(command);
    if (!r.ok) {
      ok = false;
      failedCommand = command;
      exitCode = r.code;
      // NH31: the source stops, the ORCHESTRATOR does not.
      console.log(`\n  ::warning title=refresh source failed::${source.id} failed at 'pnpm ${command}' (exit ${r.code}). The other due sources continue; this run will be FAILED at the end, after any healthy data is safely committed.`);
      break;
    }
  }
  outcomes.push({ source, ran: true, ok, failedCommand, exitCode });
}

const ranSources = outcomes.filter((o) => o.ran);
const failed = ranSources.filter((o) => !o.ok);
const succeeded = ranSources.filter((o) => o.ok);

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
  lines.push(`- **\`${s.id}\`** — ${s.cadence}${elevated}. ${s.why}`);
}
lines.push("");

if (!dryRun) {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, `${lines.join("\n")}\n`, "utf8");
  console.log(`\nrefresh-daily · wrote docs/refresh-run.md`);
}

console.log(
  `\nrefresh-daily · ${succeeded.length} clean, ${failed.length} failed, ${outcomes.length - ranSources.length} not due, of ${REFRESH_SOURCES.length} source(s)`,
);

if (ranSources.length === 0) {
  console.log("refresh-daily · nothing was due today — exit 0, and the workflow will find no diff to commit");
  process.exit(0);
}
if (succeeded.length === 0) {
  console.log("refresh-daily · EVERY due source failed — nothing trustworthy was written. Commit nothing.");
  process.exit(1);
}
if (failed.length > 0) {
  console.log(
    `refresh-daily · PARTIAL: ${failed.map((f) => f.source.id).join(", ")} failed. The healthy sources' data continues to the gate and the commit; this run goes red afterwards (NH31).`,
  );
  process.exit(2);
}
process.exit(0);
