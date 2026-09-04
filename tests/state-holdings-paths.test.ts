import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { checkHoldingPaths, classifyHolding, isLegacyStateHoldingPath, sha256, type HoldingMovePlan, type HoldingPlanRow } from "../lib/holdings/classification.ts";

const dataRoot = "data";
const publicRoot = "public";
const libraryRoot = "lib";

function plantedPlan(): HoldingMovePlan {
  const oldPath = [dataRoot, "funding", "state-money-az-2026.json"].join("/");
  const row: HoldingPlanRow = { ...classifyHolding(oldPath), sha256: sha256("{}"), bytes: 2, referenceCount: 1, references: [{ path: "reader.ts", count: 1 }] };
  return { schemaVersion: 1, baseSha: "a".repeat(40), generatedBy: "test", universeDefinition: "one planted canonical holding", referenceDefinition: "one reader", sourceFiles: [{ path: oldPath, blob: "b".repeat(40) }], discoveredStateInputs: [], discoveredStates: ["az"], rows: [row], exemptions: [], excluded: [], allowedHistoricalReferences: [], counts: { candidates: 1, classifiedHoldings: 1, moved: 1, exempted: 0, excluded: 0, references: 1 } };
}

test("residual check accepts migrated data and rejects a planted old reference", () => {
  const plan = plantedPlan();
  const files = new Map([[plan.rows[0].newPath!, Buffer.from("{}")], ["reader.ts", Buffer.from(`read('${plan.rows[0].newPath}')`)]]);
  assert.deepEqual(checkHoldingPaths(plan, files).issues, []);
  files.set("reader.ts", Buffer.from(`read('${plan.rows[0].oldPath}')`));
  assert.match(checkHoldingPaths(plan, files).issues.join("\n"), /stale state-holding reference/);
});

test("new state's future legacy layout fails without appearing in the finite move plan", () => {
  const plan = plantedPlan();
  const path = [dataRoot, "funding", "state-money-ca-2028.json"].join("/");
  const files = new Map([[plan.rows[0].newPath!, Buffer.from("{}")], [path, Buffer.from("{}")]]);
  assert.equal(isLegacyStateHoldingPath(path), true);
  assert.equal(isLegacyStateHoldingPath([dataRoot, "hunt", "wikipedia-ca-alameda.json"].join("/")), true);
  assert.equal(isLegacyStateHoldingPath([libraryRoot, "registry", "rosters-ca-alameda.ts"].join("/")), true);
  assert.match(checkHoldingPaths(plan, files).issues.join("\n"), /newly introduced legacy state layout/);
});

test("record JSON pointers retain exact file exemptions without hiding legacy holdings", () => {
  const plan = plantedPlan();
  const path = [dataRoot, "ballot", "candidate-cards-2026.json"].join("/");
  const exemption: HoldingPlanRow = { ...classifyHolding(path), sha256: sha256("{}"), bytes: 2, referenceCount: 1, references: [] };
  assert.equal(exemption.disposition, "EXEMPT");
  plan.exemptions.push(exemption);
  plan.sourceFiles.push({ path, blob: "c".repeat(40) });
  plan.counts.candidates++;
  plan.counts.classifiedHoldings++;
  plan.counts.exempted++;
  const files = new Map([[plan.rows[0].newPath!, Buffer.from("{}")], ["evidence.json", Buffer.from(JSON.stringify({ record: `${path}#/cards/example` }))]]);
  assert.deepEqual(checkHoldingPaths(plan, files).issues, []);
  for (const legacy of [plan.rows[0].oldPath, [dataRoot, "funding", "state-money-ca-2028.json"].join("/")]) {
    files.set("evidence.json", Buffer.from(JSON.stringify({ record: `${legacy}#/records/0` })));
    assert.match(checkHoldingPaths(plan, files).issues.join("\n"), /stale state-holding reference/);
  }
});

test("a composed legacy path is detected and an unrelated fixture stays a fixture", () => {
  const plan = plantedPlan();
  const pieces = plan.rows[0].oldPath.split("/");
  const files = new Map([[plan.rows[0].newPath!, Buffer.from("{}")], ["reader.ts", Buffer.from(`join(root, ${pieces.map((p) => JSON.stringify(p)).join(", ")})`)]]);
  assert.match(checkHoldingPaths(plan, files).issues.join("\n"), /stale state-holding reference/);
  files.set("reader.ts", Buffer.from(`read('tests/fixtures/example/${plan.rows[0].oldPath}')`));
  assert.deepEqual(checkHoldingPaths(plan, files).issues, []);
});

