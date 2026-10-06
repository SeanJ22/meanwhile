/**
 * **THE COMPLETE CHAIN FOR A FACT: SCOUTED → CONFIRMED → VERIFIED → AUDITED → APPROVED.**
 * (Fleet Promotion Readiness, PRDY-3, 2026-09-06.)
 *
 * Every transition is OFFERED through `appendTransition`, the one gated path,
 * and every burden is decided by `validateTransition`'s existing rules plus
 * the two additive ones this session gave it (a conflicting confirmation, a
 * failed approval burden). Nothing here bypasses a stage, and nothing here
 * writes a record the validator did not accept or refuse.
 *
 * ```
 *   SCOUTED    the fact, from its acquiring Attempt; one item per fact key
 *   CONFIRMED  a second acquisition of the same official representation by another
 *              Attempt whose bytes, through the same adapter, state the same fact;
 *              a second acquisition that states a different fact is offered and
 *              REFUSED (the hold), never skipped
 *   VERIFIED   the five checks, measured by fact-verification over the immutable
 *              bytes, bound to the exact Validator result and its artifact
 *   AUDITED    the exact Auditor result, with controls MEASURED from an independent
 *              parse of the same bytes
 *   APPROVED   a machine RELEASE_ORCHESTRATOR actor, once the chain holds and the
 *              deterministic burdens pass: checks, controls, currency, freshness,
 *              candidate class. Implemented class-specific paths define the gate; no fact is
 *              approved by a person.
 * ```
 *
 * Record ids and `at` values are derived from the evidence, so a re-projection
 * re-offers the same records and the log dedupes them; a refusal whose reasons
 * did not change is the same refusal.
 */
import { activeWiring, type BodySourceWiring } from "../../registry/source-wiring.ts";
import { getRegistryRuntimeReadModel } from "../../registry/runtime-read-model.ts";
import { fingerprint } from "../ids.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../repository/types.ts";
import type { WorkerResultRecord } from "../workers/types.ts";
import { readAcquisitionAttempts, promotionArtifactReader } from "./evidence-reads.ts";
import { LOW_RISK_CANDIDATE_CLASSES } from "./activation-gate.ts";
import { controlsClean, measureFactControls, verifyMeetingFact } from "./fact-verification.ts";
import { factSubjectsFromStates, readFactFreshness, type FactFreshnessReading, type FactSubject } from "./fact-freshness.ts";
import {
  bridgeMeetingFacts,
  factAgreementIn,
  factSummary,
  isMeetingFactClass,
  meetingFactContract,
  normalizeFactsFromBytes,
  type FactBridge,
  type FactRefusal,
  type MeetingFact,
  type MeetingFactClass,
  type NormalizedSource,
} from "./meeting-facts.ts";
import { appendTransition, contextFromRepositories, readPipelineStates, stageCounts, type PipelineContext, type StageCounts } from "./pipeline.ts";
import {
  PIPELINE_STAGES,
  PROMOTION_PIPELINE_FORMAT_VERSION,
  type ApprovalBurden,
  type ApprovedRecord,
  type AuditedRecord,
  type ConfirmedRecord,
  type PipelineActor,
  type PipelineItemState,
  type PipelineStage,
  type ScoutedRecord,
  type TransitionRecord,
  type VerifiedRecord,
} from "./types.ts";

export const FACT_CHAIN_VERSION = "fact-chain/1";

/** The item id is the fact: a re-acquisition stating the same fact lands on the same item. */
export function factItemId(recordClass: MeetingFactClass, factKey: string): string {
  return `pp-${fingerprint(["fleet-fact", recordClass, factKey])}`;
}

/** Body ids the Reader recognises: the canonical registry and SOURCE_WIRING. */
export function readRegistryBodyIds(root: string, wiring: readonly BodySourceWiring[] = activeWiring()): ReadonlySet<string> {
  const ids = new Set<string>(wiring.map((row) => row.bodyId));
  void root;
  for (const body of getRegistryRuntimeReadModel().registry.bodies) ids.add(body.id);
  return ids;
}

