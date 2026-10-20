/**
 * Which audits get the model's adversarial review (the deterministic audit runs on every validated record):
 * every new stratum (a record class from one publisher) first, a stratum that broke until it survives several
 * audits in a row, model-parsed results more often, and a stable-hash fraction of the rest. Outcomes are written
 * back to the field manual so the next Parser skips a tier that broke for that publisher.
 */

import { createHash,randomUUID } from "node:crypto";
import { newFieldManualEntry, type FieldManualEntry, type FieldManualStore } from "../field-manual.ts";
import type { ModelClass } from "../scheduler/model-routing.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import { needsSecondSource } from "../promotion/section3.ts";
import { parseLearningEntries } from "./model-parser.ts";
import { emptyFieldManual } from "../field-manual.ts";
import type { AuditCoverage, AuditorResult, CivicExtractionContract, WorkerResultRecord, WorkerTaskSpec } from "./types.ts";
import { stratumOf,type AuditStratumContract } from "./audit-stratum.ts";
import { withIndexedAuditSample,type AuditHistoryRepositories } from "./audit-history-index.ts";
export { stratumOf } from "./audit-stratum.ts";

export const AUDIT_LEARNING_SOURCE = "auditor-learning";

export interface AuditSamplePolicy {
  /** Fraction of rule-parsed results the model reviews once their stratum is established. */
  readonly ratio: number;
  /** A boosted fact is model-reviewed this many times as often (capped at every one). */
  readonly boostMultiplier?: number;
  /** Fraction of model-parsed (quoted) results the model reviews once their stratum is established. */
  readonly quotedRatio: number;
  /** The first N results of any stratum are always reviewed. */
  readonly floorPerStratum: number;
  /** After a break, this many consecutive surviving audits are needed before the stratum returns to the ordinary fraction. */
  readonly survivedAfterBreak: number;
}

export const DEFAULT_AUDIT_SAMPLE_POLICY: AuditSamplePolicy = { ratio: 0.1, quotedRatio: 0.25, floorPerStratum: 3, survivedAfterBreak: 5, boostMultiplier: 3 };

function auditorRecords(results: readonly WorkerResultRecord[]): WorkerResultRecord[] {
  return results.filter((r) => r.result.role === "ADVERSARIAL_AUDITOR");
}

export interface StratumHistory {
  /** Model-reviewed audits so far. */
  readonly reviewed: number;
  /** Audits that survived since the most recent break (all of them if it never broke). */
  readonly survivedSinceBreak: number;
  readonly everBroken: boolean;
}

export type AuditHistory = ReadonlyMap<string, StratumHistory>;

/** Each stratum's audit history, from the durable auditor results. */
export function auditHistoryFrom(results: readonly WorkerResultRecord[]): Map<string, StratumHistory> {
  const byStratum = new Map<string, WorkerResultRecord[]>();
  for (const record of auditorRecords(results)) {
    const spec = record.completion.completedTask.workerTask;
    if (!spec) continue;
    const key = stratumOf(spec.contract);
    byStratum.set(key, [...(byStratum.get(key) ?? []), record]);
  }
  const history = new Map<string, StratumHistory>();
  for (const [key, records] of byStratum) {
    const ordered = [...records].sort((a, b) => a.endedAt.localeCompare(b.endedAt) || a.id.localeCompare(b.id));
    let survived = 0;
    let everBroken = false;
    for (const record of ordered) {
      if (record.result.verdict === "BROKE") { everBroken = true; survived = 0; }
      else if (record.result.verdict === "SURVIVED") survived += 1;
    }
    history.set(key, { reviewed: ordered.filter((r) => r.modelReview !== undefined).length, survivedSinceBreak: survived, everBroken });
  }
  return history;
}

/**
 * What the field manual remembers of each stratum's latest audit (the
 * AUDIT_STRATUM rows the Auditor writes). It fills in strata the durable results
 * no longer show, so a stratum that broke once is still under review after its
 * results have aged out, and a stratum already reviewed is not treated as new.
 */
