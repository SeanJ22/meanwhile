import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  readReaderEvidence, readerSourceFingerprint, readerRowStructuralSha256,
  readerSourceRevalidationProblems, censusClosureFailures, packReaderEvidence, sha256,
  type ReaderCensus, type ReaderClosureReceipt, type ReaderProofInvalidationReport,
  type ReaderSourceRevalidation, type ReaderComponentCase,
} from "../../lib/holdings/reader-census.ts";

/** The source-only branch of the existing finalizer. It cannot renew data,
 * identities or applicability: every prepared row must match the closed row. */
export function finalizeReaderSources(root: string, prepared: ReaderCensus, options: {
  receiptPath: string; reportPath: string; baselineCommit: string;
  executionPath: string; outputPrefix: string;
}) {
  const priorReceiptBytes = readReaderEvidence(root, options.receiptPath);
  const prior = JSON.parse(priorReceiptBytes.toString("utf8")) as ReaderClosureReceipt;
  assert.equal(sha256(execFileSync("git", ["show", `${options.baselineCommit}:${options.receiptPath}`], { cwd: root })), sha256(priorReceiptBytes), "Start from the committed prior receipt");
  assert.ok(prior.inheritance);
  const priorReportBytes = readReaderEvidence(root, prior.inheritance.reportPath);
  const priorReport = JSON.parse(priorReportBytes.toString("utf8")) as ReaderProofInvalidationReport;
  assert.equal(sha256(priorReportBytes), prior.inheritance.reportSha256);
  const census = JSON.parse(readReaderEvidence(root, prior.censusPath).toString("utf8")) as ReaderCensus;
  assert.equal(prepared.holdingsDigest, census.holdingsDigest);
  assert.equal(prepared.registrySha256, census.registrySha256);
  assert.deepEqual(censusClosureFailures(census), []);
  const preparedRows = new Map(prepared.rows.map(row => [row.id, row]));
  assert.equal(preparedRows.size, census.rows.length);
  for (const row of census.rows) {
    const current = preparedRows.get(row.id);
    assert.ok(current, `Missing prepared row ${row.id}`);
    // The evaluator's clock appears in an out-of-window explanation. Its
    // observation time may advance, but identity, event time, window, selector
    // and applicability disposition must all remain identical.
    const applicabilityByRecord = Object.fromEntries(Object.entries(current.applicabilityByRecord ?? {}).map(([id, value]) => {
      const old = row.applicabilityByRecord?.[id];
      const clock = /(?<= days ahead at )\d{4}-\d{2}-\d{2}T[\d:.]+Z(?=\. This is a current-calendar scope)/g;
      const same = old && value.status === "INTENTIONALLY_OUT_OF_SCOPE" && old.status === value.status && old.selector === value.selector && value.selector === "searchMeetings / CONCLUDED_LOOKBACK_DAYS / UPCOMING_HORIZON_DAYS" && old.reason.replace(clock, "EVALUATED_AT") === value.reason.replace(clock, "EVALUATED_AT");
      return [id, same ? old : value];
    }));
    const comparable = current.applicabilityByRecord ? { ...current, applicabilityByRecord } : current;
    assert.equal(readerRowStructuralSha256(comparable), readerRowStructuralSha256(row), `Source-only renewal cannot change the canonical projection: ${row.id}`);
  }
  const executionBytes = readReaderEvidence(root, options.executionPath);
  const execution = JSON.parse(executionBytes.toString("utf8")) as { exactHead: string; cases: ReaderComponentCase[]; failures: string[] };
  assert.deepEqual(execution.failures, []);
  assert.ok(execution.cases.length);
  const sourceHashes = readerSourceFingerprint(root);
  const oldSources = new Map(prior.sourceHashes.map(source => [source.path, source.sha256]));
  for (const equivalent of prior.sourceEolEquivalences ?? []) oldSources.set(equivalent.path, equivalent.canonicalLfSha256);
  const sources = new Map(sourceHashes.map(source => [source.path, source.sha256]));
  const changedSources = [...new Set([...oldSources.keys(), ...sources.keys()])].filter(path => oldSources.get(path) !== sources.get(path)).sort();
  assert.ok(changedSources.length, "There must be an actual source invalidation");
  const priorReceiptPath = `${options.outputPrefix}-prior-receipt.json`;
  const priorReportPath = `${options.outputPrefix}-prior-invalidation.json`;
  const proofPath = `${options.outputPrefix}-renewal.json`;
  writeFileSync(priorReceiptPath, priorReceiptBytes);
  writeFileSync(priorReportPath, priorReportBytes);
  packReaderEvidence(root, priorReportPath);
  const proof: ReaderSourceRevalidation = {
    exactHead: execution.exactHead, baselineCommit: options.baselineCommit,
    baselineReceiptPath: options.receiptPath, baselineReceiptSha256: sha256(priorReceiptBytes),
    holdingsDigest: census.holdingsDigest, registrySha256: census.registrySha256,
    sourceHashes, changedSources,
    rows: census.rows.map(row => ({ rowId: row.id, structuralSha256: readerRowStructuralSha256(row), deliverySha256: sha256(JSON.stringify(row)) })),
    executions: [{ id: "affected-reader-presentation", sourcePaths: changedSources, evidencePath: options.executionPath, evidenceSha256: sha256(executionBytes), expected: execution.cases.length, passed: execution.cases.filter(entry => !entry.failures.length).length }],
    failures: [],
  };
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  const original = JSON.parse(readReaderEvidence(root, priorReport.baselineReceiptPath).toString("utf8")) as ReaderClosureReceipt;
  const originalSources = new Map(original.sourceHashes.map(source => [source.path, source.sha256]));
  const report: ReaderProofInvalidationReport = {
    ...priorReport,
    changedReaderSources: [...new Set([...originalSources.keys(), ...sources.keys()])].sort().filter(path => originalSources.get(path) !== sources.get(path)).map(path => ({
      path, baselineSha256: originalSources.get(path) ?? null, currentSha256: sources.get(path) ?? null,
      acceptance: changedSources.includes(path) ? "VF-S1/VF-S2" : priorReport.changedReaderSources.find(source => source.path === path)!.acceptance,
      reason: changedSources.includes(path) ? "Source-only presentation renewal; canonical census unchanged and current rendering execution is hash-bound." : priorReport.changedReaderSources.find(source => source.path === path)!.reason,
    })),
    sourceRevalidation: { priorReceiptPath, priorReceiptSha256: sha256(priorReceiptBytes), priorReportPath, priorReportSha256: sha256(priorReportBytes), proofPath, proofSha256: sha256(readFileSync(proofPath)) },
  };
  assert.deepEqual(readerSourceRevalidationProblems(root, census, report), [], "Executed renewal must satisfy the receipt validator before publication");
  writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  packReaderEvidence(root, options.reportPath);
  const evidencePaths = [...new Set([...prior.evidenceHashes.map(entry => entry.path), priorReceiptPath, priorReportPath, proofPath, options.executionPath])].sort();
  const receipt: ReaderClosureReceipt = {
    formatVersion: 1, censusPath: prior.censusPath, censusSha256: prior.censusSha256,
    holdingsDigest: prior.holdingsDigest, registrySha256: prior.registrySha256, sourceHashes,
    evidenceHashes: evidencePaths.map(path => ({ path, sha256: sha256(readReaderEvidence(root, path)) })),
    inheritance: { reportPath: options.reportPath, reportSha256: sha256(readReaderEvidence(root, options.reportPath)) },
  };
  writeFileSync(options.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { changedSources, inheritedCanonicalRows: census.rows.length, inheritedRenderedRows: census.rows.filter(row => row.deliveryState === "RENDERED").length, recomputedPresentationCases: execution.cases.length, censusSha256: prior.censusSha256, receiptPath: options.receiptPath };
}