export interface FactChainOptions {
  /** The immutable bytes for an artifact, from the vault; null when the vault cannot produce them. */
  readonly readArtifactText: (artifactId: string) => Promise<string | null>;
  readonly now: string;
  readonly root?: string;
  readonly registryBodyIds?: ReadonlySet<string>;
  readonly wiring?: readonly BodySourceWiring[];
  readonly freshness?: (input: { recordClass: MeetingFactClass; subjectId: string; meetingSource: string; lastSuccessfulAcquisitionAt: string | null }) => Promise<FactFreshnessReading>;
}

/** One completed extraction chain, bridged. */
export interface BridgedChain {
  readonly parser: WorkerResultRecord;
  readonly validator: WorkerResultRecord | null;
  readonly auditor: WorkerResultRecord | null;
  readonly artifact: ArtifactRecord;
  readonly text: string;
  readonly bridge: FactBridge;
}

export interface FactItem {
  readonly itemId: string;
  readonly fact: MeetingFact;
  readonly chain: BridgedChain;
  /** The newest later reading of the same source, when one is held. */
  readonly newerSameSource: NormalizedSource | null;
  /**
   * Other acquisitions of the same canonical URL, oldest first, with their
   * reading: a distinct artifact from another Attempt, or a COMPLETED Attempt
   * that re-observed this artifact's exact bytes (`reobservation`).
   */
  readonly confirmations: readonly {
    readonly artifact: ArtifactRecord;
    readonly source: NormalizedSource | null;
    readonly role: string | null;
    readonly attemptId: string;
    readonly at: string;
    readonly reobservation: boolean;
  }[];
}

export interface FactChainOffer {
  readonly stage: PipelineStage;
  readonly itemId: string;
  readonly recordId: string;
  readonly accepted: boolean;
  readonly appended: boolean;
  readonly refusalCodes: readonly string[];
  readonly error: string | null;
}

export interface FactChainCollection {
  readonly chains: readonly BridgedChain[];
  readonly items: readonly FactItem[];
  readonly refusals: readonly (FactRefusal & { readonly artifactId: string })[];
}

function completedValidatorFor(parser: WorkerResultRecord, results: readonly WorkerResultRecord[], ctx: PipelineContext): WorkerResultRecord | null {
  return results
    .filter((r) => r.result.role === "VALIDATOR" && r.result.verdict === "PASS" && r.inputResultIds.includes(parser.id) && ctx.workerResultById?.(r.id) !== null)
    .sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1))[0] ?? null;
}

function completedAuditorFor(validator: WorkerResultRecord | null, results: readonly WorkerResultRecord[], ctx: PipelineContext): WorkerResultRecord | null {
  if (validator === null) return null;
  return results
    .filter((r) => r.result.role === "ADVERSARIAL_AUDITOR" && r.inputResultIds.includes(validator.id) && ctx.workerResultById?.(r.id) !== null)
    .sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1))[0] ?? null;
}

/**
 * Bridge every completed meeting-fact extraction chain the control plane
 * holds, without offering anything. The promoter and the canary read facts
 * through this; the projection offers through `projectFactChains`.
 */
export async function collectFactChains(repos: ControlPlaneRepositories, options: FactChainOptions, ctx?: PipelineContext): Promise<FactChainCollection> {
  return collectWithEvidence(repos, options, await factChainEvidence(repos, ctx));
}

async function factChainEvidence(repos: ControlPlaneRepositories, ctx?: PipelineContext) {
  // Retain every result, including failed audits. There are no broad artifact,
  // Attempt or WorkItem reads, and no newest-N cutoff on source observations.
  const results = await repos.workerResults.readAll();
  const parserIds = results.flatMap(r => r.result.role === "PARSER" && meetingFactContract(r) !== null &&
    r.completion.completedTask.workerTask?.purpose !== "DIAGNOSTIC_REPLAY" ? [r.result.artifactId] : []);
  const readArtifacts = promotionArtifactReader(repos);
  const captures = await readArtifacts(parserIds);
  const artifacts = await readArtifacts(parserIds, captures.map(row => row.canonicalUrl));
  const attempts = await readAcquisitionAttempts(repos, parserIds);
  const context = ctx ?? await contextFromRepositories(repos, { artifacts, results, attemptIds: attempts.map(a => a.id) });
  return { results, artifacts, attempts, context };
}

