import assert from "node:assert/strict";
import test from "node:test";
import { newFieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { closeAuditHistoryIndex } from "../lib/control-plane/workers/audit-history-index.ts";
import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { PGlite } from "@electric-sql/pglite";
import { pgAppendOnlyRepository } from "../lib/control-plane/repository/pg-store.ts";
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
  const repos=createMemoryRepositories();
  const sampler = createModelAuditSampler({...repos,workerResults:{...repos.workerResults,readAll:async()=>{throw new Error("COUNTRY_RESULT_READ");}}});
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
  const repos=createMemoryRepositories();
  for(const entry of store.entries)await repos.fieldManual.put(entry.id,entry,"2026-10-20T12:00:00Z");
  const sampler = createModelAuditSampler({...repos,fieldManual:{...repos.fieldManual,list:async()=>{throw new Error("COUNTRY_MANUAL_READ");}}},
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

test("disk sampling preserves full-history ordering, quoted-producer lookup and interleaved burst counts",async()=>{
  const repos=createMemoryRepositories(),records=[auditRecord("a.gov","SURVIVED","2026-09-20T00:00:00Z"),
    auditRecord("a.gov","BROKE","2026-09-01T00:00:00Z"),auditRecord("a.gov","INCONCLUSIVE","2026-09-21T00:00:00Z",false),
    auditRecord("b.gov","SURVIVED","2026-09-20T00:00:00Z")];
  const parser={id:"quoted-producer",endedAt:"2026-09-20T00:00:00Z",result:{role:"PARSER",verdict:"EXTRACTED",records:[{narrative:"must stay in store"}]},modelParse:{responseText:"must stay in store"}}as unknown as WorkerResultRecord;
  for(const [at,record]of [...records,parser].entries())await repos.workerResults.append(at%2?"b":"a",record.id,record,"2026-10-20T12:00:00Z");
  const fixture=await repos.workerResults.readAll(),history=auditHistoryFrom(fixture),policy={...DEFAULT_AUDIT_SAMPLE_POLICY,survivedAfterBreak:1};
  const scoped={...repos,workerResults:{...repos.workerResults,readAll:async()=>{throw new Error("COUNTRY_PAYLOADS");}}};
  const sampler=createModelAuditSampler(scoped,policy);
  try{
    for(let at=0;at<90;at++){
      const input=spec(at%3===1?"b.gov":"a.gov",`interleaved-${at}`,{producerResultId:at%4===0?"quoted-producer":null});
      const expected=sampleDecision(input,history,at%4===0,policy);
      assert.equal(await sampler(input),expected.sample);
      if(expected.sample&&!input.auditEscalation){const prior=history.get(expected.stratum);history.set(expected.stratum,{reviewed:(prior?.reviewed??0)+1,survivedSinceBreak:prior?.survivedSinceBreak??0,everBroken:prior?.everBroken??false});}
    }
  }finally{await closeAuditHistoryIndex(scoped);}
});

test("one shared host cold-scans audit metadata once and keeps each worker's burst snapshot separate",async()=>{
  const repos=createMemoryRepositories(),read=repos.workerResults.readChangedSince.bind(repos.workerResults);
  let cold=0,incremental=0;
  const shared={...repos,workerResults:{...repos.workerResults,readAll:async()=>{throw new Error("FULL_AUDIT_SCAN");},readChangedSince:async(...args:Parameters<typeof read>)=>{
    if(args[0]===null)cold++;else incremental++;
    assert.deepEqual(args[2]?.projection?.modelReview,[]);return read(...args);
  }}};
  const policy={...DEFAULT_AUDIT_SAMPLE_POLICY,floorPerStratum:0,ratio:0,quotedRatio:0};
  for(let i=0;i<3;i++){const record=auditRecord("a.gov","SURVIVED",`2026-09-2${i}T00:00:00Z`);await repos.workerResults.append("a",record.id,record,"2026-10-20T12:00:00Z");}
  const oldUrl=process.env.WTP_WORKER_TOOLS_URL,oldToken=process.env.WTP_WORKER_TOOLS_TOKEN;
  const host=await startWorkerToolsHost({repos:shared,browse:async()=>{throw new Error("NO_BROWSER_NEEDED");}});
  try{
    const worker={workerResults:{readChangedSince:async()=>{throw new Error("WORKER_MUST_USE_SHARED_INDEX");}}}as never;
    const first=createModelAuditSampler(worker,policy);assert.equal(await first(spec("a.gov","first")),false);
    const broken=auditRecord("a.gov","BROKE","2026-10-19T00:00:00Z");await repos.workerResults.append("a",broken.id,broken,"2026-10-20T12:01:00Z");
    assert.equal(await first(spec("a.gov","same-snapshot")),false,"new durable audits do not double-count this worker's initial burst snapshot");
    assert.equal(await createModelAuditSampler(worker,policy)(spec("a.gov","new-worker")),true,"a new worker sees the newly broken stratum");
    assert.equal(cold,1);assert.equal(incremental,1);
    const burst=createModelAuditSampler(worker,{...policy,floorPerStratum:3});
    const decisions=await Promise.all(Array.from({length:30},(_,i)=>burst(spec(i%2?"new-b.gov":"new-a.gov",`burst-${i}`))));
    assert.equal(decisions.filter(Boolean).length,6,"concurrent A→B→A calls reserve only each stratum's first three reviews");
  }finally{await host.close();if(oldUrl===undefined)delete process.env.WTP_WORKER_TOOLS_URL;else process.env.WTP_WORKER_TOOLS_URL=oldUrl;if(oldToken===undefined)delete process.env.WTP_WORKER_TOOLS_TOKEN;else process.env.WTP_WORKER_TOOLS_TOKEN=oldToken;}
});

test("Postgres audit history transfers nested contract identity and flags, with no result bodies or narratives",async()=>{
  const pg=new PGlite(),transferred:unknown[]=[];
  try{
    await pg.exec("CREATE TABLE cp_log_worker_results(log_key text,record_id text,position integer,record jsonb,changed_at timestamptz,recorded_at timestamptz)");
    const record={...auditRecord("a.gov","SURVIVED","2026-10-19T00:00:00Z"),modelReview:{responseText:"UNNEEDED_MODEL_NARRATIVE"},result:{role:"ADVERSARIAL_AUDITOR",verdict:"SURVIVED",findings:[{detail:"UNNEEDED_FINDING"}]},completion:{completedTask:{workerTask:spec("a.gov","a"),disposition:{note:"UNNEEDED_DISPOSITION"}}}};
    await pg.query("INSERT INTO cp_log_worker_results VALUES('a','append-id',0,$1,now(),now())",[JSON.stringify(record)]);
    const sql={async query(text:string,params:readonly unknown[]=[]){const rows=(await pg.query<Record<string,unknown>>(text,[...params])).rows;transferred.push(rows);return rows;}};
    const repos={workerResults:pgAppendOnlyRepository<WorkerResultRecord>(sql,"worker_results")};
    try{
      assert.equal(await createModelAuditSampler(repos,{...DEFAULT_AUDIT_SAMPLE_POLICY,floorPerStratum:1,ratio:0,quotedRatio:0})(spec("a.gov","a")),false);
      assert.ok(!JSON.stringify(transferred).includes("UNNEEDED_"));
    }finally{await closeAuditHistoryIndex(repos);}
  }finally{await pg.close();}
});
