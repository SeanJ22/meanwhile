#!/usr/bin/env tsx
/**
 * THE GATE THAT REFUSES ONE SOURCE'S DATA WITHOUT THROWING AWAY EVERY OTHER
 * SOURCE'S. (2026-09-02, the refresh-failure session; Work Item 1.3.)
 *
 *   corepack pnpm exec tsx scripts/refresh-gate.mts [--suite-log=<path>] [--suite-exit=<code>] [--skip-suite]
 *
 * Runs the full suite over the refreshed tree — or, with `--suite-exit`, reads
 * the outcome of the `corepack pnpm test` the workflow just ran and tee'd to
 * `--suite-log`. Green: every changed source is
 * INGESTED and the record says so. Red: the failing test files are ATTRIBUTED
 * to sources by reverting one source's governed paths at a time and re-running
 * only those files (`lib/ops/refresh-gate.ts` decides); culprits go back to
 * HEAD and into `data/ops/refresh-debt.json`, survivors stay for the commit,
 * and `docs/refresh-run.json` is rewritten with the final outcomes.
 *
 * ## What it never does
 *
 * It never exits non-zero for a refusal. The commit step must still run —
 * survivors and the debt file are both owed to `main` — and the workflow goes
 * red afterwards from `gate_refused=true`. It exits non-zero only when IT
 * could not do its job: no run record, no git, a suite that would not start.
 * A tree-level red (a failure that no source's revert fixes) refuses every
 * changed source and says so — nothing is committed under a red the data did
 * not cause — but still exits 0 so the debt lands.
 *
 * The suite's output is tee'd to `--suite-log` (default `$WTP_JOB_LOG`, then
 * `$RUNNER_TEMP/gate.log`), which is what `pnpm diagnose` reads first: a job
 * cannot fetch its own log from the API while it is still running.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { regenerateStaleDependents, spawningRunner } from "../lib/ops/generated-freshness.ts";
import { REFRESH_SOURCES, utcDay } from "../lib/ops/refresh-cadence.ts";
import { attributeFailures, failingTestFiles, refusalReason, type RevertTrial } from "../lib/ops/refresh-gate.ts";
import {
  clearDebt,
  dayAfter,
  readDebt,
  readRefreshRun,
  recordDebt,
  writeDebtIfChanged,
  writeRefreshRun,
  type RefreshRun,
} from "../lib/ops/refresh-report.ts";
import { today } from "./doc-dates.mjs";
import { changedFilesUnder, revertFilesToHead } from "./lib/refresh-revert.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const skipSuite = argv.includes("--skip-suite");
const suiteLog =
  argv.find((a) => a.startsWith("--suite-log="))?.slice("--suite-log=".length) ??
  process.env.WTP_JOB_LOG?.trim() ??
  join(process.env.RUNNER_TEMP ?? tmpdir(), "gate.log");
/**
 * `--suite-exit=N`: the workflow already ran `corepack pnpm test` — literally,
 * so `tests/workflow-actions.test.ts` can see every governed-artifact refresh
 * gating on the same suite — and tee'd it to `--suite-log`. This script then
 * attributes from that log rather than running the suite a second time.
 */
const suiteExitArg = argv.find((a) => a.startsWith("--suite-exit="))?.slice("--suite-exit=".length);
const suiteExit = suiteExitArg === undefined ? null : Number(suiteExitArg);
if (suiteExit !== null && !Number.isInteger(suiteExit)) {
  console.error(`refresh-gate: --suite-exit=${suiteExitArg} is not an exit code`);
  process.exit(1);
}

function cannotRun(why: string): never {
  console.error(`\nrefresh-gate: CANNOT RUN — ${why}`);
  console.error("  This is a fact about the gate, not about the data. Nothing is committed.");
  process.exit(1);
}

const run = readRefreshRun(ROOT);
if (!run) cannotRun("docs/refresh-run.json does not exist — the orchestrator did not write its record");

