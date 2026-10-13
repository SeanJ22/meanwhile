import { readRolePlaybook, workerSystemPrompt } from "../playbooks.ts";
import { performance } from "node:perf_hooks";
import { contentHash } from "../ids.ts";
import { canonicalJson, type ControlPlaneRepositories } from "../repository/types.ts";
import { meteredCostFields, priceMeteredUsage, readMeteredUsage, type MeteredUsage } from "../model-cost.ts";
import { canonicalModelId } from "../../models.ts";
import { assertStepMayInvokeModel, MODEL_FOR_CLASS } from "../scheduler/model-routing.ts";
import { readCompletedWorkerResult } from "../repository/worker-completion.ts";
import { nextAuditEscalation } from "./audit-escalation.ts";
import { ceilingPermits, RESEARCH_BOUNDS, researchSpendInWindow } from "../scheduler/research-policy.ts";
import { anthropicTransport, type ModelRequest, type ModelResponse, type ModelTransport } from "../scheduler/scout-executor.ts";
import type { FleetRuntime } from "./runtime.ts";
import type { IndependentAuditContext, WorkerEvidence, WorkerResultRecord, RecordExtractionShape } from "./types.ts";
import { SendBudgetRefusal } from "../expansion/spend-holds.ts";
import { inventoryRecordEvidence } from "./record-evidence.ts";
import { readSpendWindow } from "../spend-window.ts";

export const AUDIT_RESPONSE_MAX_BYTES = 16_384;
export const AUDIT_CONTEXT_MAX_BYTES = 32_000;



/*
 * No forced tool choice (HTTP 400 on Opus 5.5): `auto`, the system prompt naming the tool, and `strict: true`. A
 * response without a tool call fails closed as `AUDIT_MODEL_NO_TOOL_CALL`. Strict mode accepts no array-length
 * constraints, so the 24-challenge limit is enforced by `validateAnswer`.
 */
const RECORD_AUDIT = {
  name: "record_audit",
  description: "Return the bounded independent evidence audit. This records a proposal only and grants no acquisition or promotion authority.",
  strict: true,
  input_schema: {
    type: "object", additionalProperties: false, required: ["verdict", "challenges"],
    properties: {
      verdict: { type: "string", enum: ["SURVIVED", "BROKE", "INCONCLUSIVE"] },
      challenges: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["code", "detail", "artifactId", "quote"],
        properties: { code: { type: "string" }, detail: { type: "string" }, artifactId: { type: "string" }, quote: { type: "string" } },
      } },
    },
  },
  cache_control: { type: "ephemeral" as const },
};

/** The provider call ends on its response or failure, without an attempt clock. */
export function boundedAuditTransport(apiKey: string): ModelTransport {
  return anthropicTransport(apiKey);
}

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function fit(text: string, budget: number): string {
  if (Buffer.byteLength(text) <= budget) return text;
  return Buffer.from(text).subarray(0, budget).toString("utf8").replace(/\uFFFD$/, "");
}

/** Exact source slices; scripts/styles cannot bury the publisher's useful links. */
function surfaceExcerpts(text: string, budget: number): readonly { start: number; end: number; text: string }[] {
  const searchable = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, (match) => " ".repeat(match.length));
  const starts: number[] = [];
  for (const pattern of [/civicclerk|legistar/gi, /agenda|minutes|meeting|calendar|quorum|council/gi]) {
    let found: RegExpExecArray | null;
    let inspected = 0;
    while ((found = pattern.exec(searchable)) !== null && inspected++ < 80) {
      const start = Math.max(0, found.index - 180);
      if (!starts.some((other) => Math.abs(other - start) < 500)) starts.push(start);
    }
  }
  // Spend a tight budget on the official route before incidental page headers.
  if (!starts.some((start) => start < 500)) starts.push(0);
  const slices: { start: number; end: number; text: string }[] = [];
  let remaining = budget;
  for (const start of starts) {
    if (remaining <= 0) break;
    const excerpt = fit(text.slice(start, start + 900), remaining);
    if (excerpt) slices.push({ start, end: start + excerpt.length, text: excerpt });
    remaining -= Buffer.byteLength(excerpt);
  }
  return slices.sort((a, b) => a.start - b.start);
}

