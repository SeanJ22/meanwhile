/**
 * The local gate set: the commands CI requires (`.github/workflows/build-check.yml`).
 *
 * Every gate runs, even after one fails (`if: always()` in the workflow), and
 * each is reported by name with its own result. There is no skip flag.
 *
 *   pnpm gates              run every gate, report each, exit non-zero on any failure
 *   pnpm gates --list       print the gate set and exit
 */

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

import { runPreflight } from "./preflight.mjs";

/**
 * The gate set. Each entry names the CI job it stands in for.
 *
 * Order: cheap, high-signal gates first; `test:bundle` scans the built client
 * chunks, so it follows the default build; the standalone build goes last
 * because it overwrites `.next` with a differently-traced output.
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
    /*
     * After the suite and before the builds: no point building a head whose
     * schema has not been applied. It exits 0 without contacting anything when
     * the change does not touch the schema contract, and exits 2 (COULD NOT
     * TELL, a failing gate) when it is applicable and no read-only production
     * credential is set.
     */
    id: "db:gate",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm exec tsx scripts/db-shipping-gate.mts",
    why: "a deploy may not cross its own migrations — 0021 and 0022 shipped ahead of the schema",
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
 * Run before the gate set, and by CI before anything. Not a gate: a failure
 * here stops the run, so it is kept out of `GATES`, where everything runs and
 * reports.
 */
export const PRECONDITIONS = [
  {
    id: "preflight",
    ciJob: "every required job, before its first expensive step",
    command: "node scripts/preflight.mjs",
    why: "the cheap deterministic checks: a tree the sweeps can see, and no unrecorded duplicate implementation",
  },
];

/** Nothing below runs on import: tests import `GATES`, and running the gates would exit their process. */
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

/* `tsconfig.tsbuildinfo` cleared first: a warm incremental type check can skip a just-written file. */
try {
  rmSync("tsconfig.tsbuildinfo", { force: true });
} catch {
  /* absent is the normal case and is not a failure */
}

console.log("local gates — the set CI requires (RULING 155)\n");

