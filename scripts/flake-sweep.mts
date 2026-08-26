#!/usr/bin/env tsx
/**
 * `pnpm flake:sweep` — **run the walk N times on ONE unchanged build and
 * classify every check.** (`NH176`, 2026-08-25, Item 13.)
 *
 * ```
 * pnpm flake:sweep            three runs, report only
 * pnpm flake:sweep --runs=4
 * pnpm flake:sweep --write    write docs/walk-flakes.json from the verdict
 * ```
 *
 * **Detection has to be rerun-based.** A check cannot be classified from one
 * run: the evidence that separates a flake from a regression is *fails, then
 * passes, with nothing changed*. Anything less is a guess about which failures
 * matter, and that guess is what `NH176` exists to stop anyone making.
 *
 * **It never rebuilds between runs, deliberately.** The whole claim rests on
 * the tree being identical, so this runs the walk as it stands and states which
 * build it measured. A sweep that rebuilt would be measuring two builds and
 * calling the difference a flake.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { today } from "./doc-dates.mjs";
import { classifyRuns, type RunOutcome } from "../lib/ops/flake-quarantine.ts";

const ROOT = process.cwd();
const RUNS = Number(
  (process.argv.find((a) => a.startsWith("--runs=")) ?? "--runs=3").slice("--runs=".length),
);
const WRITE = process.argv.includes("--write");

/** Parse one walk's stdout into identity → outcome. */
function readRun(output: string): Map<string, RunOutcome> {
  const out = new Map<string, RunOutcome>();
  for (const line of output.split(/\r?\n/)) {
    /*
     * **THE ELAPSED STAMP SITS BETWEEN THE MARK AND THE IDENTITY**
     * (2026-08-26, `NH196`).
     *
     * `walk:all` now prints `  ok   03:46 [g4] …` so a reader can tell a slow
     * run from a stopped one. That put an `mm:ss` token exactly where this
     * parser expected a `[`, and the regex stopped matching every passing and
     * failing line — leaving only the `??` lines, which carry no stamp.
     *
     * **It was caught before it produced anything, and how it would have
     * failed is why it mattered:** the sweep would have read a handful of
     * outcomes per walk, classified almost nothing, and written a quarantine
     * file that read as a clean result. Ninety minutes of walks reporting on
     * checks it never parsed — RULING 159, inside the instrument built to
     * measure flakiness.
     *
     * The stamp is OPTIONAL rather than required, so a walk from before the
     * change and one from after it read identically.
     */
    const m =
      /^\s{2}(ok  |FAIL|QUAR|\?\?  )\s*(?:\d{2}:\d{2}\s+)?(\[[^\]]+\][^—]*?)\s*(?:—.*)?$/.exec(
        line,
      );
    if (!m) continue;
    const mark = m[1].trim();
    const identity = m[2].trim();
    if (!identity.startsWith("[")) continue;
    out.set(
      identity,
      mark === "ok" ? "PASS" : mark === "??" ? "COULD_NOT_RUN" : "FAIL",
    );
  }
  return out;
}

const runs: Map<string, RunOutcome>[] = [];
for (let i = 1; i <= RUNS; i += 1) {
  console.log(`\n=== walk ${i} of ${RUNS} ===`);
  let output = "";
  try {
    /*
     * **`spawnSync`, not `execSync`, and the reason is `NH196`'s** (2026-08-26).
     *
     * `execSync` throws on a non-zero exit and hands the caller stdout on the
     * error — which works, and which also means NOTHING reaches a reader until
     * the walk is over. A walk takes about half an hour. So this script sat
     * silent for half an hour per run, three runs deep, and a reader could not
     * tell it from a hang — the exact ambiguity `walk:all` just stopped having,
     * reintroduced one layer up by its own runner.
     *
     * `spawnSync` does not throw on a non-zero exit, so the failure path stops
     * being an exception carrying data, and the elapsed stamps and heartbeats
     * the walk now prints are echoed as they arrive.
     */
    /*
     * `pnpm.cmd` on Windows rather than `shell: true`. Node deprecates passing
     * args with a shell (DEP0190) because they are concatenated rather than
     * escaped — harmless here, since both args are literals in this file, and
     * still worth not doing: a warning nobody can act on is noise in the one
     * instrument whose whole job is to make a signal legible.
     */
    const result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["run", "walk:all"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    for (const line of output.split(/\r?\n/)) {
      if (/^\s{2}(ok  |FAIL|QUAR|\?\?  |\.\.  )/.test(line)) console.log(`    ${line.trim()}`);
    }
  } catch (error) {
    output = String((error as { stdout?: string }).stdout ?? "");
  }
  const parsed = readRun(output);
  console.log(`  read ${parsed.size} check outcome(s)`);
  runs.push(parsed);
}

const verdicts = classifyRuns(runs);
const flaky = verdicts.filter((v) => v.classification === "FLAKY");
const real = verdicts.filter((v) => v.classification === "REAL");
const healthy = verdicts.filter((v) => v.classification === "HEALTHY");

console.log(`\nFLAKE SWEEP · ${RUNS} run(s) of one unchanged build · ${today()}\n`);
console.log(`  ${healthy.length} HEALTHY · ${flaky.length} FLAKY · ${real.length} REAL · of ${verdicts.length} check(s)\n`);
for (const v of real) console.log(`  REAL   ${v.identity} — failed ${v.failures} of ${v.failures + v.passes}`);
for (const v of flaky) console.log(`  FLAKY  ${v.identity} — failed ${v.failures}, passed ${v.passes}`);

if (!WRITE) {
  console.log("\n  report only. Re-run with --write to record the quarantine.");
  process.exit(0);
}

writeFileSync(
  join(ROOT, "docs", "walk-flakes.json"),
  `${JSON.stringify(
    {
      note:
        "NH176. A check here FAILED AND THEN PASSED on one unchanged build. It is tracked and hunted, never deleted and never counted passing — pnpm walk:all still runs it and prints it as QUARANTINED. Written by pnpm flake:sweep --write; never hand-edited (RULING 92).",
      entries: flaky.map((v) => ({
        identity: v.identity,
        row: "NH176",
        since: today(),
        evidence: `failed ${v.failures} and passed ${v.passes} across ${RUNS} run(s) of one build`,
      })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`\n  wrote docs/walk-flakes.json — ${flaky.length} quarantined`);
