import { readRolePlaybook, workerSystemPrompt } from "../playbooks.ts";

import { performance } from "node:perf_hooks";
import type { WorkerRef } from "../attempt.ts";
import { contentHash } from "../ids.ts";
import {
  newFieldManualEntry,
  readFieldManual,
  writeFieldManual,
  type FieldManualEntry,
  type FieldManualRepos,
  type FieldManualStore,
} from "../field-manual.ts";
import { meteredCostFields, priceMeteredUsage, readMeteredUsage, sumMeteredUsage, type MeteredUsage } from "../model-cost.ts";
import type { AttemptCost } from "../attempt.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { canonicalJson } from "../repository/types.ts";
import { canonicalModelId } from "../../models.ts";
import { assertStepMayEscalate, assertStepMayInvokeModel, MODEL_FOR_CLASS, type ModelClass } from "../scheduler/model-routing.ts";
import { ceilingPermits, RESEARCH_BOUNDS } from "../scheduler/research-policy.ts";
import { modelRequestAccounting, type ModelRequest, type ModelResponse, type ModelTransport } from "../scheduler/scout-executor.ts";
import { SendBudgetRefusal } from "../expansion/spend-holds.ts";
import { confirmQuotedRecords, MODEL_PARSER_IMPLEMENTATION, type ProposedRecord, type Rejection } from "./quoted-proof.ts";
import type {
  GeneralizedCivicExtractionContract,
  ParserResult,
  ParserWorkerInput,
  WorkerFinding,
  WorkerUsage,
} from "./types.ts";

export const MODEL_PARSER_VERSION = "1.0.0";
export const PARSE_STEP = "extraction";
export const PARSE_RESPONSE_MAX_TOKENS = 8_192;

export const PARSE_WINDOW_CHARS = 24_000;
export const PARSE_WINDOW_OVERLAP = 1_000;

export const PARSE_MAX_WINDOWS = 6;
export const PARSE_LEARNING_SOURCE = "parser-learning";
const MAX_FINDINGS = 60;

const RECORD_EXTRACTION = {
  name: "record_extraction",
  description: "Return the records found in the document, each field with the exact quote it came from. This is a proposal only; code confirms every quote against the saved document.",
  strict: true,
  input_schema: {
    type: "object", additionalProperties: false, required: ["records"],
    properties: {
      records: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["fields"],
        properties: { fields: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["name", "value", "quote"],
          properties: { name: { type: "string" }, value: { type: "string" }, quote: { type: "string" } },
        } } },
      } },
    },
  },
  cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
};

export const PARSE_TIERS: readonly ModelClass[] = ["haiku", "sonnet", "frontier"];

export interface ParseRoute {

  readonly tier: ModelClass;

  readonly reason: string;

  readonly inheritedEntryIds: readonly string[];

  readonly knownFieldNames: readonly string[];
}

export function routeParse(store: FieldManualStore, key: { readonly recordClass: string; readonly host: string }): ParseRoute {
  const names = store.entries.find((e) => e.id === parseFieldsId(key.recordClass));
  const knownFieldNames = names ? ((names.payload as { fieldNames?: unknown }).fieldNames as string[] | undefined) ?? [] : [];
  return {
    tier: "haiku",
    reason: "starting at haiku: each source gets its own cheapest-model attempt",
    inheritedEntryIds: names ? [names.id] : [],
    knownFieldNames,
  };
}

export function parseFieldsId(recordClass: string): string {
  return newFieldManualEntry(PARSE_LEARNING_SOURCE, `fields|${recordClass}`, { role: "PARSER", kind: "PARSE_FIELDS", title: "", summary: "", outcome: "REFERENCE" }).id;
}

export function documentWindows(text: string, size = PARSE_WINDOW_CHARS, overlap = PARSE_WINDOW_OVERLAP, max = PARSE_MAX_WINDOWS): { readonly windows: readonly { readonly start: number; readonly end: number }[]; readonly unreadFrom: number | null } {
  const windows: { start: number; end: number }[] = [];
  let start = 0;
  while (start < text.length && windows.length < max) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const cut = text.lastIndexOf("\n", end);
      if (cut > start + size / 2) end = cut + 1;
    }
    windows.push({ start, end });
    if (end >= text.length) return { windows, unreadFrom: null };
    start = Math.max(end - overlap, start + 1);
  }
  return { windows, unreadFrom: start < text.length ? windows[windows.length - 1]!.end : null };
}