/*
 * The cheap tier runs first, and the expensive tier is not run on a head that
 * failed it: the preflight reports every check by name, and one of them is that
 * the tree being judged is the tree that would be committed.
 */
{
  const started = Date.now();
  const preflight = runPreflight();
  const failed = preflight.filter((c) => !c.ok);
  const seconds = Math.round((Date.now() - started) / 10) / 100;
  if (failed.length > 0) {
    console.log(
      `\n  preflight REFUSED in ${seconds}s — ${failed.map((c) => c.id).join(", ")}.\n` +
        "  The expensive tier was not run on this tree. Fix the above and run `pnpm gates` again;\n" +
        "  the corrected tree runs every gate before anything may ship.\n",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  preflight … PASS (${seconds}s) — ${preflight.length} cheap check(s) clean\n`);
}

const results = [];
for (const gate of GATES) {
  const started = Date.now();
  const nodeProcessesAtStart = countNodeProcesses();
  process.stdout.write(`  ${gate.id} … `);
  let status = "PASS";
  let detail = "";
  let failureKind = null;
  /* The failing test names, when the runner prints any. Recorded, not only printed. */
  let failingTests = [];
  let suiteTotals = null;
  try {
    /* The suite summary is read on the success path too. */
    const out = execSync(gate.command, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(gate.env ?? {}) },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    /* Null for every gate that prints no `node:test` summary. Never invented. */
    suiteTotals = parseSuiteTotals(typeof out === "string" ? out : "");
  } catch (error) {
    /* A gate that could not run is not a gate that refused. */
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    /*
     * No exit status means the command never ran. A nested pnpm refusing on
     * its version guard (run through corepack) is also CANNOT RUN. Matched
     * against the head of the output only: a failing test's diff can contain
     * the same patterns as text.
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
      /* `node:test`'s `✖ <name>` lines are the only place a failing test's name appears. */
      const lines = out
        .split("\n")
        .filter((l) =>
          /error TS\d+|✖ \d+ problems|error {2}Error|Failed to compile|not ok \d/.test(l),
        )
        .slice(0, 6);
      /* Kept apart from the six-line budget above. */
      failingTests = [
        ...new Set(
          out
            .split("\n")
            .map((l) => /^\s*✖\s+(?!\d+ problems)(.+?)(?:\s+\([\d.]+ms\))?\s*$/.exec(l)?.[1])
            .filter((n) => n && n !== "failing tests:"),
        ),
      ].slice(0, 10);
      if (lines.length) detail += `\n${lines.map((l) => `        ${l.trim()}`).join("\n")}`;
      if (failingTests.length) {
        detail += `\n${failingTests.map((n) => `        ✖ ${n}`).join("\n")}`;
      }
      /*
       *   ASSERTION_FAILURE  a summary was printed and `fail` is above zero
       *   EARLY_ABORT        exit non-zero with NO complete summary, or a
       *                      summary reporting zero failures (a killed child
       *                      under host load; never evidence about the tree)
       *   UNATTRIBUTED       non-zero, and this gate prints no summary to read
       */
      suiteTotals = parseSuiteTotals(out);
      if (suiteTotals === null) {
        failureKind = /^\s*(?:ℹ|#)\s*(?:tests|pass|fail)\b/m.test(out)
          ? "EARLY_ABORT"
          : "UNATTRIBUTED";
      } else if (suiteTotals.fail > 0) {
        failureKind = "ASSERTION_FAILURE";
      } else {
        failureKind = "EARLY_ABORT";
      }
    }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`${status} (${secs}s)`);
  if (detail) console.log(`      ${detail}`);
  if (status === "PASS" && suiteTotals) {
    const extra = ["suites", "skipped", "todo", "cancelled"]
      .filter((k) => suiteTotals[k] !== null && suiteTotals[k] !== undefined)
      .map((k) => `${k} ${suiteTotals[k]}`);
    console.log(
      `      summary: tests ${suiteTotals.tests}, pass ${suiteTotals.pass}, ` +
        `fail ${suiteTotals.fail}${extra.length ? `, ${extra.join(", ")}` : ""}`,
    );
  }
  if (failureKind === "EARLY_ABORT") {
    console.log(
      `      EARLY ABORT — exit non-zero with no failing test named` +
        (suiteTotals
          ? ` (the summary says tests ${suiteTotals.tests}, pass ${suiteTotals.pass}, fail ${suiteTotals.fail})`
          : " (no complete summary was printed at all)") +
        `.\n      ${nodeProcessesAtStart === null ? "Host node-process count unavailable" : `${nodeProcessesAtStart} node process(es) were running on this host when the gate started`}.` +
        `\n      This is NOT evidence about the tree. Re-run this gate ISOLATED before` +
        `\n      believing it. Do not ship on it, and do not record it as green.`,
    );
  }
  results.push({ ...gate, status, secs, failureKind, failingTests, suiteTotals, nodeProcessesAtStart });
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
/* A run that printed no summary says so rather than printing a number. */
{
  const suite = results.find((r) => r.id === "test");
  if (suite?.suiteTotals) {
    console.log(
      `  suite denominator: ${suite.suiteTotals.tests} tests registered ` +
        `(${suite.suiteTotals.pass} pass, ${suite.suiteTotals.fail} fail` +
        (suite.suiteTotals.skipped === null ? "" : `, ${suite.suiteTotals.skipped} skipped`) +
        `) — this run, this environment`,
    );
  } else if (suite) {
    console.log(
      `  suite denominator: NOT MEASURED — the test gate printed no summary this run`,
    );
  }
}
process.exitCode = bad.length ? 1 : 0;
}

/**
 * `node --test`'s own summary, or null when it never printed one.
 *
 * Both reporters are read: the spec reporter prefixes with `ℹ`, TAP with `#`.
 * Null is the load-bearing answer — a non-zero exit with NO summary is a run
 * that never reached the end, which is a different fact from a run that
 * reached the end and reported failures.
 */
function parseSuiteTotals(out) {
  const field = (name) => {
    const m = new RegExp(`^\\s*(?:ℹ|#)\\s*${name}\\s+(\\d+)\\s*$`, "m").exec(out);
    return m ? Number(m[1]) : null;
  };
  const tests = field("tests");
  const pass = field("pass");
  const fail = field("fail");
  if (tests === null || pass === null || fail === null) return null;
  /* The optional counters are null when not printed, never defaulted to 0. */
  return {
    tests,
    pass,
    fail,
    suites: field("suites"),
    skipped: field("skipped"),
    todo: field("todo"),
    cancelled: field("cancelled"),
  };
}

/**
 * How many `node` processes are on this host right now, or null.
 *
 * Never fatal; null means unknown, never zero.
 */
function countNodeProcesses() {
  try {
    if (process.platform === "win32") {
      const out = execSync('tasklist /FI "IMAGENAME eq node.exe" /NH /FO CSV', {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      });
      return out.split("\n").filter((l) => /^"node\.exe"/i.test(l.trim())).length;
    }
    const out = execSync("ps -eo comm=", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    return out.split("\n").filter((l) => /(^|\/)node$/.test(l.trim())).length;
  } catch {
    return null;
  }
}
