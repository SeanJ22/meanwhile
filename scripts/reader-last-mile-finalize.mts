import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  applyReaderApplicability,
  buildReaderCensus,
  censusClosureFailures,
  composeCanonicalRouteProofs,
  composeReaderComponentProofs,
  inheritReaderProofs,
  packReaderEvidence,
  projectCanonicalReaderRecords,
  readerBundleEvidence,
  readerCensusSummary,
  readerSourceFingerprint,
  readReaderEvidence,
  reconcileDelivery,
  renderCanonicalReaderComponents,
  renderCensusMarkdown,
  sha256,
  type ReaderClosureReceipt,
  type ReaderCensus,
  type ReaderDeliveryProof,
  type ReaderSurfaceClassWitness,
} from "../lib/holdings/reader-census.ts";
import { readerProofSources } from "./lib/reader-proof-sources.ts";

const root = process.cwd();
const codeHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const baselineCensusPath = "docs/evidence/reader-last-mile-closure.json";
const baselineReceiptPath = "docs/evidence/reader-last-mile-closure-receipt.json";
const invalidationPath = "docs/evidence/reader-last-mile-final-invalidation.json";
const componentPath = "docs/evidence/reader-last-mile-final-delta-components.json";
const witnessPath = "docs/evidence/reader-last-mile-final-delta-witnesses.json";
const bundlePath = "docs/evidence/reader-last-mile-final-bundle.json";
const buildReceiptPath = "docs/evidence/reader-last-mile-final-build-receipt.json";
const portraitProofPath = "docs/evidence/reader-last-mile-final-portraits.json";
const censusPath = "docs/evidence/reader-last-mile-final-closure.json";
const receiptPath = "docs/evidence/reader-last-mile-final-closure-receipt.json";
const routePaths = [
  "docs/evidence/reader-last-mile-final-delta-routes.json",
  "docs/evidence/reader-last-mile-final-ballot.json",
  "docs/evidence/reader-last-mile-final-ballot-ask.json",
  "docs/evidence/reader-last-mile-final-candidate-profiles-ask.json",
  "docs/evidence/reader-last-mile-final-meeting-routes.json",
  "docs/evidence/reader-last-mile-final-agenda.json",
  "docs/evidence/reader-last-mile-final-meetings-ask.json",
  "docs/evidence/reader-last-mile-final-meeting-knowledge-ask.json",
  "docs/evidence/reader-last-mile-final-money-ask.json",
  "docs/evidence/reader-last-mile-final-federal-money-ask.json",
];
const preparedCensusPath = process.env.READER_FINAL_PREPARED_CENSUS ?? "../reader-last-mile-final-prepared-census.json";
const proofSourcesPath = process.env.READER_PROOF_SOURCES ?? "../reader-last-mile-final-proof-sources.json";

if (process.argv.includes("--prepare")) {
  const baseCensus = buildReaderCensus(root);
  const projection = await projectCanonicalReaderRecords(root, baseCensus);
  const prepared = applyReaderApplicability(baseCensus, projection);
  writeFileSync(preparedCensusPath, `${JSON.stringify(prepared)}\n`);
  writeFileSync(proofSourcesPath, `${JSON.stringify(readerProofSources(root, prepared), null, 2)}\n`);
  console.log(JSON.stringify({ preparedCensusPath, proofSourcesPath, denominator: prepared.denominator, holdingsDigest: prepared.holdingsDigest }, null, 2));
  process.exit(0);
}

let census = JSON.parse(readFileSync(preparedCensusPath, "utf8")) as ReaderCensus;
const inherited = inheritReaderProofs(root, census, {
  baselineCensusPath,
  baselineReceiptPath,
  reportPath: invalidationPath,
  currentReaderHead: codeHead,
});
census = inherited.census;
writeFileSync(invalidationPath, `${JSON.stringify(inherited.report, null, 2)}\n`);
assert.deepEqual(inherited.report.failures, [], "The reader delta contains an unclassified change");

const invalidatedRows = new Set(inherited.report.rows.filter((row) => row.disposition === "INVALIDATED").map((row) => row.rowId));
const invalidatedAuditIds = new Set(census.rows.filter((row) => invalidatedRows.has(row.id)).flatMap((row) => row.applicableEligibleRecordIds ?? row.eligibleRecordIds));
const componentCensus = { ...census, records: census.records.filter((record) => invalidatedAuditIds.has(record.auditId)) };
const components = await renderCanonicalReaderComponents(root, componentCensus);
writeFileSync(componentPath, `${JSON.stringify(components, null, 2)}\n`);
assert.deepEqual(components.failures, [], "An invalidated canonical component payload failed to render");

