import assert from "node:assert/strict";
import test from "node:test";
import { newFieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  auditCoverageReport, boostReason, auditHistoryFrom, auditHistoryFromManual, createModelAuditSampler, DEFAULT_AUDIT_SAMPLE_POLICY, sampleDecision, stableFraction, stratumOf,
} from "../lib/control-plane/workers/audit-sampling.ts";
import { auditCoverage, recordOutcome } from "../lib/control-plane/workers/audit-outcome.ts";
import type { GeneralizedCivicExtractionContract, WorkerFinding, WorkerResultRecord, WorkerTaskSpec } from "../lib/control-plane/workers/types.ts";

const contractFor = (host: string, recordClass = "PLANNING_MEETING"): GeneralizedCivicExtractionContract => ({
  schemaVersion: 2, recordClass, subjectId: `az:${host}`, requiredFields: ["title"], identity: { namespace: host, keyFields: ["title"] },
  jurisdiction: { country: "US", state: "AZ", canonicalId: `az:${host}` }, completenessScope: "x", expectedSourceDate: null, methodVersion: 61,
  sourceScope: { sourceId: host, publisher: host, routeIds: ["r"], canonicalUrls: [`https://${host}/agenda`], observationArtifactIds: ["a"] },
  extraction: { format: "UNSUPPORTED", mediaType: "text/plain", fields: {}, reason: "none" }, verification: { required: false, authorities: [] },
});
const spec = (host: string, artifactId: string, over: Partial<WorkerTaskSpec> = {}): WorkerTaskSpec => ({
  schemaVersion: 1, role: "ADVERSARIAL_AUDITOR", artifactId, contract: contractFor(host), producerResultId: `p-${artifactId}`, validatorResultId: `v-${artifactId}`,
  auditScope: "CAPTURED_ARTIFACT", implementationVersion: "t", ...over });

let n = 0;
function auditRecord(host: string, verdict: "SURVIVED" | "BROKE" | "INCONCLUSIVE", at: string, reviewed = true, coverage: { sourcesPercent: number | null; recordsPercent: number | null } | null = null): WorkerResultRecord {
  n += 1;
  return { id: `wr-audit-${n}`, workItemId: `wi-${host}`, endedAt: at, inputResultIds: [`p-${n}`, `v-${n}`], ...(reviewed ? { modelReview: { step: "adversarial-audit" } } : {}),
    completion: { completedTask: { workerTask: spec(host, `art-${n}`) } },
    result: { role: "ADVERSARIAL_AUDITOR", verdict, ...(coverage ? { coverage: { routesApplicable: 2, routesChecked: 1, sourceRecords: 2, extractedRecords: 2, ...coverage } } : {}) } } as unknown as WorkerResultRecord;
}

test("a stratum is a record class from one publisher", () => {
  assert.equal(stratumOf(contractFor("www.a.gov")), "PLANNING_MEETING|www.a.gov");
  assert.notEqual(stratumOf(contractFor("www.a.gov")), stratumOf(contractFor("www.b.gov")));
});

test("the first results of any new stratum are always model-reviewed, so the sample reaches everything", () => {
  const history = auditHistoryFrom([]);
  for (const host of ["www.a.gov", "www.b.gov", "www.c.gov"]) {
    const d = sampleDecision(spec(host, "x1"), history, false);
    assert.deepEqual([d.sample, d.reason], [true, "NEW_STRATUM"]);
  }
});

test("an established stratum is sampled at the fixed fraction by a stable hash: same result, same answer; about the right share overall", () => {
  const seed = Array.from({ length: 3 }, (_, i) => auditRecord("www.a.gov", "SURVIVED", `2026-09-0${i + 1}T00:00:00Z`));
  const history = auditHistoryFrom(seed);
  let hits = 0;
  for (let i = 0; i < 2000; i++) {
    const s = spec("www.a.gov", `art-${i}`);
    const d = sampleDecision(s, history, false);
    assert.equal(sampleDecision(s, history, false).sample, d.sample, "a retry never flips the decision");
    if (d.sample) hits += 1;
  }
  assert.ok(hits > 120 && hits < 280, `expected about 10% of 2000, got ${hits}`);
  let quotedHits = 0;
  for (let i = 0; i < 2000; i++) if (sampleDecision(spec("www.a.gov", `art-${i}`), history, true).sample) quotedHits += 1;
  assert.ok(quotedHits > hits, "model-parsed results are reviewed more often");
  assert.ok(stableFraction("x") >= 0 && stableFraction("x") < 1);
});

test("a stratum that broke stays under review until it has survived several audits in a row", () => {
  const records = [
    ...Array.from({ length: 3 }, (_, i) => auditRecord("www.a.gov", "SURVIVED", `2026-09-0${i + 1}T00:00:00Z`)),
    auditRecord("www.a.gov", "BROKE", "2026-09-04T00:00:00Z"),
    ...Array.from({ length: 4 }, (_, i) => auditRecord("www.a.gov", "SURVIVED", `2026-09-1${i}T00:00:00Z`)),
  ];
  const h = auditHistoryFrom(records);
  assert.equal(h.get("PLANNING_MEETING|www.a.gov")!.survivedSinceBreak, 4);
  assert.deepEqual(sampleDecision(spec("www.a.gov", "any"), h, false).reason, "BROKEN_STRATUM");
  const settled = auditHistoryFrom([...records, auditRecord("www.a.gov", "SURVIVED", "2026-09-20T00:00:00Z")]);
  assert.notEqual(sampleDecision(spec("www.a.gov", "any"), settled, false).reason, "BROKEN_STRATUM");
});

