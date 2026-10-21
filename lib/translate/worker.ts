import { canonicalModelId } from "../models.ts";
import { randomUUID } from "node:crypto";
import { recordCost } from "../control-plane/repository/coordinator.ts";
import { costEntryWithModel } from "../control-plane/cost.ts";
import { ZERO_COST } from "../control-plane/attempt.ts";
import { WORKER_SAFETY_FRAME, rolePlaybook, readRolePlaybookRow, type RolePlaybookEntry } from "../control-plane/playbooks.ts";
import { type FieldManualRepos } from "../control-plane/field-manual.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { assertStepMayInvokeModel } from "../control-plane/scheduler/model-routing.ts";
import { modelRequestAccounting, scoutThinkingOptions, type ModelRequest, type ModelResponse, type ModelTransport } from "../control-plane/scheduler/scout-executor.ts";
import type { WorkerEvidence } from "../control-plane/workers/types.ts";
import { meteredCostFields, readMeteredUsage, priceMeteredUsage } from "../control-plane/model-cost.ts";
import { measureRecordIssue, type MeasureRecord } from "../ballot/measure-records.ts";
import { runtimeKinds } from "../registry/kinds-runtime.ts";
import { registeredKind } from "../registry/kinds.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
type TranslationCostRepos = FieldManualRepos & Pick<ControlPlaneRepositories, "costs" | "spend">;
export type MeasureTranslationRepos = TranslationCostRepos & Pick<ControlPlaneRepositories, "adminConfig">;
import { translationHash, translationRecordIssue, translationSourceContains, translationSourceNames, type TranslationSentence, type MeasureTranslation, type TextTranslation, type PreservedCuratedText } from "./records.ts";

export interface TranslationPlaybook {
  readonly writerText: string;
  readonly checkerText: string;
  readonly writerModel: string;
  readonly checkerModel: string;
  readonly version: string;
}

/** The same canonical rows used by every other model role. */
export function translationPlaybook(entries: readonly RolePlaybookEntry[]): TranslationPlaybook {
  const writerBook = rolePlaybook(entries, "MEASURE_WRITER"), checkerBook = rolePlaybook(entries, "MEASURE_CHECKER");
  if (writerBook.error || checkerBook.error) throw new Error(writerBook.error ?? checkerBook.error);
  const writer = assertStepMayInvokeModel("summarization"), checker = assertStepMayInvokeModel("adversarial-audit");
  const modelFor = (role: "MEASURE_WRITER" | "MEASURE_CHECKER", fallback: string) => {
    const id = rolePlaybook(entries, role).entryIds[0];
    const model = (entries.find(entry => entry.id === id)?.payload as { model?: unknown })?.model;
    return typeof model === "string" ? model : fallback;
  };
  const writerModel = modelFor("MEASURE_WRITER", writer.model), checkerModel = modelFor("MEASURE_CHECKER", checker.model);
  if (![writer.model, assertStepMayInvokeModel("summarization", true).model].includes(writerModel) ||
      ![checker.model, assertStepMayInvokeModel("adversarial-audit", true).model].includes(checkerModel) || canonicalModelId(writerModel) === canonicalModelId(checkerModel)) throw new Error("Translation instructions have no distinct supported writer and checker models.");
  return { writerText: writerBook.text, checkerText: checkerBook.text, writerModel, checkerModel,
    version: translationHash(JSON.stringify([writerBook.version, checkerBook.version, writerModel, checkerModel])) };
}

async function loadTranslationPlaybook(repos: FieldManualRepos) {
  const rows = await Promise.all([readRolePlaybookRow(repos, "MEASURE_WRITER"), readRolePlaybookRow(repos, "MEASURE_CHECKER")]);
  return translationPlaybook(rows.flatMap(row => row ? [row.value] : []));
}

