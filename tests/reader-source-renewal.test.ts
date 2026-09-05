import assert from "node:assert/strict";
import test from "node:test";
import { sha256, sourceRenewalCaseProblems, readerRowStructuralSha256, type ReaderComponentCase, type CensusRow } from "../lib/holdings/reader-census.ts";

const markup = '<p data-record-id="canonical:one">Held statement</p>';
const rendered: ReaderComponentCase = {
  auditId: "canonical:one", component: "components/ask/answer-records.tsx", componentSha256: sha256("source"),
  selector: "canonical record → actual renderer", actualCanonicalIdentities: ["canonical:one"],
  payloadSha256: sha256("payload"), markup, markupSha256: sha256(markup), expectedFragments: ["canonical:one", "Held statement"],
  forbiddenFragments: ["Wrong person's statement"], rowCounts: { records: { expected: 1, actual: 1 } }, failures: [],
};

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