test("an escalation is always reviewed, and the sampler counts its own decisions so a burst from a new stratum is not all 'first'", async () => {
  assert.equal(sampleDecision(spec("www.a.gov", "x", { auditEscalation: { previousResultId: "r", from: "haiku", to: "sonnet", reason: "r" } }), new Map(), false).reason, "ESCALATION");
  const sampler = createModelAuditSampler({ workerResults: { readAll: async () => [] } } as never);
  const decisions: boolean[] = [];
  for (let i = 0; i < 40; i++) decisions.push(await sampler(spec("www.new.gov", `burst-${i}`)));
  assert.deepEqual(decisions.slice(0, DEFAULT_AUDIT_SAMPLE_POLICY.floorPerStratum), [true, true, true]);
  assert.ok(decisions.filter(Boolean).length < 15, "after the floor, only the fixed fraction is reviewed");
});

test("a judgment call is always model-reviewed, even in a settled stratum; an ordinary record is only sampled", () => {
  const settled = new Map([[stratumOf(contractFor("www.a.gov", "CROSS_SOURCE_IDENTITY")), { reviewed: 50, survivedSinceBreak: 50, everBroken: false }],
    [stratumOf(contractFor("www.a.gov")), { reviewed: 50, survivedSinceBreak: 50, everBroken: false }]]);
  let judgment = 0; let ordinary = 0;
  for (let i = 0; i < 200; i++) {
    const call = sampleDecision(spec("www.a.gov", `j-${i}`, { contract: contractFor("www.a.gov", "CROSS_SOURCE_IDENTITY") }), settled, false);
    if (call.sample) judgment += 1; else assert.fail("a judgment call was not reviewed");
    assert.equal(call.reason, "JUDGMENT_CALL");
    if (sampleDecision(spec("www.a.gov", `o-${i}`), settled, false).sample) ordinary += 1;
  }
  assert.equal(judgment, 200);
  assert.ok(ordinary < 60, "ordinary records in a settled stratum are still only a fraction");
});

test("what the manual remembers of a stratum keeps it under review after its results have aged out; the results, when present, win", async () => {
  const stratumRow = (host: string, outcome: "FAILED" | "YIELDED", modelReviewed: boolean) => newFieldManualEntry("auditor-learning", `stratum|PLANNING_MEETING|${host}`, {
    role: "AUDITOR", kind: "AUDIT_STRATUM", title: "t", summary: "s", outcome, payload: { recordClass: "PLANNING_MEETING", host, modelReviewed } });
  const store = { entries: [stratumRow("www.broke.gov", "FAILED", true), stratumRow("www.fine.gov", "YIELDED", true)] };
  const h = auditHistoryFromManual(store);
  assert.equal(h.get("PLANNING_MEETING|www.broke.gov")!.everBroken, true);
  assert.equal(sampleDecision(spec("www.broke.gov", "x"), new Map([...h]), false, { ...DEFAULT_AUDIT_SAMPLE_POLICY, floorPerStratum: 1 }).reason, "BROKEN_STRATUM");
  const repos = createMemoryRepositories();
  for (const entry of store.entries) await repos.fieldManual.put(entry.id, entry, "2026-09-20T00:00:00.000Z");
  const sampler = createModelAuditSampler(repos,
    { ...DEFAULT_AUDIT_SAMPLE_POLICY, floorPerStratum: 1, ratio: 0, quotedRatio: 0 });
  assert.equal(await sampler(spec("www.broke.gov", "a1")), true, "a stratum the manual says broke is reviewed");
  assert.equal(await sampler(spec("www.fine.gov", "a2")), false, "a stratum the manual says was reviewed and held is not new");
  const settled = auditHistoryFrom([auditRecord("www.broke.gov", "SURVIVED", "2026-09-20T00:00:00Z")]);
  assert.equal(new Map([...h, ...settled]).get("PLANNING_MEETING|www.broke.gov")!.everBroken, false, "the durable results override the manual's summary");
});

