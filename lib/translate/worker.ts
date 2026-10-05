import { readFileSync } from "node:fs";
import { canonicalModelId } from "../models.ts";
import { WORKER_SAFETY_FRAME } from "../control-plane/playbooks.ts";
import { newFieldManualEntry, readFieldManual, writeFieldManual, type FieldManualRepos, type FieldManualEntry } from "../control-plane/field-manual.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { assertStepMayInvokeModel } from "../control-plane/scheduler/model-routing.ts";
import { scoutThinkingOptions, type ModelRequest, type ModelResponse, type ModelTransport } from "../control-plane/scheduler/scout-executor.ts";
import type { WorkerEvidence } from "../control-plane/workers/types.ts";
import { readMeteredUsage, priceMeteredUsage } from "../control-plane/model-cost.ts";
import { measureRecordIssue, type MeasureRecord } from "../ballot/measure-records.ts";
import { translationHash, translationRecordIssue, type TranslationSentence, type MeasureTranslation } from "./records.ts";

export interface TranslationPlaybook {
  readonly text: string;
  readonly writerModel: string;
  readonly checkerModel: string;
  readonly version: string;
}

/** Live Bank entries override the seed; no deploy or worker restart is needed. */
export function translationPlaybook(entries: readonly FieldManualEntry[]): TranslationPlaybook {
  const held = entries.filter(entry => entry.kind === "PLAYBOOK" && (entry.payload as { translator?: unknown })?.translator === true)
    .sort((a, b) => Number(a.source === "translator-seed") - Number(b.source === "translator-seed") ||
      (b.observedAt ?? "").localeCompare(a.observedAt ?? "") || a.id.localeCompare(b.id));
  const payload = held[0]?.payload as { text?: unknown; writerModel?: unknown; checkerModel?: unknown } | undefined;
  const writer = assertStepMayInvokeModel("summarization"), checker = assertStepMayInvokeModel("adversarial-audit");
  const text = typeof payload?.text === "string" ? payload.text : readFileSync(new URL("./playbook.md", import.meta.url), "utf8");
  const writerModel = typeof payload?.writerModel === "string" ? payload.writerModel : writer.model;
  const checkerModel = typeof payload?.checkerModel === "string" ? payload.checkerModel : checker.model;
  if (!text.trim() || ![writer.model, assertStepMayInvokeModel("summarization", true).model].includes(writerModel) ||
      ![checker.model, assertStepMayInvokeModel("adversarial-audit", true).model].includes(checkerModel) || canonicalModelId(writerModel) === canonicalModelId(checkerModel)) throw new Error("Translation playbook has no distinct supported writer and checker models.");
  return { text, writerModel, checkerModel, version: translationHash(JSON.stringify([text, writerModel, checkerModel])) };
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
    measure: { type: "object", description: "MeasureRecord: contestId, whatItDoes, yesMeans, noMeans, parts[{id, number, kind, label, what}], sourceUrl, sourceHash, writtenAt. Preserve supplied existing part IDs when rewriting the same parts." },
    sentences: { type: "array", items: { type: "object", required: ["field", "text", "quote"], properties: {
      field: { type: "string" }, text: { type: "string" }, quote: { type: "string" },
    } } },
  } },
};
const checkerTool = {
  name: "check_measure_translation", description: "Compare each translated sentence with the original source, independently. Return one check per sentence; reject added facts, judgments, omitted material qualifications and invented part numbering.",
  input_schema: { type: "object", required: ["checked"], properties: { checked: { type: "array", items: {
    type: "object", required: ["field", "text", "supported"], properties: { field: { type: "string" }, text: { type: "string" }, supported: { type: "boolean" } },
  } } } },
};