function projectedEvidence(evidence: WorkerEvidence, budget: number, surface: boolean, extraction?: RecordExtractionShape): Record<string, unknown> {
  const identity = { artifactId: evidence.artifactId, contentHash: evidence.contentHash, canonicalUrl: evidence.canonicalUrl, retrievedAt: evidence.retrievedAt };
  if (surface) {
    const excerpts = surfaceExcerpts(evidence.text, budget);
    return { ...identity, representation: "EXACT_SOURCE_EXCERPTS", offsetUnit: "UTF16_CODE_UNITS", excerpts,
      omittedCharacters: Math.max(0, evidence.text.length - excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0)),
      limitation: "Selected first-party publisher/link evidence only; the immutable artifact retains all omitted bytes." };
  }
  let text = evidence.text;
  let representation = "SOURCE_TEXT";
  try {
    if (extraction) {
      const inventory = inventoryRecordEvidence(evidence, extraction);
      text = canonicalJson({ publisherCount: inventory.declaredCount, rows: inventory.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell.value]))) });
      representation = "CONTRACT_FIELD_PROJECTION";
    } else {
    const raw: unknown = JSON.parse(evidence.text);
    const rows: unknown = Array.isArray(raw) ? raw : object(raw) ? raw.value : null;
    if (Array.isArray(rows) && rows.every(object)) {
      const fields = ["id", "eventName", "startDateTime", "eventDate", "eventCategoryName", "categoryId", "isPublished",
        "publishedAgendaTimeStamp", "hasAgenda", "isArchived", "isDeleted", "eventNotice", "eventDescription", "publishedFiles",
        "EventId", "EventBodyId", "EventBodyName", "EventDate", "EventTime", "EventComment", "EventAgendaStatusName", "EventMinutesStatusName"];
      text = canonicalJson({ publisherCount: object(raw) ? raw["@odata.count"] ?? raw["odata.count"] ?? null : null,
        rows: rows.map((row) => Object.fromEntries(fields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]]))) });
      representation = "DETERMINISTIC_FIELD_PROJECTION";
    }
    }
  } catch { /* Preserve bounded raw source text when a structured projection is unavailable. */ }
  // A structured feed is indivisible here. Cutting through JSON silently hid
  // later civic rows; the outer budget now refuses before any model call.
  return { ...identity, representation, sourceExcerpt: text, omittedCharacters: 0,
    limitation: "Selected fields for independent reasoning; no omitted field or row is evidence of publisher absence. Exact quotes must also occur in the immutable source artifact." };
}