export function auditHistoryFromManual(store: Pick<FieldManualStore, "entries">): Map<string, StratumHistory> {
  const history = new Map<string, StratumHistory>();
  for (const entry of store.entries) {
    if (entry.kind !== "AUDIT_STRATUM") continue;
    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    const recordClass = payload.recordClass; const host = payload.host;
    if (typeof recordClass !== "string" || typeof host !== "string") continue;
    const broke = entry.outcome === "FAILED";
    history.set(`${recordClass}|${host}`, {
      reviewed: payload.modelReviewed === true ? 1 : 0,
      survivedSinceBreak: broke ? 0 : entry.outcome === "YIELDED" ? 1 : 0,
      everBroken: broke,
    });
  }
  return history;
}

export type SampleReason = "ESCALATION" | "JUDGMENT_CALL" | "NEW_STRATUM" | "BROKEN_STRATUM" | "PAST_REFRESH" | "DEMAND" | "SINGLE_SOURCE" | "SAMPLED" | "NOT_SAMPLED";

/** Where the sampler should look harder: facts readers ask for, facts with one source, facts past their refresh date. */
export interface SampleBoosts {
  /** 0 is the most-asked-for; null or absent when readers have not asked. */
  readonly demandRank?: number | null;
  readonly singleSource?: boolean;
  readonly pastRefresh?: boolean;
}
/** How many of the most-asked-for places count as high demand. */
export const DEMAND_TOP_RANKS = 20;

/** The boost that applies, strongest first: a fact past its refresh date, then reader demand, then a single source. */
export function boostReason(boosts: SampleBoosts | undefined): "PAST_REFRESH" | "DEMAND" | "SINGLE_SOURCE" | null {
  if (!boosts) return null;
  if (boosts.pastRefresh) return "PAST_REFRESH";
  if (boosts.demandRank !== null && boosts.demandRank !== undefined && boosts.demandRank < DEMAND_TOP_RANKS) return "DEMAND";
  if (boosts.singleSource) return "SINGLE_SOURCE";
  return null;
}

/** A stable value in [0, 1) from a result key: the same result always lands the same side of the line. */
export function stableFraction(key: string): number {
  return parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) / 0x1_0000_0000;
}

/**
 * Whether the model reviews this audit. Pure: the caller supplies the history
 * and whether the parse was model-quoted.
 */
export function sampleDecision(
  spec: AuditSampleSpec,
  history: AuditHistory,
  quoted: boolean,
  policy: AuditSamplePolicy = DEFAULT_AUDIT_SAMPLE_POLICY,
  boosts?: SampleBoosts,
): { readonly sample: boolean; readonly reason: SampleReason; readonly stratum: string } {
  const stratum = stratumOf(spec.contract);
  if (spec.auditEscalation) return { sample: true, reason: "ESCALATION", stratum };
  // A judgment call (portrait, statement or position summary, one person matched across sources) is always re-read by the model.
  const urls = spec.contract.schemaVersion === 2 ? spec.contract.sourceScope.canonicalUrls : [];
  // The publisher still binds the image to the named person. Own official
  // pages receive the ordinary live sample rather than a blanket second-source audit.
  const portraitBasis = urls.length > 0 && urls.every(url => isOfficialSource(url)) ? "OWN_PAGE" as const : undefined;
  if (needsSecondSource({ ...spec.contract, portraitBasis })) return { sample: true, reason: "JUDGMENT_CALL", stratum };
  const h = history.get(stratum);
  if (!h || h.reviewed < policy.floorPerStratum) return { sample: true, reason: "NEW_STRATUM", stratum };
  if (h.everBroken && h.survivedSinceBreak < policy.survivedAfterBreak) return { sample: true, reason: "BROKEN_STRATUM", stratum };
  const fraction = stableFraction(`${spec.artifactId}|${spec.producerResultId ?? ""}|${stratum}`);
  const base = quoted ? policy.quotedRatio : policy.ratio;
  if (fraction < base) return { sample: true, reason: "SAMPLED", stratum };
  const boost = boostReason(boosts);
  if (boost && fraction < Math.min(1, base * (policy.boostMultiplier ?? 1))) return { sample: true, reason: boost, stratum };
  return { sample: false, reason: "NOT_SAMPLED", stratum };
}

/**
 * The sampler a runtime hands to the fleet: it reads the results once, then keeps
 * its own count as it decides, so a burst of new results from one stratum does not
 * all count as "the first".
 */
