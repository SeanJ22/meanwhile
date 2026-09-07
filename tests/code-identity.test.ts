import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  codeIdentityLine,
  deriveEffectiveExecutable,
  firstParentChangedPaths,
  isCodeIdentity,
  judgeCodeIdentity,
  readCodeIdentity,
  walkFirstParent,
  type AncestryOracle,
} from "../lib/control-plane/code-identity.ts";

/**
 * **PRDY-1 — EXECUTABLE SHA IDENTITY.** (Fleet Promotion Readiness, 2026-09-06.)
 *
 * The activation audit's ACT-1 read the runner as stale because raw main
 * (`54d4d946`, an observer-only integrity reading) was not the SHA the runner
 * had tested (`972d1a60`, its parent and the newest commit whose tree changes
 * executable code). These tests hold the repaired evidence model: three SHAs,
 * the canonical shipping classification deciding which commits count, and a
 * verdict whose unanswerable cases all fall the safe way.
 */

const EXECUTABLE = "972d1a607510818ee23a50e90689e80050ec131c";
const OBSERVER = "54d4d946d919671f20d19aae5191e7b58709c8e9";

test("PRDY-1: an observer-only child of the executable head does not make a current runner look stale (ACT-1)", () => {
  const derived = deriveEffectiveExecutable([
    { sha: OBSERVER, changed: ["data/ops/production-integrity.json", "docs/status-ledger.md"] },
    { sha: EXECUTABLE, changed: ["lib/control-plane/scheduler/scout-executor.ts", "docs/status-ledger.md"] },
  ]);
  assert.equal(derived.effectiveExecutableSha, EXECUTABLE);
  assert.deepEqual(derived.nonShippingAbove.map((c) => c.sha), [OBSERVER]);
  assert.equal(derived.nonShippingAbove[0].klass, "NON_SHIPPING");
  assert.equal(derived.executable?.klass, "SHIPPING");
  assert.equal(derived.walkExhausted, false);

  const oracle: AncestryOracle = (a, b) => a === b || (a === EXECUTABLE && b === OBSERVER);
  const testedExecutable = judgeCodeIdentity({
    rawMainSha: OBSERVER, effectiveExecutableSha: EXECUTABLE, runnerTestedSha: EXECUTABLE, walkExhausted: false, contains: oracle,
  });
  assert.equal(testedExecutable.verdict, "CONSISTENT");
  assert.match(testedExecutable.detail, /non-shipping commits only/);

  // The runner later caught up to the observer commit itself: still consistent.
  const caughtUp = judgeCodeIdentity({
    rawMainSha: OBSERVER, effectiveExecutableSha: EXECUTABLE, runnerTestedSha: OBSERVER, walkExhausted: false, contains: oracle,
  });
  assert.equal(caughtUp.verdict, "CONSISTENT");
});

test("PRDY-1: executable code above the runner is the real stale case, undiminished", () => {
  const NEWER = "a".repeat(40);
  const derived = deriveEffectiveExecutable([
    { sha: NEWER, changed: ["lib/sources/legistar/index.ts"] },
    { sha: OBSERVER, changed: ["data/ops/production-integrity.json"] },
    { sha: EXECUTABLE, changed: ["lib/x.ts"] },
  ]);
  assert.equal(derived.effectiveExecutableSha, NEWER);
  assert.equal(derived.nonShippingAbove.length, 0);

  const ancestry = new Set([`${EXECUTABLE}>${OBSERVER}`, `${EXECUTABLE}>${NEWER}`, `${OBSERVER}>${NEWER}`]);
  const oracle: AncestryOracle = (a, b) => a === b || ancestry.has(`${a}>${b}`);
  const judged = judgeCodeIdentity({
    rawMainSha: NEWER, effectiveExecutableSha: NEWER, runnerTestedSha: EXECUTABLE, walkExhausted: false, contains: oracle,
  });
  assert.equal(judged.verdict, "RUNNER_BEHIND_EXECUTABLE");
  assert.match(judged.detail, /stale/);
});

