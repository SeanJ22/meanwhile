/**
 * `scripts/river.mjs` — the streams → river → main path.
 *
 * The decisions are pure and tested directly: status parsing, READY detection,
 * fold order, lock ownership, returns that hold a READY back, GitHub CI's
 * verdict, failing tests read from a CI log and the lane they blame, post-deploy
 * reuse and migration numbering. The git paths are driven end to end against a
 * scratch repository with a local bare `origin` and a stand-in `pnpm`, so fold,
 * migrations, the quick check, release, settle and the lock protocol are
 * exercised with real merges and real fast-forward pushes, and nothing here
 * reaches GitHub.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  FULL_CI_LABEL,
  STALE_LOCK_MS,
  FIFTY_STATES,
  blameLanes,
  countsAsCode,
  decideCi,
  decideLock,
  decideObserve,
  drawZips,
  failingTests,
  foldOrder,
  linesOfCode,
  measureSql,
  migrationProblems,
  missingProofs,
  parseArgs,
  parseStatus,
  pendingReady,
  planMigrationNumbers,
  returnHolds,
  setStatusFields,
  slugOf,
  stepIds,
  usableNow,
  zipsByState,
} from "../scripts/river.mjs";
import { REQUIRED_CONTEXTS } from "../lib/ops/required-contexts.ts";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "river.mjs");
/** The two connection proofs every READY message carries. */
const PROOFS = "Connected end to end: a reader request reaches the new rows.\n\nNext scheduled run: the controlled clock shows the next pass still serves them.";
const NOW = Date.parse("2026-10-04T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

/* -------------------------------------------------------------------------- */
/* Pure decisions                                                             */
/* -------------------------------------------------------------------------- */

const STATUS = [
  "# River status",
  "",
  "build_state: setup",
  "worker: river",
  "lock: none",
  "heartbeat: 2026-10-04T06:05:59Z",
  "",
  "## Launch",
  "",
  "- note: this line is prose, not a field",
  "",
].join("\n");

test("a status file's fields are its key lines before the first section", () => {
  assert.deepEqual(parseStatus(STATUS), {
    build_state: "setup",
    worker: "river",
    lock: "none",
    heartbeat: "2026-10-04T06:05:59Z",
  });
  assert.deepEqual(parseStatus("lock: a\r\nheartbeat: b\r\n"), { lock: "a", heartbeat: "b" });
});

test("writing fields replaces them in place, adds new ones to the block and keeps the rest", () => {
  const written = setStatusFields(STATUS, { lock: "tok-1", heartbeat: "2026-10-04T07:00:00Z", run_id: "r9" });
  assert.equal(written, STATUS
    .replace("lock: none", "lock: tok-1")
    .replace("heartbeat: 2026-10-04T06:05:59Z", "heartbeat: 2026-10-04T07:00:00Z\nrun_id: r9"));
  const crlf = setStatusFields("lock: none\r\nworker: x\r\n", { lock: "t" });
  assert.equal(crlf, "lock: t\r\nworker: x\r\n");
  assert.equal(setStatusFields("# Title\n\nprose\n", { lock: "t" }), "# Title\n\nlock: t\n\nprose\n");
});

test("plan step ids from R, platform and source lanes count as steps", () => {
  assert.deepEqual(stepIds("READY: R2"), ["R2"]);
  assert.deepEqual(stepIds("READY: R2B"), ["R2B"]);
  assert.deepEqual(stepIds("READY: R0"), ["R0"]);
  assert.deepEqual(stepIds("READY: R3-LEGISTAR-MEMBERS"), ["R3-LEGISTAR-MEMBERS"]);
  assert.deepEqual(stepIds("READY: R3-CIVICCLERK"), ["R3-CIVICCLERK"]);
  assert.deepEqual(stepIds("READY: SRC-LS"), ["SRC-LS"]);
  assert.deepEqual(stepIds("READY: SRC-AC"), ["SRC-AC"]);
  assert.deepEqual(stepIds("READY: RB-A1, RB-A10, RB-A11"), ["RB-A1", "RB-A10", "RB-A11"]);
  assert.deepEqual(stepIds("READY: R2B, SRC-LS and DB-09"), ["R2B", "SRC-LS", "DB-09"]);
  assert.deepEqual(stepIds("READY: RB-A1"), ["RB-A1"]);
  assert.deepEqual(stepIds("READY: RB-A10 and RB-A2"), ["RB-A10", "RB-A2"]);
  assert.deepEqual(stepIds("WIP: still working"), []);
});

test("a READY message carries both connection proofs or names the ones it lacks", () => {
  assert.deepEqual(missingProofs(`READY: DB-09\n\n${PROOFS}`), []);
  assert.deepEqual(missingProofs("READY: DB-09\n\nConnected end-to-end through the reader route."), ["still working on the next scheduled run"]);
  assert.deepEqual(missingProofs("READY: DB-09"), ["connected end to end", "still working on the next scheduled run"]);
  assert.deepEqual(missingProofs("READY: PB-01\n\nFeeds into: reader body cards.\n\nControlled next/tomorrow scheduler replays preserve the roster."), []);
  assert.deepEqual(missingProofs("READY: SRC-01\n\nConnection proof 1 — upstream to reader.\n\nConnection proof 2 — next configured run."), []);
  assert.deepEqual(missingProofs("READY: RB-A1\n\nConnection proof 1: reader copy.\n\nNext-run proof: the same reconciliation ran again unchanged."), []);
  assert.deepEqual(missingProofs("READY: CL-01\n\nTwo connection proofs on real production data.\n\nNext-run proof: the scheduled task republishes."), []);
  assert.deepEqual(missingProofs("READY: EX-03\n\nTomorrow proof: the scheduled pass is due."), ["connected end to end"]);
  assert.deepEqual(missingProofs("READY: PK-01\n\nWhat PK-01 feeds: BL-01's ballot controls.\n\nTomorrow-clock connection proof: the next poll syncs."), []);
  assert.deepEqual(missingProofs("READY: NX-02\n\nFeeds: NationalSection.\n\nNext scheduled-run proof: due at the boundary."), []);
});

test("READY subjects name their step ids; the newest READY is folded and later WIP stays behind", () => {
  assert.deepEqual(stepIds("READY: DB-09, DB-10 and RL-03 (again DB-09)"), ["DB-09", "DB-10", "RL-03"]);
  const commits = [
    { sha: "w2", subject: "WIP: DB-12 half done" },
    { sha: "r2", subject: "READY: DB-10" },
    { sha: "x1", subject: "status heartbeat" },
    { sha: "r1", subject: "READY: DB-09" },
    { sha: "r0", subject: "READY: DB-08" },
  ];
  assert.deepEqual(pendingReady({ commits, integrated: new Set() }), {
    ready_sha: "r2", steps: ["DB-08", "DB-09", "DB-10"], wip_after_ready: 1,
  });
  // Already-integrated READY commits, and everything before them, are not carried again.
  assert.deepEqual(pendingReady({ commits, integrated: new Set(["r1"]) }), {
    ready_sha: "r2", steps: ["DB-10"], wip_after_ready: 1,
  });
  assert.equal(pendingReady({ commits, integrated: new Set(["r2"]) }), null);
  assert.equal(pendingReady({ commits: [{ sha: "w", subject: "WIP: not ready: yet" }], integrated: new Set() }), null);
});

test("fold order is registry-first by default, adapters sorted after, unknown lanes last, and can be pinned", () => {
  const lanes = ["frontend", "adapter-legistar", "river", "registry", "adapter-civicplus", "measures", "admin"];
  const expected = ["measures", "registry", "admin", "frontend", "adapter-civicplus", "adapter-legistar", "river"];
  assert.deepEqual(foldOrder(lanes), expected);
  assert.deepEqual(foldOrder(lanes, "dep"), expected);
  assert.deepEqual(foldOrder(lanes, "frontend,adapter-legistar"), [
    "frontend", "adapter-legistar", "measures", "registry", "admin", "adapter-civicplus", "river",
  ]);
});

test("a live lock refuses another owner; a stale one is taken over; ownership change stops a heartbeat", () => {
  const held = (minutes: number | null) => ({ lock: "other", heartbeat: minutes === null ? "none" : minutesAgo(minutes) });
  assert.equal(decideLock({ mode: "claim", fields: { lock: "none" }, token: "me", now: NOW }).write, true);
  assert.equal(decideLock({ mode: "claim", fields: held(44), token: "me", now: NOW }).exit, 3);
  assert.equal(decideLock({ mode: "claim", fields: held(null), token: "me", now: NOW }).exit, 3);
  const stale = decideLock({ mode: "claim", fields: held(STALE_LOCK_MS / 60_000), token: "me", now: NOW });
  assert.equal(stale.write, true);
  assert.equal(stale.takeover, "other");
  assert.equal(decideLock({ mode: "claim", fields: { lock: "me", heartbeat: minutesAgo(5) }, token: "me", now: NOW }).write, true);

  assert.equal(decideLock({ mode: "heartbeat", fields: { lock: "me" }, token: "me", now: NOW }).write, true);
  assert.equal(decideLock({ mode: "heartbeat", fields: held(1), token: "me", now: NOW }).exit, 4);
  assert.equal(decideLock({ mode: "heartbeat", fields: { lock: "none" }, token: "me", now: NOW }).exit, 4);

  assert.deepEqual(decideLock({ mode: "release", fields: { lock: "none" }, token: "me", now: NOW }), { write: false, exit: 0, reason: "lock already free" });
  assert.equal(decideLock({ mode: "release", fields: { lock: "me" }, token: "me", now: NOW }).write, true);
  assert.equal(decideLock({ mode: "release", fields: held(1), token: "me", now: NOW }).exit, 4);
});

test("a lane's open return holds back the same READY, never a new one or a cleared return", () => {
  const sha = "abcdef0123456789abcdef0123456789abcdef01";
  const open = `# Returned: people\n\nlane: people\ncheck: GitHub CI\nready: PE-01 ${sha}\nstate: returned\n\n## Failure\n`;
  assert.equal(returnHolds(open, sha), true);
  assert.equal(returnHolds(open.replace(sha, sha.slice(0, 9)), sha), true, "a short SHA names the same READY");
  assert.equal(returnHolds(open, "1".repeat(40)), false, "a new READY folds");
  assert.equal(returnHolds(open.replace("state: returned", `state: cleared: integrated ready ${sha} on river x`), sha), false);
  assert.equal(returnHolds(open.replace(` ${sha}`, " unknown"), sha), false, "a return that names no READY holds nothing back");
  assert.equal(returnHolds("# Returned to ZS-01: READY 74d3fb7d5\n\nprose only\n", sha), false);
  assert.equal(returnHolds(null, sha), false);
});

test("migrations ship only when the fold's own are numbered and the journal and files name each other", () => {
  const journal = [
    { idx: 0, when: 100, tag: "0000_first" },
    { idx: 1, when: 200, tag: "DB-01_shipped" },
    { idx: 2, when: 300, tag: "0002_db09_place_owed" },
  ];
  const files = ["0000_first.sql", "DB-01_shipped.sql", "0002_db09_place_owed.sql", "meta"];
  assert.deepEqual(migrationProblems({ files, added: ["0002_db09_place_owed.sql"], journal }), [], "a step-named migration river already shipped keeps its name");
  assert.deepEqual(migrationProblems({ files: [...files, "DB-10_new.sql"], added: ["DB-10_new.sql"], journal }), [
    "DB-10_new.sql is still named by step; run migrations",
    "DB-10_new.sql has no journal entry",
  ]);
  assert.deepEqual(migrationProblems({ files: files.filter((name) => name !== "0002_db09_place_owed.sql"), added: [], journal }), [
    "journal entry 0002_db09_place_owed has no 0002_db09_place_owed.sql",
  ]);
  assert.deepEqual(migrationProblems({ files, added: [], journal: [journal[0], { ...journal[2], idx: 1, when: 50 }] }), [
    "journal entry 0002_db09_place_owed is not later than 0000_first",
    "DB-01_shipped.sql has no journal entry",
  ]);
});

test("GitHub CI's verdict waits for every required check, counts only the newest run of each, and names failed jobs", () => {
  assert.deepEqual([...REQUIRED_CONTEXTS], ["build (default)", "build (standalone)", "gates (test · lint · tsc)"]);
  const run = (id: number, name: string, conclusion: string | null, status = "completed") => ({ id, name, status, conclusion });
  const green = [run(10, "build (default)", "success"), run(11, "build (standalone)", "success"), run(12, "gates (test · lint · tsc)", "success")];
  assert.equal(decideCi(green).state, "pass");
  // The run opened before the label was cancelled; the labelled run replaced it.
  assert.equal(decideCi([run(1, "gates (test · lint · tsc)", "cancelled"), run(2, "test (1/4)", "cancelled"), ...green]).state, "pass");
  const running = decideCi([green[0], green[1], run(12, "gates (test · lint · tsc)", null, "in_progress")]);
  assert.deepEqual([running.state, running.waiting], ["pending", ["gates (test · lint · tsc)"]]);
  assert.deepEqual(decideCi([green[0]]).waiting, ["build (standalone)", "gates (test · lint · tsc)"], "a check not reported yet is waited for");
  const red = decideCi([...green.slice(0, 2), run(14, "test (2/4)", "failure"), run(13, "test (1/4)", "success"), run(15, "gates (test · lint · tsc)", "failure")]);
  assert.equal(red.state, "fail");
  assert.deepEqual(red.failed.map((job) => [job.id, job.name]), [[15, "gates (test · lint · tsc)"], [14, "test (2/4)"]]);
  assert.equal(decideCi([...green.slice(0, 2), run(16, "gates (test · lint · tsc)", "skipped")]).state, "fail", "a skipped required check is not a pass");
  const cancelled = decideCi([...green.slice(0, 2), run(17, "gates (test · lint · tsc)", "cancelled"), run(3, "test (${{ matrix.shard }})", "cancelled")]);
  assert.deepEqual([cancelled.state, cancelled.failed], ["fail", []], "a cancelled required check is not a pass; a replaced run's cancelled jobs have no log to read");
});

test("the failing tests are read from a CI job log, with GitHub's timestamps and checkout paths dropped", () => {
  const log = [
    "2026-10-28T05:10:00.1234567Z ✔ passes (1ms)",
    "2026-10-28T05:10:01.0000000Z ✖ failing tests:",
    "2026-10-28T05:10:01.0000000Z ",
    "2026-10-28T05:10:01.0000000Z test at /home/runner/work/meanwhile/meanwhile/tests/people.test.ts:12:3",
    "2026-10-28T05:10:01.0000000Z ✖ a person keeps one card (3.2ms)",
    "2026-10-28T05:10:01.0000000Z   AssertionError [ERR_ASSERTION]: 1 == 2",
    "2026-10-28T05:10:01.0000000Z ",
    "2026-10-28T05:10:01.0000000Z test at tests/ballot/contests.test.tsx:4:1",
    "2026-10-28T05:10:01.0000000Z ✖ tests/ballot/contests.test.tsx (44.9ms)",
    "2026-10-28T05:10:01.0000000Z test at lib/sources/platform-adapters/legistar.test.ts:9:5",
    "2026-10-28T05:10:01.0000000Z ✖ keeps quotes (1ms)",
    "test at /home/runner/work/meanwhile/meanwhile/tests/people.test.ts:12:3",
    "✖ a person keeps one card (3.4ms)",
  ].join("\r\n");
  assert.deepEqual(failingTests(log), [
    { file: "lib/sources/platform-adapters/legistar.test.ts", name: "keeps quotes" },
    { file: "tests/ballot/contests.test.tsx", name: "tests/ballot/contests.test.tsx" },
    { file: "tests/people.test.ts", name: "a person keeps one card" },
  ]);
  assert.deepEqual(failingTests("Error: build failed\n"), []);
});

test("a failing test returns the one lane that changed it or whose change reaches it, and leaves the rest to River", () => {
  const lanes = [
    { lane: "people", changed: ["lib/people.ts", "tests/people.test.ts"] },
    { lane: "ballot", changed: ["lib/ballot.ts"] },
    { lane: "frontend", changed: ["package.json"] },
  ];
  const asked: string[] = [];
  const reaches = (lane: { lane: string }) => {
    asked.push(lane.lane);
    return lane.lane === "frontend" ? "all" as const : new Set(lane.lane === "ballot" ? ["tests/ballot.test.ts"] : ["tests/people.test.ts", "tests/shared.test.ts"]);
  };
  const direct = blameLanes({ tests: ["tests/people.test.ts"], lanes, reaches });
  assert.deepEqual(direct.returned, ["people"], "the lane that changed the failing test file is its cause");
  assert.deepEqual(asked, [], "no import graph is read when a lane changed the test itself");
  const reached = blameLanes({ tests: ["tests/ballot.test.ts"], lanes: lanes.slice(0, 2), reaches });
  assert.deepEqual(reached.returned, ["ballot"]);
  const shared = blameLanes({ tests: ["tests/shared.test.ts", "tests/ballot.test.ts"], lanes, reaches });
  assert.deepEqual(shared.returned, [], "a lane that reaches every test makes each one ambiguous");
  assert.deepEqual(shared.unresolved.map((entry) => [entry.file, entry.suspects]), [
    ["tests/shared.test.ts", ["people", "frontend"]], ["tests/ballot.test.ts", ["ballot", "frontend"]],
  ]);
  const own = blameLanes({ tests: ["tests/unrelated.test.ts"], lanes: lanes.slice(0, 2), reaches });
  assert.deepEqual([own.returned, own.unresolved[0].suspects], [[], []], "a test no folded lane reaches fails on river's own code");
});

test("post-deploy observation reuses a run for the same SHA, retries a failed one, and dispatches only when none covers it", () => {
  const sha = "a".repeat(40);
  const run = (id: number, status: string, conclusion: string | null, head = sha) => ({ id, head_sha: head, status, conclusion });
  assert.equal(decideObserve([run(5, "in_progress", null)], sha).action, "reuse");
  assert.equal(decideObserve([run(5, "queued", null), run(4, "completed", "failure")], sha).run?.id, 5);
  assert.equal(decideObserve([run(4, "completed", "success")], sha).action, "reuse");
  const retry = decideObserve([run(4, "completed", "failure")], sha);
  assert.equal(retry.action, "rerun");
  assert.equal(retry.run?.id, 4);
  // The concurrency group cancels older runs, so a cancelled run covers nothing.
  assert.equal(decideObserve([run(4, "completed", "cancelled")], sha).action, "dispatch");
  assert.equal(decideObserve([run(4, "completed", "success", "b".repeat(40))], sha).action, "dispatch");
  assert.equal(decideObserve([], sha).action, "dispatch");
});

test("step-named migrations are numbered after the journal in fold order, matching its conventions", () => {
  const journal = [
    { idx: 0, version: "7", when: 100, tag: "0000_first", breakpoints: true },
    { idx: 1, version: "7", when: 200, tag: "0001_second", breakpoints: true },
    { idx: 2, version: "7", when: 150, tag: "DB-09_place_owed", breakpoints: true },
  ];
  const plan = planMigrationNumbers({ added: ["DB-09_place_owed.sql", "SC-03-held-votes.sql"], journal, baseCount: 2 });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.renames.map((r) => [r.from, r.to, r.when]), [
    ["DB-09_place_owed.sql", "0002_db09_place_owed.sql", 201],
    ["SC-03-held-votes.sql", "0003_sc03_held_votes.sql", 202],
  ]);
  assert.deepEqual(plan.journal.map((e) => [e.idx, e.tag]), [[0, "0000_first"], [1, "0001_second"], [2, "0002_db09_place_owed"], [3, "0003_sc03_held_votes"]]);
  assert.ok(plan.journal.every((e) => e.version === "7" && e.breakpoints === true));
  assert.equal(slugOf("RL-03_x"), "rl03_x");

  const clash = planMigrationNumbers({ added: ["0001_mine.sql", "0002_a.sql", "0002_b.sql"], journal: journal.slice(0, 2), baseCount: 2 });
  assert.equal(clash.ok, false);
  assert.ok(clash.problems.some((p) => /0001_mine\.sql reuses a number/.test(p)));
  assert.ok(clash.problems.some((p) => /two streams added migration 0002/.test(p)));
});

