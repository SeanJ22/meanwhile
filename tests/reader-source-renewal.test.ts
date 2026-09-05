import assert from "node:assert/strict";
import test from "node:test";
import { sha256, sourceRenewalCaseProblems, sourceRenewalDependencyProblems, inheritedReaderSourceClassifications, readerRowStructuralSha256, type ReaderComponentCase, type CensusRow } from "../lib/holdings/reader-census.ts";

const markup = '<p data-record-id="canonical:one">Held statement</p>';
const rendered: ReaderComponentCase = {
  auditId: "canonical:one", component: "components/ask/answer-records.tsx", componentSha256: sha256("source"),
  selector: "canonical record → actual renderer", actualCanonicalIdentities: ["canonical:one"],
  payloadSha256: sha256("payload"), markup, markupSha256: sha256(markup), expectedFragments: ["canonical:one", "Held statement"],
  forbiddenFragments: ["Wrong person's statement"], rowCounts: { records: { expected: 1, actual: 1 } }, failures: [],
};

test("successive source renewal inherits only byte-identical already-classified dependencies", () => {
  const source = { path: "app/ballot/page.tsx", sha256: sha256("previously executed page") };
  const entry = { path: source.path, baselineSha256: sha256("original"), currentSha256: source.sha256, acceptance: "VF-S1", reason: "Bound executed presentation" };
  const report = { changedReaderSources: [entry] };
  const prior = { ...report, failures: [] as string[] };
  assert.deepEqual(inheritedReaderSourceClassifications(report, prior, [source], [source]), [source.path]);
  for (const [next, old, before, current] of [
    [report, { ...prior, failures: ["Failed prior proof"] }, [source], [source]],
    [report, { ...prior, changedReaderSources: [] }, [source], [source]],
    [report, prior, [], [source]],
    [report, prior, [source], []],
    [report, prior, [source], [{ ...source, sha256: sha256("unexecuted changes") }]],
    [{ changedReaderSources: [{ ...entry, reason: "rewritten" }] }, prior, [source], [source]],
    [{ changedReaderSources: [{ ...entry, acceptance: "invented" }] }, prior, [source], [source]],
    [{ changedReaderSources: [{ ...entry, currentSha256: null }] }, prior, [source], [source]],
    [report, { ...prior, changedReaderSources: [{ ...entry, acceptance: "UNCLASSIFIED" }] }, [source], [source]],
  ] as const) assert.deepEqual(inheritedReaderSourceClassifications(next, old, before, current), []);
});

test("reader source renewal rechecks rendered facts instead of trusting a PASS label", () => {
  assert.deepEqual(sourceRenewalCaseProblems([rendered]), []);
  for (const cases of [
    [],
    [{ ...rendered, markup: "" }],
    [{ ...rendered, markupSha256: sha256("other") }],
    [{ ...rendered, actualCanonicalIdentities: [] }],
    [{ ...rendered, expectedFragments: [] }],
    [{ ...rendered, expectedFragments: ["Missing canonical fact"] }],
    [{ ...rendered, forbiddenFragments: ["Held statement"] }],
    [{ ...rendered, rowCounts: { records: { expected: 2, actual: 1 } } }],
    [{ ...rendered, failures: ["Execution failed"] }],
  ]) assert.ok(sourceRenewalCaseProblems(cases).length, "Incomplete or forged execution must fail");
});

test("source-only reader renewal cannot inherit a changed canonical identity or eligibility projection", () => {
  const row = { id: "family:surface:state", eligibleRecordIds: ["person:one"], applicableEligibleRecordIds: ["person:one"], deliveryState: "RENDERED", evidencePaths: ["old-proof.json"] } as unknown as CensusRow;
  assert.equal(readerRowStructuralSha256(row), readerRowStructuralSha256({ ...row, evidencePaths: ["new-proof.json"] }));
  assert.notEqual(readerRowStructuralSha256(row), readerRowStructuralSha256({ ...row, eligibleRecordIds: ["person:two"] }));
  assert.notEqual(readerRowStructuralSha256(row), readerRowStructuralSha256({ ...row, applicableEligibleRecordIds: [] }));
});

test("reader structural identity ignores only the volatile calendar evaluation time", () => {
  const reason = "Event event:one starts 2027-01-13T02:00:00.000Z, outside the canonical calendar window 90 days back / 120 days ahead at 2026-09-04T21:29:26.023Z. This is a current-calendar scope, not unheld data.";
  const row = { id: "meetings:map:az", applicabilityByRecord: { "event:one": { status: "INTENTIONALLY_OUT_OF_SCOPE", selector: "searchMeetings", reason } } } as unknown as CensusRow;
  const later = { ...row, applicabilityByRecord: { "event:one": { ...row.applicabilityByRecord!["event:one"], reason: reason.replace("2026-09-04T21:29:26.023Z", "2026-09-05T15:49:06.685Z") } } };
  assert.equal(readerRowStructuralSha256(row), readerRowStructuralSha256(later));
  assert.notEqual(readerRowStructuralSha256(row), readerRowStructuralSha256({ ...later, applicabilityByRecord: { "event:one": { ...later.applicabilityByRecord["event:one"], selector: "different" } } }));
});

test("source renewal accepts an exact removed dependency only beside current execution and complete graph absence", () => {
  const old = { path: "components/map/state-focus-overlay.tsx", sha256: sha256("committed former DOM overlay") };
  const current = { path: "components/map/map-canvas.tsx", sha256: sha256("current map layers") };
  const input = {
    changedSources: [old.path, current.path], executionSourcePaths: [old.path, current.path],
    priorSources: [old, { ...current, sha256: sha256("former canvas") }], currentSources: [current],
    executedSources: [current], removedSourceHashes: [old], renderedComponents: [current.path],
  };
  const result = sourceRenewalDependencyProblems(input);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.covered, [current.path, old.path].sort());
  for (const invalid of [
    { ...input, removedSourceHashes: [] },
    { ...input, removedSourceHashes: [{ ...old, sha256: sha256("different old bytes") }] },
    { ...input, currentSources: [current, old] },
    { ...input, executedSources: [current, old] },
    { ...input, renderedComponents: [current.path, old.path] },
    { ...input, removedSourceHashes: [old, old] },
    { ...input, removedSourceHashes: [old, { path: "invented.ts", sha256: old.sha256 }] },
    { ...input, changedSources: [current.path] },
    { ...input, priorSources: [current] },
    { ...input, executedSources: [{ ...current, sha256: sha256("unexecuted canvas") }] },
  ]) assert.ok(sourceRenewalDependencyProblems(invalid).failures.length, "A missing/forged removal, live dependency or stale execution cannot renew a receipt");
});