const bundleEvidence = readerBundleEvidence(root, census, buildReceiptPath, portraitProofPath);
writeFileSync(bundlePath, `${JSON.stringify(bundleEvidence, null, 2)}\n`);
const bundleBytes = readReaderEvidence(root, bundlePath);
assert.equal(bundleEvidence.exactHead, codeHead, "Bundle proof belongs to another reader head");
assert.deepEqual(bundleEvidence.failures, []);
const deployedBundle: NonNullable<ReaderDeliveryProof["deployedBundle"]> = {
  evidencePath: bundlePath,
  evidenceSha256: sha256(bundleBytes),
  exactHead: codeHead,
  holdingPaths: bundleEvidence.holdings.map((holding) => holding.path),
};
const routeComposition = composeCanonicalRouteProofs(root, census, routePaths, deployedBundle);
assert.deepEqual(routeComposition.failures, [], "An invalidated route proof is stale or inconsistent");
const witnesses = JSON.parse(readReaderEvidence(root, witnessPath).toString("utf8")) as ReaderSurfaceClassWitness[];
const componentComposition = composeReaderComponentProofs(root, census, componentPath, witnesses, deployedBundle);
assert.deepEqual(componentComposition.failures, [], "An invalidated component proof is stale or inconsistent");

const proofs = [...routeComposition.proofs, ...componentComposition.proofs].filter((proof) => invalidatedRows.has(proof.rowId));
for (const proof of proofs) {
  const row = census.rows.find((candidate) => candidate.id === proof.rowId);
  assert.ok(row, `Unknown proof row ${proof.rowId}`);
  const result = reconcileDelivery(row, proof, root);
  assert.deepEqual(result.failures, [], `${proof.rowId}: current-head proof cannot be reconciled`);
  census = { ...census, rows: census.rows.map((candidate) => candidate.id === proof.rowId ? result.row : candidate) };
}
const closureFailures = censusClosureFailures(census);
assert.deepEqual(closureFailures, [], `Final reader census has ${closureFailures.length} open obligations`);

const censusBytes = Buffer.from(`${JSON.stringify(census, null, 2)}\n`);
writeFileSync(censusPath, censusBytes);
writeFileSync(censusPath.replace(/\.json$/, ".md"), renderCensusMarkdown(census));
writeFileSync(censusPath.replace(/\.json$/, "-summary.json"), `${JSON.stringify(readerCensusSummary(census), null, 2)}\n`);
writeFileSync("docs/evidence/reader-last-mile-final-delta-summary.json", `${JSON.stringify({
  formatVersion: 1,
  exactReaderHead: codeHead,
  inheritedRows: inherited.report.counts.INHERITED,
  invalidatedRows: inherited.report.counts.INVALIDATED,
  recomputedRows: inherited.report.counts.RECOMPUTED,
  invalidatedApplicableRecords: invalidatedAuditIds.size,
  routeProofs: routeComposition.proofs.length,
  componentProofs: componentComposition.proofs.length,
  componentCases: components.cases.length,
  componentUncoveredDiagnostics: componentComposition.uncovered.length,
  closureFailures: closureFailures.length,
  delivery: Object.fromEntries([...new Set(census.rows.map((row) => row.deliveryState))].map((state) => [state, census.rows.filter((row) => row.deliveryState === state).length])),
}, null, 2)}\n`);

// Store the two large final artifacts losslessly. The logical .json paths stay
// stable because readReaderEvidence transparently verifies the gzip bytes.
packReaderEvidence(root, componentPath);
packReaderEvidence(root, censusPath);
const evidencePaths = [...new Set([
  ...census.rows.flatMap((row) => row.evidencePaths),
  invalidationPath,
  witnessPath,
  bundlePath,
  buildReceiptPath,
  portraitProofPath,
  ...routePaths,
])].sort();
const receipt: ReaderClosureReceipt = {
  formatVersion: 1,
  censusPath,
  censusSha256: sha256(censusBytes),
  holdingsDigest: census.holdingsDigest,
  registrySha256: census.registrySha256,
  sourceHashes: readerSourceFingerprint(root),
  evidenceHashes: evidencePaths.map((path) => ({ path, sha256: sha256(readReaderEvidence(root, path)) })),
  inheritance: { reportPath: invalidationPath, reportSha256: sha256(readReaderEvidence(root, invalidationPath)) },
};
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({
  exactReaderHead: codeHead,
  censusPath,
  receiptPath,
  denominator: census.denominator,
  inherited: inherited.report.counts,
  invalidatedApplicableRecords: invalidatedAuditIds.size,
  routeProofs: routeComposition.proofs.length,
  componentProofs: componentComposition.proofs.length,
  componentCases: components.cases.length,
  closureFailures: closureFailures.length,
}, null, 2));