test("lines of code: tracked source, styles and SQL, counted as wc -l counts newlines", () => {
  for (const path of ["a.ts", "b.tsx", "c.mts", "d.cts", "e.mjs", "f.cjs", "g.js", "h.jsx", "app/x.css", "lib/db/migrations/0001_a.sql"]) assert.ok(countsAsCode(path), path);
  for (const path of ["types.d.ts", "lib/x.min.js", "node_modules/p/i.js", "lib/node_modules/p/i.js", ".next/a.js", "public/vendor/maplibre.js", "a.json", "a.md", "a.tsbuildinfo"]) {
    assert.equal(countsAsCode(path), false, path);
  }
  const repo = mkdtempSync(join(tmpdir(), "river-lines-"));
  try {
    for (const [path, text] of [["a.ts", "1\n2\n"], ["b.css", "no newline"], ["c.sql", "\n\n\n"], ["d.md", "x\ny\n"], ["e.d.ts", "x\n"]]) put(repo, path, text);
    sh(repo, ["init", "--quiet"]);
    sh(repo, ["add", "-A"]);
    sh(repo, ["commit", "--quiet", "-m", "x"]);
    assert.equal(linesOfCode("HEAD", repo), 5);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("ZIP sampling: one random ZIP in each of the 50 states, from the ZIP index", () => {
  const byState = zipsByState(process.cwd());
  assert.equal(FIFTY_STATES.length, 50);
  let calls = 0;
  const drawn = drawZips(byState, () => ((calls += 1) * 0.37) % 1);
  assert.equal(drawn.length, 50);
  assert.equal(new Set(drawn.map((place: { state: string }) => place.state)).size, 50, "50 distinct states");
  assert.equal(new Set(drawn.map((place: { zip: string }) => place.zip)).size, 50);
  for (const { state, zip } of drawn) assert.ok(byState.get(state).includes(zip), `${zip} is a ${state} ZIP`);
  assert.ok(!FIFTY_STATES.includes("DC") && !FIFTY_STATES.includes("PR"));
  assert.notDeepEqual(drawZips(byState).map((place: { zip: string }) => place.zip), drawZips(byState).map((place: { zip: string }) => place.zip), "drawn fresh each time");
  assert.throws(() => drawZips(new Map([["AL", ["35004"]]])), /no ZIP for AK/);
  const sql = measureSql("2026-10-29T06:51:00Z", false);
  assert.match(sql.facts, /f\.status = 'live' AND f\.live_at >= timestamptz '2026-10-29T06:51:00Z' - interval '24 hours'/);
  assert.match(sql.facts, /NOT EXISTS \(SELECT 1 FROM fact p .* p\.value_text = f\.value_text\)/, "a value already shown doesn't count");
  assert.match(sql.facts, /depends @>/, "only facts on a reader's page count");
  for (const after of [false, true]) assert.match(measureSql("2026-10-29T06:51:00Z", after).reads, /sum\(response_bytes\) \/ 1e9/, "only the billed response bytes count");
});

test("arguments: --k v, --k=v and bare boolean flags", () => {
  assert.deepEqual(parseArgs(["claim", "--branch", "board/river", "--token=t", "--heartbeat"]), {
    flags: { branch: "board/river", token: "t", heartbeat: true },
    positional: ["claim"],
  });
});

/* -------------------------------------------------------------------------- */
/* The git paths, against a scratch repository                                */
/* -------------------------------------------------------------------------- */

const IDENTITY = {
  GIT_AUTHOR_NAME: "River Test", GIT_AUTHOR_EMAIL: "river@example.invalid",
  GIT_COMMITTER_NAME: "River Test", GIT_COMMITTER_EMAIL: "river@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
};
/**
 * A stand-in `pnpm` first on PATH: the quick check's lint and type check run
 * through it, each call is logged next to the checkout, and RIVER_TEST_FAIL_LINT
 * makes lint fail.
 */
const FAKE_BIN = mkdtempSync(join(tmpdir(), "river-pnpm-"));
writeFileSync(join(FAKE_BIN, "pnpm"), '#!/bin/sh\necho "$*" >> "$PWD/../pnpm.log"\nif [ "$1" = lint ] && [ -n "$RIVER_TEST_FAIL_LINT" ]; then echo "lint: 1 problem"; exit 1; fi\nexit 0\n', { mode: 0o755 });
test.after(() => rmSync(FAKE_BIN, { recursive: true, force: true }));
const ENV = { ...process.env, ...IDENTITY, GITHUB_TOKEN: "", GH_TOKEN: "", GH_REPOSITORY: "example/meanwhile", PATH: `${FAKE_BIN}:${process.env.PATH}` };

function sh(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function put(cwd: string, path: string, text: string) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), text);
}
function river(cwd: string, ...args: string[]) {
  return riverWith({}, cwd, ...args);
}
function riverWith(env: Record<string, string>, cwd: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: { ...ENV, ...env }, encoding: "utf8" });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}
const remoteSha = (cwd: string, branch: string) => sh(cwd, ["ls-remote", "origin", `refs/heads/${branch}`]).split("\t")[0];
const board = (cwd: string, path: string) => {
  sh(cwd, ["fetch", "--quiet", "origin", "+refs/heads/board/river:refs/remotes/origin/board/river"]);
  return sh(cwd, ["show", `origin/board/river:${path}`]);
};

