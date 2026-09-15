import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  readerPresentationRenewalProblems,
  sha256,
  type ReaderClosureReceipt,
  type ReaderPresentationRenewal,
} from "../lib/holdings/reader-census.ts";
import { committeePillLabel, committeeTypeLabelById } from "../lib/funding/committee-types.ts";

const FULL_BEHAVIOR = ["DATA_LOADING", "QUERIES", "IDENTITY_SELECTION", "AUTHORIZATION", "VALIDATION", "PUBLICATION"] as const;
const COMMIT = "a".repeat(40);
const RECEIPT_PATH = "docs/evidence/test-receipt.json";
const RECEIPT_SHA = sha256(Buffer.from("preserved-production-receipt-bytes"));

type DeepWritable<T> = T extends readonly (infer U)[] ? DeepWritable<U>[] : T extends object ? { -readonly [K in keyof T]: DeepWritable<T[K]> } : T;
const clone = (renewal: ReaderPresentationRenewal): DeepWritable<ReaderPresentationRenewal> => structuredClone(renewal) as DeepWritable<ReaderPresentationRenewal>;

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
  const receipt: ReaderClosureReceipt = {
    formatVersion: 1,
    censusPath: "x",
    censusSha256: "0".repeat(64),
    holdingsDigest: "0".repeat(64),
    registrySha256: "0".repeat(64),
    sourceHashes: Object.entries(files).map(([path, file]) => ({ path, sha256: sha256(Buffer.from(file.orig)) })),
    evidenceHashes: [],
  };
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
  return { root, files, receipt, renewal, options };
}

function run(root: string, receipt: ReaderClosureReceipt, renewal: ReaderPresentationRenewal, options: { receiptPath: string; receiptSha256: string; integrationCommitReachable: boolean }) {
  return readerPresentationRenewalProblems(root, receipt, renewal, options);
}

