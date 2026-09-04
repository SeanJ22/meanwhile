import { requireCapability } from "../capability.ts";
import { contentHash } from "../ids.ts";
import { indexJson } from "./parser.ts";
import { assertResearchResult, assertResearchWalk, type DetectiveResult, type DetectiveWorkerInput, type ResearchBlocker,
  type ResearchSpan } from "./research-types.ts";
import type { WorkerEvidence } from "./types.ts";

/** JSON grammar, duplicate-key checks and exact pointer offsets reuse the Parser's lexical index. */
function valueAt(evidence: WorkerEvidence, pointer: string): { value: unknown; span: ResearchSpan } | null {
  try {
    JSON.parse(evidence.text);
    const token = indexJson(evidence.text).get(pointer);
    if (!token) return null;
    const quote = evidence.text.slice(token.start, token.end);
    return { value: JSON.parse(quote), span: { artifactId: evidence.artifactId, contentHash: evidence.contentHash,
      start: token.start, end: token.end, quote, offsetUnit: "UTF16_CODE_UNITS" } };
  } catch { return null; }
}

/** One bounded investigation. Proposed explanations never get to supply their own evidence. */
export function runDetective(input: DetectiveWorkerInput): DetectiveResult {
  const { question } = input;
  if (input.worker.role !== "DETECTIVE" || input.grant.role !== "DETECTIVE" || input.grant.project !== input.project) throw new Error("DETECTIVE_GRANT_SCOPE_MISMATCH");
  requireCapability(input.grant, "VAULT_READ_SANITIZED");
  if (!question.id || !question.text.trim() || !question.subjectId || !question.jurisdiction || !question.recordClass ||
    !question.falsificationCondition.trim() || !question.nextAction.trim() || !Number.isFinite(Date.parse(input.now)) ||
    question.text.length > 2_000 || question.alternatives.length < 2 || question.alternatives.length > 12 ||
    new Set(question.alternatives.map(a => a.id)).size !== question.alternatives.length ||
    question.alternatives.some(a => !a.id || !a.statement.trim() || !a.tests.length || a.tests.length > 12)) throw new Error("DETECTIVE_QUESTION_NOT_BOUNDED");
  assertResearchWalk(input.walk, input.walkState);
  const byId = new Map(input.evidence.map(e => [e.artifactId, e]));
  if (byId.size !== input.evidence.length || input.artifactIds.length !== byId.size || input.artifactIds.some(id => !byId.has(id)) ||
    input.evidence.some(e => !e.artifactId || !e.acquiredByAttemptId || contentHash(e.text) !== e.contentHash ||
      !Number.isFinite(Date.parse(e.retrievedAt)) || Date.parse(e.retrievedAt) > Date.parse(input.now))) throw new Error("DETECTIVE_EVIDENCE_IDENTITY_MISMATCH");
  // External authority is a declared, machine-supplied source context, never a model claim.
  for (const authority of question.authorities) {
    const evidence = byId.get(authority.artifactId);
    if (!evidence || !authority.organization.trim() || !/^https?:\/\//.test(evidence.canonicalUrl) ||
      authority.observedAt !== evidence.retrievedAt) throw new Error("DETECTIVE_AUTHORITY_PROVENANCE_MISMATCH");
  }
  const authorities = new Set(question.authorities.map(a => a.artifactId));
  const spans: ResearchSpan[] = [];
  const alternativesTested: DetectiveResult["alternativesTested"][number][] = [];
  for (const alternative of question.alternatives) {
    const spanIndexes: number[] = [];
    let contradicted = false;
    let insufficient = false;
    for (const test of alternative.tests) {
      const evidence = byId.get(test.artifactId);
      if (!evidence || !authorities.has(test.artifactId)) { insufficient = true; continue; }
      if (test.predicate.kind === "JSON_VALUE_EQUALS") {
        const found = valueAt(evidence, test.predicate.pointer);
        if (!found) { insufficient = true; continue; }
        spanIndexes.push(spans.length); spans.push(found.span);
        if (found.value !== test.predicate.expected) contradicted = true;
      } else {
        const quote = test.predicate.quote;
        const start = quote.length ? evidence.text.indexOf(quote) : -1;
        if (start < 0) { insufficient = true; continue; }
        spanIndexes.push(spans.length); spans.push({ artifactId: evidence.artifactId, contentHash: evidence.contentHash,
          start, end: start + quote.length, quote, offsetUnit: "UTF16_CODE_UNITS" });
      }
    }
    alternativesTested.push({ id: alternative.id, outcome: contradicted ? "CONTRADICTED" : insufficient ? "INSUFFICIENT_EVIDENCE" : "SUPPORTED", spanIndexes });
  }
  const supported = alternativesTested.filter(a => a.outcome === "SUPPORTED");
  const selected = supported.length === 1 ? question.alternatives.find(a => a.id === supported[0].id)! : null;
  const contradictions = supported.length > 1 ? ["Multiple authoritative alternatives remain supported; the evidence does not settle their disagreement."] : [];
  const blockers: ResearchBlocker[] = [];
  const block = (code: ResearchBlocker["code"], description: string) => blockers.push({ code, description,
    worker: input.worker, attemptId: input.attemptId, observedAt: input.now, artifactIds: input.artifactIds,
    retryable: true, anotherRouteRemains: input.walkState.state === "OPEN" && input.walkState.nextRouteIds.length > 0, operatorDecisionRequired: false });
  let identity: DetectiveResult["identity"] = { state: "UNRESOLVED", candidates: question.alternatives.flatMap(a => a.canonicalIdentity ? [a.canonicalIdentity] : []) };
  // Names in prose alone do not silently join an entity to a canonical identifier.
  if (selected?.canonicalIdentity && selected.tests.some(t => t.predicate.kind === "JSON_VALUE_EQUALS" && t.predicate.expected === selected.canonicalIdentity)) {
    identity = { state: "CANDIDATE", canonicalId: selected.canonicalIdentity };
  }
  if (question.kind === "IDENTITY" && identity.state === "UNRESOLVED") block("AMBIGUOUS_IDENTITY", "The evidence does not establish one direct canonical identity join; acquisition under another label cannot be treated as absence.");
  if (supported.length > 1) block("CONFLICTING_AUTHORITIES", contradictions[0]);
  let denominator: DetectiveResult["denominator"] = { state: "UNKNOWN", populationDefinition: question.populationDefinition };
  const d = question.denominator;
  if (d) {
    const e = byId.get(d.authority.artifactId);
    const declared = question.authorities.find(a => a.artifactId === d.authority.artifactId);
    const found = e ? valueAt(e, d.countPointer) : null;
    if (declared && declared.organization === d.authority.organization && declared.type === d.authority.type &&
      declared.observedAt === d.authority.observedAt && found && typeof found.value === "number" && Number.isSafeInteger(found.value) && found.value >= 0 &&
      Number.isSafeInteger(d.coveredCount) && d.coveredCount >= 0 && Number.isSafeInteger(d.unresolvedCount) && d.unresolvedCount >= 0 &&
      found.value >= d.coveredCount + d.unresolvedCount && d.populationDefinition === question.populationDefinition) {
      denominator = { state: "KNOWN", authority: declared, authorityArtifactId: declared.artifactId, count: found.value,
        coveredCount: d.coveredCount, unresolvedCount: d.unresolvedCount, populationDefinition: d.populationDefinition,
        observedAt: declared.observedAt, span: found.span };
      spans.push(found.span);
    }
  }
  if (question.populationDefinition !== null && denominator.state === "UNKNOWN") block("MISSING_EXTERNAL_DENOMINATOR", "No authoritative denominator count is grounded in the provided evidence; found records are not a population total.");
  const verdict: DetectiveResult["verdict"] = supported.length === 1 && blockers.length === 0 ? "SUPPORTED" :
    alternativesTested.every(a => a.outcome === "CONTRADICTED") ? "CONTRADICTED" : "UNRESOLVED";
  const result: DetectiveResult = { role: "DETECTIVE", attemptId: input.attemptId, verdict, question, artifactIds: input.artifactIds,
    spans, alternativesTested, conclusion: selected ? selected.statement : "The available authoritative evidence does not settle the bounded question.",
    burden: verdict === "SUPPORTED" ? "EVIDENCE_SUPPORTED_PENDING_INDEPENDENT_VALIDATION" : "UNRESOLVED", identity,
    contradictions, nextAction: question.nextAction, falsificationCondition: question.falsificationCondition, denominator,
    learnedProcedure: { implementation: "bounded-authoritative-evidence-comparison/1", deterministic: true, testableQuestion: question, promotion: "CANDIDATE_ONLY" },
    hypotheses: (input.hypotheses ?? []).map(claim => ({ claim, status: "UNVERIFIED_MODEL_HYPOTHESIS" })),
    findings: blockers.map(b => ({ code: b.code, detail: b.description, severity: "BLOCKING" })), blockers,
    walk: input.walk, walkState: input.walkState };
  assertResearchResult(result, "DETECTIVE", input.attemptId);
  return result;
}