export function parseLearningEntries(
  store: FieldManualStore,
  input: { readonly recordClass: string; readonly host: string; readonly state: string; readonly tier: ModelClass; readonly proposed: number; readonly confirmed: number;
    readonly rejected: number; readonly fieldNames: readonly string[]; readonly samples: readonly { field: string; quote: string }[]; readonly observedAt: string },
): FieldManualEntry[] {
  const day = input.observedAt.slice(0, 10);
  const yielded = input.confirmed > 0;
  const outcome = newFieldManualEntry(PARSE_LEARNING_SOURCE, `outcome|${input.recordClass}|${input.host}|${input.tier}`, {
    role: "PARSER", kind: "PARSE_OUTCOME", outcome: yielded ? "YIELDED" : "FAILED",
    title: `${input.recordClass} on ${input.host}: ${input.tier}`,
    summary: `${input.tier} proposed ${input.proposed} record(s), ${input.confirmed} confirmed against the saved document, ${input.rejected} claim(s) dropped`,
    states: [input.state], recordClasses: [input.recordClass], observedAt: day,
    payload: { recordClass: input.recordClass, host: input.host, tier: input.tier, proposed: input.proposed, confirmed: input.confirmed, rejected: input.rejected, samples: input.samples.slice(0, 3) },
  });
  const entries = [outcome];
  if (yielded && input.fieldNames.length) {
    const prior = store.entries.find((e) => e.id === parseFieldsId(input.recordClass));
    const merged = [...new Set([...(((prior?.payload as { fieldNames?: string[] } | undefined)?.fieldNames) ?? []), ...input.fieldNames])].sort();
    entries.push(newFieldManualEntry(PARSE_LEARNING_SOURCE, `fields|${input.recordClass}`, {
      role: "PARSER", kind: "PARSE_FIELDS", outcome: "REFERENCE", portable: true,
      title: `${input.recordClass}: field names used by earlier parses`,
      summary: `earlier parses of ${input.recordClass} settled on: ${merged.join(", ")}`.slice(0, 300),
      recordClasses: [input.recordClass], observedAt: day, payload: { recordClass: input.recordClass, fieldNames: merged },
    }));
  }
  return entries;
}

export interface ModelParseRecord {
  readonly byModel?: readonly CostModelShare[];
  readonly step: "extraction";
  readonly model: string;
  readonly tier: ModelClass;
  readonly effort: string;
  readonly contextHash: string;
  readonly route: { readonly tier: ModelClass; readonly reason: string; readonly inheritedEntryIds: readonly string[] };
  readonly escalation?: { readonly from: ModelClass; readonly to: ModelClass; readonly reason: string };
  readonly windows: number;
  readonly unreadFrom: number | null;
  readonly proposed: number;
  readonly confirmed: number;
  readonly rejections: readonly Rejection[];
  readonly validationError: string | null;
  readonly elapsedMs: number;
}

export interface ModelParseOutcome {
  readonly result: ParserResult;
  readonly review: ModelParseRecord;
  readonly usage: WorkerUsage;
  readonly usd: number | null;
  readonly metering: Pick<AttemptCost, "cacheReadInputTokens" | "cacheCreationInputTokens" | "cacheCreation5mInputTokens" | "cacheCreation1hInputTokens" | "uncachedInputTokens" | "batch">;
}

export class ModelParseFailure extends Error {
  readonly accounting: Pick<ModelParseOutcome, "usage" | "usd" | "metering"> & {
    readonly byModel: readonly CostModelShare[];
  };
  constructor(message: string, accounting: ModelParseFailure["accounting"]) {
    super(message); this.name = "ModelParseFailure"; this.accounting = accounting;
  }
}