/** Preserve each writer/checker charge even when its proposed translation is rejected. */
function meteredTranslationTransport(repos: TranslationCostRepos, send: ModelTransport, subjectId: string): ModelTransport {
  return async request => {
    const started = performance.now();
    const response = await send(request);
    const usage = readMeteredUsage(response.usage, response.batch === true);
    const at = new Date().toISOString(), id = `translation:${randomUUID()}`;
    const checker = request.tools[0]?.name.startsWith("check_") === true;
    const entry = costEntryWithModel({ attemptId: id, workItemId: subjectId, routeTaskId: null, routeId: "plain-english-translation",
      source: "api.anthropic.com", jurisdiction: subjectId, project: "freshness", role: checker ? "TRANSLATION_CHECKER" : "TRANSLATOR",
      costPolicy: "R7", recordedAt: at, requestedModel: request.model, servedModel: response.model,
      cost: { ...ZERO_COST, ...meteredCostFields(usage), ...modelRequestAccounting(response), requestCount: 1,
        inputTokens: usage.uncachedInputTokens === null ? null : usage.uncachedInputTokens + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0),
        outputTokens: usage.outputTokens, usd: priceMeteredUsage(response.model, usage, "1h").usd,
        durationMs: Math.round(performance.now() - started) } }, response.model);
    await recordCost(repos, entry, at);
    return response;
  };
}

function toolResult(response: ModelResponse, name: string, model: string): unknown {
  if (response.stop_reason === "max_tokens" || canonicalModelId(response.model) !== canonicalModelId(model)) throw new Error("Translation model result is incomplete or from a different model.");
  const tools = response.content.filter(block => block.type === "tool_use" && block.name === name);
  if (tools.length !== 1 || tools[0].type !== "tool_use") throw new Error("Translation model returned no unique structured result.");
  return tools[0].input;
}

const writerTool = {
  name: "write_measure_translation", description: "Write the measure summary, vote meanings and only officially numbered parts, with one exact supporting source quote per written sentence.",
  input_schema: { type: "object", required: ["measure", "sentences"], properties: {
    measure: { type: "object", required: ["contestId", "whatItDoes", "yesMeans", "noMeans", "parts", "sourceUrl", "sourceHash", "writtenAt"],
      description: "Preserve supplied existing part IDs when rewriting the same parts.",
      properties: {
        contestId: { type: "string" }, whatItDoes: { type: "string" }, yesMeans: { type: "string" }, noMeans: { type: "string" },
        sourceUrl: { type: "string" }, sourceHash: { type: "string" }, writtenAt: { type: "string" },
        parts: { type: "array", description: "Optional. Use [] for a short explainer unless retaining supplied existing numbered parts. Never invent part numbering.", items: { type: "object", required: ["id", "number", "kind", "label", "what"], properties: {
          id: { type: "string", description: "Must start with the exact contestId followed by #. Preserve any supplied existing part ID." },
          number: { type: "string", description: "The part's own unique number in the official text." },
          kind: { type: "string", description: "One of the supplied partKinds keys." }, label: { type: "string" }, what: { type: "string" },
        } } },
      } },
    sentences: { type: "array", items: { type: "object", required: ["field", "text", "quote"], properties: {
      field: { type: "string", description: "Exact output field: whatItDoes, yesMeans, noMeans, parts.<exact part id>.label, or parts.<exact part id>.what. For a text translation use text." },
      text: { type: "string", description: "One sentence copied exactly from that output field; sentences joined with one space must reproduce the whole field." },
      quote: { type: "string", description: "One contiguous exact supporting passage copied from the supplied source. Do not insert ellipses or combine separate passages." },
    } } },
  } },
};
const checkerTool = {
  name: "check_measure_translation", description: "Compare each translated sentence with the original source, independently. Return one check per sentence; reject added facts, judgments, omitted material qualifications and invented part numbering.",
  input_schema: { type: "object", required: ["checked"], properties: { checked: { type: "array", items: {
    type: "object", required: ["field", "text", "supported"], properties: { field: { type: "string" }, text: { type: "string" }, supported: { type: "boolean" } },
  } } } },
};

export interface TextTranslationSubject {
  readonly kind: TextTranslation["kind"];
  readonly subjectId: string;
  readonly label: string;
  readonly ocdId: string;
  readonly state: string;
  readonly meeting?: TextTranslation["meeting"];
}

