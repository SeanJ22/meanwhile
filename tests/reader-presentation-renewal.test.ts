import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  readerPresentationRenewalProblems,
  renewalConsistencyProblems,
  READER_PRESENTATION_RENEWAL_PATH,
  type ReaderPresentationRenewal,
  type ReaderRenewalSourceHash,
} from "../lib/control-plane/presentation-renewal.ts";
import { committeePillLabel, committeeTypeLabelById } from "../lib/funding/committee-types.ts";

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const FULL_BEHAVIOR = ["DATA_LOADING", "QUERIES", "IDENTITY_SELECTION", "AUTHORIZATION", "VALIDATION", "PUBLICATION"] as const;
const COMMIT = "a".repeat(40);
const RECEIPT_PATH = "docs/evidence/test-receipt.json";
const RECEIPT_SHA = sha256(Buffer.from("preserved-production-receipt-bytes"));

type DeepWritable<T> = T extends readonly (infer U)[] ? DeepWritable<U>[] : T extends object ? { -readonly [K in keyof T]: DeepWritable<T[K]> } : T;
const clone = (renewal: ReaderPresentationRenewal): DeepWritable<ReaderPresentationRenewal> => structuredClone(renewal) as DeepWritable<ReaderPresentationRenewal>;

/* ============================ pure validator ============================ */

/**
 * A synthetic tree with three receipt-pinned files: two presentation files that
 * actually changed after the proof (admitted), and one unchanged. Tests clone
 * and mutate the returned renewal/tree to exercise each rejection.
 */
function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), "pres-renewal-"));
  const files = {
    "a.css": { orig: "a-orig", cur: "a-new" },
    "b.tsx": { orig: "b-orig", cur: "b-new" },
    "d.css": { orig: "d-orig", cur: "d-orig" }, // pinned but unchanged
  };
  for (const [path, file] of Object.entries(files)) writeFileSync(join(root, path), file.cur);
  const sourceHashes: ReaderRenewalSourceHash[] = Object.entries(files).map(([path, file]) => ({ path, sha256: sha256(Buffer.from(file.orig)) }));
  const renewal: ReaderPresentationRenewal = {
    formatVersion: 1,
    renewalKind: "PRESENTATION_ONLY",
    rationale: "bounded presentation-only renewal (fixture)",
    integrationCommit: COMMIT,
    baselineReceiptPath: RECEIPT_PATH,
    baselineReceiptSha256: RECEIPT_SHA,
    permittedFiles: [
      { path: "a.css", baselineSha256: sha256(Buffer.from(files["a.css"].orig)), renewedSha256: sha256(Buffer.from(files["a.css"].cur)), kind: "STYLESHEET", behaviorReview: "styling only" },
      { path: "b.tsx", baselineSha256: sha256(Buffer.from(files["b.tsx"].orig)), renewedSha256: sha256(Buffer.from(files["b.tsx"].cur)), kind: "PRESENTATION_COMPONENT", behaviorReview: "presentation only" },
    ],
    unchangedBehavior: [...FULL_BEHAVIOR],
    browserVerification: { at: "2026-09-14", head: COMMIT, surfaces: [{ surface: "shell", expectedRecords: "records render", changedControls: "controls work", result: "RENDERED_AS_EXPECTED" }] },
  };
  const options = { receiptPath: RECEIPT_PATH, receiptSha256: RECEIPT_SHA, integrationCommitReachable: true } as const;
  return { root, files, sourceHashes, renewal, options };
}

function run(root: string, sourceHashes: readonly ReaderRenewalSourceHash[], renewal: ReaderPresentationRenewal, options: { receiptPath: string; receiptSha256: string; integrationCommitReachable: boolean }) {
  return readerPresentationRenewalProblems(root, sourceHashes, renewal, options);
}