async function collectWithEvidence(repos: ControlPlaneRepositories, options: FactChainOptions,
  evidence: Awaited<ReturnType<typeof factChainEvidence>>): Promise<FactChainCollection> {
  const { context, results, artifacts, attempts } = evidence;
  const refusals: (FactRefusal & { artifactId: string })[] = [];
  const parsers = results
    .filter((r) => r.result.role === "PARSER" && meetingFactContract(r) !== null &&
      r.completion.completedTask.workerTask?.purpose !== "DIAGNOSTIC_REPLAY" && context.workerResultById?.(r.id) !== null)
    .sort((a, b) => (a.endedAt < b.endedAt ? -1 : 1));
  const seenArtifacts = new Set<string>();
  const chains: BridgedChain[] = [];
  const textById = new Map<string, string | null>();
  const readText = async (id: string): Promise<string | null> => {
    if (!textById.has(id)) {
      try { textById.set(id, await options.readArtifactText(id)); } catch { textById.set(id, null); }
    }
    return textById.get(id) ?? null;
  };
  for (const parser of parsers) {
    if (parser.result.role !== "PARSER") continue;
    const artifactId = parser.result.artifactId;
    if (seenArtifacts.has(artifactId)) continue;
    if (parser.result.verdict !== "EXTRACTED") {
      /* A failed or ambiguous extraction is a named refusal, not a silent skip; a later clean extraction of the same artifact may still bridge. */
      refusals.push({ code: "EXTRACTION_NOT_CLEAN", detail: `parser ${parser.id} verdict ${parser.result.verdict}: ${parser.result.warnings.map((w) => w.code).join(", ") || "no warning code"}`, recordId: null, artifactId });
      continue;
    }
    const artifact = context.artifactById(artifactId);
    if (artifact === null) { refusals.push({ code: "ARTIFACT_NOT_IN_LOG", detail: `parser ${parser.id} extracted ${artifactId}, which the artifact log does not hold`, recordId: null, artifactId }); continue; }
    const text = await readText(artifactId);
    if (text === null) { refusals.push({ code: "VAULT_BYTES_UNAVAILABLE", detail: `the vault produced no bytes for ${artifactId}; nothing is bridged from a parser's copy`, recordId: null, artifactId }); continue; }
    seenArtifacts.add(artifactId);
    const validator = completedValidatorFor(parser, results, context);
    const auditor = completedAuditorFor(validator, results, context);
    const bridge = bridgeMeetingFacts({ parser, validator, auditor, artifact, text, now: options.now, wiring: options.wiring });
    for (const refusal of bridge.refusals) refusals.push({ ...refusal, artifactId });
    chains.push({ parser, validator, auditor, artifact, text, bridge });
  }

  /* Readings of every artifact at a chain's URL, for currency and confirmation. */
  const sourceByArtifact = new Map<string, NormalizedSource | null>();
  const readingOf = async (chain: BridgedChain, artifact: ArtifactRecord): Promise<NormalizedSource | null> => {
    if (artifact.artifactId === chain.artifact.artifactId) return chain.bridge.source;
    if (sourceByArtifact.has(artifact.artifactId)) return sourceByArtifact.get(artifact.artifactId) ?? null;
    const contract = chain.bridge.contract;
    const text = await readText(artifact.artifactId);
    const source = contract === null || text === null || artifact.partial ? null
      : normalizeFactsFromBytes({ contract, artifact, text, now: options.now, wiring: options.wiring });
    sourceByArtifact.set(artifact.artifactId, source);
    return source;
  };

  const items: FactItem[] = [];
  for (const chain of chains) {
    const sameUrl = artifacts
      .filter((a) => a.canonicalUrl === chain.artifact.canonicalUrl && a.artifactId !== chain.artifact.artifactId && a.attemptId !== chain.artifact.attemptId)
      .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1));
    const confirmations: (FactItem["confirmations"][number])[] = [];
    for (const artifact of sameUrl) {
      confirmations.push({ artifact, source: await readingOf(chain, artifact), role: context.attemptRoleById(artifact.attemptId), attemptId: artifact.attemptId, at: artifact.recordedAt, reobservation: false });
    }
    for (const attempt of attempts) {
      /* Only an ACQUIRER re-observes; a worker computation that names the artifact it read is not an acquisition. */
      if (attempt.id === chain.artifact.attemptId || attempt.outcome !== "COMPLETED" || attempt.worker.role !== "ACQUIRER" || !attempt.artifactIds.includes(chain.artifact.artifactId)) continue;
      confirmations.push({ artifact: chain.artifact, source: chain.bridge.source, role: attempt.worker.role, attemptId: attempt.id, at: attempt.endedAt ?? attempt.startedAt, reobservation: true });
    }
    confirmations.sort((a, b) => (a.at < b.at ? -1 : 1));
    const later = sameUrl.filter((a) => a.recordedAt > chain.artifact.recordedAt);
    const newest = later.length === 0 ? null : later[later.length - 1];
    const newerSameSource = newest === null ? null : await readingOf(chain, newest);
    for (const fact of chain.bridge.facts) {
      items.push({ itemId: factItemId(fact.recordClass, fact.factKey), fact, chain, newerSameSource, confirmations });
    }
  }
  return { chains, items, refusals };
}

