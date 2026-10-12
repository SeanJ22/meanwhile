import { lengthRuleForPrompt } from "./length-contract.ts";
import { writerSelection } from "./writer-selection.ts";
import { stanceAnswerability } from "./stance-answerability.ts";
import { gapWords, packHasEvidence, type EvidencePack } from "./evidence.ts";
import { askModelTakesEffort, resolveAskEffort, resolveAskFastWriter, resolveAskModel, type AskEffort, type AskModelEnv } from "./model.ts";
import { modelRequestFields, servedModelOf } from "../models.ts";
import type { ValidationVerdict } from "./validate.ts";
import {
  SYNTHESIS_CACHE_TTL,
  askCallerKey,
  readCacheUsage,
  type AskCallerKey,
  type CacheUsage,
} from "./prompt-cache.ts";

export {
  ASK_SYNTHESIS_MODEL,
  ASK_SYNTHESIS_EFFORT,
  resolveAskModel,
  resolveAskEffort,
  type AskEffort,
} from "./model.ts";

export const ASK_SYNTHESIS_TIMEOUT_MS = 12_000;

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export type SynthesisOutcome =
  | {
      kind: "WROTE";
      answer: string;
      citedUrls: string[];
      model: string;
      servedModel: string | null;
      effort: AskEffort | null;
      ms: number;
      usage: CacheUsage;
      callerKey: AskCallerKey;
    }
  | {
      kind: "UNAVAILABLE";
      why: "no-key" | "ceiling" | "no-evidence" | "unverified-stance" | "error";
      ms: number;
      detail?: string;
    };

export function synthesisSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      answer: {
        type: "string",
        description:
          "The answer to the reader's question, in plain language, using only the supplied records.",
      },
      citedSources: {
        type: "array",
        items: { type: "integer" },
        description: "The n, from the sources list, of every source whose records the answer actually relied on.",
      },
    },
    required: ["answer", "citedSources"],
    additionalProperties: false,
  };
}

export function synthesisPrompt(pack: EvidencePack): string {
  const agenda = pack.subject?.kind === "BODY" && pack.intent === "UPCOMING_AGENDA";
  return [
    "You are answering one resident's question about their government, using ONLY the records supplied below.",
    "",
    "Rules, all of them absolute:",
    "- Use only the supplied records. You have no other source. If something is not in the records, you do not know it.",
    "- Never state a fact about a government that the records do not contain. Do not fill a gap with what is likely, typical, or what you may remember.",
    "- The named gaps are part of the evidence. Say them plainly when they matter to the answer.",
    ...(writerSelection(pack).note
      ? ["- You were given a selection of the vote records; writerSelection says how many exist. Never say or imply that the others were not published, not recorded or not available."] : []),
    ...(pack.records.some(record => record.meetingListingIdentity?.uniqueMeetingCount === null)
      ? ["- Calendar listings with uniqueMeetingCount:null have an unresolved distinct-meeting count. State their source-listing count and the identity gap; never call that number a count of meetings or merge their agendas, minutes or votes."] : []),
    "- A gap marked OURS is about us — say we have not recorded it. A gap marked THEIRS is about the government — say what they have not published. Never swap these.",
    ...(pack.records.some(record => record.kind === "FINANCE_SUMMARY" || record.kind === "FINANCE_TRANSACTION" || record.kind === "FINANCE_COMMITTEE")
      ? [
        "- CAMPAIGN MONEY: state each figure exactly as its record states it, and whose committee reported it. A total is not a list of donors: when no record names who gave, say the records we hold give totals and do not name donors. That is what WE hold; never say the state, the county or the committee withholds donors or did not file.",
        "- When the question names more than one person, give each person's figures from that person's own records. Never say we hold no money records for a person whose records are in the list; if one person has none, say so for that person alone.",
      ] : []),
    "- Never tell the reader how to vote, never rank or score candidates, and never say who to support.",
    "- Never state a candidate's or official's position, stance or vote unless a supplied record states it.",
    "- SOURCE_PASSAGE is a matched quotation from a linked page. It does not establish who spoke or adopted the words. Attribute it to the page, never to the person.",
    "- Do not announce your own failure or apologise. State what is known, name what is missing, stop.",
    "- Plain language a twelve-year-old would understand. No identifiers, no codes, no internal state names.",
    agenda
      ? "- LEAD WITH THE HELD AGENDA: answer what is on this body's selected meeting agenda using its held agenda item titles and documents. Keep each item attached to its own meeting. A publication index is not a meeting agenda. If no agenda is held, lead with the named holding gap; never infer an empty docket or publisher absence. A sourced body-purpose explanation may be brief fallback context only when no agenda is held."
      : "- LEAD WITH THE PLAIN DEFINITION: begin with one or two short sentences saying, in the simplest words, what the thing the reader asked about actually MEANS. Say what it is before you say anything else about it.",
    agenda
      ? "- After the agenda information, add only supporting facts that answer the agenda question. Do not replace held agenda information with generic civics education."
      : "- After the definition, add only the most important supporting facts, in DESCENDING order of relevance — most important first, and stop when the important part is said. Do not list everything in the records.",
    "- Everything you write is about the ONE thing the reader asked about. Nothing about any other race, office, measure or person on the ballot belongs in the answer, even if a record mentions it.",
    agenda
      ? "- Preserve the source's meeting date and the named scope of every holding gap. Never describe missing extraction as nothing on the agenda."
      : "- Any procedural caveat — wording not final, an analysis still pending, where a title came from — comes AFTER the definition, briefly, once, and only when a record states it. It is never the lead.",
    lengthRuleForPrompt(),
    "",
    "Also report citedSources: the n, from the sources list, of every source whose records you actually relied on. Do not invent one.",
  ].join("\n");
}