test("dynamic filenames cannot reconstruct removed domain-first readers", () => {
  const plan = plantedPlan();
  for (const domain of ["funding", "identity", "jurisdictions", "officials", "zcta", "ballot"]) {
    const text = `join(root, ${JSON.stringify(dataRoot)}, ${JSON.stringify(domain)}, file)`;
    const files = new Map([[plan.rows[0].newPath!, Buffer.from("{}")], ["reader.ts", Buffer.from(text)]]);
    assert.match(checkHoldingPaths(plan, files).issues.join("\n"), /stale state-holding reference/);
  }
});

test("historical evidence allowances bind to an exact field and its hash", () => {
  const plan = plantedPlan();
  const evidence = `Acquired from ${plan.rows[0].oldPath}`;
  plan.allowedHistoricalReferences = [{ path: "evidence.json", jsonPointer: "/sourceClaim", sha256: sha256(evidence), reason: "Immutable source identity at observation time" }];
  const files = new Map([[plan.rows[0].newPath!, Buffer.from("{}")], ["evidence.json", Buffer.from(JSON.stringify({ sourceClaim: evidence }))]]);
  assert.deepEqual(checkHoldingPaths(plan, files).issues, []);
  files.set("evidence.json", Buffer.from(JSON.stringify({ sourceClaim: evidence, currentReader: plan.rows[0].oldPath })));
  assert.match(checkHoldingPaths(plan, files).issues.join("\n"), /stale state-holding reference/);
  files.set("evidence.json", Buffer.from(JSON.stringify({ sourceClaim: evidence + " changed" })));
  assert.match(checkHoldingPaths(plan, files).issues.join("\n"), /historical claim is missing or changed/);
});

test("denominator identity and missing planned holdings cannot yield a vacuous green", () => {
  const plan = plantedPlan();
  assert.match(checkHoldingPaths(plan, new Map()).issues.join("\n"), /planned canonical holding is missing/);
  plan.counts.classifiedHoldings++;
  assert.match(checkHoldingPaths(plan, new Map()).issues.join("\n"), /denominator identity failed/);
});

test("classification distinguishes canonical acquisitions from state-themed evidence", () => {
  assert.equal(classifyHolding([publicRoot, "geo", "sldl-33.geojson"].join("/")).disposition, "MOVE");
  assert.equal(classifyHolding([dataRoot, "hunt", "wikipedia-nj-morris.json"].join("/")).disposition, "MOVE");
  assert.equal(classifyHolding([dataRoot, "hunt", "vail-novus-probe.json"].join("/")).disposition, "NON_HOLDING");
  assert.equal(classifyHolding([dataRoot, "reference", "census_govt_units_2022.csv"].join("/")).disposition, "EXEMPT");
  assert.equal(classifyHolding([libraryRoot, "registry", "rosters-az-cawcd.ts"].join("/")).disposition, "MOVE");
  assert.equal(classifyHolding([libraryRoot, "registry", "rosters-nj-morris.ts"].join("/")).disposition, "NON_HOLDING");
  assert.equal(classifyHolding([libraryRoot, "registry", "body-rosters.ts"].join("/")).disposition, "EXEMPT");
});

test("standalone residual command fails a planted violation without repairing it", () => {
  const root = mkdtempSync(join(tmpdir(), "holdings-residual-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const plan = plantedPlan();
    for (const [path, value] of [["data/state-holdings/move-plan.json", JSON.stringify(plan)], [plan.rows[0].newPath!, "{}"]]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), value);
    }
    const args = ["--experimental-strip-types", resolve("scripts/state-holdings-check.mts"), "--root", root];
    assert.equal(spawnSync(process.execPath, args, { encoding: "utf8" }).status, 0);
    const violation = `read('${plan.rows[0].oldPath}')`;
    writeFileSync(join(root, "planted-reader.ts"), violation);
    const rejected = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /stale state-holding reference/);
    assert.equal(readFileSync(join(root, "planted-reader.ts"), "utf8"), violation);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  }
});
