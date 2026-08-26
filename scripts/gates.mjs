/**
 * THE LOCAL GATE SET, AND IT IS THE GATE SET CI REQUIRES.
 * (RO04, 2026-08-25. RULING 155.)
 *
 * **The two errors that held `main` red were the instance. This is the class.**
 *
 * `pnpm handoff --ship` calls itself the single door everything merges through,
 * and `pnpm closeout` is RULING 75's gated door. Both ran exactly one command:
 * `pnpm run build`. CI requires three jobs and seven commands. **Lint was in
 * the second set and not the first**, and had never been in the first.
 *
 * So the one-session-0825 run reported passing gates — 2,295/2,295 tests, a
 * green build, a confirmed deploy — and merged twice on that confidence while
 * `pnpm lint` was failing on both merges. **The report was true about every
 * gate it ran.** Nothing anywhere asked it to run the one that was failing.
 * That is not a session being careless; it is a gate set with a hole in it,
 * and every session that used the door inherited the hole.
 *
 * **What this runs is derived from `.github/workflows/build-check.yml`, and
 * `tests/gate-parity.test.ts` is what keeps it derived.** That test reads the
 * workflow, extracts every command the required jobs actually run, and fails
 * if any of them is missing here. The anchor is EXTERNAL (RULING 147): a check
 * that re-derived this list from this list would prove only that the file
 * equals itself, which is what it was already doing when lint fell out.
 *
 * **Every gate runs, even after one fails** — `if: always()` in the workflow,
 * mirrored here. A session gets all seven answers from one run rather than
 * discovering them one merge at a time. And each is REPORTED BY NAME with its
 * own result, because RULING 155 requires the report to name them individually
 * and a summary line cannot be written from a single aggregate boolean.
 *
 * **There is no skip flag**, for the reason the build gate already gives: an
 * escape hatch on a gate is how the gate stops meaning anything.
 *
 *   pnpm gates              run every gate, report each, exit non-zero on any failure
 *   pnpm gates --list       print the gate set and exit (what the parity test reads)
 */

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

/**
 * THE GATE SET. Each entry names the CI job it stands in for, so a failure
 * here points at the check that would have failed there.
 *
 * ORDER IS DELIBERATE and it is not the workflow's order:
 *
 *  - The CHEAP, HIGH-SIGNAL gates go first. Lint is 25 seconds and it is the
 *    one that was missing; a session that has broken it learns so before
 *    spending ten minutes on two builds.
 *  - `test:bundle` scans the BUILT client chunks, so it must follow the
 *    default build that produces them. The workflow says this in as many
 *    words: with no `.next/static` it reports CANNOT RUN and skips.
 *  - The STANDALONE build goes LAST because it overwrites `.next` with a
 *    differently-traced output. Running it before `test:bundle` would have
 *    that check read bytes the deploy does not serve.
 */
const GATES = [
  {
    id: "lint",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm lint",
    why: "the gate that was missing — it is why RO04 exists",
  },
  {
    id: "tsc",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm exec tsc --noEmit",
    why: "a fresh-checkout type check, never behind a build",
  },
  {
    id: "assert:browser",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm run assert:browser",
    why: "RULING 113 — observe the step's product at the step",
  },
  {
    id: "test",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm test",
    why: "the suite, which is every other protection in this repo",
  },
  {
    id: "build",
    ciJob: "build (default)",
    command: "pnpm run build",
    why: "the command netlify.toml gives Netlify",
  },
  {
    id: "test:bundle",
    ciJob: "build (default)",
    command: "pnpm run test:bundle",
    why: "scans the built chunks — needs the build above",
  },
  {
    id: "build:standalone",
    ciJob: "build (standalone)",
    command: "pnpm run build",
    why: "what the Netlify Next runtime plugin actually builds",
    env: { NEXT_PRIVATE_STANDALONE: "true" },
  },
];

export { GATES };

/**
 * **NOTHING BELOW RUNS ON IMPORT, and that guard is load-bearing.**
 *
 * `tests/gate-parity.test.ts` imports `GATES` to compare it against the
 * workflow. Without this check that import RAN THE GATES — and worse, the
 * `process.exit()` at the end of the run killed the test process after the
 * first test, so a four-test file reported `pass 1, fail 0` and a green tick.
 * A suite that exits early reports on the tests it reached, which is the
 * shape RULING 62 exists to catch, arriving through an imported side effect.
 *
 * Caught on the day this file was written, by reading the run's own output
 * rather than its exit status: `test … PASS (1s)` for a 2,295-test suite is
 * not a pass, and `ℹ tests 1` in a file carrying four is not a green run.
 */
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (!invokedDirectly) {
  /* imported for GATES — export only, run nothing */
} else if (process.argv.includes("--list")) {
  for (const g of GATES) console.log(`${g.id}\t${g.ciJob}\t${g.command}`);
} else {
  runGates();
}