export function synthesisSources(pack: Pick<EvidencePack, "records">): { n: number; url: string }[] {
  const urls: string[] = [];
  for (const record of pack.records) {
    if (record.sourceUrl && !urls.includes(record.sourceUrl)) urls.push(record.sourceUrl);
  }
  return urls.map((url, index) => ({ n: index + 1, url }));
}

export function citedUrlsFrom(pack: Pick<EvidencePack, "records">, cited: unknown): string[] {
  if (!Array.isArray(cited)) return [];
  const sources = synthesisSources(writerSelection(pack));
  const out: string[] = [];
  for (const value of cited) {
    const source = typeof value === "number" && Number.isInteger(value) ? sources.find((entry) => entry.n === value) : undefined;
    const url = source ? source.url : `unknown-source:${String(value).slice(0, 40)}`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

function synthesisFields(pack: EvidencePack): Record<string, unknown> {
  const selection = writerSelection(pack);
  return {
    question: pack.question,
    whatTheyAreAskingFor: pack.intent,
    timeframe: pack.temporal,
    subject: pack.subject,
    records: selection.records,
    writerSelection: selection.note,
    sources: synthesisSources(selection),
    namedGaps: pack.gaps.map(gapWords),
    whatWasSearched: pack.denominators,
  };
}

/** The context and question fields partition every field the model is given; each key lands in exactly one. */
export const SYNTHESIS_CONTEXT_FIELDS = [
  "subject",
  "records",
  "writerSelection",
  "sources",
  "namedGaps",
  "whatWasSearched",
] as const;

export const SYNTHESIS_QUESTION_FIELDS = [
  "question",
  "whatTheyAreAskingFor",
  "timeframe",
] as const;

function pick(fields: readonly string[], pack: EvidencePack): string {
  const all = synthesisFields(pack);
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = all[field];
  return JSON.stringify(out, null, 1);
}

export function synthesisContextPayload(pack: EvidencePack): string {
  return pick(SYNTHESIS_CONTEXT_FIELDS, pack);
}

export function synthesisQuestionPayload(pack: EvidencePack): string {
  return pick(SYNTHESIS_QUESTION_FIELDS, pack);
}

export function synthesisDateBlock(pack: EvidencePack): string {
  return `Today is ${pack.today}.`;
}

/** The single-blob form, called by nothing on the live path: the reference the partition is checked against. */
export function synthesisPayload(pack: EvidencePack): string {
  return JSON.stringify(synthesisFields(pack), null, 1);
}

export function synthesisRequestBody(
  pack: EvidencePack,
  shape: { model: string; cached: boolean; effort?: AskEffort },
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    type: "text",
    text: synthesisContextPayload(pack),
  };
  if (shape.cached) context.cache_control = SYNTHESIS_CACHE_TTL.cacheControl;
  const fields = modelRequestFields(shape.model, { thinking: "ADAPTIVE", effort: shape.effort ?? resolveAskEffort() });
  const system: string | { type: "text"; text: string; cache_control: typeof SYNTHESIS_CACHE_TTL.cacheControl }[] = shape.cached
    ? [{ type: "text", text: synthesisPrompt(pack), cache_control: SYNTHESIS_CACHE_TTL.cacheControl }]
    : synthesisPrompt(pack);

  return {
    model: shape.model,
    // Thinking tokens count against max_tokens: raise this before raising effort above high.
    max_tokens: Math.max(2048, fields.minMaxTokens),
    ...(fields.thinking ? { thinking: fields.thinking } : {}),
    output_config: {
      // Pinned: an omitted effort defaults to high, and thinking bills at the output rate.
      ...(fields.effort ? { effort: fields.effort } : {}),
      format: { type: "json_schema", schema: synthesisSchema() },
    },
    // Byte-identical from one request to the next: it is the front of the cached prefix.
    system,
    messages: [
      {
        role: "user",
        content: [context, { type: "text", text: synthesisDateBlock(pack) }, { type: "text", text: synthesisQuestionPayload(pack) }],
      },
    ],
  };
}

export const SYNTHESIS_MESSAGES_URL = MESSAGES_URL;

export interface SynthesizeOptions {
  fetchImpl?: typeof fetch;
  recordCost?: AskCostWriter;
  apiKey?: string;
  allowCall?: () => boolean;
  callerKey?: AskCallerKey;
  signal?: AbortSignal;
}

export interface SynthesisRung {
  model: string;
  effort: AskEffort | null;
  role: "FAST" | "FRONTIER";
  timeoutMs: number;
}

export const ASK_FAST_WRITER_TIMEOUT_MS = 6_000;

export function frontierRung(env: AskModelEnv = process.env): SynthesisRung {
  return { model: resolveAskModel(env), effort: resolveAskEffort(env), role: "FRONTIER", timeoutMs: ASK_SYNTHESIS_TIMEOUT_MS };
}

export function synthesisLadder(env: AskModelEnv = process.env): SynthesisRung[] {
  const frontier = frontierRung(env);
  const fast = resolveAskFastWriter(env);
  if (!fast || fast === frontier.model) return [frontier];
  return [{ model: fast, effort: askModelTakesEffort(fast) ? "low" : null, role: "FAST", timeoutMs: ASK_FAST_WRITER_TIMEOUT_MS }, frontier];
}

export function ladderIdentity(ladder: readonly SynthesisRung[]): { model: string; effort: string } {
  return { model: ladder.map((rung) => rung.model).join(">"), effort: ladder.map((rung) => rung.effort ?? "none").join(">") };
}

export async function synthesizeAnswer(
  pack: EvidencePack,
  options: SynthesizeOptions = {},
): Promise<SynthesisOutcome> {
  return synthesizeOnRung(pack, frontierRung(), options);
}

async function synthesizeOnRung(
  pack: EvidencePack,
  rung: SynthesisRung,
  options: SynthesizeOptions,
): Promise<SynthesisOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const callerKey = options.callerKey ?? askCallerKey();

  if (!packHasEvidence(pack)) {
    return { kind: "UNAVAILABLE", why: "no-evidence", ms: elapsed() };
  }
  if (stanceAnswerability(pack) === "UNVERIFIED_PERSONAL_STANCE") {
    return { kind: "UNAVAILABLE", why: "unverified-stance", ms: elapsed() };
  }

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { kind: "UNAVAILABLE", why: "no-key", ms: elapsed() };
  if (options.signal?.aborted) return { kind: "UNAVAILABLE", why: "error", ms: elapsed(), detail: "AbortError" };
  if (options.allowCall && !options.allowCall()) {
    return { kind: "UNAVAILABLE", why: "ceiling", ms: elapsed() };
  }

  const { model, effort } = rung;

  const impl = meteredAskFetch(options.fetchImpl ?? fetch, rung.role, options.recordCost);
  try {
    const response = await impl(MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(synthesisRequestBody(pack, { model, cached: true, ...(effort ? { effort } : {}) })),
      signal: options.signal ? AbortSignal.any([AbortSignal.timeout(rung.timeoutMs), options.signal]) : AbortSignal.timeout(rung.timeoutMs),
    });
    if (!response.ok) {
      let kind = "";
      try {
        const failure = (await response.json()) as { error?: { type?: unknown } };
        if (typeof failure?.error?.type === "string") kind = ` ${failure.error.type}`;
      } catch {
      }
      return {
        kind: "UNAVAILABLE",
        why: "error",
        ms: elapsed(),
        detail: `HTTP ${response.status}${kind}`,
      };
    }

    const body = (await response.json()) as {
      model?: unknown;
      stop_reason?: unknown;
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = body.content?.find((b) => b.type === "text")?.text ?? "";
    if (!text) {
      return { kind: "UNAVAILABLE", why: "error", ms: elapsed(), detail: body.stop_reason === "refusal" ? "refusal" : "no text block" };
    }
    const parsed = JSON.parse(text) as { answer?: unknown; citedSources?: unknown };
    if (typeof parsed.answer !== "string" || parsed.answer.trim().length === 0) {
      return { kind: "UNAVAILABLE", why: "error", ms: elapsed(), detail: "no answer string" };
    }
    return {
      kind: "WROTE",
      answer: parsed.answer.trim(),
      citedUrls: citedUrlsFrom(pack, parsed.citedSources),
      model,
      servedModel: servedModelOf(body),
      effort,
      ms: elapsed(),
      usage: readCacheUsage(body),
      callerKey,
    };
  } catch (error) {
    return {
      kind: "UNAVAILABLE",
      why: "error",
      ms: elapsed(),
      detail: error instanceof Error ? error.name : "threw a non-Error",
    };
  }
}