test("fold, migrations, the quick check, release, settle and the lock protocol work end to end against a real remote", { timeout: 120_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "river-test-"));
  try {
    const origin = join(root, "origin.git");
    const work = join(root, "work");
    const riverCheckout = join(root, "river");
    sh(root, ["init", "--quiet", "--bare", "--initial-branch=main", origin]);
    sh(root, ["clone", "--quiet", origin, work]);
    sh(work, ["checkout", "--quiet", "-b", "main"]);

    // An application tree with one numbered migration.
    const journal = { version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", when: 1000, tag: "0000_first", breakpoints: true }] };
    put(work, "lib/db/migrations/meta/_journal.json", `${JSON.stringify(journal, null, 2)}\n`);
    put(work, "lib/db/migrations/0000_first.sql", "CREATE TABLE a (id int);\n");
    put(work, "lib/db/migration-phases.ts", 'export const MIGRATION_PHASES = {\n  "0000_first": "expand",\n};\n');
    // Code the lanes delete, so their releases keep the code the same size or smaller.
    put(work, "lib/old.ts", "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n");
    for (const lane of ["ballot", "people"]) put(work, `lib/old-${lane}.ts`, "export const old = 1;\n");
    sh(work, ["add", "-A"]);
    sh(work, ["commit", "--quiet", "-m", "base"]);
    sh(work, ["push", "--quiet", "origin", "main", "main:river"]);

    // board/river with River's status file.
    sh(work, ["checkout", "--quiet", "--orphan", "board"]);
    sh(work, ["rm", "-r", "-q", "--cached", "."]);
    rmSync(join(work, "lib"), { recursive: true, force: true });
    put(work, "status.md", "# River status\n\nworker: river\nlock: none\nheartbeat: none\n\n## Notes\n\nkeep me\n");
    put(work, "integration.md", "# Integration record\n\n(none yet)\n");
    sh(work, ["add", "status.md", "integration.md"]);
    sh(work, ["commit", "--quiet", "-m", "board"]);
    sh(work, ["push", "--quiet", "origin", "board:board/river"]);

    // stream/measures: status, a READY with a step-named migration, then WIP.
    sh(work, ["checkout", "--quiet", "-f", "-B", "measures", "origin/river"]);
    put(work, ".factory/measures.md", `build_state: active\nlock: m-1\nheartbeat: ${new Date().toISOString()}\n`);
    sh(work, ["add", "-A"]);
    sh(work, ["commit", "--quiet", "-m", "stream/measures: seed"]);
    put(work, "lib/db/migrations/DB-09_place_owed.sql", "CREATE TABLE owed (id int);\n");
    put(work, "lib/db/migration-phases.ts", 'export const MIGRATION_PHASES = {\n  "0000_first": "expand",\n  "DB-09_place_owed": "expand",\n};\n');
    put(work, "measures.txt", "ready\n");
    sh(work, ["add", "-A"]);
    sh(work, ["commit", "--quiet", "-m", "READY: DB-09", "-m", PROOFS]);
    const measuresReady = sh(work, ["rev-parse", "HEAD"]);
    put(work, "measures.txt", "wip\n");
    sh(work, ["commit", "--quiet", "-am", "WIP: DB-12"]);
    sh(work, ["push", "--quiet", "origin", "measures:stream/measures"]);

    // stream/registry: one READY, an old heartbeat under a lock.
    sh(work, ["checkout", "--quiet", "-B", "registry", "origin/river"]);
    put(work, ".factory/registry.md", "build_state: active\nlock: r-1\nheartbeat: 2026-01-01T00:00:00Z\n");
    put(work, "registry.txt", "ready\n");
    sh(work, ["add", "-A"]);
    sh(work, ["commit", "--quiet", "-m", "READY: DB-10", "-m", PROOFS]);
    const registryReady = sh(work, ["rev-parse", "HEAD"]);
    sh(work, ["push", "--quiet", "origin", "registry:stream/registry"]);

    sh(root, ["clone", "--quiet", origin, riverCheckout]);

    const scanned = river(riverCheckout, "scan");
    assert.equal(scanned.code, 0, scanned.out);
    const plan = JSON.parse(scanned.out);
    assert.deepEqual(plan.ready_lanes, ["measures", "registry"]);
    const measures = plan.lanes.find((lane: { lane: string }) => lane.lane === "measures");
    assert.deepEqual(measures.ready, { ready_sha: measuresReady, steps: ["DB-09"], wip_after_ready: 1, missing_proofs: [] });
    assert.equal(measures.stale_lock, false);
    assert.equal(plan.lanes.find((lane: { lane: string }) => lane.lane === "registry").stale_lock, true);

    const folded = river(riverCheckout, "fold");
    assert.equal(folded.code, 0, folded.out);
    const record = JSON.parse(readFileSync(join(riverCheckout, ".scratch/river/fold.json"), "utf8"));
    assert.deepEqual(record.lanes.map((lane: { lane: string; ready_sha: string }) => [lane.lane, lane.ready_sha]), [
      ["measures", measuresReady], ["registry", registryReady],
    ]);
    assert.equal(sh(riverCheckout, ["ls-tree", "-r", "--name-only", "HEAD", ".factory"]), "","coordination files never reach the application tree");
    assert.equal(readFileSync(join(riverCheckout, "measures.txt"), "utf8"), "ready\n", "WIP after READY stays behind");

    const numbered = river(riverCheckout, "migrations");
    assert.equal(numbered.code, 0, numbered.out);
    assert.ok(existsSync(join(riverCheckout, "lib/db/migrations/0001_db09_place_owed.sql")));
    assert.ok(!existsSync(join(riverCheckout, "lib/db/migrations/DB-09_place_owed.sql")));
    const newJournal = JSON.parse(readFileSync(join(riverCheckout, "lib/db/migrations/meta/_journal.json"), "utf8"));
    assert.deepEqual(newJournal.entries.map((e: { idx: number; tag: string; when: number }) => [e.idx, e.tag, e.when]), [
      [0, "0000_first", 1000], [1, "0001_db09_place_owed", 1001],
    ]);
    assert.match(readFileSync(join(riverCheckout, "lib/db/migration-phases.ts"), "utf8"), /"0001_db09_place_owed": "expand"/);
    assert.equal(river(riverCheckout, "migrations").code, 0, "a second run finds nothing left to number");

    // The fold grows the code by two lines: no release until River makes it smaller.
    const grown = river(riverCheckout, "release", "1");
    assert.equal(grown.code, 1, grown.out);
    assert.match(grown.out, /grows the code from 9 to 11 lines \(\+2\)/);
    assert.equal(remoteSha(riverCheckout, "release/1"), "", "a release that grows the code pushes no release branch");
    sh(riverCheckout, ["rm", "--quiet", "lib/old.ts"]);
    sh(riverCheckout, ["commit", "--quiet", "-m", "River: remove unused code"]);

    // The quick check fails on lint: nothing is released.
    const base = remoteSha(riverCheckout, "river");
    const head = sh(riverCheckout, ["rev-parse", "HEAD"]);
    const lintRed = riverWith({ RIVER_TEST_FAIL_LINT: "1" }, riverCheckout, "release", "1");
    assert.equal(lintRed.code, 1, lintRed.out);
    assert.match(lintRed.out, /lint failed on river-next/);
    assert.equal(remoteSha(riverCheckout, "release/1"), "", "a red quick check pushes no release branch");

    // Release 1: the quick check runs lint and types only, then release/1 is
    // pushed from river-next and the PR is printed for River to open with its
    // label and auto-merge. River does not move yet.
    rmSync(join(root, "pnpm.log"), { force: true });
    const released = river(riverCheckout, "release", "1");
    assert.equal(released.code, 0, released.out);
    assert.deepEqual(readFileSync(join(root, "pnpm.log"), "utf8").trim().split("\n"), ["--version", "lint", "exec tsc --noEmit"], "only lint and the type check: no suite, no build");
    assert.match(released.out, /ACTION NEEDED: confirm no other release\/\* PR is open into main, then create the release PR/);
    assert.match(released.out, new RegExp(`ACTION NEEDED: right after creating it, label the new PR ${FULL_CI_LABEL}`));
    assert.match(released.out, /POST https:\/\/api\.github\.com\/repos\/[^ ]+\/issues\/<new PR number>\/labels\n  body: \{"labels":\["run-full-ci"\]\}/);
    assert.match(released.out, /ACTION NEEDED: then enable auto-merge \(merge commit\)/);
    assert.match(released.out, /GitHub CI on this pull request is the full test of this exact commit/);
    assert.match(released.out, /Lines of code: 9 before, 8 after \(−1\)/);
    assert.match(released.out, /ZIPs usable in under 3 seconds \(of 50\): phone not measured→measuring/);
    assert.doesNotMatch(released.out, /pnpm gates/);
    assert.equal(remoteSha(riverCheckout, "release/1"), head);
    assert.equal(remoteSha(riverCheckout, "river"), base, "river waits for GitHub CI");
    const record1 = JSON.parse(board(riverCheckout, "releases/1.json"));
    assert.deepEqual([record1.head_sha, record1.base_river_sha, record1.ci, record1.steps], [head, base, "running", ["DB-09", "DB-10"]]);

    // Without a token, settle prints the exact check-run read and leaves river alone.
    const unread = river(riverCheckout, "settle", "1");
    assert.equal(unread.code, 0, unread.out);
    assert.match(unread.out, /ACTION NEEDED: read GitHub CI on release\/1 [0-9a-f]{12}; the required checks are build \(default\), build \(standalone\), gates \(test · lint · tsc\)/);
    assert.match(unread.out, new RegExp(`GET https://api\\.github\\.com/repos/[^ ]+/commits/${head}/check-runs`));
    assert.match(unread.out, /settle 1 --ci fail --log-file <file>/);
    assert.equal(remoteSha(riverCheckout, "river"), base);

    // GitHub CI passed: river moves to exactly the released commit and the lanes are recorded.
    const settled = river(riverCheckout, "settle", "1", "--ci", "pass");
    assert.equal(settled.code, 0, settled.out);
    assert.equal(remoteSha(riverCheckout, "river"), head);
    const integration = JSON.parse(board(riverCheckout, "integration.json"));
    assert.deepEqual(integration.map((entry: { lane: string; steps: string[]; river_sha: string; ci: string; release: number }) => [entry.lane, entry.steps, entry.river_sha, entry.ci, entry.release]), [
      ["measures", ["DB-09"], head, "pass", 1], ["registry", ["DB-10"], head, "pass", 1],
    ]);
    assert.match(board(riverCheckout, "integration.md"), /GitHub CI passed on release 1$/m);
    assert.doesNotMatch(board(riverCheckout, "integration.md"), /none yet/);
    assert.equal(JSON.parse(board(riverCheckout, "releases/1.json")).ci, "pass");
    assert.match(river(riverCheckout, "settle", "1", "--ci", "pass").out, /already settled \(pass\)/);
    assert.deepEqual(JSON.parse(river(riverCheckout, "scan").out).ready_lanes, [], "integrated work is not folded twice");

    // A lane's second READY after catching up: its status file was deleted on
    // river and modified on the stream. That modify/delete is not an application
    // conflict, so the fold drops .factory and goes on. Main moved meanwhile
    // (the merged release), so the fold merges it in.
    sh(work, ["checkout", "--quiet", "-f", "main"]);
    sh(work, ["pull", "--quiet", "--ff-only", "origin", "main"]);
    put(work, "main-only.txt", "merged on main\n");
    sh(work, ["add", "-A"]);
    sh(work, ["commit", "--quiet", "-m", "Merge pull request #1 from release/1"]);
    sh(work, ["push", "--quiet", "origin", "main"]);
    const main = sh(work, ["rev-parse", "HEAD"]);
    sh(work, ["checkout", "--quiet", "-f", "measures"]);
    sh(work, ["fetch", "--quiet", "origin", "+refs/heads/river:refs/remotes/origin/river"]);
    sh(work, ["merge", "--quiet", "--no-edit", "-X", "theirs", "origin/river"]);
    put(work, ".factory/measures.md", `build_state: active\nlock: m-1\nheartbeat: ${new Date().toISOString()}\nready: DB-12\n`);
    put(work, "measures-two.txt", "ready\n");
    sh(work, ["add", "-A"]);
    sh(work, ["commit", "--quiet", "-m", "READY: DB-12", "-m", PROOFS]);
    sh(work, ["push", "--quiet", "origin", "measures:stream/measures"]);
    const second = river(riverCheckout, "fold");
    assert.equal(second.code, 0, second.out);
    assert.equal(sh(riverCheckout, ["ls-tree", "-r", "--name-only", "HEAD", ".factory"]), "", "the status file stays off the application tree");
    assert.equal(JSON.parse(readFileSync(join(riverCheckout, ".scratch/river/fold.json"), "utf8")).main_sha, main);
    assert.equal(spawnSync("git", ["merge-base", "--is-ancestor", main, "HEAD"], { cwd: riverCheckout }).status, 0, "the release head carries main");
    assert.equal(river(riverCheckout, "release", "2").code, 0);
    assert.equal(river(riverCheckout, "settle", "2", "--ci", "pass").code, 0);

    // Release 3 fails GitHub CI: people's own test fails. Settle names it,
    // returns people, folds again without it and opens release 4; river stays.
    const tested = remoteSha(riverCheckout, "river");
    const lanes: Record<string, string> = {};
    for (const [lane, step, file] of [["ballot", "BA-01", "lib/ballot.ts"], ["people", "PE-01", "tests/people.test.ts"]]) {
      sh(work, ["fetch", "--quiet", "origin", "+refs/heads/river:refs/remotes/origin/river"]);
      sh(work, ["checkout", "--quiet", "-f", "-B", lane, "origin/river"]);
      put(work, file, `export const ${lane} = 1;\n`);
      rmSync(join(work, `lib/old-${lane}.ts`));
      sh(work, ["add", "-A"]);
      sh(work, ["commit", "--quiet", "-m", `READY: ${step}`, "-m", PROOFS]);
      lanes[lane] = sh(work, ["rev-parse", "HEAD"]);
      sh(work, ["push", "--quiet", "origin", `${lane}:stream/${lane}`]);
    }
    assert.equal(river(riverCheckout, "fold").code, 0);
    assert.equal(river(riverCheckout, "release", "3").code, 0);
    const head3 = remoteSha(riverCheckout, "release/3");
    put(root, "ci.log", [
      "2026-10-28T05:10:01.0000000Z ✖ failing tests:",
      "2026-10-28T05:10:01.0000000Z test at /home/runner/work/meanwhile/meanwhile/tests/people.test.ts:1:1",
      "2026-10-28T05:10:01.0000000Z ✖ a person keeps one card (3.2ms)",
    ].join("\n"));
    const failed = river(riverCheckout, "settle", "3", "--ci", "fail", "--log-file", join(root, "ci.log"));
    assert.equal(failed.code, 0, failed.out);
    assert.match(failed.out, /GitHub CI FAILED on release\/3/);
    assert.match(failed.out, /✖ tests\/people\.test\.ts — a person keeps one card/);
    assert.match(failed.out, /RETURN: people failed GitHub CI/);
    assert.match(failed.out, /ACTION NEEDED: close the release\/3 pull request/);
    const peopleReturn = parseStatus(board(riverCheckout, "returns/people.md"));
    assert.deepEqual([peopleReturn.check, peopleReturn.state, peopleReturn.ready], ["GitHub CI", "returned", `PE-01 ${lanes.people}`]);
    assert.match(board(riverCheckout, "returns/people.md"), /✖ tests\/people\.test\.ts — a person keeps one card/);
    const record3 = JSON.parse(board(riverCheckout, "releases/3.json"));
    assert.deepEqual([record3.ci, record3.returned, record3.failed_tests.map((t: { file: string }) => t.file)], ["fail", ["people"], ["tests/people.test.ts"]]);
    assert.equal(remoteSha(riverCheckout, "river"), tested, "river never points at a commit GitHub CI has not passed");
    const record4 = JSON.parse(board(riverCheckout, "releases/4.json"));
    assert.deepEqual(record4.lanes.map((lane: { lane: string }) => lane.lane), ["ballot"], "folded again without the returned lane");
    assert.equal(record4.ci, "running");
    assert.notEqual(record4.head_sha, head3);
    assert.equal(remoteSha(riverCheckout, "release/4"), record4.head_sha);
    assert.equal(sh(riverCheckout, ["ls-tree", "--name-only", record4.head_sha, "tests/people.test.ts"]), "");
    // Until people posts a new READY, every fold holds it back.
    assert.equal(river(riverCheckout, "settle", "4", "--ci", "pass").code, 0);
    assert.equal(remoteSha(riverCheckout, "river"), record4.head_sha);
    assert.match(river(riverCheckout, "fold").out, new RegExp(`HELD people ${lanes.people.slice(0, 12)}`));

    // Two lanes editing the same line: the fold stops on the second, aborts and names it.
    for (const lane of ["hunters", "slide"]) {
      sh(work, ["fetch", "--quiet", "origin", "+refs/heads/river:refs/remotes/origin/river"]);
      sh(work, ["checkout", "--quiet", "-f", "-B", lane, "origin/river"]);
      put(work, "shared.txt", `${lane}\n`);
      sh(work, ["add", "-A"]);
      sh(work, ["commit", "--quiet", "-m", `READY: HU-0${lane.length}`, "-m", PROOFS]);
      sh(work, ["push", "--quiet", "origin", `${lane}:stream/${lane}`]);
    }
    const conflicted = river(riverCheckout, "fold");
    assert.equal(conflicted.code, 1);
    assert.match(conflicted.out, /fold stopped: slide/);
    assert.equal(sh(riverCheckout, ["status", "--porcelain", "--untracked-files=no"]), "", "the aborted merge leaves a clean tree");
    assert.equal(JSON.parse(readFileSync(join(riverCheckout, ".scratch/river/fold.json"), "utf8")).conflict.lane, "slide");
    const stopped = river(riverCheckout, "release", "5");
    assert.equal(stopped.code, 1, "a stopped fold cannot be released");
    assert.match(stopped.out, /the fold stopped on slide/);

    // A READY without the two connection proofs is refused and sent back; nothing is folded.
    sh(work, ["fetch", "--quiet", "origin", "+refs/heads/river:refs/remotes/origin/river"]);
    sh(work, ["checkout", "--quiet", "-f", "-B", "auditors", "origin/river"]);
    put(work, "auditors.txt", "ready\n");
    sh(work, ["add", "-A"]);
    sh(work, ["commit", "--quiet", "-m", "READY: AU-01"]);
    const auditorsReady = sh(work, ["rev-parse", "HEAD"]);
    sh(work, ["push", "--quiet", "origin", "auditors:stream/auditors"]);
    sh(riverCheckout, ["checkout", "--quiet", "-f", "river-next"]);
    const unproven = river(riverCheckout, "fold", "--lanes", "auditors");
    assert.equal(unproven.code, 0, unproven.out);
    assert.match(unproven.out, /REFUSED auditors .*connected end to end; still working on the next scheduled run/);
    const refusedRecord = JSON.parse(readFileSync(join(riverCheckout, ".scratch/river/fold.json"), "utf8"));
    assert.deepEqual(refusedRecord.lanes, []);
    assert.deepEqual(refusedRecord.refused.map((entry: { lane: string; ready_sha: string }) => [entry.lane, entry.ready_sha]), [["auditors", auditorsReady]]);
    const auditorsReturn = parseStatus(sh(riverCheckout, ["show", "origin/board/river:returns/auditors.md"]));
    assert.equal(auditorsReturn.check, "connection proofs");
    assert.equal(auditorsReturn.state, "returned");

    // The lock protocol on River's status file.
    const lock = (mode: string, token: string) => river(riverCheckout, "lock", mode, "--branch", "board/river", "--file", "status.md", "--token", token, "--worker", "river");
    assert.equal(lock("claim", "A").code, 0);
    const status = sh(riverCheckout, ["show", "origin/board/river:status.md"]);
    assert.equal(parseStatus(status).lock, "A");
    assert.match(status, /## Notes\n\nkeep me$/);
    assert.equal(lock("claim", "B").code, 3, "a live owner is not replaced");
    assert.equal(lock("heartbeat", "B").code, 4, "a non-owner's heartbeat refuses");
    assert.equal(lock("heartbeat", "A").code, 0);
    assert.equal(lock("release", "A").code, 0);
    assert.equal(parseStatus(sh(riverCheckout, ["show", "origin/board/river:status.md"])).lock, "none");
    assert.equal(lock("claim", "B").code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a ZIP is usable only once its district lines are drawn on the map", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, window: g.window };
  const page = (rendered: number, lineLayer: boolean) => {
    const map = {
      loaded: () => true,
      isMoving: () => false,
      getStyle: () => ({ layers: [{ id: "water" }, ...(lineLayer ? [{ id: "district-congressional-line" }] : [])] }),
      queryRenderedFeatures: () => new Array(rendered).fill({}),
    };
    g.window = { __wtpMap: map };
    g.document = { querySelector: (selector: string) => (selector.includes("data-stat") ? { textContent: "12" } : null) };
  };
  try {
    page(0, false);
    assert.equal(usableNow(), false, "no district line layer yet");
    page(0, true);
    assert.equal(usableNow(), false, "layer added but no lines rendered");
    page(3, true);
    assert.equal(typeof usableNow(), "number", "lines rendered");
  } finally {
    g.document = saved.document;
    g.window = saved.window;
  }
});
