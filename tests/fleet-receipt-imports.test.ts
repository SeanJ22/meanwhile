import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build, type Metafile } from "esbuild";
import ts from "typescript";
import { PROMOTER_VERSION, RECEIPTS_DIR, receiptSummary, type PromotionReceipt } from "../lib/control-plane/promotion/historical-receipt.ts";
import type { FleetReceiptStore } from "../lib/control-plane/fleet-receipt-store.ts";
import type { HistoricalWindowRun } from "../lib/control-plane/fleet-delivery.ts";

const ENTRY = "lib/control-plane/fleet-receipt-store.ts";
const LEAF = "lib/control-plane/promotion/historical-receipt.ts";
const REPOSITORY_CONTRACT = "lib/control-plane/repository/types.ts";
const AT = "2026-09-05T18:00:00.000Z";
const OBSERVED = "2026-09-05T18:01:00.000Z";

async function bundle(root: string, entry = ENTRY) {
  return build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false,
    metafile: true, platform: "node", packages: "external", format: "esm", logLevel: "silent" });
}

function modulePaths(metafile: Metafile): string[] {
  return Object.keys(metafile.inputs).map(path => path.replaceAll("\\", "/")).sort();
}

test("receipt loader executable closure excludes the retiring producer and its civic source graph", async t => {
  const result = await bundle(process.cwd());
  const inputs = modulePaths(result.metafile);
  assert.deepEqual(inputs, [ENTRY, LEAF, REPOSITORY_CONTRACT].sort(), "Only archive loading, its immutable leaf contract and canonical JSON support may execute");
  const external = Object.values(result.metafile.inputs).flatMap(value => value.imports).filter(value => value.external);
  assert.ok(external.every(value => value.path.startsWith("node:")), "The archive reader has no external package runtime dependency");
  const baseline = JSON.parse(readFileSync(new URL("../docs/fleet-receipt-imports-baseline.json", import.meta.url), "utf8")) as {
    baseSha: string; inputCount: number; sourceBytes: number; bundleBytes: number; inputs: { path: string }[];
  };
  assert.ok(baseline.inputs.some(input => input.path === "lib/control-plane/promotion/promoter.ts"));
  assert.ok(inputs.length < baseline.inputCount);
  t.diagnostic(JSON.stringify({ baselineSha: baseline.baseSha, baselineInputCount: baseline.inputCount, currentInputCount: inputs.length,
    baselineSourceBytes: baseline.sourceBytes, currentSourceBytes: Object.values(result.metafile.inputs).reduce((n, value) => n + value.bytes, 0),
    note: "Executable source closure; packages external; no runtime timing or production-performance claim" }));
});