test("a valid bounded presentation renewal admits exactly the enumerated changed files", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    const { admittedPaths, problems } = run(root, receipt, renewal, options);
    assert.deepEqual(problems, []);
    assert.deepEqual([...admittedPaths].sort(), ["a.css", "b.tsx"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the negative check rejects a reader dependency that changed outside the permitted scope", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    // d.css is pinned by the receipt but NOT enumerated; change it on disk.
    writeFileSync(join(root, "d.css"), "d-changed-outside-scope");
    const { admittedPaths, problems } = run(root, receipt, renewal, options);
    assert.ok(!admittedPaths.has("d.css"));
    assert.ok(problems.some((p) => p === "Reader dependency changed outside the permitted presentation renewal: d.css"), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a permitted file whose baseline does not match the preserved receipt is rejected", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.permittedFiles = bad.permittedFiles.map((f) => ({ ...f, baselineSha256: f.path === "a.css" ? sha256(Buffer.from("not-the-receipt-baseline")) : f.baselineSha256 }));
    const { admittedPaths, problems } = run(root, receipt, bad, options);
    assert.ok(!admittedPaths.has("a.css"));
    assert.ok(problems.some((p) => p.includes("a.css") && p.includes("baseline does not match the preserved production fingerprint")), problems.join(" | "));
    // and a.css now reads as an unadmitted out-of-scope change (fails closed)
    assert.ok(problems.some((p) => p === "Reader dependency changed outside the permitted presentation renewal: a.css"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a stale renewed fingerprint (file drifted past the renewal) is rejected", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    // The file drifts again after the renewal was authored.
    writeFileSync(join(root, "a.css"), "a-new-drifted-further");
    const { admittedPaths, problems } = run(root, receipt, renewal, options);
    assert.ok(!admittedPaths.has("a.css"));
    assert.ok(problems.some((p) => p.includes("a.css") && p.includes("renewed fingerprint does not match the current bytes")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a permitted file that did not actually change is rejected as scope inflation", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    // Enumerate d.css, which is unchanged (renewed == baseline).
    const bad = clone(renewal);
    const dHash = sha256(Buffer.from("d-orig"));
    bad.permittedFiles = [...bad.permittedFiles, { path: "d.css", baselineSha256: dHash, renewedSha256: dHash, kind: "STYLESHEET", behaviorReview: "unchanged" }];
    const { admittedPaths, problems } = run(root, receipt, bad, options);
    assert.ok(!admittedPaths.has("d.css"));
    assert.ok(problems.some((p) => p.includes("d.css") && p.includes("lists an unchanged file")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a renewal not bound to the integration history is rejected", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    const problems = run(root, receipt, renewal, { ...options, integrationCommitReachable: false }).problems;
    assert.ok(problems.some((p) => p.includes("integration commit is not part of the integration history")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a malformed integration commit is rejected", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.integrationCommit = "not-a-sha";
    bad.browserVerification.head = "not-a-sha";
    const problems = run(root, receipt, bad, options).problems;
    assert.ok(problems.some((p) => p.includes("integration commit is not an exact Git head")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a renewal that does not bind the exact preserved receipt bytes is rejected", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.baselineReceiptSha256 = sha256(Buffer.from("a-different-receipt"));
    const problems = run(root, receipt, bad, options).problems;
    assert.ok(problems.some((p) => p.includes("does not bind the exact preserved production receipt bytes")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a renewal linked to the wrong receipt path is rejected", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.baselineReceiptPath = "docs/evidence/some-other-receipt.json";
    const problems = run(root, receipt, bad, options).problems;
    assert.ok(problems.some((p) => p.includes("not linked to the receipt under validation")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a non-presentation kind is rejected", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.permittedFiles = bad.permittedFiles.map((f) => ({ ...f, kind: f.path === "b.tsx" ? ("DATA_LOADER" as never) : f.kind }));
    const { admittedPaths, problems } = run(root, receipt, bad, options);
    assert.ok(!admittedPaths.has("b.tsx"));
    assert.ok(problems.some((p) => p.includes("b.tsx") && p.includes("kind is not a presentation class")), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a renewal that omits a behavior-class attestation is rejected", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    const bad = clone(renewal);
    bad.unchangedBehavior = FULL_BEHAVIOR.filter((b) => b !== "IDENTITY_SELECTION");
    const problems = run(root, receipt, bad, options).problems;
    assert.ok(problems.some((p) => p === "Presentation renewal does not attest unchanged IDENTITY_SELECTION behavior"), problems.join(" | "));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("browser verification is required, bound to the commit, and must confirm every surface", () => {
  const { root, receipt, renewal, options } = buildFixture();
  try {
    const missing = clone(renewal);
    missing.browserVerification.surfaces = [];
    assert.ok(run(root, receipt, missing, options).problems.some((p) => p.includes("lacks focused browser verification")));

    const wrongHead = clone(renewal);
    wrongHead.browserVerification.head = "b".repeat(40);
    assert.ok(run(root, receipt, wrongHead, options).problems.some((p) => p.includes("browser verification is not bound to the integration commit")));

    const unconfirmed = clone(renewal);
    unconfirmed.browserVerification.surfaces = unconfirmed.browserVerification.surfaces.map((s) => ({ ...s, result: "PENDING" as never }));
    assert.ok(run(root, receipt, unconfirmed, options).problems.some((p) => p.includes("did not confirm")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the committed presentation-renewal artifact matches the current tree and receipt", () => {
  // Fails closed on any hand-edit or drift: the artifact must be exactly what the
  // generator derives from the preserved receipt and the current reader bytes.
  execFileSync("node", ["scripts/reader-presentation-renewal.mjs", "--check"], { cwd: process.cwd(), stdio: "pipe" });
});

test("the funding committee pill drops the leading article without touching the prose label", () => {
  for (const [id, expected] of [["super-pac", "super PAC"], ["organization", "organization"], ["party-committee", "party committee"]] as const) {
    const label = committeeTypeLabelById(id);
    assert.ok(label, `missing committee type ${id}`);
    // The prose label (used inline in sentences) keeps its article.
    assert.ok(/^an? /.test(label.label), `${id} prose label should keep its article`);
    // The pill reader strips exactly the leading article.
    assert.equal(committeePillLabel(label), expected);
    const markup = renderToStaticMarkup(createElement("span", { className: "pill" }, committeePillLabel(label)));
    assert.ok(markup.includes(expected) && !new RegExp(`>an? ${expected}`).test(markup), markup);
  }
});