export interface FactChainReport {
  readonly version: typeof FACT_CHAIN_VERSION;
  readonly chains: number;
  readonly bridged: number;
  readonly facts: number;
  readonly refusals: readonly (FactRefusal & { readonly artifactId: string })[];
  readonly offers: readonly FactChainOffer[];
  /** Every FLEET_EXTRACTION item's derived state, after this projection. */
  readonly states: readonly PipelineItemState[];
  readonly counts: StageCounts;
  readonly byClass: Readonly<Record<MeetingFactClass, { readonly items: number; readonly byStage: Readonly<Record<PipelineStage, number>>; readonly refused: number }>>;
  readonly factsByItem: ReadonlyMap<string, MeetingFact>;
  readonly freshness: readonly FactFreshnessReading[];
}

function lane(record: WorkerResultRecord): PipelineActor["lane"] {
  return record.executionMode === "MODEL_ASSISTED" ? "BOUNDED_MODEL_WORKER" : "DETERMINISTIC";
}

/** Every fact item's derived state, from the log. */
export async function readFactItemStates(repos: ControlPlaneRepositories): Promise<PipelineItemState[]> {
  return (await readPipelineStates(repos)).filter((s) => s.byStage.SCOUTED?.source.kind === "FLEET_EXTRACTION");
}

/** The (record class, body) subjects the scheduler owes a freshness obligation, from the pipeline's own records. */
export async function factSubjectsFromRepositories(repos: ControlPlaneRepositories, nowIso: string): Promise<FactSubject[]> {
  return factSubjectsFromStates(await readFactItemStates(repos), nowIso);
}

export function factClassCounts(states: readonly PipelineItemState[]): FactChainReport["byClass"] {
  const zero = (): Record<PipelineStage, number> => ({ SCOUTED: 0, CONFIRMED: 0, VERIFIED: 0, AUDITED: 0, APPROVED_FOR_PROMOTION: 0 });
  const out = { "meeting-times": { items: 0, byStage: zero(), refused: 0 }, agendas: { items: 0, byStage: zero(), refused: 0 } };
  for (const s of states) {
    if (s.recordClass === null || !isMeetingFactClass(s.recordClass)) continue;
    const row = out[s.recordClass];
    row.items += 1;
    if (s.stage !== null) row.byStage[s.stage] += 1;
    if (s.refused !== null) row.refused += 1;
  }
  return out;
}