test("PRDY-1: unclassifiable and mixed commits are executable; the walk bound refuses rather than guesses", () => {
  const MERGE = "b".repeat(40);
  const MIXED = "c".repeat(40);
  assert.equal(
    deriveEffectiveExecutable([{ sha: OBSERVER, changed: ["docs/status-ledger.md"] }, { sha: MERGE, changed: [] }]).effectiveExecutableSha,
    MERGE,
    "an empty first-parent diff is UNKNOWN under the cost rule and therefore executable here",
  );
  assert.equal(deriveEffectiveExecutable([{ sha: MERGE, changed: null }]).executable?.klass, "UNKNOWN");
  assert.equal(
    deriveEffectiveExecutable([{ sha: MIXED, changed: ["data/ops/production-integrity.json", "lib/a.ts"] }]).effectiveExecutableSha,
    MIXED,
    "one proof-bearing path makes the whole commit executable",
  );
  const exhausted = deriveEffectiveExecutable(
    [{ sha: OBSERVER, changed: ["docs/status-ledger.md"] }, { sha: MERGE, changed: ["data/ops/refresh-debt.json"] }, { sha: MIXED, changed: ["lib/a.ts"] }],
    2,
  );
  assert.equal(exhausted.effectiveExecutableSha, null);
  assert.equal(exhausted.walkExhausted, true);
  const judged = judgeCodeIdentity({
    rawMainSha: OBSERVER, effectiveExecutableSha: null, runnerTestedSha: OBSERVER, walkExhausted: true, contains: () => true,
  });
  assert.equal(judged.verdict, "CANNOT_TELL");
  assert.match(judged.detail, /within its bound/);
});

test("PRDY-1: a missing SHA or an unanswerable git is CANNOT_TELL; ahead-of-main and off-main are named, never called current", () => {
  const always: AncestryOracle = () => true;
  assert.equal(judgeCodeIdentity({ rawMainSha: null, effectiveExecutableSha: EXECUTABLE, runnerTestedSha: EXECUTABLE, walkExhausted: false, contains: always }).verdict, "CANNOT_TELL");
  assert.equal(judgeCodeIdentity({ rawMainSha: OBSERVER, effectiveExecutableSha: EXECUTABLE, runnerTestedSha: null, walkExhausted: false, contains: always }).verdict, "CANNOT_TELL");
  assert.equal(
    judgeCodeIdentity({ rawMainSha: OBSERVER, effectiveExecutableSha: EXECUTABLE, runnerTestedSha: "d".repeat(40), walkExhausted: false, contains: () => null }).verdict,
    "CANNOT_TELL",
  );

  const AHEAD = "e".repeat(40);
  const aheadAncestry = new Set([`${EXECUTABLE}>${OBSERVER}`, `${EXECUTABLE}>${AHEAD}`, `${OBSERVER}>${AHEAD}`]);
  const ahead: AncestryOracle = (a, b) => a === b || aheadAncestry.has(`${a}>${b}`);
  assert.equal(
    judgeCodeIdentity({ rawMainSha: OBSERVER, effectiveExecutableSha: EXECUTABLE, runnerTestedSha: AHEAD, walkExhausted: false, contains: ahead }).verdict,
    "RUNNER_AHEAD_OF_MAIN",
  );

  const BRANCH = "f".repeat(40);
  const off: AncestryOracle = (a, b) => a === b || (a === EXECUTABLE && b === OBSERVER);
  assert.equal(
    judgeCodeIdentity({ rawMainSha: OBSERVER, effectiveExecutableSha: EXECUTABLE, runnerTestedSha: BRANCH, walkExhausted: false, contains: off }).verdict,
    "RUNNER_NOT_ON_MAIN",
  );
});

/* ---------------------------------------------------------- a real repo --- */

