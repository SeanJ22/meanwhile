/**
 * `scripts/river.mjs` — the streams → river → main path.
 *
 * The decisions are pure and tested directly: status parsing, READY detection,
 * fold order, lock ownership, release contents, post-deploy reuse and migration
 * numbering. The git paths are driven end to end against a scratch repository
 * with a local bare `origin`, so fold, migrations, promote and the lock protocol
 * are exercised with real merges and real fast-forward pushes, and nothing here
 * reaches GitHub.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  STALE_LOCK_MS,
  decideLock,
  decideObserve,
  foldOrder,
  parseArgs,
  parseStatus,
  pendingReady,
  planMigrationNumbers,
  releaseContents,
  setStatusFields,
  slugOf,
  stepIds,
} from "../scripts/river.mjs";

const SCRIPT = join(import.meta.dirname, "..", "scripts", "river.mjs");
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
  assert.deepEqual(stepIds("READY: 0048_r3_legistar_members"), ["0048_r3_legistar_members"]);
  assert.deepEqual(stepIds("READY: R3-CIVICCLERK"), ["R3-CIVICCLERK"]);
  assert.deepEqual(stepIds("READY: SRC-LS"), ["SRC-LS"]);
  assert.deepEqual(stepIds("READY: SRC-AC"), ["SRC-AC"]);
  assert.deepEqual(stepIds("READY: R2B, SRC-LS and DB-09"), ["R2B", "SRC-LS", "DB-09"]);
  assert.deepEqual(stepIds("WIP: still working"), []);
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

test("a release carries exactly the integrations recorded since the previous release", () => {
  const integration = [
    { lane: "measures", steps: ["SC-01"] },
    { lane: "registry", steps: ["DB-09", "DB-10"] },
    { lane: "measures", steps: ["SC-02", "SC-01"] },
    { lane: "adapter-legistar", steps: ["AD-01"] },
  ];
  assert.deepEqual(releaseContents(integration, []).steps, ["SC-01", "DB-09", "DB-10", "SC-02", "AD-01"]);
  const after = releaseContents(integration, [{ n: 1, integration_count: 1 }, { n: 2, integration_count: 3 }]);
  assert.equal(after.from, 3);
  assert.deepEqual(after.steps, ["AD-01"]);
  assert.deepEqual(after.lanes, ["adapter-legistar"]);
  assert.deepEqual(releaseContents(integration, [{ n: 3, integration_count: 4 }]).steps, []);
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
const ENV = { ...process.env, ...IDENTITY, GITHUB_TOKEN: "", GH_TOKEN: "" };

function sh(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function put(cwd: string, path: string, text: string) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), text);
}
function river(cwd: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: ENV, encoding: "utf8" });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

test("fold, migrations, promote and the lock protocol work end to end against a real remote", { timeout: 120_000 }, () => {
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
    sh(work, ["commit", "--quiet", "-m", "READY: DB-09"]);
    const measuresReady = sh(work, ["rev-parse", "HEAD"]);
    put(work, "measures.txt", "wip\n");
    sh(work, ["commit", "--quiet", "-am", "WIP: DB-12"]);
    sh(work, ["push", "--quiet", "origin", "measures:stream/measures"]);

    // stream/registry: one READY, an old heartbeat under a lock.
    sh(work, ["checkout", "--quiet", "-B", "registry", "origin/river"]);
    put(work, ".factory/registry.md", "build_state: active\nlock: r-1\nheartbeat: 2026-01-01T00:00:00Z\n");
    put(work, "registry.txt", "ready\n");
    sh(work, ["add", "-A"]);
    sh(work, ["commit", "--quiet", "-m", "READY: DB-10"]);
    const registryReady = sh(work, ["rev-parse", "HEAD"]);
    sh(work, ["push", "--quiet", "origin", "registry:stream/registry"]);

    sh(root, ["clone", "--quiet", origin, riverCheckout]);

    const scanned = river(riverCheckout, "scan");
    assert.equal(scanned.code, 0, scanned.out);
    const plan = JSON.parse(scanned.out);
    assert.deepEqual(plan.ready_lanes, ["measures", "registry"]);
    const measures = plan.lanes.find((lane: { lane: string }) => lane.lane === "measures");
    assert.deepEqual(measures.ready, { ready_sha: measuresReady, steps: ["DB-09"], wip_after_ready: 1 });
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

    // Promote refuses without a passing test of this exact SHA.
    assert.equal(river(riverCheckout, "promote").code, 1);
    const head = sh(riverCheckout, ["rev-parse", "HEAD"]);
    writeFileSync(join(riverCheckout, ".scratch/river/test.json"), JSON.stringify({ sha: head, gates: "pass" }));
    const promoted = river(riverCheckout, "promote");
    assert.equal(promoted.code, 0, promoted.out);
    assert.equal(sh(riverCheckout, ["ls-remote", "origin", "refs/heads/river"]).split("\t")[0], head);
    const integration = JSON.parse(sh(riverCheckout, ["show", "origin/board/river:integration.json"]));
    assert.deepEqual(integration.map((entry: { lane: string; steps: string[]; river_sha: string; gates: string }) => [entry.lane, entry.steps, entry.river_sha, entry.gates]), [
      ["measures", ["DB-09"], head, "pass"], ["registry", ["DB-10"], head, "pass"],
    ]);
    assert.doesNotMatch(sh(riverCheckout, ["show", "origin/board/river:integration.md"]), /none yet/);
    assert.deepEqual(JSON.parse(river(riverCheckout, "scan").out).ready_lanes, [], "integrated work is not folded twice");

    // A lane's second READY after catching up: its status file was deleted on
    // river and modified on the stream. That modify/delete is not an application
    // conflict, so the fold drops .factory and goes on.
    sh(work, ["checkout", "--quiet", "-f", "measures"]);
    sh(work, ["fetch", "--quiet", "origin", "+refs/heads/river:refs/remotes/origin/river"]);
    sh(work, ["merge", "--quiet", "--no-edit", "-X", "theirs", "origin/river"]);
    put(work, ".factory/measures.md", `build_state: active\nlock: m-1\nheartbeat: ${new Date().toISOString()}\nready: DB-12\n`);
    put(work, "measures-two.txt", "ready\n");
    sh(work, ["add", "-A"]);
    sh(work, ["commit", "--quiet", "-m", "READY: DB-12"]);
    sh(work, ["push", "--quiet", "origin", "measures:stream/measures"]);
    const second = river(riverCheckout, "fold");
    assert.equal(second.code, 0, second.out);
    assert.equal(sh(riverCheckout, ["ls-tree", "-r", "--name-only", "HEAD", ".factory"]), "", "the status file stays off the application tree");
    writeFileSync(join(riverCheckout, ".scratch/river/test.json"), JSON.stringify({ sha: sh(riverCheckout, ["rev-parse", "HEAD"]), gates: "pass" }));
    assert.equal(river(riverCheckout, "promote").code, 0);

    // Two lanes editing the same line: the fold stops on the second, aborts and names it.
    for (const lane of ["hunters", "people"]) {
      sh(work, ["fetch", "--quiet", "origin", "+refs/heads/river:refs/remotes/origin/river"]);
      sh(work, ["checkout", "--quiet", "-f", "-B", lane, "origin/river"]);
      put(work, "shared.txt", `${lane}\n`);
      sh(work, ["add", "-A"]);
      sh(work, ["commit", "--quiet", "-m", `READY: HU-0${lane.length}`]);
      sh(work, ["push", "--quiet", "origin", `${lane}:stream/${lane}`]);
    }
    const conflicted = river(riverCheckout, "fold");
    assert.equal(conflicted.code, 1);
    assert.match(conflicted.out, /fold stopped: people/);
    assert.equal(sh(riverCheckout, ["status", "--porcelain", "--untracked-files=no"]), "", "the aborted merge leaves a clean tree");
    assert.equal(JSON.parse(readFileSync(join(riverCheckout, ".scratch/river/fold.json"), "utf8")).conflict.lane, "people");
    assert.equal(river(riverCheckout, "promote").code, 1, "a stopped fold cannot be promoted");

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