export interface LadderAttempt {
  model: string;
  servedModel?: string | null;
  role: SynthesisRung["role"];
  ms: number;
  result: "PASSED" | "FAILED" | "UNAVAILABLE";
  failed?: string[];
  detail?: string;
}

export interface LadderResult {
  outcome: SynthesisOutcome;
  verdict: ValidationVerdict | null;
  attempts: LadderAttempt[];
  escalation: string | null;
}

export async function synthesizeWithLadder(
  pack: EvidencePack,
  options: SynthesizeOptions & {
    validate: (answer: string, citedUrls: readonly string[]) => ValidationVerdict;
    ladder?: readonly SynthesisRung[];
  },
): Promise<LadderResult> {
  const ladder = options.ladder ?? synthesisLadder();
  const attempts: LadderAttempt[] = [];
  let escalation: string | null = null;
  let last: LadderResult | null = null;
  for (const [index, rung] of ladder.entries()) {
    if (options.signal?.aborted && last) return last;
    const outcome = await synthesizeOnRung(pack, rung, options);
    const hasNext = index < ladder.length - 1 && !options.signal?.aborted;
    if (outcome.kind === "UNAVAILABLE") {
      attempts.push({ model: rung.model, role: rung.role, ms: outcome.ms, result: "UNAVAILABLE", detail: outcome.detail ? `${outcome.why}: ${outcome.detail}` : outcome.why });
      last = { outcome, verdict: null, attempts, escalation };
      if (outcome.why !== "error" || !hasNext) return last;
      escalation = `${rung.role.toLowerCase()}-writer-unavailable: ${outcome.detail ?? outcome.why}`;
      continue;
    }
    const verdict = options.validate(outcome.answer, outcome.citedUrls);
    attempts.push({ model: rung.model, servedModel: outcome.servedModel, role: rung.role, ms: outcome.ms, result: verdict.kind, ...(verdict.kind === "FAILED" ? { failed: verdict.failed } : {}) });
    last = { outcome, verdict, attempts, escalation };
    if (verdict.kind === "PASSED" || !hasNext) return last;
    escalation = `${rung.role.toLowerCase()}-writer-failed-validation: ${verdict.failed.join(", ")}`;
  }
  return last ?? { outcome: { kind: "UNAVAILABLE", why: "error", ms: 0, detail: "no writer declared" }, verdict: null, attempts, escalation };
}
import { meteredAskFetch, type AskCostWriter } from "./cost.ts";