function git(dir: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function commit(dir: string, path: string, message: string): string {
  mkdirSync(join(dir, dirname(path)), { recursive: true });
  writeFileSync(join(dir, path), `${message}\n`);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "--quiet", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

test("PRDY-1: readCodeIdentity derives the three SHAs and the verdict from a real repository, with no network", () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-code-identity-"));
  try {
    git(dir, ["init", "--quiet"]);
    git(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    git(dir, ["config", "user.email", "prdy@example.invalid"]);
    git(dir, ["config", "user.name", "code identity test"]);
    git(dir, ["config", "commit.gpgsign", "false"]);
    const root = commit(dir, "lib/a.ts", "root");
    const executable = commit(dir, "lib/b.ts", "shipping change");
    const observer1 = commit(dir, "data/ops/production-integrity.json", "observer reading");
    const observer2 = commit(dir, "docs/status-ledger.md", "status ledger");
    const now = "2026-09-06T00:00:00.000Z";

    assert.equal(firstParentChangedPaths(root, dir), null, "a root commit has no first parent to diff against");
    assert.deepEqual(firstParentChangedPaths(observer1, dir), ["data/ops/production-integrity.json"]);
    assert.deepEqual(walkFirstParent(observer2, dir, 3).map((c) => c.sha), [observer2, observer1, executable]);

    const identity = readCodeIdentity({ cwd: dir, runnerTestedSha: executable, now });
    assert.equal(identity.rawMainRef, "main", "a checkout without origin answers from its local main");
    assert.equal(identity.rawMainFetched, false);
    assert.equal(identity.rawMainSha, observer2);
    assert.equal(identity.effectiveExecutableSha, executable);
    assert.deepEqual(identity.nonShippingAbove.map((c) => c.sha), [observer2, observer1]);
    assert.equal(identity.runnerTestedSha, executable);
    assert.equal(identity.verdict, "CONSISTENT");
    assert.equal(identity.readAt, now);
    assert.ok(isCodeIdentity(JSON.parse(JSON.stringify(identity))), "the record survives a JSON round trip");
    assert.match(codeIdentityLine(identity), /2 non-shipping commits above the executable head/);
    assert.match(codeIdentityLine(identity), /CONSISTENT$/);

    assert.equal(readCodeIdentity({ cwd: dir, runnerTestedSha: observer2, now }).verdict, "CONSISTENT", "a runner on the observer commit is current");

    const newer = commit(dir, "lib/c.ts", "another shipping change");
    const behind = readCodeIdentity({ cwd: dir, runnerTestedSha: executable, now });
    assert.equal(behind.effectiveExecutableSha, newer);
    assert.equal(behind.nonShippingAbove.length, 0);
    assert.equal(behind.verdict, "RUNNER_BEHIND_EXECUTABLE");

    assert.equal(readCodeIdentity({ cwd: dir, runnerTestedSha: "0".repeat(40), now }).verdict, "CANNOT_TELL", "an unknown SHA is not judged");
    assert.equal(readCodeIdentity({ cwd: dir, runnerTestedSha: null, now }).verdict, "CANNOT_TELL");

    git(dir, ["checkout", "--quiet", "-b", "side", root]);
    const side = commit(dir, "lib/side.ts", "side work");
    git(dir, ["checkout", "--quiet", "main"]);
    assert.equal(readCodeIdentity({ cwd: dir, runnerTestedSha: side, now }).verdict, "RUNNER_NOT_ON_MAIN");

    // Only ops-only commits within a tiny bound: the walk refuses instead of naming a head.
    const bounded = readCodeIdentity({ cwd: dir, runnerTestedSha: newer, now, bound: 1 });
    assert.equal(bounded.walkBound, 1);
    // `newer` is executable and is the tip, so a bound of 1 still finds it; move the tip onto ops-only commits.
    assert.equal(bounded.verdict, "CONSISTENT");
    commit(dir, "docs/refresh-run.md", "refresh report");
    const exhausted = readCodeIdentity({ cwd: dir, runnerTestedSha: newer, now, bound: 1 });
    assert.equal(exhausted.effectiveExecutableSha, null);
    assert.equal(exhausted.walkExhausted, true);
    assert.equal(exhausted.verdict, "CANNOT_TELL");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("PRDY-1: a stored record that is not a code identity is refused, never read as consistent", () => {
  assert.equal(isCodeIdentity(null), false);
  assert.equal(isCodeIdentity({ formatVersion: 1, readAt: "x", verdict: "GREEN", detail: "", nonShippingAbove: [] }), false);
  assert.equal(isCodeIdentity({ formatVersion: 2, readAt: "x", verdict: "CONSISTENT", detail: "", nonShippingAbove: [] }), false);
});