/** Only independent context fields are selected; no producer/validator object can pass through. */
export function auditReasoningContext(context: IndependentAuditContext): string {
  const surfaces = context.surfaceEvidence ?? [];
  const fixed = {
    subjectId: context.subjectId, contract: {
      recordClass: context.contract.recordClass, schemaVersion: context.contract.schemaVersion,
      subjectId: context.contract.subjectId,
      ...(context.contract.schemaVersion === 1 ? { sourceBodyId: context.contract.sourceBodyId, sourceBodyName: context.contract.sourceBodyName, publisherSlug: context.contract.publisherSlug }
        : { jurisdiction: context.contract.jurisdiction, identity: context.contract.identity, sourceScope: context.contract.sourceScope,
          methodVersion: context.contract.methodVersion, extraction: context.contract.extraction, verification: context.contract.verification }),
      requiredFields: context.contract.requiredFields,
      completenessScope: context.contract.completenessScope, expectedSourceDate: context.contract.expectedSourceDate,
    }, scope: context.scope,
    publisherSurfaces: context.publisherSurfaces, methodVersion: context.methodVersion,
    routeReasonLimitation: "Route reasons may be abbreviated with explicit omitted character counts; route identities, applicability, status and artifact references are complete.",
    evidence: context.evidence.map((evidence) => projectedEvidence(evidence, 0, false, context.contract.schemaVersion === 2 ? context.contract.extraction : undefined)),
    ...(context.contract.schemaVersion === 2 ? { authorityEvidence: (context.authorityEvidence ?? []).map(evidence => projectedEvidence(evidence, 0, false,
      context.contract.schemaVersion === 2 ? context.contract.verification.authorities.find(authority => authority.artifactIds.includes(evidence.artifactId))?.extraction : undefined)) } : {}),
  };
  let routes: Record<string, unknown>[] = [];
  const serialize = (surfaceBudget: number): string => canonicalJson({
    ...fixed, routes,
    surfaceEvidence: surfaces.map((evidence) => projectedEvidence(evidence, surfaceBudget, true)),
  });
  let baseline = "";
  // Reasons are explanatory metadata; the complete feed and route identities
  // take precedence. Even a fully omitted reason is explicitly accounted for.
  for (const reasonBudget of [256, 128, 0]) {
    routes = context.routes.map(({ routeId, canonicalUrl, applicable, status, artifactIds, reason }) => {
      const excerpt = fit(reason, reasonBudget);
      return { routeId, canonicalUrl, applicable, status, artifactIds, reason: excerpt, reasonOmittedCharacters: reason.length - excerpt.length };
    });
    baseline = serialize(0);
    const excerptReserve = surfaces.reduce((sum, evidence) => sum + Math.min(512, Buffer.byteLength(evidence.text) * 2), 0);
    if (Buffer.byteLength(baseline) + excerptReserve <= AUDIT_CONTEXT_MAX_BYTES) break;
  }
  const baseBytes = Buffer.byteLength(baseline);
  if (baseBytes > AUDIT_CONTEXT_MAX_BYTES) throw new Error("AUDIT_REPRESENTATION_BOUND_EXCEEDED:COMPLETE_FEED_AND_ROUTE_METADATA");
  if (surfaces.length === 0) return baseline;
  let lower = 0;
  let upper = Math.min(10_000, Math.floor((AUDIT_CONTEXT_MAX_BYTES - baseBytes) / surfaces.length));
  let body = baseline;
  // JSON escaping changes the byte size of HTML excerpts. Measure the actual
  // serialized request instead of assuming raw evidence bytes equal wire bytes.
  while (lower <= upper) {
    const budget = Math.floor((lower + upper) / 2);
    const offered = serialize(budget);
    if (Buffer.byteLength(offered) <= AUDIT_CONTEXT_MAX_BYTES) { body = offered; lower = budget + 1; }
    else upper = budget - 1;
  }
  if (upper < 128 && surfaces.some((evidence) => Buffer.byteLength(evidence.text) > upper)) throw new Error("AUDIT_REPRESENTATION_BOUND_EXCEEDED:MEANINGFUL_SURFACE_EXCERPTS");
  return body;
}