export type AuditSampleSpec=Pick<WorkerTaskSpec,"artifactId"|"producerResultId">&{readonly auditEscalation?:boolean|WorkerTaskSpec["auditEscalation"];readonly contract:AuditStratumContract&{readonly requiredFields?:readonly string[]}};
export interface AuditSampleRequest{readonly samplerId:string;readonly spec:AuditSampleSpec;readonly policy:AuditSamplePolicy}

export async function indexedModelAuditSample(repos:AuditHistoryRepositories,request:AuditSampleRequest):Promise<boolean>{
  return withIndexedAuditSample(repos,{samplerId:request.samplerId,stratum:stratumOf(request.spec.contract),producerResultId:request.spec.producerResultId},(history,quoted)=>{
    const decision=sampleDecision(request.spec,history?new Map([[stratumOf(request.spec.contract),history]]):new Map(),quoted,request.policy);
    return{value:decision.sample,count:decision.sample&&!request.spec.auditEscalation};
  });
}

export function createModelAuditSampler(repos: AuditHistoryRepositories, policy: AuditSamplePolicy = DEFAULT_AUDIT_SAMPLE_POLICY) {
  const samplerId=randomUUID();
  return async (spec: WorkerTaskSpec): Promise<boolean> => {
    const contract:AuditSampleSpec["contract"]=spec.contract.schemaVersion===2?{schemaVersion:2,recordClass:spec.contract.recordClass,
      requiredFields:spec.contract.requiredFields,sourceScope:{publisher:spec.contract.sourceScope.publisher,canonicalUrls:spec.contract.sourceScope.canonicalUrls}}:
      {schemaVersion:1,recordClass:spec.contract.recordClass,requiredFields:spec.contract.requiredFields,publisherSlug:spec.contract.publisherSlug};
    const request:AuditSampleRequest={samplerId,spec:{artifactId:spec.artifactId,contract,auditEscalation:spec.auditEscalation?true:undefined,producerResultId:spec.producerResultId},policy};
    if(process.env.WTP_WORKER_TOOLS_URL){
      const response=await fetch(process.env.WTP_WORKER_TOOLS_URL,{method:"POST",headers:{"content-type":"application/json",authorization:process.env.WTP_WORKER_TOOLS_TOKEN??""},
        body:JSON.stringify({kind:"audit-history",body:request})});
      if(!response.ok)throw new Error(`SHARED_AUDIT_HISTORY_FAILED:${response.status}`);
      const value=await response.json();if(typeof value!=="boolean")throw new Error("SHARED_AUDIT_HISTORY_INVALID");return value;
    }
    return indexedModelAuditSample(repos,request);
  };
}


export interface AuditCoverageReport {
  /** Extracted-and-validated results the audits could reach. */
  readonly validated: number;
  /** Of those, how many have an audit (the deterministic audit runs on every one). */
  readonly audited: number;
  /** Of those, how many had the model's adversarial review (the sampled part). */
  readonly modelReviewed: number;
  readonly broke: number;
  readonly strata: number;
  readonly strataModelReviewed: number;
  /** Whole percents; null when there is no denominator. */
  readonly auditedPercent: number | null;
  readonly modelReviewedPercent: number | null;
  readonly strataModelReviewedPercent: number | null;
  /** Mean of the audits' own coverage numbers: official sources checked of those that apply, and source records extracted of those the sources hold. */
  readonly sourcesCheckedPercent: number | null;
  readonly recordsExtractedPercent: number | null;
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((100 * part) / whole) : null);
const mean = (values: readonly number[]): number | null => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