/**
 * Offer every stage the evidence supports for every bridged fact. Idempotent:
 * a held stage is never re-offered, and a refused offer whose reasons did not
 * change re-appends nothing.
 */
export async function projectFactChains(repos: ControlPlaneRepositories, options: FactChainOptions): Promise<FactChainReport> {
  const evidence = await factChainEvidence(repos);
  const ctx = evidence.context;
  const collected = await collectWithEvidence(repos, options, evidence);
  const registryBodyIds = options.registryBodyIds ?? readRegistryBodyIds(options.root ?? process.cwd(), options.wiring);
  const freshness = options.freshness ?? (async (input) => readFactFreshness(repos, { ...input, now: options.now }));
  const statesById = new Map((await readFactItemStates(repos)).map((s) => [s.itemId, s]));
  const offers: FactChainOffer[] = [];
  const factsByItem = new Map<string, MeetingFact>();
  const readings: FactFreshnessReading[] = [];
  const readingKeys = new Set<string>();

  const offer = async (record: TransitionRecord): Promise<PipelineItemState | null> => {
    try {
      const out = await appendTransition(repos, record, ctx, options.now);
      offers.push({ stage: record.stage, itemId: record.itemId, recordId: record.recordId, accepted: out.accepted, appended: out.appended,
        refusalCodes: out.accepted ? [] : out.record.stage === "REFUSED" ? out.record.reasons.map((r) => r.code) : [], error: null });
      statesById.set(record.itemId, out.state);
      return out.state;
    } catch (error) {
      offers.push({ stage: record.stage, itemId: record.itemId, recordId: record.recordId, accepted: false, appended: false, refusalCodes: [], error: error instanceof Error ? error.message : String(error) });
      return statesById.get(record.itemId) ?? null;
    }
  };

  for (const item of collected.items) {
    const { fact, chain, itemId } = item;
    factsByItem.set(itemId, fact);
    const artifact = chain.artifact;
    let state = statesById.get(itemId) ?? null;

    /* SCOUTED */
    if (!state?.byStage.SCOUTED) {
      const role = ctx.attemptRoleById(artifact.attemptId) ?? "ACQUIRER";
      const scouted: ScoutedRecord = {
        formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${itemId}:scouted`, itemId, at: artifact.recordedAt,
        actor: { role, lane: role === "SCOUT" ? "BOUNDED_MODEL_WORKER" : "DETERMINISTIC", instance: artifact.attemptId },
        stage: "SCOUTED",
        source: { kind: "FLEET_EXTRACTION", workItemId: artifact.workItemId, attemptId: artifact.attemptId, parserResultId: chain.parser.id, artifactId: artifact.artifactId,
          extractedRecordId: fact.chain.extractedRecordId, factKey: fact.factKey, sourceRecordClass: fact.chain.sourceRecordClass, sourceKey: fact.source.sourceKey, applicableAt: fact.applicableAt },
        recordClass: fact.recordClass, subjectId: fact.body.bodyId, canonicalUrl: artifact.canonicalUrl, artifactIds: [artifact.artifactId],
        scoutAttemptId: artifact.attemptId, summary: factSummary(fact),
      };
      state = await offer(scouted);
    }
    if (!state?.byStage.SCOUTED) continue;

    /* CONFIRMED */
    if (state.stage === "SCOUTED") {
      const candidates = item.confirmations.filter((c) => c.source !== null && c.role !== null && c.role !== "SCOUT");
      const agreements = candidates.map((c) => ({ ...c, agreement: factAgreementIn(fact, c.source!) })).filter((c) => c.agreement.present);
      const chosen = agreements.find((c) => c.agreement.sameFact) ?? agreements.find((c) => !c.agreement.sameFact) ?? null;
      if (chosen !== null) {
        const confirmed: ConfirmedRecord = {
          formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${itemId}:confirmed:${fingerprint([chosen.artifact.artifactId, chosen.attemptId])}`, itemId, at: chosen.at,
          actor: { role: chosen.role as PipelineActor["role"], lane: "DETERMINISTIC", instance: chosen.attemptId },
          stage: "CONFIRMED", basis: "SECOND_ACQUISITION", confirmingArtifactIds: [chosen.artifact.artifactId], sameFact: null,
          factAgreement: { sameFact: chosen.agreement.sameFact, detail: `${fact.factKey}: ${chosen.reobservation ? "byte-identical re-acquisition; " : ""}${chosen.agreement.detail}` },
        };
        state = await offer(confirmed);
      }
    }
    if (!state) continue;

    /* VERIFIED */
    if (state.stage === "CONFIRMED" && chain.validator !== null) {
      const validator = chain.validator;
      const verification = verifyMeetingFact({ fact, parser: chain.parser.result as never, artifact, text: chain.text, siblings: chain.bridge.facts,
        newerSameSource: item.newerSameSource, registryBodyIds, now: options.now });
      const verified: VerifiedRecord = {
        formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${itemId}:verified:${validator.id}`, itemId, at: validator.endedAt,
        actor: { role: "VALIDATOR", lane: lane(validator), instance: validator.worker.instance },
        stage: "VERIFIED", checks: verification.checks, workerResultId: validator.id,
      };
      state = await offer(verified);
    }
    if (!state) continue;

    /* AUDITED */
    const audit = chain.auditor?.result;
    if (state.stage === "VERIFIED" && chain.auditor !== null && audit !== undefined && audit.role === "ADVERSARIAL_AUDITOR") {
      const auditor = chain.auditor;
      let controls: AuditedRecord["controls"] = null;
      let controlLine: string;
      try {
        const measured = measureFactControls({ sourceId: fact.source.sourceId, publisherSlug: fact.source.publisherSlug, artifact, text: chain.text, parser: chain.parser.result as never, now: options.now });
        controls = measured.score;
        controlLine = `${measured.instrument}; ${controlsClean(measured.score).detail}`;
      } catch (error) {
        controlLine = `controls NOT MEASURED: ${error instanceof Error ? error.message : String(error)}`;
      }
      const audited: AuditedRecord = {
        formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${itemId}:audited:${auditor.id}`, itemId, at: auditor.endedAt,
        actor: { role: "ADVERSARIAL_AUDITOR", lane: lane(auditor), instance: auditor.worker.instance },
        stage: "AUDITED", startedFrom: audit.startedFrom, survived: audit.verdict === "SURVIVED", controls,
        findings: [
          ...audit.findings.map((f) => `${f.code}: ${f.detail}`),
          ...(auditor.modelReview ? [`model review ${auditor.modelReview.model}: ${auditor.modelReview.verdict}${auditor.modelReview.validationError ? ` (${auditor.modelReview.validationError})` : ""}`] : []),
          `${auditor.completion.completedTask.workerTask?.auditScope ?? "CAPTURED_ARTIFACT"} audit; ${controlLine}`,
        ],
        workerResultId: auditor.id,
      };
      state = await offer(audited);
    }
    if (!state) continue;

    /* APPROVED_FOR_PROMOTION */
    if (state.stage === "AUDITED") {
      const scouted = state.byStage.SCOUTED!;
      const confirmed = state.byStage.CONFIRMED!;
      const verified = state.byStage.VERIFIED!;
      const audited = state.byStage.AUDITED!;
      const failedChecks = verified.checks.filter((c) => c.result !== "PASS").map((c) => c.name);
      const clean = audited.controls === null ? { clean: false, detail: "controls NOT MEASURED" } : controlsClean(audited.controls);
      const currency = item.newerSameSource === null ? { present: false, sameFact: false, detail: "no later reading of the same source is held" } : factAgreementIn(fact, item.newerSameSource);
      const agreeingAt = [artifact.recordedAt, ...item.confirmations.filter((c) => c.source !== null && factAgreementIn(fact, c.source!).sameFact).map((c) => c.at)];
      const lastSuccess = agreeingAt.sort().at(-1) ?? null;
      const readingKey = `${fact.recordClass}|${fact.body.bodyId}`;
      const reading = await freshness({
        recordClass: fact.recordClass,
        subjectId: fact.body.bodyId,
        meetingSource: fact.source.sourceId,
        lastSuccessfulAcquisitionAt: lastSuccess,
      });
      if (!readingKeys.has(readingKey)) { readingKeys.add(readingKey); readings.push(reading); }
      const burdens: ApprovalBurden[] = [
        { name: "CHAIN_CHECKS_PASS", result: failedChecks.length === 0 ? "PASS" : "FAIL", detail: failedChecks.length === 0 ? `all ${verified.checks.length} checks PASS on ${verified.recordId}` : `${failedChecks.join(", ")} not PASS on ${verified.recordId}` },
        { name: "CONTROLS_MEASURED_CLEAN", result: clean.clean ? "PASS" : "FAIL", detail: clean.detail },
        { name: "FACT_CURRENT", result: currency.present && !currency.sameFact ? "FAIL" : "PASS", detail: currency.detail },
        { name: "FRESHNESS_NOT_STALE", result: reading.hold ? "FAIL" : "PASS", detail: `${reading.state}: ${reading.reason}` },
        { name: "RECORD_CLASS_CANDIDATE", result: LOW_RISK_CANDIDATE_CLASSES.includes(fact.recordClass) && isMeetingFactClass(fact.recordClass) ? "PASS" : "FAIL", detail: `${fact.recordClass} ${LOW_RISK_CANDIDATE_CLASSES.includes(fact.recordClass) ? "is" : "is not"} in the implemented fact-chain class set` },
      ];
      const approved: ApprovedRecord & { readonly readerMeeting: typeof fact.meeting; readonly publicationDoor: "PERMANENT_MEETING_PARTITION" } = {
        formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: `${itemId}:approved:${audited.recordId}`, itemId, at: audited.at,
        actor: { role: "RELEASE_ORCHESTRATOR", lane: "DETERMINISTIC", instance: `fact-approver:${FACT_CHAIN_VERSION}:${itemId}` },
        stage: "APPROVED_FOR_PROMOTION", chain: { scouted: scouted.recordId, confirmed: confirmed.recordId, verified: verified.recordId, audited: audited.recordId },
        recordClass: fact.recordClass, burdens,
        readerMeeting: fact.meeting, publicationDoor: "PERMANENT_MEETING_PARTITION",
      };
      state = await offer(approved);
    }
  }

  const states = await readFactItemStates(repos);
  return {
    version: FACT_CHAIN_VERSION,
    chains: collected.chains.length,
    bridged: collected.chains.filter((c) => c.bridge.facts.length > 0).length,
    facts: collected.items.length,
    refusals: collected.refusals,
    offers,
    states,
    counts: stageCounts(states),
    byClass: factClassCounts(states),
    factsByItem,
    freshness: readings,
  };
}

/** Lines for a digest: every count with its denominator. */
export function factChainLines(report: FactChainReport): string[] {
  const out = [
    `  fact chains        ${report.bridged} of ${report.chains} completed meeting-fact extraction(s) bridged into ${report.facts} fact(s); ${report.refusals.length} refusal(s) named`,
    `  fact offers        ${report.offers.filter((o) => o.accepted).length} of ${report.offers.length} offered transition(s) accepted (${report.offers.filter((o) => o.appended).length} newly appended, ${report.offers.filter((o) => o.error !== null).length} errored)`,
  ];
  for (const cls of ["meeting-times", "agendas"] as const) {
    const row = report.byClass[cls];
    out.push(`      ${cls}: ${row.items} item(s) — ${PIPELINE_STAGES.map((s) => `${s} ${row.byStage[s]}`).join(", ")}, with a refused offer ${row.refused}`);
  }
  for (const reading of report.freshness) out.push(`      freshness ${reading.obligationId}: ${reading.state}${reading.hold ? " (HOLD)" : ""} — ${reading.reason}`);
  return out;
}