type Review = NonNullable<WorkerResultRecord["modelReview"]>;
class PartiallyGroundedResponse extends Error {
  readonly grounded: Review["challenges"];
  constructor(message: string, grounded: Review["challenges"]) { super(message); this.grounded = grounded; }
}
function validationFailure(code: string): never { throw new Error(code); }
function rawResponse(response: ModelResponse): string {
  const content = Array.isArray(response.content) ? response.content : [];
  return content.map((block) => block.type === "text" && "text" in block ? String(block.text)
    : block.type === "tool_use" ? canonicalJson({ type: block.type, name: block.name, input: block.input }) : "").filter(Boolean).join("\n");
}
function validateAnswer(response: ModelResponse, expectedModel: string, context: IndependentAuditContext): Pick<Review, "verdict" | "challenges"> {
  // The provider may answer with a dated alias of the model asked for: the same model.
  if (canonicalModelId(String(response.model)) !== canonicalModelId(expectedModel)) validationFailure("AUDIT_MODEL_IDENTITY_MISMATCH");
  if (!Array.isArray(response.content)) validationFailure("AUDIT_MODEL_CONTENT_INVALID");
  const tools = response.content.filter((block) => block.type === "tool_use");
  /*
   * Under `tool_choice: auto` the model may answer in text. That answer is not
   * the audit's contract, so it is never read as a verdict — even valid JSON
   * saying SURVIVED. The review fails closed, named with the stop reason
   * (`end_turn`, `max_tokens`, `refusal`, …), and the record is not approved.
   */
  if (tools.length === 0) validationFailure(`AUDIT_MODEL_NO_TOOL_CALL:${String(response.stop_reason).slice(0, 80)}`);
  if (tools.length !== 1) validationFailure("AUDIT_MODEL_MULTIPLE_TOOL_CALLS");
  if (tools[0].name !== "record_audit") validationFailure("AUDIT_MODEL_UNEXPECTED_TOOL");
  if (response.stop_reason !== "tool_use") validationFailure(`AUDIT_MODEL_STOP_REASON_INVALID:${String(response.stop_reason).slice(0, 80)}`);
  const answer: unknown = tools[0].input;
  if (!object(answer) || !["SURVIVED", "BROKE", "INCONCLUSIVE"].includes(String(answer.verdict)) ||
      !Array.isArray(answer.challenges) || answer.challenges.length > 24 || Object.keys(answer).some((key) => !["verdict", "challenges"].includes(key))) validationFailure("AUDIT_MODEL_RESPONSE_SCHEMA_INVALID");
  const challenges: Review["challenges"][number][] = [];
  const failures: string[] = [];
  const evidence = [...context.evidence, ...(context.surfaceEvidence ?? []), ...(context.authorityEvidence ?? [])];
  for (const [index, challenge] of answer.challenges.entries()) {
    if (!object(challenge) || ["code", "detail", "artifactId", "quote"].some((key) => typeof challenge[key] !== "string" || !String(challenge[key]).trim()) ||
        Object.keys(challenge).some((key) => !["code", "detail", "artifactId", "quote"].includes(key))) { failures.push(`AUDIT_MODEL_CHALLENGE_SCHEMA_INVALID:${index}`); continue; }
    if (!evidence.some((held) => held.artifactId === challenge.artifactId && held.text.includes(String(challenge.quote)))) { failures.push(`AUDIT_MODEL_UNGROUNDED_CHALLENGE:${index}`); continue; }
    challenges.push({ code: String(challenge.code), detail: String(challenge.detail), artifactId: String(challenge.artifactId), quote: String(challenge.quote) });
  }
  if (answer.verdict === "BROKE" && challenges.length === 0) failures.push("AUDIT_MODEL_BROKE_WITHOUT_CHALLENGE");
  if (failures.length) throw new PartiallyGroundedResponse(failures.join(";"), challenges);
  return { verdict: answer.verdict as Review["verdict"], challenges };
}