const dayName = today();
const utcToday = utcDay(new Date());
const output = (key: string, value: string) => {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${key}=${value}\n`);
  console.log(`refresh-gate: ${key}=${value}`);
};

/* -------------------------------------------------------------------------- */
/* GIT                                                                         */
/* -------------------------------------------------------------------------- */

function git(args: string[]): string {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) cannotRun(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

/** Governed paths that differ from HEAD: tracked modifications and untracked additions, each marked. */
function changedUnder(paths: readonly string[]): { path: string; untracked: boolean }[] {
  return changedFilesUnder(git, paths);
}

/** A source's refreshed bytes, set aside so its paths can be put back after a trial. */
interface Stash {
  dir: string;
  files: { path: string; untracked: boolean }[];
}

function stashAway(files: { path: string; untracked: boolean }[]): Stash {
  const dir = mkdtempSync(join(tmpdir(), "refresh-gate-"));
  for (const f of files) {
    const from = join(ROOT, f.path);
    if (!existsSync(from)) continue;
    const to = join(dir, f.path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
  return { dir, files };
}

/** Put a source's governed paths at HEAD: tracked files checked out, untracked ones removed. */
function revertToHead(files: { path: string; untracked: boolean }[]): void {
  revertFilesToHead(git, ROOT, files);
}

function restore(stash: Stash): void {
  for (const f of stash.files) {
    const from = join(stash.dir, f.path);
    if (!existsSync(from)) continue;
    const to = join(ROOT, f.path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
  rmSync(stash.dir, { recursive: true, force: true });
}

/* -------------------------------------------------------------------------- */
/* RUNNING TESTS                                                               */
/* -------------------------------------------------------------------------- */

const pnpmCmd = process.platform === "win32" ? "corepack.cmd" : "corepack";

/** The whole suite, tee'd to the log file. Returns the exit code and what it printed. */
function runSuite(): { code: number; text: string } {
  mkdirSync(dirname(suiteLog), { recursive: true });
  const r = spawnSync(pnpmCmd, ["pnpm", "test"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  writeFileSync(suiteLog, text, "utf8");
  process.stdout.write(text);
  if (r.error) cannotRun(`the suite would not start: ${r.error.message}`);
  return { code: r.status ?? -1, text };
}

/** Only the named test files, the way `pnpm test` runs them. Returns the files that PASSED. */
function runFiles(files: readonly string[]): { passing: string[]; failing: string[] } {
  const r = spawnSync(
    process.execPath,
    ["--test", "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", ...files],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  appendFileSync(suiteLog, `\n\n===== refresh-gate trial: ${files.join(" ")} =====\n${text}`);
  const failing = r.status === 0 ? [] : failingTestFiles(text);
  // A non-zero exit that named no file failed for a reason outside any test —
  // every file in the trial is counted as still failing, never as passing.
  const failedSet = new Set(r.status === 0 ? [] : failing.length > 0 ? failing : files);
  return { passing: files.filter((f) => !failedSet.has(f)), failing: [...failedSet] };
}

/* -------------------------------------------------------------------------- */
/* THE GATE                                                                    */
/* -------------------------------------------------------------------------- */

const changedBySource = new Map(
  run.sources
    .filter((s) => s.ran)
    .map((s) => [s.id, changedUnder(s.governs)] as const)
    .filter(([, files]) => files.length > 0),
);
const changedSources = [...changedBySource.keys()];

// RULING 159: the count carries its denominator. A record in which no source
// ran is a gate with nothing to gate, and it says so rather than "0 changed".
const ranCount = run.sources.filter((s) => s.ran).length;
console.log(
  `refresh-gate · ${dayName} · ${floorLine(
    floored("changed sources", "the sources that ran", ranCount, changedSources.length, ranCount === 0 ? "no source ran this run" : undefined),
  )}: ${changedSources.join(", ") || "none"}`,
);
console.log(`  suite log: ${suiteLog}`);

const ranAt = new Date().toISOString();
const suite = skipSuite
  ? { code: 0, text: "" }
  : suiteExit === 0
    ? { code: 0, text: "" }
    : suiteExit !== null && existsSync(suiteLog)
      ? { code: suiteExit, text: readFileSync(suiteLog, "utf8") }
      : runSuite();
if (suiteExit !== null && suiteExit !== 0 && !existsSync(suiteLog)) {
  // The workflow's own `corepack pnpm test` step is kept literal and un-tee'd
  // (tests/workflow-actions.test.ts reads it), so on a red day the suite is
  // run once more HERE, tee'd, to learn which files refused. Said out loud.
  console.log(`refresh-gate · the suite exited ${suiteExit} and no tee'd log exists at ${suiteLog}; it was re-run above to name the failing files`);
}
let debt = readDebt(ROOT, dayName);

/*
 * RL-3 (2026-09-05): a source whose holding change the Reader proof renewal
 * could not prove was refused BEFORE the suite ran (scripts/refresh-reader-
 * renewal.mts); its governed paths are already at HEAD. It is recorded here
 * — ROUTE_UNREAD, owed, by name — on the green path and the red path alike,
 * so the survivors' verdict never hides the refusal and the run goes red.
 */
