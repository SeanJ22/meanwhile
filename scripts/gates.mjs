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
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readRunProvenance } from "../lib/ops/run-provenance.ts";
import { today } from "./doc-dates.mjs";

/**
 * THE GATE SET. Each entry names the CI job it stands in for, so a failure
 * here points at the check that would have failed there.
 *
 * ORDER IS DELIBERATE and it is not the workflow's order:
 *
 *  - The CHEAP, HIGH-SIGNAL gates go first. Lint is 25 seconds and it is the
 *    one that was missing; a session that has broken it learns so before
 *    spending ten minutes on two builds. The three canonical-state checkers
 *    added on 2026-08-29 are cheaper still — 3.8s, 1.1s and 1.1s measured —
 *    and sit immediately behind the type check for that reason.
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
  /*
   * THE THREE CANONICAL AUTHORITIES, MADE EXPLICIT IN THE DOOR (2026-08-29).
   *
   * `governance:check`, `orchestration:check` and `method:check` were enforced
   * only INDIRECTLY, by tests that assert things about their subject matter.
   * That is not the same as running them, and the difference is the RO04 shape
   * exactly: a session can run every gate it knows about, report all of them
   * green truthfully, and merge a ledger whose generated views are stale.
   *
   * EACH WAS CLASSIFIED BY READING IT, not by assuming from its name:
   *
   *   pnpm governance:check    scripts/governance-check.mts       PURE CHECKER.
   *     Loads the ledger, validates it, and regenerates every view INTO A
   *     TEMPORARY COPY of the tree (`mkdtempSync` + `cpSync`) to compare byte
   *     for byte. Its own comment states why: "a validator that repairs what it
   *     measures cannot report a failure." Nothing under the repository is
   *     written. Exits 1 on any structural issue or stale view.
   *
   *   pnpm orchestration:check scripts/orchestration-check.mts    PURE CHECKER.
   *     Reads `data/workstate/orchestration/*.json`, classifies each plan, and
   *     prints. No `writeFileSync`, no `mkdir`, no git mutation — the only
   *     child process it can spawn is `git for-each-ref` / `git worktree list`
   *     under `--closeout`. A repository with no plan on disk PASSES, so it
   *     costs a single-workstream session nothing.
   *
   *   pnpm method:check        scripts/method-check.mts           PURE CHECKER.
   *     Reads `data/method/knowledge.json` and `conclusions.json`, validates,
   *     prints, exits 1 on any issue. It opens no writer at all.
   *
   * AND THE ONES DELIBERATELY NOT WIRED, NAMED SO THE OMISSION IS NOT READ AS
   * AN OVERSIGHT:
   *
   *   pnpm governance:compile  — a GENERATOR. It writes the views this checker
   *     compares against. Running it as a gate would have CI repair the very
   *     staleness the gate exists to catch, and the run would go green having
   *     destroyed its own evidence (RULING 92, RULING 102).
   *   pnpm governance:accept / governance:import — ledger WRITERS.
   *   pnpm orchestration:closeout — the SAME script with `--closeout`. It is
   *     not a disk writer, and it is still refused here: it reconciles a plan
   *     against artifacts only the running session can observe, it requires
   *     `--plan`, and fed the empty artifact list CI would hand it, it
   *     manufactures "unaccounted work" findings about a session that is not
   *     running. A gate that invents findings is worse than one that is absent.
   *   pnpm method:ingest — rebuilds the method store from the legacy manifest.
   *     It once took the store from 88 routes at v27 to 62 at v0 while
   *     reporting success. It is a writer, and a destructive one.
   *   pnpm workstream:status / :close, pnpm tracker:* — status and close-out
   *     WRITERS. Running one in CI to make a question "covered" would have the
   *     gate mutate canonical work state on every pull request.
   *
   * THEY GO HERE — third, fourth and fifth, ahead of the browser assert and the
   * suite — because they are the cheapest high-signal checks in the set.
   * Measured on this machine: governance:check 3.8s cold and 2.1s warm,
   * orchestration:check 1.1s, method:check 1.1s — against `pnpm test`'s suite
   * and two ~5-minute builds. Six seconds for all three.
   * A session that has left a generated view stale learns it six seconds in
   * rather than ten minutes in.
   */
  {
    id: "governance:check",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm governance:check",
    why: "the ledger is the canonical store, and a generated view that disagrees with its generator is not law (RULING 92, RULING 102)",
  },
  {
    id: "orchestration:check",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm orchestration:check",
    why: "independent executable work serialized with nothing checkable behind it is a process defect (RULING 190)",
  },
  {
    id: "method:check",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm method:check",
    why: "the cumulative route knowledge is what every later jurisdiction inherits; a broken store reads as a project that knows nothing",
  },
  {
    id: "control-plane:gate",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm control-plane:gate",
    why: "RULING 220 puts Level-2 scheduling state in a dedicated database outside lib/db and invisible to db:gate; that exemption must not become ungoverned, so the schema has its own version, applied-version and drift check (Session B, W3.2)",
  },
  {
    id: "state-holdings:check",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm state-holdings:check",
    why: "canonical state holdings cannot regress to the old domain-first layouts",
  },
  {
    id: "state-manifest",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm state-manifest --check",
    why: "each discovered state needs a byte-current answer derived only from committed inputs and durable external observations",
  },
  {
    id: "feedback:sweep",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm feedback:sweep --check",
    why: "an owner pass that a sweep neither processes nor lists as unidentifiable is dropped rather than deferred, and the difference is that a deferral names what it is deferring (Session B, WS2.5)",
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
     * THE SHIPPING INVARIANT (2026-08-28, the P0 schema drift).
     *
     * It sits AFTER the suite and BEFORE the builds, deliberately. The suite
     * already fails when a committed migration declares no phase, which is the
     * cheap half and needs no credential; this is the half that asks
     * production, and there is no point spending ten minutes on two builds for
     * a head whose schema has not been applied.
     *
     * It exits 0 without contacting anything when the change does not touch
     * `lib/db/migrations/` or `lib/db/schema.ts`, so it costs a docs-only
     * session nothing. When it IS applicable and there is no
     * `WTP_PRODUCTION_DATABASE_URL_READONLY` in the environment it exits 2 —
     * COULD NOT TELL, which is a failing gate, because a session changing the
     * schema with no way to ask production genuinely does not know.
     */
    id: "db:gate",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm exec tsx scripts/db-shipping-gate.mts",
    why: "a deploy may not cross its own migrations — 0021 and 0022 shipped ahead of the schema",
  },
  {
    /**
     * THE RELEASE FREEZE (NH273, 2026-08-28, the author's decision).
     *
     * `db:gate` above asks whether production holds what this change ships. This
     * one asks a different question that no other gate asks: whether the LAST
     * post-deploy reading of production came back red, and therefore whether
     * this release may proceed at all.
     *
     * It reads a committed record rather than a database, so it needs no
     * credential and costs nothing. It is scoped by `classifyDeploy`, so a
     * docs-only close-out is never treated as a production release.
     *
     * It lives here rather than in a tenth workflow for a measured reason:
     * `gh api repos/:owner/:repo/deployments` returns 0, so Netlify creates no
     * GitHub Deployment and a `deployment_status` workflow would never fire.
     */
    id: "release:freeze",
    ciJob: "gates (test · lint · tsc)",
    command: "pnpm exec tsx scripts/release-freeze-gate.mts",
    why: "a production-changing release may not ship on top of a DEGRADED production integrity reading",
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
 * **THE ENVIRONMENT VARIABLES THAT CHANGE HOW MANY TESTS EXIST.**
 * (Session C final, Item C.4, 2026-09-01.)
 *
 * A suite total is only comparable against another suite total taken under the
 * same environment, and this repository has already paid for not recording
 * that: **4,555 and 4,562 were both correct measurements of the same test
 * tree**, seven apart, because `tests/control-plane-conformance.test.ts`
 * registers a seventh-per-provider Postgres lane only when
 * `WTP_CONTROL_PLANE_DATABASE_URL` is set — and `pnpm test` does not load
 * `.env.local`. Two sessions reported two numbers and neither could be
 * adjudicated, because a total with no environment beside it is not a
 * denominator, it is an integer.
 *
 * **PRESENCE ONLY. NEVER THE VALUE.** These are connection strings. The record
 * says `SET` or `UNSET` and nothing else — a gate record is committed, and a
 * secret has no business in one.
 *
 * This list is what the project knows NOW, exactly like every other manifest
 * here. A variable that starts gating a lane belongs in it; nothing about the
 * list being short means it is finished.
 */
const SUITE_LANE_ENV = [
  {
    name: "WTP_CONTROL_PLANE_DATABASE_URL",
    gates: "the postgres arm of tests/control-plane-conformance.test.ts — 7 tests",
  },
];

function readSuiteLaneEnv() {
  return Object.fromEntries(
    SUITE_LANE_ENV.map((v) => [
      v.name,
      { present: Boolean(process.env[v.name]), gates: v.gates },
    ]),
  );
}

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
  const nodeProcessesAtStart = countNodeProcesses();
  process.stdout.write(`  ${gate.id} … `);
  let status = "PASS";
  let detail = "";
  let failureKind = null;
  /* The failing test names, when the runner prints any. Recorded, not only printed. */
  let failingTests = [];
  let suiteTotals = null;
  try {
    /*
     * **A PASSING GATE'S SUMMARY IS EVIDENCE TOO, AND IT WAS BEING THROWN
     * AWAY.** (Session C final, Item C.4, 2026-09-01. Measured, not theorised.)
     *
     * `suiteTotals` was parsed ONLY in the `catch` below, so every PASSING run
     * wrote `"suiteTotals": null` — `2026-09-01-01`, `-03`, `-04` and `-06` all
     * did. The only totals this repository has ever persisted came from runs
     * that were RED, which is exactly backwards: the number a close-out quotes
     * is the number from the run it shipped on, and that run is green.
     *
     * The cost was a close-out that could not say how many tests it had. The
     * session report said **4,555**, the pull-request close-out said **4,562**,
     * and no record on disk held either against a green run. Both were true
     * measurements of the SAME test tree — `7514e68e..f2e1aa9b` changes no test
     * file — taken in two different ENVIRONMENTS: the control-plane
     * conformance suite registers a seventh-per-provider Postgres lane only
     * when `WTP_CONTROL_PLANE_DATABASE_URL` is set, `pnpm test` does not load
     * `.env.local`, and 4,555 + 7 = 4,562. A whole lane not running showed up
     * as nothing but a smaller integer nobody could source.
     *
     * So the summary is now read on the SUCCESS path as well, and it carries
     * `suites`, `skipped`, `todo` and `cancelled` beside `tests`/`pass`/`fail`
     * — because "fewer tests registered" is the only shape a skipped lane has,
     * and a record holding only `tests` cannot tell that from a deleted test.
     */
    const out = execSync(gate.command, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(gate.env ?? {}) },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    /* Null for every gate that prints no `node:test` summary. Never invented. */
    suiteTotals = parseSuiteTotals(typeof out === "string" ? out : "");
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
      /*
       * **AN ASSERTION FAILURE THAT NAMES NOTHING IS AS UNACTIONABLE AS AN
       * EARLY ABORT.** (2026-09-01, met head-on.)
       *
       * This filter matched `error TS…`, ESLint's problem count, and TAP's
       * `not ok` — and NOT `node:test`'s own `✖ <name>` lines, which is the
       * only place the failing test's NAME appears. So a real single-test
       * failure inside `pnpm gates` printed `test … FAIL` with `exit 1` under
       * it and nothing else, the record read `ASSERTION_FAILURE` with
       * `4522 pass, 1 fail`, and the run that produced it was gone.
       *
       * The whole point of separating ASSERTION_FAILURE from EARLY_ABORT was
       * that the first kind is evidence about the tree. Evidence you cannot
       * read is not evidence, and a session meeting this had exactly one move
       * left — re-run and hope it reproduces — which is the move the split was
       * supposed to make unnecessary.
       */
      const lines = out
        .split("\n")
        .filter((l) =>
          /error TS\d+|✖ \d+ problems|error {2}Error|Failed to compile|not ok \d/.test(l),
        )
        .slice(0, 6);
      /*
       * The failing test NAMES, kept separately from the line filter above so a
       * suite failure cannot be crowded out of the six-line budget by whatever
       * else the run happened to print.
       */
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
       * **AN EARLY ABORT IS NOT AN ASSERTION FAILURE, AND SAYING SO IS THE
       * WHOLE POINT.** (Part C, 2026-08-31. Measured, not theorised.)
       *
       * `data/ops/gate-runs/2026-08-31-41.json` recorded `test FAIL` at
       * 18d1f808 and no session could ever name a failing test, because there
       * was not one to name. The discriminating measurement is the CLOCK: the
       * failing run took 59s and a complete passing run of the same tree takes
       * 75s. **It failed FASTER than a full run takes.** A suite that fails an
       * assertion still runs to the end and reports `fail N`; this one never
       * reached the summary at all. Under concurrent load on this host — seven
       * parallel agents running installs, builds and suites — a child process
       * dies and `node --test` exits non-zero with nothing to report.
       *
       * That is a FALSE RED, it is reproducible on demand by running the gate
       * under load, and until now the record it wrote was indistinguishable
       * from a real failure. So the record now carries WHICH KIND, derived
       * from the suite's own summary rather than from the exit code:
       *
       *   ASSERTION_FAILURE  a summary was printed and `fail` is above zero
       *   EARLY_ABORT        exit non-zero with NO complete summary, or a
       *                      summary reporting zero failures
       *   UNATTRIBUTED       non-zero, and this gate prints no summary to read
       *
       * `EARLY_ABORT` is never evidence about the tree. A session that meets
       * one RE-RUNS THE GATE ISOLATED before believing it — and may neither
       * ship on it nor record it as green.
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
  /*
   * PRINTED AS WELL AS PERSISTED. A session reading its own run should not have
   * to open the record to learn the denominator it is about to report.
   */
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
/*
 * THE SUITE DENOMINATOR, NAMED ONCE, WHERE A CLOSE-OUT WILL LOOK FOR IT.
 * A run that printed no summary says so rather than printing a number from
 * somewhere else (RULING 184 — a missing measurement is never a measurement).
 */
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
/*
 * **THE GATE RUN RECORD.** (A.1 WI6, 2026-08-30.)
 *
 * The status ledger used to carry hand-typed strings — "suite green in the
 * workstream run that generated this ledger" — as though they were results.
 * They were sentences. Nothing produced them, nothing checked them, and
 * `status:ledger --check` proved only that the Markdown matched the array
 * that held them.
 *
 * A status surface may only be generated from a RECORD of a check actually
 * running. This is that record for the gate set: which gate, which command,
 * what it reported, how long it took, on which tree, at what time. The ledger
 * reads it, and an entry whose check has no record here renders UNPROVEN.
 *
 * Written even when gates FAIL, and that is the point — a record that exists
 * only on success is a record that can only ever say one thing.
 */
writeGateRunRecord(results);

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
  /*
   * `suites`, `skipped`, `todo` and `cancelled` are RECORDED WHEN PRINTED and
   * null when they are not — never defaulted to 0, which would assert a
   * measurement the summary did not make. They are here because `tests` alone
   * cannot distinguish a lane that never registered from tests that were
   * deleted, and that ambiguity is what cost the 4,555-vs-4,562 close-out.
   */
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
 * Cheap, portable and never fatal: a gate run may not fail because the host
 * would not answer a question about itself. Null means UNKNOWN and is recorded
 * as such — a missing measurement is never rendered as zero, which would read
 * as "the host was idle" and is exactly the wrong conclusion to hand the next
 * session reading a false RED.
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

function writeGateRunRecord(results) {
  /* `today()`, not a UTC slice: a UTC slice reads a day ahead of
     America/Phoenix after 5pm local, so a record stamped that way files
     itself under tomorrow and the ledger reads the wrong newest run. */
  const day = today();
  const dir = join(process.cwd(), "data", "ops", "gate-runs");
  mkdirSync(dir, { recursive: true });

  /* Max existing suffix + 1, not a count: a count collides with — and would
     silently overwrite — a surviving record after an earlier one is removed.
     Same rule as `nextRunRecordPath` in lib/health/run-records.ts. */
  let seq = 0;
  const suffix = new RegExp("^" + day + "-(\\d+)\\.json$");
  for (const name of readdirSync(dir)) {
    const m = name.match(suffix);
    if (m) seq = Math.max(seq, Number(m[1]));
  }

  let testedSha = null;
  try {
    testedSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* Not a checkout. Named as unknown, never invented — a fabricated SHA
       would misattribute every reading later derived from this record. */
  }

  const recordPath = join(dir, `${day}-${String(seq + 1).padStart(2, "0")}.json`);
  const record = {
    runId: `gates@${new Date().toISOString()}`,
    testedSha,
    finishedAt: new Date().toISOString(),
    gates: results.map((r) => ({
      id: r.id,
      ciJob: r.ciJob,
      command: r.command,
      status: r.status,
      seconds: Number(r.secs),
      /*
       * WHY IT FAILED, not merely THAT it did. Null on a passing gate.
       * See the EARLY_ABORT note in the runner above: a gate record that
       * stores only `{status, seconds}` cannot tell a real failure from a
       * process killed by host contention, and every reading of one of those
       * has cost a full re-run to attribute.
       */
      failureKind: r.failureKind ?? null,
      failingTests: r.failingTests ?? [],
      suiteTotals: r.suiteTotals ?? null,
      /*
       * HOW BUSY THE HOST WAS. The false RED on the test gate is producible on
       * demand by running it under concurrent load, so the load is recorded
       * beside the result rather than reconstructed from memory afterwards.
       */
      nodeProcessesAtStart: r.nodeProcessesAtStart ?? null,
    })),
    /*
     * WHO RAN THIS, recorded at run time. (Session B WI1.8.)
     *
     * `status-result.ts` derives SESSION_MEASURED vs INDEPENDENTLY_REPRODUCED
     * from this block and from nothing else. Without it every passing gate
     * claimed the stronger class, including this session running gates on its
     * own unmerged branch — the observation RULING 216 excludes by name. A
     * record with no provenance reads SESSION_MEASURED, so this is the field
     * that lets an independent run be recognised, never the field that lets a
     * dependent one claim independence.
     */
    provenance: readRunProvenance(testedSha),
    /*
     * **THE SUITE DENOMINATOR, AT THE TOP OF THE RECORD, WHERE A CLOSE-OUT
     * LOOKS.** (Session C final, Item C.4.)
     *
     * The per-gate `suiteTotals` above is the primary. This is the same thing
     * hoisted, because the question a close-out actually asks is *how many
     * tests did this run have*, and making it hunt through fourteen gate
     * entries for the one that answers is how a report ends up quoting a
     * number from a session's memory instead.
     *
     * **`read: false` IS NOT ZERO, AND THAT DISTINCTION IS THE POINT.** A run
     * whose summary could not be parsed — the EARLY_ABORT case, where a
     * failure shorter than a full pass never reaches the summary at all —
     * records `read: false` with the reason in words. It never records `0`
     * tests, because zero tests is a measurement and "we could not read it" is
     * not. Every counter inside `totals` obeys the same rule: `null` when the
     * runner did not print that line, never a defaulted `0`.
     */
    suiteDenominator: (() => {
      const suite = results.find((r) => r.id === "test");
      if (!suite) return { gate: "test", read: false, reason: "no test gate ran" };
      if (!suite.suiteTotals) {
        return {
          gate: "test",
          read: false,
          reason: "the test gate printed no complete node:test summary this run",
          gateStatus: suite.status,
          failureKind: suite.failureKind ?? null,
        };
      }
      return { gate: "test", read: true, ...suite.suiteTotals };
    })(),
    /*
     * WHICH TEST LANES WERE EVEN ELIGIBLE THIS RUN. Presence, never value.
     * See SUITE_LANE_ENV above: two totals taken under different environments
     * are not comparable, and this is the field that lets a later reader see
     * that rather than conclude tests were deleted.
     */
    suiteLaneEnv: readSuiteLaneEnv(),
  };
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`  gate run record: ${recordPath}`);
}