test("a valid bounded presentation renewal admits exactly the enumerated changed files", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    const { admittedPaths, problems } = run(root, sourceHashes, renewal, options);
    assert.deepEqual(problems, []);
    assert.deepEqual([...admittedPaths].sort(), ["a.css", "b.tsx"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the negative check rejects a reader dependency that changed outside the permitted scope", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    writeFileSync(join(root, "d.css"), "d-changed-outside-scope"); // pinned but not enumerated
    const { admittedPaths, problems } = run(root, sourceHashes, renewal, options);
    assert.ok(!admittedPaths.has("d.css"));
    assert.ok(problems.some((p) => p === "Reader dependency changed outside the permitted presentation renewal: d.css"), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a permitted file whose baseline does not match the preserved receipt is rejected", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.permittedFiles = bad.permittedFiles.map((f) => ({ ...f, baselineSha256: f.path === "a.css" ? sha256(Buffer.from("not-the-receipt-baseline")) : f.baselineSha256 }));
    const { admittedPaths, problems } = run(root, sourceHashes, bad, options);
    assert.ok(!admittedPaths.has("a.css"));
    assert.ok(problems.some((p) => p.includes("a.css") && p.includes("baseline does not match the preserved production fingerprint")), problems.join(" | "));
    assert.ok(problems.some((p) => p === "Reader dependency changed outside the permitted presentation renewal: a.css"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a stale renewed fingerprint (file drifted past the renewal) is rejected", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    writeFileSync(join(root, "a.css"), "a-new-drifted-further");
    const { admittedPaths, problems } = run(root, sourceHashes, renewal, options);
    assert.ok(!admittedPaths.has("a.css"));
    assert.ok(problems.some((p) => p.includes("a.css") && p.includes("renewed fingerprint does not match the current bytes")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a permitted file that did not actually change is rejected as scope inflation", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    const dHash = sha256(Buffer.from("d-orig"));
    bad.permittedFiles = [...bad.permittedFiles, { path: "d.css", baselineSha256: dHash, renewedSha256: dHash, kind: "STYLESHEET", behaviorReview: "unchanged" }];
    const { admittedPaths, problems } = run(root, sourceHashes, bad, options);
    assert.ok(!admittedPaths.has("d.css"));
    assert.ok(problems.some((p) => p.includes("d.css") && p.includes("lists an unchanged file")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a renewal not bound to the integration history is rejected", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    const problems = run(root, sourceHashes, renewal, { ...options, integrationCommitReachable: false }).problems;
    assert.ok(problems.some((p) => p.includes("integration commit is not part of the integration history")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a malformed integration commit is rejected", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.integrationCommit = "not-a-sha";
    bad.browserVerification.head = "not-a-sha";
    const problems = run(root, sourceHashes, bad, options).problems;
    assert.ok(problems.some((p) => p.includes("integration commit is not an exact Git head")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a renewal that does not bind the exact preserved receipt bytes is rejected", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.baselineReceiptSha256 = sha256(Buffer.from("a-different-receipt"));
    const problems = run(root, sourceHashes, bad, options).problems;
    assert.ok(problems.some((p) => p.includes("does not bind the exact preserved production receipt bytes")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a renewal linked to the wrong receipt path is rejected", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.baselineReceiptPath = "docs/evidence/some-other-receipt.json";
    const problems = run(root, sourceHashes, bad, options).problems;
    assert.ok(problems.some((p) => p.includes("not linked to the receipt under validation")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a non-presentation kind is rejected", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.permittedFiles = bad.permittedFiles.map((f) => ({ ...f, kind: f.path === "b.tsx" ? ("DATA_LOADER" as never) : f.kind }));
    const { admittedPaths, problems } = run(root, sourceHashes, bad, options);
    assert.ok(!admittedPaths.has("b.tsx"));
    assert.ok(problems.some((p) => p.includes("b.tsx") && p.includes("kind is not a presentation class")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a renewal that omits a behavior-class attestation is rejected", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.unchangedBehavior = FULL_BEHAVIOR.filter((b) => b !== "IDENTITY_SELECTION");
    const problems = run(root, sourceHashes, bad, options).problems;
    assert.ok(problems.some((p) => p === "Presentation renewal does not attest unchanged IDENTITY_SELECTION behavior"), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("browser verification is required, bound to the commit, and must confirm every surface", () => {
  const { root, sourceHashes, renewal, options } = buildFixture();
  try {
    const missing = clone(renewal);
    missing.browserVerification.surfaces = [];
    assert.ok(run(root, sourceHashes, missing, options).problems.some((p) => p.includes("lacks focused browser verification")));

    const wrongHead = clone(renewal);
    wrongHead.browserVerification.head = "b".repeat(40);
    assert.ok(run(root, sourceHashes, wrongHead, options).problems.some((p) => p.includes("browser verification head is not the recorded integration commit")));

    const unconfirmed = clone(renewal);
    unconfirmed.browserVerification.surfaces = unconfirmed.browserVerification.surfaces.map((s) => ({ ...s, result: "PENDING" as never }));
    assert.ok(run(root, sourceHashes, unconfirmed, options).problems.some((p) => p.includes("did not confirm")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/* ==================== git-integration: verification is stable ==================== */

/**
 * A throwaway git repo whose renewal is bound to a real commit (C1) at which two
 * bound files drifted from their receipt baselines. HEAD then advances one more
 * commit (C2, the renewal itself), reproducing the shape of the real integration:
 * the recorded integration commit is an ANCESTOR of HEAD, not equal to it.
 */
function makeGitRepo() {
  const root = mkdtempSync(join(tmpdir(), "pres-renewal-git-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  const write = (rel: string, body: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };

  const receiptPath = "docs/evidence/receipt.json";
  const origA = "/* a original */\n";
  const origB = "export const b = 1;\n";
  const receipt = { sourceHashes: [{ path: "styles/a.css", sha256: sha256(Buffer.from(origA)) }, { path: "components/b.tsx", sha256: sha256(Buffer.from(origB)) }] };
  write(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  write("styles/a.css", origA);
  write("components/b.tsx", origB);
  git("add", "-A"); git("commit", "-q", "-m", "C0: baseline");

  // C1: the restyle — bound files drift.
  const newA = "/* a lumen restyle */\n";
  const newB = "export const b = 1; /* restyled */\n";
  write("styles/a.css", newA);
  write("components/b.tsx", newB);
  git("add", "-A"); git("commit", "-q", "-m", "C1: restyle");
  const integrationCommit = git("rev-parse", "HEAD").toString().trim();

  const renewal: ReaderPresentationRenewal = {
    formatVersion: 1, renewalKind: "PRESENTATION_ONLY", rationale: "git fixture",
    integrationCommit, baselineReceiptPath: receiptPath, baselineReceiptSha256: sha256(readFileBytes(root, receiptPath)),
    permittedFiles: [
      { path: "styles/a.css", baselineSha256: sha256(Buffer.from(origA)), renewedSha256: sha256(Buffer.from(newA)), kind: "STYLESHEET", behaviorReview: "styling only" },
      { path: "components/b.tsx", baselineSha256: sha256(Buffer.from(origB)), renewedSha256: sha256(Buffer.from(newB)), kind: "PRESENTATION_COMPONENT", behaviorReview: "presentation only" },
    ],
    unchangedBehavior: [...FULL_BEHAVIOR],
    browserVerification: { at: "2026-09-14", head: integrationCommit, surfaces: [{ surface: "shell", expectedRecords: "records", changedControls: "controls", result: "RENDERED_AS_EXPECTED" }] },
  };
  write(READER_PRESENTATION_RENEWAL_PATH, `${JSON.stringify(renewal, null, 2)}\n`);
  git("add", "-A"); git("commit", "-q", "-m", "C2: record renewal");
  return { root, git, integrationCommit };
}
function readFileBytes(root: string, rel: string) { return execFileSync("git", ["show", `HEAD:${rel}`], { cwd: root }); }

test("verification passes after a subsequent evidence/documentation commit (HEAD past the integration commit)", () => {
  const { root, git } = makeGitRepo();
  try {
    // The renewal commit already advanced HEAD past the integration commit; add
    // one more unrelated documentation commit for good measure.
    writeFileSync(join(root, "docs/evidence/notes.md"), "later notes\n");
    git("add", "-A"); git("commit", "-q", "-m", "C3: docs");
    assert.deepEqual(renewalConsistencyProblems(root), [], "unchanged bound files across later commits must still verify");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("verification passes on a GitHub-style merge checkout with the bound files unchanged", () => {
  const { root, git, integrationCommit } = makeGitRepo();
  try {
    const main = git("rev-parse", "HEAD").toString().trim();
    // A side branch off the integration commit, an unrelated change, then a real
    // merge commit — the shape GitHub tests a PR at.
    git("checkout", "-q", "-b", "side", integrationCommit);
    writeFileSync(join(root, "docs/evidence/side.md"), "side\n");
    git("add", "-A"); git("commit", "-q", "-m", "side change");
    git("checkout", "-q", main);
    git("merge", "-q", "--no-ff", "-m", "merge side", "side");
    assert.deepEqual(renewalConsistencyProblems(root), [], "a merge whose ancestry contains the integration commit must verify");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("verification fails when a bound file changes, names the receipt is wrong, or the ancestry is broken", () => {
  // Changed bound file.
  {
    const { root } = makeGitRepo();
    try {
      appendFileSync(join(root, "styles/a.css"), "/* drift after the renewal */\n");
      const problems = renewalConsistencyProblems(root);
      assert.ok(problems.some((p) => p.includes("styles/a.css") && p.includes("renewed fingerprint does not match the current bytes")), problems.join(" | "));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  // Wrong receipt bytes.
  {
    const { root } = makeGitRepo();
    try {
      appendFileSync(join(root, "docs/evidence/receipt.json"), "\n");
      const problems = renewalConsistencyProblems(root);
      assert.ok(problems.some((p) => p.includes("does not bind the exact preserved production receipt bytes")), problems.join(" | "));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  // Invalid ancestry: rewrite the recorded integration commit to one not in history.
  {
    const { root } = makeGitRepo();
    try {
      const renewal = JSON.parse(execFileSync("git", ["show", `HEAD:${READER_PRESENTATION_RENEWAL_PATH}`], { cwd: root }).toString("utf8"));
      renewal.integrationCommit = "f".repeat(40);
      renewal.browserVerification.head = "f".repeat(40);
      writeFileSync(join(root, READER_PRESENTATION_RENEWAL_PATH), `${JSON.stringify(renewal, null, 2)}\n`);
      const problems = renewalConsistencyProblems(root);
      assert.ok(problems.some((p) => p.includes("integration commit is not part of the integration history")), problems.join(" | "));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("verification tolerates a shallow clone with the integration commit absent, but still enforces content", () => {
  // The exact CI shape: actions/checkout at fetch-depth 1-3, so the integration
  // commit is not in the checkout. Absent-on-shallow ancestry must be tolerated
  // (the content bindings still prove the tree), or CI falsely rejects valid
  // evidence — the second defect this fix addresses.
  const { root } = makeGitRepo();
  const shallow = mkdtempSync(join(tmpdir(), "pres-renewal-shallow-"));
  try {
    // -c core.autocrlf=false: match the Linux CI checkout so byte hashes are stable
    // on Windows too (the clone does not inherit the origin's config).
    execFileSync("git", ["clone", "-c", "core.autocrlf=false", "--quiet", "--depth=1", `file:///${root.replace(/\\/g, "/")}`, shallow], { stdio: "pipe" });
    assert.equal(execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: shallow, encoding: "utf8" }).trim(), "true");
    assert.deepEqual(renewalConsistencyProblems(shallow), [], "absent-on-shallow ancestry must be tolerated; content still binds");
    // Content is STILL enforced on a shallow clone.
    appendFileSync(join(shallow, "styles/a.css"), "/* drift on shallow */\n");
    assert.ok(renewalConsistencyProblems(shallow).some((p) => p.includes("styles/a.css")), "a changed bound file must still fail on a shallow clone");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(shallow, { recursive: true, force: true }); }
});

/* ==================== the real committed artifact ==================== */

test("the committed presentation renewal verifies against this checkout (receipt, files, ancestry)", () => {
  // The preflight's exact check: recorded evidence still binds. Stable across the
  // renewal's own commit and any later merge, because it checks ancestry, not
  // HEAD equality, and never regenerates the browser evidence.
  assert.deepEqual(renewalConsistencyProblems(process.cwd()), []);
});

/* ==================== the funding committee pill ==================== */

test("the funding committee pill drops the leading article without touching the prose label", () => {
  for (const [id, expected] of [["super-pac", "super PAC"], ["organization", "organization"], ["party-committee", "party committee"]] as const) {
    const label = committeeTypeLabelById(id);
    assert.ok(label, `missing committee type ${id}`);
    assert.ok(/^an? /.test(label.label), `${id} prose label should keep its article`);
    assert.equal(committeePillLabel(label), expected);
    const markup = renderToStaticMarkup(createElement("span", { className: "pill" }, committeePillLabel(label)));
    assert.ok(markup.includes(expected) && !new RegExp(`>an? ${expected}`).test(markup), markup);
  }
});