const runRecord = run;
const renewalRefused = runRecord.renewal?.verdict === "FAILED" ? runRecord.renewal.refusedSources : [];
function applyRenewalRefusals(): void {
  for (const refused of renewalRefused) {
    const s = runRecord.sources.find((row) => row.id === refused.id);
    if (!s) continue;
    s.outcome = "ROUTE_UNREAD";
    s.reason = refused.why;
    s.changedPaths = [];
    s.nextDueAt = dayAfter(utcToday);
    debt = recordDebt(debt, { sourceId: s.id, reason: refused.why, today: dayName, nextDueAt: dayAfter(utcToday) });
  }
  if (renewalRefused.length > 0) console.log(`\nrefresh-gate · the Reader proof renewal refused ${renewalRefused.length} source(s): ${renewalRefused.map((r) => r.id).join(", ")}`);
}

const finalise = (next: RefreshRun, refused: boolean): void => {
  // REGENERATE STALE PURE DEPENDENTS OF THE FINAL SURVIVOR TREE (2026-09-03).
  //
  // A survivor source may have changed an input to a registered PURE generator
  // (a candidate ballot feeds `state-manifest` and the questionnaire) without
  // regenerating the dependent, and — on a REFUSED path — a reverted source may
  // have left a dependent stale relative to the tree that will actually commit.
  // Either way, a stale dependent would be refused at the push door
  // (`lib/ops/generated-freshness.ts`), so the daily refresh could never LAND a
  // candidate change. Regenerating here, from the final tree, is the positive
  // half of that guard: the dependents that ship are current against the inputs
  // that ship. It is deterministic (PURE generators over committed inputs) and
  // read-first (only stale ones are rewritten).
  const runner = spawningRunner(ROOT);
  const regen = regenerateStaleDependents({
    runCheck: runner,
    runGen: (command) => runner(command),
    log: (line) => console.log(line),
  });
  if (regen.regenerated.length > 0) {
    console.log(`refresh-gate · regenerated ${regen.regenerated.length} stale dependent path(s) before commit`);
  }
  if (regen.failed.length > 0) {
    for (const f of regen.failed) {
      console.error(`refresh-gate · a dependent generator FAILED to regenerate: \`${f.command}\`\n${f.output}`);
    }
    cannotRun(
      `a registered PURE dependent could not be regenerated (${regen.failed.map((f) => f.command).join(", ")}); ` +
        "nothing is committed under a tree whose generated invariants cannot be made green.",
    );
  }
  writeRefreshRun(ROOT, next, REFRESH_SOURCES);
  const debtMoved = writeDebtIfChanged(ROOT, debt, dayName);
  console.log(`\nrefresh-gate · wrote docs/refresh-run.json and docs/refresh-run.md${debtMoved ? "; data/ops/refresh-debt.json moved" : ""}`);
  for (const s of next.sources) {
    if (s.ran) console.log(`  ${s.outcome.padEnd(13)} ${s.id.padEnd(12)} ${s.reason}`);
  }
  output("gate_refused", refused ? "true" : "false");
  output("refused_sources", next.sources.filter((s) => s.ran && s.outcome === "ROUTE_UNREAD").map((s) => s.id).join(","));
};

if (suite.code === 0) {
  for (const s of run.sources) {
    if (s.ran && s.outcome === "INGESTED") {
      s.reason = `ran clean; ${s.changedPaths.length} governed path(s) changed and the gate passed — committed`;
      debt = clearDebt(debt, s.id);
    }
  }
  run.gate = {
    verdict: "GREEN",
    ranAt,
    failingFiles: [],
    attribution: [],
    note: "The full suite passed over every changed source's data together. Everything that changed commits." + (renewalRefused.length > 0 ? ` The Reader proof renewal refused ${renewalRefused.length} source(s) before the suite ran; see the renewal section.` : ""),
  };
  applyRenewalRefusals();
  run.finishedAt = new Date().toISOString();
  finalise(run, renewalRefused.length > 0);
  process.exit(0);
}

const failing = failingTestFiles(suite.text);
console.log(`\nrefresh-gate · the suite is RED (exit ${suite.code}); ${failing.length} failing test file(s): ${failing.join(", ") || "(none named)"}`);

