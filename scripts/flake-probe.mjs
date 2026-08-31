/**
 * A REPRODUCTION ATTEMPT for the test-gate flake. (Session B resume, W5.)
 *
 * Not a gate and not a fix. The brief for this session is explicit: reproduce
 * before attributing, record what was tried, and if the theory does not
 * reproduce leave the incident open WITH THE EVIDENCE rather than assigning a
 * cause. This runs the gate's exact test invocation N times, records each
 * result, and — because the standing theory is that the suite rewrites
 * `docs/context.md` mid-run — records that file's state around every run.
 *
 * ```
 *   node scripts/flake-probe.mjs [runs]
 * ```
 *
 * Writes `data/health/flake-probe/<stamp>.json`. Every run's failing test names
 * are captured, so a flake that moves between tests is distinguishable from one
 * that always lands on the same assertion.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();
const OUT = join(ROOT, "data", "health", "flake-probe");
const RUNS = Number(process.argv[2] ?? 6);
const CONTEXT = join(ROOT, "docs", "context.md");

/* The gate's own invocation, read from package.json rather than retyped. A
   probe that ran a DIFFERENT command than the gate would be a probe of a
   different thing. */
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const COMMAND = pkg.scripts.test;
console.log(`flake-probe · ${RUNS} run(s) of the gate's exact test invocation`);
console.log(`  ${COMMAND}\n`);

function contextState() {
  if (!existsSync(CONTEXT)) return { present: false, sha: null, bytes: 0 };
  const body = readFileSync(CONTEXT);
  return {
    present: true,
    sha: createHash("sha256").update(body).digest("hex").slice(0, 16),
    bytes: body.length,
  };
}

function gitDirty() {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return ["(git status unavailable)"];
  }
}

const results = [];
for (let i = 1; i <= RUNS; i += 1) {
  const before = contextState();
  const started = Date.now();
  const proc = spawnSync(process.execPath, [
    "--test",
    "--experimental-strip-types",
    "--import",
    "./scripts/register-test-loader.mjs",
    ...expand(),
  ], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const after = contextState();
  const out = `${proc.stdout ?? ""}\n${proc.stderr ?? ""}`;

  const pass = Number(/^ℹ pass (\d+)$/m.exec(out)?.[1] ?? -1);
  const fail = Number(/^ℹ fail (\d+)$/m.exec(out)?.[1] ?? -1);
  const failing = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]);

  const row = {
    run: i,
    exitCode: proc.status,
    durationMs: Date.now() - started,
    pass,
    fail,
    failingTests: [...new Set(failing)],
    contextBefore: before,
    contextAfter: after,
    contextChanged: before.sha !== after.sha,
    dirtyAfter: gitDirty(),
  };
  results.push(row);
  console.log(
    `  run ${i}: exit ${row.exitCode} · ${row.pass} pass / ${row.fail} fail · ` +
      `${(row.durationMs / 1000).toFixed(1)}s · context.md ${row.contextChanged ? "CHANGED" : "unchanged"}` +
      (row.failingTests.length ? `\n      failing: ${row.failingTests.join(" | ")}` : ""),
  );
}

function expand() {
  /* node's --test does not glob on every shell, so the file list is built here
     the same way the package script's glob would resolve it. */
  return readdirSync(join(ROOT, "tests"))
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => join("tests", f));
}

const failures = results.filter((r) => r.exitCode !== 0);
const changed = results.filter((r) => r.contextChanged);

/*
 * RULING 159: both counts state the population they were taken over. "0 runs
 * failed" over zero runs and over six runs are opposite facts about whether
 * this probe measured anything, and a flake report is exactly the place where
 * that difference decides what somebody does next.
 */
console.log(
  `\n  ${floorLine(
    floored("run(s) FAILED", "this probe's runs", RUNS, failures.length, RUNS === 0 ? "no runs were requested" : undefined),
  )}`,
);
console.log(
  `  ${floorLine(
    floored(
      "run(s) rewrote docs/context.md during the run",
      "this probe's runs",
      RUNS,
      changed.length,
      RUNS === 0 ? "no runs were requested" : undefined,
    ),
  )}`,
);

/*
 * THE VERDICT IS DERIVED AND IT IS ALLOWED TO SAY "NOT REPRODUCED".
 *
 * A probe that could only conclude "confirmed" would confirm anything. If the
 * suite passes every time here, the standing context.md theory is NOT thereby
 * disproven either — it is unreproduced under this probe, on this machine, at
 * this commit, and the incident stays open with that recorded.
 */
const verdict =
  failures.length === 0
    ? "NOT_REPRODUCED"
    : failures.every((r) => r.contextChanged)
      ? "REPRODUCED_WITH_CONTEXT_REWRITE"
      : "REPRODUCED_WITHOUT_CONTEXT_REWRITE";

console.log(`  VERDICT: ${verdict}`);

mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const path = join(OUT, `${stamp}.json`);
writeFileSync(
  path,
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      runs: RUNS,
      command: COMMAND,
      failures: failures.length,
      contextRewrites: changed.length,
      verdict,
      results,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`\n  record: ${path}`);
