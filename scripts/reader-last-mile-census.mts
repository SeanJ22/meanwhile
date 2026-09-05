import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyReaderApplicability, buildReaderCensus, censusClosureFailures, composeCanonicalRouteProofs, composeReaderComponentProofs, packReaderEvidence, readerBundleEvidence, readerCensusSummary, readerProofInventory, readReaderEvidence, projectCanonicalReaderRecords, reconcileDelivery, renderCanonicalReaderComponents, renderCensusMarkdown, sha256, type ReaderDeliveryProof, type ReaderProjectionReport, type ReaderSurfaceClassWitness } from "../lib/holdings/reader-census.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { readerSourceFingerprint, readerNestedFieldInventory, validateReaderClosureReceipt, type ReaderClosureReceipt } from "../lib/holdings/reader-census.ts";
import { activePortraitInventory } from "../lib/holdings/reader-census.ts";

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const root = option("--root") ?? process.cwd();
const receiptToValidate = option("--validate-closure");
if (receiptToValidate) {
  const failures = validateReaderClosureReceipt(root, JSON.parse(readReaderEvidence(root, receiptToValidate).toString("utf8")) as ReaderClosureReceipt);
  console.log(JSON.stringify({ receiptToValidate, failures },null,2));
  process.exit(failures.length ? 1 : 0);
}
const packPath = option("--pack");
if (packPath) { console.log(JSON.stringify(packReaderEvidence(root, packPath), null, 2)); process.exit(0); }
const output = option("--output") ?? "docs/evidence/reader-last-mile-current.json";
const proofPath = option("--proof");
const proofs = proofPath ? JSON.parse(readReaderEvidence(root, proofPath).toString("utf8")) as ReaderDeliveryProof[] : [];
let census = buildReaderCensus(root);
if (args.includes("--fields-only")) {
  const inventory = readerNestedFieldInventory(root,census);
  writeFileSync(join(root,"docs/evidence/reader-last-mile-nested-fields.json"),`${JSON.stringify(inventory,null,2)}\n`);
  console.log(JSON.stringify({ fields:inventory.fields.length,families:new Set(inventory.fields.map((field)=>field.family)).size }));
  process.exit(0);
}
floored("reader-eligible records", "canonical records in datasets declaring reader surfaces", census.records.length, census.records.filter((record) => record.eligibility.state === "READER_ELIGIBLE").length);
const problems = [...census.failures];
const projectionPath = option("--projection");
if (args.includes("--project") || projectionPath) {
  const projection = projectionPath ? JSON.parse(readReaderEvidence(root, projectionPath).toString("utf8")) as ReaderProjectionReport : await projectCanonicalReaderRecords(root, census);
  census = applyReaderApplicability(census, projection);
  const path = output.replace(/\.json$/, "-projection.json");
  if (!args.includes("--check") && !projectionPath) writeFileSync(join(root, path), `${JSON.stringify(projection, null, 2)}\n`);
  if (!args.includes("--check")) writeFileSync(join(root,"docs/evidence/reader-last-mile-active-portraits.json"),`${JSON.stringify({holdingsDigest:census.holdingsDigest,records:activePortraitInventory(census,projection)},null,2)}\n`);
  console.log(JSON.stringify({ projection: path, counts: projection.counts, failureCount: projection.failures.length, firstFailures: projection.failures.slice(0, 20) }, null, 2));
  if (args.includes("--projection-closure")) problems.push(...projection.failures);
}
const componentEvidencePath = option("--components");
const executedEvidencePaths = option("--executed-proofs");
const instrumentPaths = option("--instrument-components");
if (instrumentPaths) {
  const inventory = readerProofInventory(root, census, (option("--instrument-routes") ?? executedEvidencePaths ?? "").split(",").filter(Boolean), instrumentPaths.split(","));
  const path = output.replace(/\.json$/, "-instrument-inventory.json");
  writeFileSync(join(root, path), `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(JSON.stringify({ instrumentInventory: path, lackingEitherInstrument: inventory.rows.reduce((sum,row)=>sum+row.lackingEitherInstrument,0), staleRoutes: inventory.routeFailures, staleComponents: inventory.componentFailures.length }, null, 2));
}
if (executedEvidencePaths) {
  const bundlePath = option("--bundle-proof");
  const bundle = bundlePath ? JSON.parse(readReaderEvidence(root, bundlePath).toString("utf8")) as NonNullable<ReaderDeliveryProof["deployedBundle"]> : undefined;
  const composed = composeCanonicalRouteProofs(root, census, executedEvidencePaths.split(","), bundle);
  proofs.push(...composed.proofs); problems.push(...composed.failures);
  writeFileSync(join(root, output.replace(/\.json$/, "-route-proof-composition.json")), `${JSON.stringify(composed, null, 2)}\n`);
  console.log(JSON.stringify({ executedProofs: composed.proofs.length, failures: composed.failures }, null, 2));
}
const buildReceiptPath = option("--build-receipt");
if (buildReceiptPath) {
  const evidence = readerBundleEvidence(root, census, buildReceiptPath, option("--portrait-proof"));
  const evidencePath = "docs/evidence/reader-last-mile-bundle.json";
  const bytes = `${JSON.stringify(evidence, null, 2)}\n`;
  writeFileSync(join(root, evidencePath), bytes);
  writeFileSync(join(root, "docs/evidence/reader-last-mile-bundle-descriptor.json"), `${JSON.stringify({ evidencePath, evidenceSha256: sha256(bytes), exactHead: evidence.exactHead, holdingPaths: evidence.holdings.map((holding) => holding.path) }, null, 2)}\n`);
  problems.push(...evidence.failures);
  console.log(JSON.stringify({ bundleEvidence: evidencePath, holdings: evidence.holdings.length, failures: evidence.failures }, null, 2));
}
if (componentEvidencePath) {
  const witnessesPath = option("--component-witnesses");
  const bundlePath = option("--bundle-proof");
  if (!witnessesPath || !bundlePath) throw new Error("Component composition requires executed surface witnesses and a same-head bundle proof");
  const witnesses = JSON.parse(readReaderEvidence(root, witnessesPath).toString("utf8")) as ReaderSurfaceClassWitness[];
  const bundle = JSON.parse(readReaderEvidence(root, bundlePath).toString("utf8")) as NonNullable<ReaderDeliveryProof["deployedBundle"]>;
  const parts = componentEvidencePath.split(",").map((path) => composeReaderComponentProofs(root, census, path, witnesses, bundle));
  const composed = { proofs: parts.flatMap((part) => part.proofs), uncovered: parts.flatMap((part) => part.uncovered), failures: parts.flatMap((part) => part.failures) };
  proofs.push(...composed.proofs);
  problems.push(...composed.failures);
  const path = output.replace(/\.json$/, "-component-proof-composition.json");
  writeFileSync(join(root, path), `${JSON.stringify(composed, null, 2)}\n`);
  console.log(JSON.stringify({ componentComposition: path, measuredEdges: composed.proofs.length, uncoveredRecords: composed.uncovered.length, failures: composed.failures.length }, null, 2));
}
for (const proof of proofs) {
  const current = census.rows.find((row) => row.id === proof.rowId);
  if (!current) { problems.push(`Proof names unknown census edge ${proof.rowId}`); continue; }
  const result = reconcileDelivery(current, proof, root);
  problems.push(...result.failures);
  census = { ...census, rows: census.rows.map((row) => row.id === proof.rowId ? result.row : row) };
}
if (args.includes("--render-components")) {
  const rendered = await renderCanonicalReaderComponents(root, census);
  floored("reader component cases passing", "every applicable canonical payload assigned to the component harness", rendered.cases.length, rendered.cases.filter((entry) => entry.failures.length === 0).length);
  const path = output.replace(/\.json$/, "-components.json");
  writeFileSync(join(root, path), `${JSON.stringify(rendered, null, 2)}\n`);
  problems.push(...rendered.failures);
  console.log(JSON.stringify({ componentEvidence: path, cases: rendered.cases.length, failureCount: rendered.failures.length, firstFailures: rendered.failures.slice(0, 20) }, null, 2));
}
const json = `${JSON.stringify(census, null, 2)}\n`;
const markdownPath = output.replace(/\.json$/, ".md");
const markdown = renderCensusMarkdown(census);
if (args.includes("--check")) {
  for (const [path, expected] of [[output, json], [markdownPath, markdown]]) {
    const source = existsSync(join(root, path)) ? path : `${path}.gz`;
    if (!existsSync(join(root, source)) || readReaderEvidence(root, source).toString("utf8") !== expected) problems.push(`STALE ${path}`);
  }
} else {
  if (args.includes("--baseline") && [output, `${output}.gz`].some((path) => existsSync(join(root, path)))) throw new Error(`Baseline already exists and cannot be overwritten: ${output}`);
  writeFileSync(join(root, output), json);
  writeFileSync(join(root, markdownPath), markdown);
  writeFileSync(join(root, output.replace(/\.json$/, "-summary.json")), `${JSON.stringify(readerCensusSummary(census), null, 2)}\n`);
}
if (args.includes("--closure")) problems.push(...censusClosureFailures(census));
if (args.includes("--closure") && problems.length === 0) {
  // RULING 20 keeps screenshot bytes outside git. Validate their hashes during
  // composition, then retain the exact reviewed-image manifest as durable proof.
  const witnessManifest = option("--component-witnesses");
  const evidenceHashes = [...new Set([...census.rows.flatMap((row)=>row.evidencePaths), ...(witnessManifest ? [witnessManifest] : [])])].sort().map((path)=>({path,sha256:sha256(readReaderEvidence(root,path))}));
  const receipt: ReaderClosureReceipt = { formatVersion: 1, censusPath: output, censusSha256: sha256(json), holdingsDigest: census.holdingsDigest, registrySha256: census.registrySha256, sourceHashes: readerSourceFingerprint(root), evidenceHashes };
  writeFileSync(join(root, output.replace(/\.json$/, "-receipt.json")), `${JSON.stringify(receipt,null,2)}\n`);
}
console.log(JSON.stringify({ output, denominator: census.denominator, delivery: Object.fromEntries([...new Set(census.rows.map((r) => r.deliveryState))].map((state) => [state, census.rows.filter((r) => r.deliveryState === state).length])), stagedAutonomous: census.autonomous.length, closureObligations: censusClosureFailures(census).length, problemCount: problems.length, firstProblems: problems.slice(0, 20) }, null, 2));
if (problems.length) process.exitCode = 1;