const stashes = new Map<string, Stash>();
const trials: RevertTrial[] = [];
if (failing.length > 0) {
  for (const id of changedSources) {
    const files = changedBySource.get(id)!;
    console.log(`\nrefresh-gate · trial: ${id} reverted to HEAD (${files.length} path(s)) — re-running ${failing.length} file(s)`);
    const stash = stashAway(files);
    revertToHead(files);
    try {
      const r = runFiles(failing);
      trials.push({ sourceId: id, passing: r.passing });
      console.log(`  with ${id} at HEAD: ${r.passing.length} pass, ${r.failing.length} still fail`);
    } finally {
      restore(stash);
    }
  }
}

// The all-reverted trial runs only when a single revert left something unexplained.
const explained = new Set(trials.flatMap((t) => t.passing));
let allRevertedPassing: string[] | null = null;
if (failing.some((f) => !explained.has(f)) && changedSources.length > 1) {
  console.log(`\nrefresh-gate · trial: EVERY changed source reverted to HEAD — re-running ${failing.length} file(s)`);
  for (const id of changedSources) {
    const files = changedBySource.get(id)!;
    stashes.set(id, stashAway(files));
    revertToHead(files);
  }
  try {
    allRevertedPassing = runFiles(failing).passing;
    console.log(`  with everything at HEAD: ${allRevertedPassing.length} pass`);
  } finally {
    for (const stash of stashes.values()) restore(stash);
  }
} else if (failing.some((f) => !explained.has(f)) && changedSources.length === 1) {
  // One changed source, already tried alone: its trial IS the all-reverted trial.
  allRevertedPassing = [...(trials[0]?.passing ?? [])];
}

const verdict = attributeFailures({ failing, changedSources, trials, allRevertedPassing });
console.log(`\nrefresh-gate · verdict ${verdict.verdict}; culprits: ${verdict.culprits.join(", ") || "none"}; survivors: ${verdict.survivors.join(", ") || "none"}`);
for (const a of verdict.byFile) console.log(`  ${a.file} -> ${a.sourceId ?? "the tree"} — ${a.basis}`);

/*
 * Culprits' governed paths go back to HEAD for good; on a TREE_RED or an
 * UNNAMED failure every changed source does, because nothing about any
 * source's data was proved and a red the data did not cause may not carry it.
 */
const refuse = verdict.verdict === "ATTRIBUTED" ? new Set(verdict.culprits) : new Set(changedSources);
for (const id of refuse) revertToHead(changedBySource.get(id)!);

for (const s of run.sources) {
  if (!s.ran) continue;
  if (refuse.has(s.id)) {
    s.outcome = "ROUTE_UNREAD";
    s.reason =
      verdict.verdict === "ATTRIBUTED"
        ? refusalReason(s.id, verdict.byFile)
        : verdict.verdict === "UNNAMED"
          ? `the suite failed (exit ${suite.code}) without naming a test file, so nothing could be attributed — its governed paths are back at HEAD and it is owed until it lands`
          : `the suite is red independent of any source's data (${verdict.treeFiles.join(", ")}) — nothing commits under a red the refresh did not cause; its governed paths are back at HEAD and it is owed until it lands`;
    s.changedPaths = [];
    s.nextDueAt = dayAfter(utcToday);
    debt = recordDebt(debt, { sourceId: s.id, reason: s.reason, today: dayName, nextDueAt: dayAfter(utcToday) });
  } else if (s.outcome === "INGESTED") {
    s.reason = `ran clean; the failing files pass with this source's data present — committed`;
    debt = clearDebt(debt, s.id);
  }
}

run.gate = {
  verdict: "REFUSED",
  ranAt,
  failingFiles: failing,
  attribution: verdict.byFile,
  note:
    verdict.verdict === "ATTRIBUTED"
      ? `The suite refused ${verdict.culprits.length} source(s): ${verdict.culprits.join(", ")}. Their governed paths are back at HEAD and they are owed (data/ops/refresh-debt.json). ${verdict.survivors.length} survivor(s) commit: ${verdict.survivors.join(", ") || "none"}.`
      : verdict.verdict === "UNNAMED"
        ? `The suite failed (exit ${suite.code}) and named no failing test file. Nothing could be attributed, so every changed source is refused and owed.`
        : `The suite is red independent of the refreshed data — ${verdict.treeFiles.join(", ")} fail with every changed source at HEAD. That is a defect on main, not a source's; nothing commits under it, and every changed source is owed until the tree is green.`,
};
applyRenewalRefusals();
run.finishedAt = new Date().toISOString();
finalise(run, true);
process.exit(0);