/** Legal class definitions never confer that class's powers on a particular body. */
export async function translateText(input: {
  readonly batchPriority?: import("../control-plane/model-batch.ts").BatchPriority;
  readonly repos: TranslationCostRepos;
  readonly evidence: WorkerEvidence;
  readonly subject: TextTranslationSubject;
  readonly preservedText?: PreservedCuratedText;
  readonly transportFor: (subject: { subjectId: string; state: string }) => ModelTransport;
  readonly now: string;
}) {
  const { evidence, subject, now } = input;
  const hash = (evidence.sourceDocument?.contentHash ?? evidence.contentHash).replace(/^sha256-/, "");
  if ((subject.kind === "AGENDA" || subject.kind === "MINUTES") && (!subject.meeting?.id || !subject.meeting.bodyId ||
      subject.subjectId !== `${subject.kind.toLowerCase()}:${subject.meeting.id}` || subject.meeting.documentUrl !== evidence.canonicalUrl ||
      subject.meeting.documentHash !== hash)) throw new Error("Meeting translation lacks its held body, sitting and document revision.");
  if (!subject.subjectId.startsWith(`${subject.kind.toLowerCase()}:`) || !subject.label.trim() ||
      !evidence.text.includes(subject.label) || !evidence.text.trim() ||
      evidence.contentHash !== `sha256-${translationHash(evidence.text)}` || !/^https:\/\//.test(evidence.canonicalUrl) ||
      jurisdictionFromOcdId(subject.ocdId)?.usps !== subject.state || !Number.isFinite(Date.parse(now))) throw new Error("Text translation lacks its exact source-named subject.");
  // Read the same live translator playbook as measures; the task-specific tool
  // supplies the output shape. Existing Bank edits and model routing apply here.
  const playbook = await loadTranslationPlaybook(input.repos);
  const instruction = subject.kind === "BODY_CLASS"
    ? "Describe only what this class of body is under the supplied creating law. Do not assert that a named body possesses those powers."
    : subject.kind === "BODY" ? "Describe only this named body's powers under its own charter or creating law. Do not import powers from its general class."
    : subject.kind === "OFFICE" ? "Describe this state's legally defined office. Do not import duties from a similarly named office in another state."
    : subject.kind === "AGENDA" ? "Describe what is on this held agenda, preserving dates, conditions and proposed status. The clerk's verbatim list remains alongside this text. Never describe a proposal as adopted."
    : "Describe only what these held minutes record. Preserve votes, outcomes, qualifications and uncertainty; never invent a vote or speaker.";
  if (input.preservedText && (input.preservedText.origin.kind !== "CURATED_MIGRATION" ||
    translationHash(input.preservedText.text) !== input.preservedText.origin.textHash)) throw new Error("Curated migration lacks its unchanged original text.");
  const preservation = input.preservedText ? "The supplied curated text must remain byte-for-byte unchanged, including punctuation. Return that exact text and annotate each sentence with its original-source passage. Do not rewrite, correct or add facts; unsupported text must fail the independent check." : "";
  const writer = { name: "write_text_translation", description: "Translate the supplied source under the task instructions. Every sentence needs an exact supporting quote.",
    input_schema: { type: "object", required: ["text", "sentences"], properties: {
      text: { type: "string" }, sentences: writerTool.input_schema.properties.sentences,
    } } };
  const send = meteredTranslationTransport(input.repos, input.transportFor({ subjectId: subject.subjectId, state: subject.state }), subject.subjectId);
  const request = (model: string, tool: typeof writer | typeof checkerTool, content: unknown): ModelRequest => ({
    batchContext: { job: (subject.kind === "AGENDA" || subject.kind === "MINUTES") && !input.batchPriority ? "LIVE_REFRESH" : "TRANSLATOR", priority: input.batchPriority },
    model, max_tokens: 8192, ...scoutThinkingOptions("medium"),
    system: [{ type: "text", text: `${WORKER_SAFETY_FRAME}\n\n${model === playbook.writerModel ? playbook.writerText : playbook.checkerText}\n\nUse the supplied text-translation tool. Every sentence uses field text and an exact supporting quote.`, cache_control: { type: "ephemeral", ttl: "1h" } }],
    tools: [tool], tool_choice: { type: "auto" }, messages: [{ role: "user", content: JSON.stringify(content) }],
  });
  const written = await send(request(playbook.writerModel, writer, { source: evidence.text, subject, instruction, preservation, ...(input.preservedText ? { curatedText: input.preservedText.text } : {}) }));
  const proposal = toolResult(written, writer.name, playbook.writerModel) as { text: string; sentences: TranslationSentence[] };
  if (typeof proposal?.text !== "string" || !proposal.text.trim() || !Array.isArray(proposal.sentences) ||
      proposal.sentences.some(row => !row || row.field !== "text" || typeof row.quote !== "string" || !row.quote.trim() || !evidence.text.includes(row.quote))) throw new Error("Text translator returned unsupported source passages.");
  if (input.preservedText && proposal.text !== input.preservedText.text) throw new Error("Curated migration would rewrite the existing text.");
  const checked = await send(request(playbook.checkerModel, checkerTool, { originalSource: evidence.text, subject, instruction, preservation, proposal }));
  const result = toolResult(checked, checkerTool.name, playbook.checkerModel) as { checked: TextTranslation["checked"] };
  const record: TextTranslation = { id: `translation:${subject.subjectId}`, kind: subject.kind, subjectId: subject.subjectId,
    ocdId: subject.ocdId, ...(input.preservedText ? { curatedOrigin: input.preservedText.origin } : {}), label: subject.label, text: proposal.text, sourceUrl: evidence.canonicalUrl,
    sourceHash: hash, ...(subject.meeting ? { meeting: subject.meeting } : {}),
    sourceText: evidence.text, sourceTextHash: translationHash(evidence.text), retrievedAt: evidence.retrievedAt,
    writtenAt: now, writerModel: canonicalModelId(written.model), checkerModel: canonicalModelId(checked.model),
    playbookVersion: playbook.version, sentences: proposal.sentences, checked: result?.checked };
  const issue = translationRecordIssue(record);
  if (issue) throw new Error(issue);
  return { record };
}