test("the coverage report is a number for Admin: audited, model-reviewed, strata reached, and the audits' own coverage", () => {
  const parser = (host: string, id: string) => ({ id, result: { role: "PARSER", verdict: "EXTRACTED" }, completion: { completedTask: { workerTask: spec(host, id) } }, inputResultIds: [] }) as unknown as WorkerResultRecord;
  const validator = (id: string, parserId: string) => ({ id, result: { role: "VALIDATOR", verdict: "PASS" }, inputResultIds: [parserId] }) as unknown as WorkerResultRecord;
  const audit = (id: string, validatorId: string, parserId: string, reviewed: boolean, verdict: "SURVIVED" | "BROKE", cov: { sourcesPercent: number; recordsPercent: number }) =>
    ({ id, result: { role: "ADVERSARIAL_AUDITOR", verdict, coverage: { routesApplicable: 2, routesChecked: 1, sourceRecords: 2, extractedRecords: 2, ...cov } },
      inputResultIds: [parserId, validatorId], ...(reviewed ? { modelReview: {} } : {}), completion: { completedTask: { workerTask: spec("www.a.gov", id) } } }) as unknown as WorkerResultRecord;
  const results = [parser("www.a.gov", "p1"), validator("v1", "p1"), parser("www.b.gov", "p2"), validator("v2", "p2"), parser("www.b.gov", "p3"), validator("v3", "p3"),
    audit("a1", "v1", "p1", true, "SURVIVED", { sourcesPercent: 50, recordsPercent: 100 }), audit("a2", "v2", "p2", false, "BROKE", { sourcesPercent: 100, recordsPercent: 50 })];
  const r = auditCoverageReport(results);
  assert.deepEqual([r.validated, r.audited, r.modelReviewed, r.broke], [3, 2, 1, 1]);
  assert.deepEqual([r.auditedPercent, r.modelReviewedPercent], [67, 33]);
  assert.deepEqual([r.strata, r.strataModelReviewed, r.strataModelReviewedPercent], [2, 1, 50]);
  assert.deepEqual([r.sourcesCheckedPercent, r.recordsExtractedPercent], [75, 75]);
  assert.deepEqual(auditCoverageReport([]), { validated: 0, audited: 0, modelReviewed: 0, broke: 0, strata: 0, strataModelReviewed: 0, auditedPercent: null,
    modelReviewedPercent: null, strataModelReviewedPercent: null, sourcesCheckedPercent: null, recordsExtractedPercent: null });
});

test("a record is broken only by a BLOCKING finding that names it; one that names none breaks the whole capture; warnings and info break nothing", () => {
  const f = (severity: WorkerFinding["severity"], recordId?: string): WorkerFinding => ({ code: "C", detail: "d", severity, ...(recordId ? { recordId } : {}) });
  assert.deepEqual(recordOutcome(["a", "b", "c"], [f("BLOCKING", "b"), f("WARNING", "a"), f("INFO")]), { brokenRecordIds: ["b"], survivingRecordIds: ["a", "c"] });
  assert.deepEqual(recordOutcome(["a", "b"], [f("BLOCKING")]), { brokenRecordIds: ["a", "b"], survivingRecordIds: [] });
  assert.deepEqual(recordOutcome(["a", "b"], [], new Set(["a"])), { brokenRecordIds: ["a"], survivingRecordIds: ["b"] });
  assert.deepEqual(auditCoverage({ routesApplicable: 0, routesChecked: 0, sourceRecords: null, extractedRecords: 3 }).sourcesPercent, null);
  assert.equal(auditCoverage({ routesApplicable: 3, routesChecked: 9, sourceRecords: 4, extractedRecords: 2 }).sourcesPercent, 100, "never over 100");
});

test("a boosted fact (past its refresh date, in demand, single-source) is model-reviewed more often, and says why", () => {
  const settled = auditHistoryFrom(Array.from({ length: 3 }, (_, i) => auditRecord("www.a.gov", "SURVIVED", `2026-09-0${i + 1}T00:00:00Z`)));
  let plain = 0, boosted = 0;
  const reasons = new Set<string>();
  for (let i = 0; i < 3000; i++) {
    const s = spec("www.a.gov", `boost-${i}`);
    if (sampleDecision(s, settled, false).sample) plain += 1;
    const d = sampleDecision(s, settled, false, undefined, { pastRefresh: true });
    if (d.sample) { boosted += 1; reasons.add(d.reason); }
  }
  assert.ok(boosted > plain * 2, `boosted ${boosted} vs plain ${plain}`);
  assert.ok(reasons.has("PAST_REFRESH") && reasons.has("SAMPLED"), [...reasons].join());
  assert.equal(boostReason({ demandRank: 3 }), "DEMAND");
  assert.equal(boostReason({ demandRank: 400 }), null, "outside the top places is no boost");
  assert.equal(boostReason({ singleSource: true }), "SINGLE_SOURCE");
  assert.equal(boostReason({ pastRefresh: true, singleSource: true }), "PAST_REFRESH", "the strongest reason is the one reported");
});


test("CP-10: official portraits use ordinary sampling, while other portraits remain judgment calls", () => {
  const policy = { ...DEFAULT_AUDIT_SAMPLE_POLICY, ratio: 0, quotedRatio: 0, floorPerStratum: 0 };
  for (const [host, judgment] of [["city.gov", false], ["portrait.example", true]] as const) {
    const contract = contractFor(host, "OFFICIAL_PORTRAIT");
    const history = new Map([[stratumOf(contract), { reviewed: 10, everBroken: false, survivedSinceBreak: 10 }]]);
    const decision = sampleDecision({ ...spec(host, "portrait"), contract }, history, false, policy);
    assert.equal(decision.reason === "JUDGMENT_CALL", judgment);
    assert.equal(decision.sample, judgment);
  }
});