function runGates() {

/*
 * `tsconfig.tsbuildinfo` cleared first, for the reason `buildGate()` in
 * handoff.mjs found on 2026-08-16: a warm incremental type check can skip the
 * file a session just wrote, so a build that passed locally failed on Netlify
 * against the same tree. A cold check is the only one that stands in for CI's
 * fresh checkout.
 */
try {
  rmSync("tsconfig.tsbuildinfo", { force: true });
} catch {
  /* absent is the normal case and is not a failure */
}

console.log("local gates — the set CI requires (RULING 155)\n");

const results = [];
for (const gate of GATES) {
  const started = Date.now();
  process.stdout.write(`  ${gate.id} … `);
  let status = "PASS";
  let detail = "";
  try {
    execSync(gate.command, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(gate.env ?? {}) },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (error) {
    /*
     * THE TWO FAILURE MODES STAY APART (RULING 24, and buildGate's own note).
     * A gate that could not RUN is not a gate that refused, and printing them
     * alike is how a broken instrument reads as a broken tree.
     */
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    /*
     * A GATE THAT COULD NOT SPAWN, AND A GATE THAT SPAWNED AND REFUSED.
     *
     * The first test is "no exit status" — the command never ran at all. That
     * catches a missing binary and nothing else.
     *
     * **The second is the one that matters here, and it cost this session a
     * false alarm on its own instrument.** Invoked as `corepack pnpm gates`,
     * corepack's shim goes first on PATH, every nested `pnpm lint` resolves to
     * a DIFFERENT pnpm than `packageManager` pins, and that pnpm refuses on
     * its version guard — *exit 1, in zero seconds, seven times.* Reported as
     * FAIL that reads as a completely broken tree; the tree was clean.
     *
     * `buildGate()` in `handoff.mjs` found this first and its patterns are
     * reused here rather than re-derived (RULING 103 — one shared path). A
     * check that cannot reach its subject must never print like one that did
     * (RULING 24).
     */
    /*
     * **MATCHED AGAINST THE HEAD OF THE OUTPUT, NOT ALL OF IT** — and that
     * narrowing is not fussiness, it is a false positive this session actually
     * produced.
     *
     * When the version guard fires it is the ENTIRE output: nothing else got
     * to run. Searching the whole stream instead found these same patterns
     * inside a FAILING TEST'S DIFF, because the test prints `handoff.mjs`'s
     * source and that source contains the patterns as source text. The suite
     * had genuinely failed, and the gate relabelled it CANNOT RUN — masking a
     * real failure as an instrument problem, which is the mirror of the error
     * this detection exists to prevent and is the worse direction of the two.
     */
    const head = out.split("\n").slice(0, 6).join("\n");
    const couldNotRun = [
      /This project is configured to use [\d.]+ of pnpm/i,
      /Your current pnpm is v/i,
      /command not found|is not recognized as an internal or external command/i,
    ].some((re) => re.test(head));

    if (typeof error.status !== "number" || couldNotRun) {
      status = "CANNOT RUN";
      detail = couldNotRun
        ? "the nested pnpm refused on its version guard — run `pnpm gates`, NOT `corepack pnpm gates`"
        : (error.message?.split("\n")[0] ?? "no exit status");
    } else {
      status = "FAIL";
      detail = `exit ${error.status}`;
      const lines = out
        .split("\n")
        .filter((l) => /error TS\d+|✖ \d+ problems|error {2}Error|Failed to compile|not ok \d/.test(l))
        .slice(0, 6);
      if (lines.length) detail += `\n${lines.map((l) => `        ${l.trim()}`).join("\n")}`;
    }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`${status} (${secs}s)`);
  if (detail) console.log(`      ${detail}`);
  results.push({ ...gate, status, secs });
}

console.log("\n  gate            CI job                        result");
for (const r of results) {
  console.log(`  ${r.id.padEnd(15)} ${r.ciJob.padEnd(29)} ${r.status} (${r.secs}s)`);
}

const bad = results.filter((r) => r.status !== "PASS");
console.log(
  `\n${results.length - bad.length} of ${results.length} gates green` +
    (bad.length ? ` — FAILING: ${bad.map((b) => b.id).join(", ")}` : ""),
);
process.exitCode = bad.length ? 1 : 0;
}
