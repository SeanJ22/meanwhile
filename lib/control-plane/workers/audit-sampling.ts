/**
 * **THE AUDITOR SAMPLES ACROSS EVERYTHING, AFTER PUBLISHING, AND TEACHES THE NEXT AGENT.**
 * (Rulings section 3: samples are re-checked against their sources, and anything wrong is pulled.)
 *
 * The deterministic audit is code and cheap, so every validated record still gets
 * it. What costs money is the model's adversarial review. That is what is
 * sampled, on the cheapest tier (Haiku, then Sonnet on a recorded escalation):
 *
 * - **Every new stratum is reviewed first.** A stratum is a record class from one
 *   publisher. The first few results from any new one always get the model, so
 *   the sample reaches everything, not the loudest publishers.
 * - **A stratum that broke stays under review** until it has survived several
 *   audits in a row since the break.
 * - **Model-parsed results are reviewed more often** than rule-parsed ones: a
 *   model proposed them, and only code confirmed the quotes.
 * - **Everything else is a fixed fraction**, chosen by a stable hash of the
 *   result, so a retry never flips the decision.
 *
 * What an audit finds is written back to the field manual. The next Auditor
 * reads its stratum's history from the results; the next Parser reads it from
 * the manual, so a tier whose records broke is skipped for that publisher.
 */

import { createHash } from "node:crypto";
import { newFieldManualEntry, readFieldManual, type FieldManualEntry, type FieldManualStore } from "../field-manual.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { ModelClass } from "../scheduler/model-routing.ts";
import { needsSecondSource } from "../promotion/section3.ts";
import { parseLearningEntries } from "./model-parser.ts";
import { emptyFieldManual } from "../field-manual.ts";
import type { AuditCoverage, AuditorResult, CivicExtractionContract, WorkerResultRecord, WorkerTaskSpec } from "./types.ts";

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

/** A record class from one publisher: the unit the sample must reach. */
export function stratumOf(contract: CivicExtractionContract): string {
  const url = contract.schemaVersion === 2 ? contract.sourceScope.canonicalUrls[0] : undefined;
  let host = contract.schemaVersion === 2 ? contract.sourceScope.publisher : contract.publisherSlug;
  if (url) { try { host = new URL(url).host.toLowerCase(); } catch { /* keep the named publisher */ } }
  return `${contract.recordClass}|${host}`;
}

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

/** Where the sampler should look harder (DP-16): facts readers ask for, facts with one source, facts past their refresh date. */
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
  spec: Pick<WorkerTaskSpec, "artifactId" | "contract" | "auditEscalation" | "producerResultId">,
  history: AuditHistory,
  quoted: boolean,
  policy: AuditSamplePolicy = DEFAULT_AUDIT_SAMPLE_POLICY,
  boosts?: SampleBoosts,
): { readonly sample: boolean; readonly reason: SampleReason; readonly stratum: string } {
  const stratum = stratumOf(spec.contract);
  if (spec.auditEscalation) return { sample: true, reason: "ESCALATION", stratum };
  // A judgment call (portrait, statement or position summary, one person matched across sources) is the one kind of fact a model always re-reads (rulings section 3).
  if (needsSecondSource(spec.contract)) return { sample: true, reason: "JUDGMENT_CALL", stratum };
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
export function createModelAuditSampler(repos: Pick<ControlPlaneRepositories, "workerResults"> & Partial<Pick<ControlPlaneRepositories, "fieldManual">>, policy: AuditSamplePolicy = DEFAULT_AUDIT_SAMPLE_POLICY) {
  let loaded: Promise<{ history: Map<string, StratumHistory>; parsers: Map<string, WorkerResultRecord> }> | null = null;
  const load = () => (loaded ??= Promise.all([
    repos.workerResults.readAll(),
    repos.fieldManual ? readFieldManual({ fieldManual: repos.fieldManual }).then((r) => r.store) : Promise.resolve(emptyFieldManual()),
  ]).then(([all, manual]) => ({
    // The results are the more exact record; the manual covers strata they no longer show.
    history: new Map([...auditHistoryFromManual(manual), ...auditHistoryFrom(all)]),
    parsers: new Map(all.filter((r) => r.result.role === "PARSER").map((r) => [r.id, r] as const)),
  })));
  return async (spec: WorkerTaskSpec): Promise<boolean> => {
    const { history, parsers } = await load();
    const quoted = parsers.get(spec.producerResultId ?? "")?.modelParse !== undefined;
    const decision = sampleDecision(spec, history, quoted, policy);
    if (decision.sample && !spec.auditEscalation) {
      const h = history.get(decision.stratum);
      history.set(decision.stratum, { reviewed: (h?.reviewed ?? 0) + 1, survivedSinceBreak: h?.survivedSinceBreak ?? 0, everBroken: h?.everBroken ?? false });
    }
    return decision.sample;
  };
}

/* ------------------------------------------------------------ the number */

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

/* ------------------------------------------------------------ the learning */

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