/** `ceilingUsd` is the rolling ceiling in force (the owner's override, the same number Scout admission reads). Absent, the default stands. */
export function modelAuditReasoner(repos: ControlPlaneRepositories, transport: ModelTransport, now: () => string,
  options: {
    readonly ceilingUsd?: number;
    /** Read only the cost rows the rolling window can count. */
    readonly scopedReads?: boolean;
    /** The transport for the jurisdiction a record is about, so the review is held on the area budget covering it. */
    readonly transportFor?: (jurisdiction: { readonly subjectId: string; readonly state: string | null }) => ModelTransport;
    /** A durable lifetime hunt hold, rather than the discretionary rolling ceiling, governs this exact subject. */
    readonly lifetimeHuntSubject?: (subjectId: string) => boolean;
  } = {}): NonNullable<FleetRuntime["auditReasoner"]> {
  const initial = assertStepMayInvokeModel("adversarial-audit");
  const ceilingUsd = options.ceilingUsd ?? RESEARCH_BOUNDS.dailyCeilingUsd;
  if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0) throw new Error("AUDIT_CEILING_INVALID");
  return { workerProvider: "anthropic", workerVersion: initial.model, review: async (context, attemptId, escalation) => {
    const started = performance.now();
    const spend = researchSpendInWindow(await readSpendWindow(repos, now()), now());
    if (!options.lifetimeHuntSubject?.(context.subjectId)) {
      const admission = ceilingPermits(spend.windowUsd, ceilingUsd);
      if (!admission.permits) throw new Error(`DENIED_BY_POLICY:AUDIT_ROLLING_COST_CEILING; ${admission.why}`);
    }
    const body = auditReasoningContext(context);
    const route = escalation ? { ...initial, model: MODEL_FOR_CLASS[escalation.to], modelClass: escalation.to } : initial;
    if (escalation) {
      const previous = (await readCompletedWorkerResult(repos, escalation.previousResultId)).record;
      const attempt = (await repos.attempts.mustRead(attemptId)).value;
      if (canonicalJson(nextAuditEscalation(previous)) !== canonicalJson(escalation) ||
        previous.workItemId !== attempt.workItemId || previous.modelReview?.contextHash !== contentHash(body)) {
        throw new Error("DENIED_BY_POLICY:AUDIT_ESCALATION_EVIDENCE_MISMATCH");
      }
    }
    const request: ModelRequest = { model: route.model, max_tokens: 2_048,
      output_config: { effort: route.effort },
      system: [{ type: "text", text: workerSystemPrompt("AUDITOR", (await readRolePlaybook(repos, "AUDITOR")).text), cache_control: { type: "ephemeral" } }], tools: [RECORD_AUDIT],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: body }] };
    const send = options.transportFor === undefined ? transport
      : options.transportFor({ subjectId: context.subjectId, state: context.contract.schemaVersion === 2 ? context.contract.jurisdiction.state : null });
    const response = await send(request).catch((error) => {
      /* A budget refusal is a policy denial before any request, never a provider failure. */
      if (error instanceof SendBudgetRefusal) throw new Error(`DENIED_BY_POLICY:${error.code}; ${error.why}`);
      const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? String(error.status) : "UNAVAILABLE";
      throw new Error(`AUDIT_PROVIDER_FAILURE:${status}; usage NOT MEASURED`);
    });
    /* The provider's usage block, read once through the shared parser and priced by the one pricing function. `inputTokens` stays the uncached remainder. */
    const metered: MeteredUsage = readMeteredUsage(response.usage, response.batch === true);
    const usage = { inputTokens: metered.uncachedInputTokens, outputTokens: metered.outputTokens,
      cacheReadInputTokens: metered.cacheReadInputTokens, cacheCreationInputTokens: metered.cacheCreationInputTokens,
      uncachedInputTokens: metered.uncachedInputTokens };
    const raw = rawResponse(response);
    const overBound = Buffer.byteLength(raw) > AUDIT_RESPONSE_MAX_BYTES;
    const responseText = overBound ? `${fit(raw, AUDIT_RESPONSE_MAX_BYTES - 64)}\n[AUDIT RESPONSE TRUNCATED AT STORAGE BOUND]` : raw;
    let verdict: Review["verdict"] = "INCONCLUSIVE";
    let challenges: Review["challenges"] = [];
    let validationError: string | null = null;
    try {
      if (overBound) validationFailure("AUDIT_MODEL_RESPONSE_BOUND_EXCEEDED");
      ({ verdict, challenges } = validateAnswer(response, route.model, context));
    } catch (error) {
      validationError = error instanceof Error && error.message.startsWith("AUDIT_MODEL_") ? error.message : "AUDIT_MODEL_RESPONSE_INVALID";
      if (error instanceof PartiallyGroundedResponse) challenges = error.grounded;
    }
    return { review: { step: "adversarial-audit", model: response.model, effort: route.effort, contextHash: contentHash(body),
      ...(escalation ? { escalation: { ...escalation, at: now() } } : {}),
      verdict, challenges, validationError, responseText, elapsedMs: Math.round(performance.now() - started) },
      usage, usd: priceMeteredUsage(response.model, metered, "5m").usd, metering: meteredCostFields(metered) };
  } };
}