/** The caller supplies the existing Fleet/area budget transport for BOTH calls. */
export async function translateMeasure(input: {
  readonly batchPriority?: import("../control-plane/model-batch.ts").BatchPriority;
  readonly repos: MeasureTranslationRepos;
  readonly evidence: WorkerEvidence;
  readonly subject: { readonly contestId: string; readonly title: string; readonly ocdId: string; readonly state: string; readonly prior: MeasureRecord | null;
    /** Exact passage bound by the held ballot to this official source. Titles
     * often include ballot numbers assigned after the legal text was written. */
    readonly sourceQuote?: string };
  readonly transportFor: (subject: { subjectId: string; state: string }) => ModelTransport;
  readonly now: string;
}) {
  const { evidence, subject, now } = input;
  if (!evidence.text.trim() || evidence.contentHash !== `sha256-${translationHash(evidence.text)}` ||
      !/^https:\/\//.test(evidence.canonicalUrl) || !subject.title.trim() ||
      !(subject.sourceQuote?.trim() ? translationSourceContains(evidence.text, subject.sourceQuote) : translationSourceNames(evidence.text, subject.title)) ||
      jurisdictionFromOcdId(subject.ocdId)?.usps !== subject.state || !Number.isFinite(Date.parse(now))) throw new Error("Translation source is incomplete or does not name this measure.");
  const playbook = await loadTranslationPlaybook(input.repos);
  const send = meteredTranslationTransport(input.repos, input.transportFor({ subjectId: subject.contestId, state: subject.state }), subject.contestId);
  const request = (model: string, tool: typeof writerTool | typeof checkerTool, content: unknown): ModelRequest => ({
    batchContext: { job: "TRANSLATOR", priority: input.batchPriority },
    model, max_tokens: 8192, ...scoutThinkingOptions("medium"),
    system: [{ type: "text", text: `${WORKER_SAFETY_FRAME}\n\n${model === playbook.writerModel ? playbook.writerText : playbook.checkerText}`, cache_control: { type: "ephemeral", ttl: "1h" } }],
    tools: [tool], tool_choice: { type: "auto" }, messages: [{ role: "user", content: JSON.stringify(content) }],
  });
  const sourceHash = (evidence.sourceDocument?.contentHash ?? evidence.contentHash).replace(/^sha256-/, "");
  const kinds = runtimeKinds((await input.repos.adminConfig.read("current"))?.value ?? null);
  const writer = await send(request(playbook.writerModel, writerTool, { source: evidence.text, subject,
    sourceUrl: evidence.canonicalUrl, sourceHash, writtenAt: now,
    partKinds: kinds.measurePart,
    instruction: "Write a short, neutral explanation in plain high-school English of what the measure does, what a YES vote would enact, and what a NO vote would reject. All three fields are required. Use only the supplied official text. Preserve every material condition and exception. Never recommend, judge, endorse, favor or argue for either side. Do not invent consequences of rejecting the proposal. Cite one contiguous exact source passage for each individual sentence, with no inserted ellipses. Use sentence fields whatItDoes, yesMeans, noMeans, parts.<exact part id>.label or parts.<exact part id>.what; their sentences joined with one space must reproduce that field exactly. Return parts: [] for a short explainer unless retaining supplied existing numbered parts. Any part ID must start with the exact contestId followed by #, and its number must be the source's own unique number." }));
  const proposal = toolResult(writer, writerTool.name, playbook.writerModel) as { measure: MeasureRecord; sentences: TranslationSentence[] };
  if (!proposal || measureRecordIssue(proposal.measure) || proposal.measure.contestId !== subject.contestId ||
      proposal.measure.sourceUrl !== evidence.canonicalUrl || proposal.measure.sourceHash !== sourceHash || proposal.measure.writtenAt !== now ||
      !Array.isArray(proposal.sentences) || proposal.sentences.some(sentence => !sentence || !translationSourceContains(evidence.text, sentence.quote))) throw new Error("Translation writer returned unsupported fields or source passages.");
  if (proposal.measure.parts.some(part => !registeredKind(kinds, "measurePart", part.kind))) throw new Error("Translation part kind is absent from the current kinds setting.");
  if (subject.prior?.parts.some(part => !proposal.measure.parts.some(proposed => proposed.id === part.id &&
      (part.number === null || proposed.number === part.number)))) throw new Error("Translation would lose or reassign an existing measure part's reaction identity.");
  const checker = await send(request(playbook.checkerModel, checkerTool, { originalSource: evidence.text, subject,
    proposal, instruction: "Check every written sentence and its qualifications against the original source. Verify what a YES vote would enact and what a NO vote would reject without assuming unstated consequences. Reject recommendations, judgments, persuasion or language favoring either side. Every official part number must appear there. Return a false check for any unsupported or non-neutral sentence." }));
  const result = toolResult(checker, checkerTool.name, playbook.checkerModel) as { checked: MeasureTranslation["checked"] };
  const record: MeasureTranslation = { id: `translation:${subject.contestId}`, kind: "MEASURE", subjectId: subject.contestId,
    ocdId: subject.ocdId, sourceUrl: evidence.canonicalUrl, sourceHash, sourceText: evidence.text,
    sourceTextHash: translationHash(evidence.text), retrievedAt: evidence.retrievedAt, writtenAt: now,
    writerModel: canonicalModelId(writer.model), checkerModel: canonicalModelId(checker.model), playbookVersion: playbook.version,
    measure: proposal.measure, sentences: proposal.sentences, checked: result?.checked };
  const issue = translationRecordIssue(record);
  if (issue) throw new Error(issue);
  return { record, usage: [writer, checker].map(response => ({ model: response.model,
    usage: readMeteredUsage(response.usage, response.batch === true), usd: priceMeteredUsage(response.model, readMeteredUsage(response.usage, response.batch === true), "1h").usd })) };
}