/** The caller supplies the existing Fleet/area budget transport for BOTH calls. */
export async function translateMeasure(input: {
  readonly repos: FieldManualRepos;
  readonly evidence: WorkerEvidence;
  readonly subject: { readonly contestId: string; readonly title: string; readonly ocdId: string; readonly state: string; readonly prior: MeasureRecord | null };
  readonly transportFor: (subject: { subjectId: string; state: string }) => ModelTransport;
  readonly now: string;
}) {
  const { evidence, subject, now } = input;
  if (!evidence.text.trim() || evidence.contentHash !== `sha256-${translationHash(evidence.text)}` ||
      !/^https:\/\//.test(evidence.canonicalUrl) || !subject.title.trim() || !evidence.text.includes(subject.title) ||
      jurisdictionFromOcdId(subject.ocdId)?.usps !== subject.state || !Number.isFinite(Date.parse(now))) throw new Error("Translation source is incomplete or does not name this measure.");
  const manual = await readFieldManual(input.repos, { role: "SHARED", state: subject.state.toLowerCase(), recordClass: "BALLOT_MEASURE" });
  if (manual.error) throw new Error(manual.error);
  const playbook = translationPlaybook(manual.store.entries);
  if (!manual.store.entries.some(entry => entry.kind === "PLAYBOOK" && (entry.payload as { translator?: unknown })?.translator === true)) {
    const saved = await writeFieldManual(input.repos, [newFieldManualEntry("translator-seed", "measures", {
      role: "SHARED", kind: "PLAYBOOK", title: "Plain-English measure translator", summary: "Source-only writer with an independent sentence checker.",
      outcome: "REFERENCE", observedAt: now, recordClasses: ["BALLOT_MEASURE"],
      payload: { translator: true, text: playbook.text, writerModel: playbook.writerModel, checkerModel: playbook.checkerModel },
    })], now);
    if (saved.error) throw new Error(saved.error);
  }
  const send = input.transportFor({ subjectId: subject.contestId, state: subject.state });
  const request = (model: string, tool: typeof writerTool | typeof checkerTool, content: unknown): ModelRequest => ({
    model, max_tokens: 8192, ...scoutThinkingOptions(model, "medium"),
    system: [{ type: "text", text: `${WORKER_SAFETY_FRAME}\n\n${playbook.text}`, cache_control: { type: "ephemeral" } }],
    tools: [tool], tool_choice: { type: "auto" }, messages: [{ role: "user", content: JSON.stringify(content) }],
  });
  const sourceHash = (evidence.sourceDocument?.contentHash ?? evidence.contentHash).replace(/^sha256-/, "");
  const writer = await send(request(playbook.writerModel, writerTool, { source: evidence.text, subject,
    sourceUrl: evidence.canonicalUrl, sourceHash, writtenAt: now }));
  const proposal = toolResult(writer, writerTool.name, playbook.writerModel) as { measure: MeasureRecord; sentences: TranslationSentence[] };
  if (!proposal || measureRecordIssue(proposal.measure) || proposal.measure.contestId !== subject.contestId ||
      proposal.measure.sourceUrl !== evidence.canonicalUrl || proposal.measure.sourceHash !== sourceHash || proposal.measure.writtenAt !== now ||
      !Array.isArray(proposal.sentences) || proposal.sentences.some(sentence => !sentence || typeof sentence.quote !== "string" || !evidence.text.includes(sentence.quote))) throw new Error("Translation writer returned unsupported fields or source passages.");
  if (subject.prior?.parts.some(part => !proposal.measure.parts.some(proposed => proposed.id === part.id &&
      (part.number === null || proposed.number === part.number)))) throw new Error("Translation would lose or reassign an existing measure part's reaction identity.");
  const checker = await send(request(playbook.checkerModel, checkerTool, { originalSource: evidence.text, subject,
    proposal, instruction: "Check every written sentence and its qualifications against the original source. Every official part number must appear there. Return a false check for any unsupported sentence." }));
  const result = toolResult(checker, checkerTool.name, playbook.checkerModel) as { checked: MeasureTranslation["checked"] };
  const record: MeasureTranslation = { id: `translation:${subject.contestId}`, kind: "MEASURE", subjectId: subject.contestId,
    ocdId: subject.ocdId, sourceUrl: evidence.canonicalUrl, sourceHash, sourceText: evidence.text,
    sourceTextHash: translationHash(evidence.text), retrievedAt: evidence.retrievedAt, writtenAt: now,
    writerModel: canonicalModelId(writer.model), checkerModel: canonicalModelId(checker.model), playbookVersion: playbook.version,
    measure: proposal.measure, sentences: proposal.sentences, checked: result?.checked };
  const issue = translationRecordIssue(record);
  if (issue) throw new Error(issue);
  return { record, usage: [writer, checker].map(response => ({ model: response.model,
    usage: readMeteredUsage(response.usage), usd: priceMeteredUsage(response.model, readMeteredUsage(response.usage), "5m").usd })) };
}