function toolInput(response: ModelResponse, expectedModel: string): unknown {

  if (canonicalModelId(String(response.model)) !== canonicalModelId(expectedModel)) throw new Error("PARSE_MODEL_IDENTITY_MISMATCH");
  const tools = (Array.isArray(response.content) ? response.content : []).filter((b) => b.type === "tool_use");
  if (tools.length !== 1 || tools[0]!.name !== "record_extraction" || response.stop_reason !== "tool_use") throw new Error(`PARSE_MODEL_NO_TOOL_CALL:${String(response.stop_reason).slice(0, 60)}`);
  return tools[0]!.input;
}

function proposalsFrom(answer: unknown): ProposedRecord[] {
  const records = (answer as { records?: unknown } | null)?.records;
  if (!Array.isArray(records)) throw new Error("PARSE_MODEL_RESPONSE_SCHEMA_INVALID");
  return records.map((r) => {
    const fields = (r as { fields?: unknown } | null)?.fields;
    if (!Array.isArray(fields)) throw new Error("PARSE_MODEL_RESPONSE_SCHEMA_INVALID");
    return { fields: fields.flatMap((f) => {
      const o = f as Record<string, unknown> | null;
      return o && typeof o.name === "string" && typeof o.value === "string" && typeof o.quote === "string" ? [{ name: o.name, value: o.value, quote: o.quote }] : [];
    }) };
  });
}

function userBody(contract: GeneralizedCivicExtractionContract, route: ParseRoute, text: string): string {
  return canonicalJson({
    recordClass: contract.recordClass,
    requiredFields: [...new Set([...contract.requiredFields, ...contract.identity.keyFields])],
    identityFields: contract.identity.keyFields,
    fieldNamesUsedByEarlierParsesOfThisRecordClass: route.knownFieldNames,
    scope: contract.completenessScope,
    documentText: text,
  });
}