/** The coverage number for Admin: how much of what is published the auditor has looked at, and how much of what applies each audit covered. */
export function auditCoverageReport(results: readonly WorkerResultRecord[]): AuditCoverageReport {
  const validated = new Set(results.filter((r) => r.result.role === "VALIDATOR" && (r.result.verdict === "PASS" || r.result.extractionVerdict === "PASS")).map((r) => r.inputResultIds.find((id) => results.some((p) => p.id === id && p.result.role === "PARSER")) ?? r.id));
  const audits = auditorRecords(results);
  const audited = new Set(audits.map((r) => r.inputResultIds.find((id) => validated.has(id)) ?? r.id));
  const reviewed = audits.filter((r) => r.modelReview !== undefined);
  const strata = new Set<string>();
  const strataReviewed = new Set<string>();
  for (const r of results.filter((x) => x.result.role === "PARSER" && x.result.verdict === "EXTRACTED")) {
    const spec = r.completion.completedTask.workerTask;
    if (spec) strata.add(stratumOf(spec.contract));
  }
  for (const r of reviewed) { const spec = r.completion.completedTask.workerTask; if (spec) strataReviewed.add(stratumOf(spec.contract)); }
  const coverages = audits.flatMap((r) => (r.result.role === "ADVERSARIAL_AUDITOR" && r.result.coverage ? [r.result.coverage as AuditCoverage] : []));
  return {
    validated: validated.size,
    audited: [...audited].filter((id) => validated.has(id)).length,
    modelReviewed: new Set(reviewed.map((r) => r.inputResultIds.find((id) => validated.has(id)) ?? r.id)).size,
    broke: audits.filter((r) => r.result.verdict === "BROKE").length,
    strata: strata.size,
    strataModelReviewed: [...strataReviewed].filter((s) => strata.has(s)).length,
    auditedPercent: pct([...audited].filter((id) => validated.has(id)).length, validated.size),
    modelReviewedPercent: pct(new Set(reviewed.map((r) => r.inputResultIds.find((id) => validated.has(id)) ?? r.id)).size, validated.size),
    strataModelReviewedPercent: pct([...strataReviewed].filter((s) => strata.has(s)).length, strata.size),
    sourcesCheckedPercent: mean(coverages.flatMap((c) => (c.sourcesPercent === null ? [] : [c.sourcesPercent]))),
    recordsExtractedPercent: mean(coverages.flatMap((c) => (c.recordsPercent === null ? [] : [c.recordsPercent]))),
  };
}


/**
 * What an audit teaches the next agent. One row per stratum (a re-audit refreshes
 * it), and, when the audited records came from a model-quoted parse and broke,
 * the parse tier's outcome for that publisher turned to FAILED: the next Parser
 * reads it and starts one tier higher.
 */
export function auditLearningEntries(input: {
  readonly result: AuditorResult;
  readonly auditResultId: string;
  readonly modelReviewed: boolean;
  readonly contract: CivicExtractionContract;
  readonly parser?: Pick<WorkerResultRecord, "modelParse">;
  readonly observedAt: string;
}): FieldManualEntry[] {
  const { result, contract } = input;
  const stratum = stratumOf(contract);
  const [recordClass, host] = stratum.split("|") as [string, string];
  const day = input.observedAt.slice(0, 10);
  const state = contract.schemaVersion === 2 ? contract.jurisdiction.state : "";
  const broken = result.brokenRecordIds ?? [];
  const codes = [...new Set(result.findings.filter((f) => f.severity === "BLOCKING").map((f) => f.code))].slice(0, 6);
  const entries: FieldManualEntry[] = [
    newFieldManualEntry(AUDIT_LEARNING_SOURCE, `stratum|${stratum}`, {
      role: "AUDITOR", kind: "AUDIT_STRATUM", title: `${recordClass} on ${host}: latest audit ${result.verdict}`,
      summary: result.verdict === "BROKE"
        ? `audit BROKE ${broken.length} record(s): ${codes.join(", ") || "see findings"}`
        : `audit ${result.verdict}: ${result.survivingRecordCount} record(s) checked${result.coverage?.sourcesPercent != null ? `; ${result.coverage.sourcesPercent}% of applicable official sources checked` : ""}`,
      outcome: result.verdict === "BROKE" ? "FAILED" : result.verdict === "SURVIVED" ? "YIELDED" : "ZERO",
      states: state ? [state] : [], recordClasses: [recordClass], observedAt: day,
      payload: { recordClass, host, verdict: result.verdict, brokenRecords: broken.length, codes, coverage: result.coverage ?? null, auditResultId: input.auditResultId, modelReviewed: input.modelReviewed },
    }),
  ];
  const tier = input.parser?.modelParse?.tier;
  if (result.verdict === "BROKE" && broken.length > 0 && tier) {
    // The parse tier that produced records this audit broke is not to be trusted again for this publisher.
    entries.push(...parseLearningEntries(emptyFieldManual(), { recordClass, host, state, tier: tier as ModelClass, proposed: broken.length, confirmed: 0,
      rejected: broken.length, fieldNames: [], samples: [], observedAt: input.observedAt }));
  }
  return entries;
}