test("historical receipt leaf has no imports, including type-only and re-export dependencies", async () => {
  const source = ts.createSourceFile(LEAF, readFileSync(resolve(LEAF), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isImportTypeNode(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
      (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")))) imports.push(node.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.deepEqual(imports, []);
  const result = await bundle(process.cwd(), LEAF);
  assert.deepEqual(modulePaths(result.metafile), [LEAF]);
  assert.deepEqual(result.metafile.inputs[LEAF].imports, []);
});

test("historical receipt contract typechecks independently of application and producer types", () => {
  const program = ts.createProgram([resolve(LEAF)], { noEmit: true, strict: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2022.d.ts"], types: [] });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => "\n",
  }));
  assert.deepEqual(program.getSourceFiles().filter(file => !file.isDeclarationFile).map(file => resolve(file.fileName)), [resolve(LEAF)]);
});

test("copied archive loader reads and retains historical receipts with the producer and all its data physically absent", async t => {
  const root = mkdtempSync(join(tmpdir(), "fleet-receipt-imports-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("fleet-receipt-imports-"));
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  for (const path of [ENTRY, LEAF, REPOSITORY_CONTRACT]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(resolve(path), join(root, path));
  }
  for (const absent of ["lib/control-plane/promotion/promoter.ts", "lib/control-plane/promotion/window.ts",
    "lib/control-plane/promotion/types.ts", "lib/control-plane/promotion/reader-projection.ts", "data", "tests/fixtures"]) {
    assert.equal(existsSync(join(root, absent)), false, `${absent} must not be supplied by this isolated copy`);
  }
  const result = await bundle(root);
  assert.deepEqual(modulePaths(result.metafile), [ENTRY, LEAF, REPOSITORY_CONTRACT].sort());
  const output = join(root, "archive-loader.mjs");
  writeFileSync(output, result.outputFiles[0].contents);
  const isolated = await import(pathToFileURL(output).href) as { createFleetReceiptStore: (input: {
    targets: readonly { kind: "SHADOW"; root: string }[];
  }) => FleetReceiptStore };
  const receiptId = `pr-${"a".repeat(24)}`;
  const receiptPath = join(root, ...RECEIPTS_DIR, `${receiptId}.json`);
  // A saved historical refusal shape, not a claim that this test executed a promotion or window.
  const receipt: PromotionReceipt = { formatVersion: 1, version: PROMOTER_VERSION, receiptId, at: AT, windowId: "archive-fixture-window",
    target: { kind: "SHADOW", root }, authority: { enabled: false, basis: "LIVE_ACTIVATION_GATE", openRecordClasses: [], reason: "Historical refusal fixture" },
    items: [], refused: [{ itemId: "archive-fixture-item", recordClass: "meeting-times", code: "PROMOTION_OFF", detail: "Historical disabled-gate evidence" }],
    before: { path: join(root, "data", "meetings-snapshot.json"), existed: false, sha256: null, copy: null },
    after: { sha256: null, meetings: null, written: false }, verification: null, regression: null, reversal: null, incident: null,
    receiptPath, lines: ["Archive fixture only; no publication performed"] };
  const window: HistoricalWindowRun = { formatVersion: 1, windowId: receipt.windowId!, localDate: "2026-09-05", zone: "America/New_York",
    scheduledFor: AT, trigger: "MANUAL", mode: "SHADOW", startedAt: AT, finishedAt: OBSERVED, host: "archive-fixture", testedSha: null,
    provider: "fixture", caughtUp: [], lock: { leaseId: "fixture", holder: "fixture", claimedAt: AT, expiresAt: OBSERVED, releasedAt: OBSERVED },
    activationGate: { promotionEnabled: false, mode: "SHADOW", openRecordClasses: [], independentlyReproduced: false, readFrom: null,
      contracts: { READER: "UNKNOWN", TRUTH: "UNKNOWN", FRESHNESS: "UNKNOWN" }, reason: "Historical reporting fixture" },
    stages: [], pipeline: { items: 1, byStage: { SCOUTED: 0, CONFIRMED: 0, VERIFIED: 0, AUDITED: 0, APPROVED_FOR_PROMOTION: 0 },
      refused: 1, verdicts: [{ itemId: "archive-fixture-item", recordClass: "meeting-times", stage: null, verdict: "REFUSE_WOULD", reason: "Historical refusal fixture" }], byRecordClass: [] },
    promoted: 0, controls: null, incidents: [], digestPath: null, mirrored: null, recordPath: null,
    promotionReceipts: [receiptSummary(receipt)] };
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, JSON.stringify(receipt));
  const store = isolated.createFleetReceiptStore({ targets: [{ kind: "SHADOW", root }] });
  const loaded = await store.read([window], OBSERVED);
  assert.equal(loaded.entries[0].state, "LOADED");
  assert.deepEqual(loaded.receipts, [receipt]);
  assert.equal(existsSync(receipt.before.path), false, "Receipt-only loading must not need or create a Reader snapshot");
  writeFileSync(receiptPath, "{invalid archived JSON");
  const retained = await store.read([window], "2026-09-05T18:02:00.000Z");
  assert.equal(retained.entries[0].state, "RETAINED");
  assert.equal(retained.entries[0].lastSuccessfulReadAt, OBSERVED);
  assert.deepEqual(retained.receipts, [receipt]);
  assert.ok(retained.entries[0].gaps.includes("RECEIPT_JSON_INVALID"));
  assert.equal(existsSync(join(root, "lib/control-plane/promotion/promoter.ts")), false);
});