export function modelParseReasoner(
  repos: ControlPlaneRepositories,
  transport: ModelTransport,
  now: () => string,
  options: {
    readonly ceilingUsd?: number;
    readonly transportFor?: (jurisdiction: { readonly subjectId: string; readonly state: string | null }) => ModelTransport;
    readonly lifetimeHuntSubject?: (subjectId: string) => boolean;
  } = {},
): { readonly workerProvider: string; readonly workerVersion: string; readonly parse: (input: ParserWorkerInput, worker: WorkerRef) => Promise<ModelParseOutcome> } {
  const initial = assertStepMayInvokeModel(PARSE_STEP);
  const ceilingUsd = options.ceilingUsd ?? RESEARCH_BOUNDS.dailyCeilingUsd;
  if (!Number.isFinite(ceilingUsd) || ceilingUsd <= 0) throw new Error("PARSE_CEILING_INVALID");

  return { workerProvider: "anthropic", workerVersion: initial.model, parse: async (input) => {
    const started = performance.now();
    const contract = input.contract;
    if (contract.schemaVersion !== 2 || contract.extraction.format !== "UNSUPPORTED") throw new Error("PARSE_MODEL_LANE_NOT_APPLICABLE");
    const spend = await readSpendWindow(repos, now());
    const admission = ceilingPermits(spend.windowUsd, ceilingUsd);
    if (!admission.permits) throw new Error(`DENIED_BY_POLICY:PARSE_ROLLING_COST_CEILING; ${admission.why}`);
    const host = (() => { try { return new URL(input.evidence.canonicalUrl).host.toLowerCase(); } catch { return input.evidence.canonicalUrl; } })();
    const playbook = await readRolePlaybook(repos, "PARSER");
    const manual = await readFieldManual(repos, { role: "PARSER", state: contract.jurisdiction.state.toLowerCase(), recordClass: contract.recordClass,ocdIds:[contract.subjectId],limit:40 });
    const route = routeParse(manual.store, { recordClass: contract.recordClass, host });
    const { windows, unreadFrom } = documentWindows(input.evidence.text);
    const send = options.transportFor === undefined ? transport
      : options.transportFor({ subjectId: contract.subjectId, state: contract.jurisdiction.state });

    const metered: MeteredUsage[] = [];
    const byModel: CostModelShare[] = [];
    let usd: number | null = 0;
    let firstBody = "";
    let escalation: ModelParseRecord["escalation"];
    let tier = route.tier;
    let confirmed = confirmQuotedRecords({ evidence: input.evidence, contract }, []);
    let validationError: string | null = null;
    let model = MODEL_FOR_CLASS[tier];
    let effort = initial.effort as string;
    const attempts: { tier: ModelClass; proposed: number; confirmed: number; rejected: number }[] = [];

    for (;;) {
      const step = tier === "haiku" ? initial : assertStepMayEscalate(PARSE_STEP, "RESULT_REFUSED", PARSE_TIERS[PARSE_TIERS.indexOf(tier) - 1]);
      model = step.model; effort = step.effort; validationError = null;
      const proposals: (ProposedRecord & { windowStart: number })[] = [];
      const calls = await Promise.allSettled(windows.map(async (w, index) => {
        const body = userBody(contract, route, input.evidence.text.slice(w.start, w.end));
        if (index === 0 && firstBody === "") firstBody = body;
        const request: ModelRequest = { model, max_tokens: PARSE_RESPONSE_MAX_TOKENS,
          output_config: { effort: step.effort },
          system: [{ type: "text", text: workerSystemPrompt("PARSER", playbook.text), cache_control: { type: "ephemeral", ttl: "1h" } }], tools: [RECORD_EXTRACTION],
          tool_choice: { type: "auto" }, messages: [{ role: "user", content: body }] };
        const response = await send(request).catch((error) => {
          if (error instanceof SendBudgetRefusal) throw new Error(`DENIED_BY_POLICY:${error.code}; ${error.why}`);
          const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? String((error as { status: number }).status) : "UNAVAILABLE";
          throw new Error(`PARSE_PROVIDER_FAILURE:${status}; usage NOT MEASURED`);
        });
        return { response, window: w };
      }));
      let failure: string | null = null;
      for (const call of calls) {
        if (call.status === "rejected") {
          const detail = call.reason instanceof Error ? call.reason.message : "PARSE_PROVIDER_FAILURE:UNAVAILABLE; usage NOT MEASURED";
          const denied = detail.startsWith("DENIED_BY_POLICY");
          const usage = readMeteredUsage(denied ? { input_tokens: 0, output_tokens: 0 } : {});
          metered.push(usage);
          const { batch: _batch, ...fields } = meteredCostFields(usage);
          byModel.push({ model, tier: activeModelTierFor(model), requestCount: denied ? 0 : 1,
            usd: denied ? 0 : null, inputTokens: usage.uncachedInputTokens, outputTokens: usage.outputTokens, ...fields });
          if (!denied) usd = null;
          failure ??= detail;
          continue;
        }
        const { response, window: w } = call.value;
        const usage = readMeteredUsage(response.usage, response.batch === true);
        metered.push(usage);
        const price = priceMeteredUsage(response.model, usage, "1h").usd;
        const fields = meteredCostFields(usage);
        byModel.push({ model: response.model, tier: activeModelTierFor(response.model), requestCount: 1, usd: price,
          inputTokens: usage.uncachedInputTokens === null ? null : usage.uncachedInputTokens + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0),
          outputTokens: usage.outputTokens, ...fields, ...modelRequestAccounting(response) });
        usd = usd === null || price === null ? null : usd + price;
        try { for (const p of proposalsFrom(toolInput(response, model))) proposals.push({ ...p, windowStart: w.start }); }
        catch (error) { validationError = error instanceof Error ? error.message : "PARSE_MODEL_RESPONSE_INVALID"; }
      }
      if (failure !== null) {
        const summed = sumMeteredUsage(metered);
        throw new ModelParseFailure(failure, { byModel, usd, metering: meteredCostFields(summed),
          usage: { inputTokens: summed.uncachedInputTokens, outputTokens: summed.outputTokens,
            cacheReadInputTokens: summed.cacheReadInputTokens, cacheCreationInputTokens: summed.cacheCreationInputTokens,
            uncachedInputTokens: summed.uncachedInputTokens } });
      }
      confirmed = confirmQuotedRecords({ evidence: input.evidence, contract }, proposals);
      attempts.push({ tier, proposed: confirmed.proposed, confirmed: confirmed.records.length, rejected: confirmed.rejections.length });
      if (confirmed.records.length > 0) break;

      const up = PARSE_TIERS.indexOf(tier) < PARSE_TIERS.length - 1 ? assertStepMayEscalate(PARSE_STEP, "RESULT_REFUSED", tier) : null;
      if (up === null) break;
      escalation = { from: tier, to: up.modelClass, reason: validationError ?? `no proposed field confirmed against the saved document (${confirmed.rejections.length} claim(s) dropped)` };
      tier = up.modelClass;
    }

    const findings: WorkerFinding[] = [
      ...confirmed.warnings,
      ...confirmed.rejections.slice(0, MAX_FINDINGS).map((r) => ({ code: r.code, severity: "INFO" as const, field: r.field,
        detail: `Proposed record ${r.recordIndex}${r.field ? `, field ${r.field}` : ""} was dropped: ${r.code}. Only quotes found in the saved document become records.` })),
      ...(unreadFrom === null ? [] : [{ code: "DOCUMENT_READ_IN_PART", severity: "INFO" as const,
        detail: `The document is longer than ${PARSE_MAX_WINDOWS} reading windows; text from character ${unreadFrom} on was not read. Records found are real; more may exist.` }]),
    ];
    const summed = sumMeteredUsage(metered);
    const zero = confirmed.records.length === 0;
    const result: ParserResult = {
      role: "PARSER", attemptId: input.attemptId, implementation: MODEL_PARSER_IMPLEMENTATION, version: MODEL_PARSER_VERSION, schemaVersion: 2,
      recordClass: contract.recordClass, artifactId: input.evidence.artifactId, contentHash: input.evidence.contentHash,
      acquiredByAttemptId: input.evidence.acquiredByAttemptId, subjectId: contract.subjectId,
      contractMetadata: { jurisdiction: contract.jurisdiction, identity: contract.identity, sourceScope: contract.sourceScope, methodVersion: contract.methodVersion },
      verdict: zero ? "FAILED" : findings.some((f) => f.severity !== "INFO") ? "AMBIGUOUS" : "EXTRACTED",
      records: confirmed.records, spans: confirmed.spans,
      warnings: zero ? [{ code: "ZERO_ROW_EXTRACTION", severity: "BLOCKING", detail: `No proposed record confirmed against the saved document. A zero-row extraction is a failed extraction, never publisher absence.${validationError ? ` (${validationError})` : ""}` }, ...findings] : findings,
      declaredRowCount: null, sourceRowCount: confirmed.proposed, actualRowCount: confirmed.records.length,
    };

    const fieldNames = [...new Set(confirmed.records.flatMap((r) => Object.keys(r.fields)))];
    const samples = confirmed.spans.slice(0, 3).map((s) => ({ field: s.field, quote: s.quote.slice(0, 160) }));
    await writeFieldManual(repos as FieldManualRepos, attempts.flatMap((a) => parseLearningEntries(manual.store, {
      recordClass: contract.recordClass, host, state: contract.jurisdiction.state, tier: a.tier, proposed: a.proposed, confirmed: a.confirmed,
      rejected: a.rejected, fieldNames: a.confirmed > 0 ? fieldNames : [], samples: a.confirmed > 0 ? samples : [], observedAt: now(),
    })), now()).catch(() => undefined);

    return {
      result,
      review: { step: "extraction", model, tier, effort, byModel, contextHash: contentHash(firstBody), route: { tier: route.tier, reason: route.reason, inheritedEntryIds: route.inheritedEntryIds },
        ...(escalation ? { escalation } : {}), windows: windows.length, unreadFrom, proposed: confirmed.proposed, confirmed: confirmed.records.length,
        rejections: confirmed.rejections.slice(0, MAX_FINDINGS), validationError, elapsedMs: Math.round(performance.now() - started) },
      usage: { inputTokens: summed.uncachedInputTokens, outputTokens: summed.outputTokens, cacheReadInputTokens: summed.cacheReadInputTokens,
        cacheCreationInputTokens: summed.cacheCreationInputTokens, uncachedInputTokens: summed.uncachedInputTokens },
      usd, metering: meteredCostFields(summed),
    };
  } };
}
import type { CostModelShare } from "../cost.ts";
import { activeModelTierFor } from "../../models.ts";
import { readSpendWindow } from "../spend-window.ts";
