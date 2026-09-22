import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { isDocumentaryAdvance, observationScope, readCommitPaths, readDeploymentRange, receiptCoversServed } from "../scripts/deploy-observation-scope.mjs";
import { productionIntegrityReceipt } from "../lib/ops/production-integrity-data-plane.ts";
import type { IntegrityRecord } from "../lib/ops/production-integrity.ts";
import { pollUntilServed } from "../scripts/post-deploy-observer.mts";

const NOW = Date.parse("2026-09-21T12:00:00Z");
function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=CI fixture", "-c", "user.email=ci@example.invalid", ...args], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  }).trim();
}
function put(root: string, path: string, text = path) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function commit(root: string, message: string) {
  git(root, "add", "--all"); git(root, "commit", "--quiet", "-m", message);
  return git(root, "rev-parse", "HEAD");
}
function fixture(t: { after(fn: () => void): void }) {
  const home = join(process.cwd(), ".scratch", "observer-tests");
  mkdirSync(home, { recursive: true });
  const root = mkdtempSync(join(home, "repo-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "--quiet", "-b", "main");
  put(root, "README.md");
  const first = commit(root, "initial documentation");
  put(root, "app/current.ts");
  const software = commit(root, "software awaiting observation");
  git(root, "checkout", "--quiet", "-b", "docs");
  put(root, "docs/note.md"); commit(root, "documentary change");
  git(root, "checkout", "--quiet", "main");
  git(root, "merge", "--no-ff", "--quiet", "docs", "-m", "documentary merge");
  return { root, first, software, head: git(root, "rev-parse", "HEAD") };
}
function held(sha: string, runId: string | null = null) {
  const record: { -readonly [P in keyof IntegrityRecord]: IntegrityRecord[P] } = {
    formatVersion: 1, deployedSha: sha, mainSha: sha, observed: "HELD", failureClass: null,
    detail: "fixture: real schema observation held", observedAt: new Date(NOW - 60_000).toISOString(),
    moment: "post-deploy", gateExit: 0,
  };
  return { kind: "HELD", receipt: productionIntegrityReceipt(record, { runId }), record };
}
function readers(sha: string | null, authority: unknown = held(sha ?? "a".repeat(40))) {
  return { observe: async () => ({ sha }), readAuthority: async () => authority, now: () => NOW };
}

test("deployment paths enumerate ordinary, root and documentary merge commits", (t) => {
  const f = fixture(t);
  assert.deepEqual(readCommitPaths(f.root, f.first), ["README.md"]);
  assert.deepEqual(readCommitPaths(f.root, f.software), ["app/current.ts"]);
  assert.equal(git(f.root, "show", "--name-only", "--format=", f.head), "", "reproduce the measured merge blind spot");
  assert.deepEqual(readCommitPaths(f.root, f.head), ["docs/note.md"]);
});

test("shipping merges, deletions and renames retain every potentially shipping path", (t) => {
  const f = fixture(t);
  git(f.root, "checkout", "--quiet", "-b", "shipping");
  put(f.root, "app/renamed.ts", "replacement");
  rmSync(join(f.root, "app/current.ts"));
  renameSync(join(f.root, "docs/note.md"), join(f.root, "app/moved.ts"));
  commit(f.root, "move and delete");
  git(f.root, "checkout", "--quiet", "main");
  git(f.root, "merge", "--no-ff", "--quiet", "shipping", "-m", "shipping merge");
  assert.deepEqual(readCommitPaths(f.root, git(f.root, "rev-parse", "HEAD")),
    ["app/current.ts", "app/moved.ts", "app/renamed.ts", "docs/note.md"]);
});

test("unknown commits, missing parents and unproved ancestry never become empty proof", (t) => {
  const f = fixture(t);
  assert.equal(readCommitPaths(f.root, "f".repeat(40)), null);
  assert.equal(readCommitPaths(f.root, "--all"), null);
  const shallow = join(f.root, "shallow");
  git(f.root, "clone", "--quiet", "--depth=1", "--no-local", f.root, shallow);
  assert.equal(git(shallow, "rev-parse", "--is-shallow-repository"), "true");
  assert.equal(readCommitPaths(shallow, f.head), null);
  assert.equal(readDeploymentRange(shallow, f.software, f.head), null);
  assert.equal(isDocumentaryAdvance(shallow, f.software, f.head, f.head), false);
  assert.equal(readDeploymentRange(f.root, f.head, f.first), null);
});

test("blobless full history proves paths and ancestry without hydrating old file contents", (t) => {
  const f = fixture(t);
  git(f.root, "config", "uploadpack.allowFilter", "true");
  const partial = join(f.root, "partial");
  git(f.root, "clone", "--quiet", "--no-local", "--filter=blob:none", "--no-checkout", f.root, partial);
  const missing = () => git(partial, "rev-list", "--objects", "--all", "--missing=print")
    .split("\n").filter((line) => line.startsWith("?")).sort();
  const before = missing();
  assert.ok(before.length > 0, "fixture must genuinely omit blobs");
  assert.deepEqual(readCommitPaths(partial, f.head), ["docs/note.md"]);
  assert.deepEqual(readDeploymentRange(partial, f.software, f.head)?.paths, ["docs/note.md"]);
  assert.equal(isDocumentaryAdvance(partial, f.software, f.head, f.head), true);
  assert.deepEqual(missing(), before, "name/status proofs must not lazy-fetch old blobs");
});

test("a documentary merge skips only when the complete range and fresh canonical receipt agree", async (t) => {
  const f = fixture(t);
  const result = await observationScope(f.root, f.head, readers(f.software));
  assert.equal(result.action, "skip");
  assert.equal(result.sha, f.software);
  assert.ok(result.reason.includes(held(f.software).receipt.id));
});

test("a documentary tip cannot suppress earlier software not yet deployed", async (t) => {
  const f = fixture(t);
  const result = await observationScope(f.root, f.head, readers(f.first));
  assert.equal(result.action, "observe-target");
  assert.equal(result.sha, f.head);
  assert.match(result.reason, /unobserved software/);
});

test("owed receipts reread the served software instead of waiting for an omitted documentary deploy", async (t) => {
  const f = fixture(t);
  const wrong = held(f.first);
  const expired = held(f.software);
  expired.record.observedAt = new Date(NOW - 25 * 3_600_000).toISOString();
  const refused = held(f.software);
  refused.record.observed = "REFUSED";
  refused.record.gateExit = 1;
  for (const authority of [{ kind: "NOT_RECORDED" }, { kind: "STORE_UNREACHABLE" }, wrong, expired, refused]) {
    const result = await observationScope(f.root, f.head, readers(f.software, authority));
    assert.equal(result.action, "observe-served");
    assert.equal(result.sha, f.software, "receipt must name production, never the documentary candidate");
  }
});

test("manual revalidation cannot reuse even a fresh receipt", async (t) => {
  const f = fixture(t);
  const result = await observationScope(f.root, f.head, { ...readers(f.software), force: true });
  assert.equal(result.action, "observe-served");
  assert.equal(result.sha, f.software);
});

test("unreadable production or Git evidence remains observation rather than a skip", async (t) => {
  const f = fixture(t);
  for (const sha of [null, "f".repeat(40)]) {
    assert.equal((await observationScope(f.root, f.head, readers(sha))).action, "observe-target");
  }
  assert.equal((await observationScope(f.root, "f".repeat(40), readers(f.software))).action, "observe-target");
});

test("fresh receipt proof rejects future timestamps, incomplete success and wrong subjects", () => {
  const sha = "a".repeat(40);
  assert.equal(receiptCoversServed(held(sha), sha, NOW), true);
  for (const change of [
    { observedAt: new Date(NOW + 1).toISOString() }, { observedAt: null }, { observedAt: "bad" },
    { moment: "pre-deploy" }, { gateExit: 2 }, { failureClass: "CHECK_NEVER_RUN" },
    { observed: "COULD_NOT_TELL" }, { deployedSha: "b".repeat(40) },
  ]) {
    const authority = held(sha);
    Object.assign(authority.record, change);
    assert.equal(receiptCoversServed(authority, sha, NOW), false);
  }
});

test("a canonical receipt must match its complete envelope and exact embedded record", async (t) => {
  const f = fixture(t);
  for (const runId of [null, "post-deploy-observer-123456"]) {
    assert.equal(receiptCoversServed(held(f.software, runId), f.software, NOW), true);
  }
  for (const patch of [
    { id: "plausible-but-wrong" }, { actor: "unknown-writer" }, { stagingSha: f.first },
    { createdAt: new Date(NOW).toISOString() }, { deployId: "unexpected" },
    { sourceRunId: "undeclared-run" }, { sourceRunId: undefined },
    { sourceRunId: "  " }, { sourceRunId: 17 }, { unknownField: true },
    { productionIntegrity: { ...held(f.software).record, detail: "different receipt subject" } },
  ]) {
    const authority = held(f.software);
    Object.assign(authority.receipt, patch);
    assert.equal(receiptCoversServed(authority, f.software, NOW), false);
    assert.equal((await observationScope(f.root, f.head, readers(f.software, authority))).action, "observe-served");
  }
  const incomplete = { ...held(f.software), receipt: { id: "canonical-looking" } };
  assert.equal(receiptCoversServed(incomplete, f.software, NOW), false);
});

test("production advances only inside a freshly proven equivalent documentary range", async (t) => {
  const f = fixture(t);
  git(f.root, "checkout", "--quiet", "-b", "more-docs");
  put(f.root, "docs/later.md"); commit(f.root, "later documentation");
  git(f.root, "checkout", "--quiet", "main");
  git(f.root, "merge", "--no-ff", "--quiet", "more-docs", "-m", "second documentary merge");
  const candidate = git(f.root, "rev-parse", "HEAD");
  const scope = await observationScope(f.root, candidate, readers(f.software, { kind: "NOT_RECORDED" }));
  assert.equal(scope.action, "observe-served");
  for (const observedSha of [f.head, candidate]) {
    const result = await pollUntilServed({
      expectedSha: scope.sha,
      documentaryRange: { root: f.root, originallyServedSha: scope.sha, candidateSha: candidate },
      probe: async () => ({ sha: observedSha, how: "fixture advance", httpStatus: 200 }),
      sleep: async () => assert.fail("equivalent production must not wait for the superseded served SHA"),
    });
    assert.equal(result.outcome, "SERVING_EXPECTED");
    assert.equal(result.servedSha, observedSha, "receipt input must name what the fresh probe actually served");
    assert.equal(result.waitedSeconds, 0);
    const exact = await pollUntilServed({
      expectedSha: scope.sha, attempts: 1,
      probe: async () => ({ sha: observedSha, how: "staging/default", httpStatus: 200 }),
      sleep: async () => {},
    });
    assert.equal(exact.outcome, "PRODUCTION_BEHIND", "default and staging stay exact");
  }
  put(f.root, "docs/beyond.md");
  const beyond = commit(f.root, "outside the scoped candidate");
  for (const observed of [f.first, beyond, "f".repeat(40)]) {
    assert.equal(isDocumentaryAdvance(f.root, f.software, candidate, observed), false);
  }
  assert.equal(isDocumentaryAdvance(f.root, f.first, candidate, candidate), false, "accumulated shipping is never equivalent");
  put(f.root, "app/new.ts");
  const shipping = commit(f.root, "shipping change");
  assert.equal(isDocumentaryAdvance(f.root, f.software, shipping, shipping), false);
  const refused = await pollUntilServed({
    expectedSha: scope.sha, attempts: 1,
    documentaryRange: { root: f.root, originallyServedSha: scope.sha, candidateSha: candidate },
    probe: async () => ({ sha: shipping, how: "new software", httpStatus: 200 }), sleep: async () => {},
  });
  assert.equal(refused.outcome, "PRODUCTION_BEHIND");
});
