import { normalizeName } from "../routing/exact-name.ts";
import { asksForBodyAgenda, type BindableEntity } from "../routing/named-entity.ts";
import { unavailableInterpretation, type AskIntent, type AskInterpretation, type AskTemporal } from "./intent.ts";
import { interpretWithoutModel } from "./interpret.ts";
import { shapeIntentFor, subjectKindOf } from "./lexical-reading.ts";
import { moneyQuestionShape } from "./money-answer.ts";
import { outcomeQuestionClass } from "./outcome-question.ts";
import { isReferential, resolveInterpretation } from "./resolve.ts";
import type { AskSubjectRef } from "./subject.ts";

const CONTACT_WORDING: readonly RegExp[] = [
  /^(?:who|whom) (?:can|could|should|do|would|might) (?:i|we) (?:talk|speak|write|reach out|turn|complain|go|contact|call|email|ask)\b/,
  /^how (?:do|can|could|would|should) (?:i|we) (?:contact|reach|call|email|get in touch with|write to|talk to|speak to|speak with|talk with)\b/,
  /\b(?:contact information|contact info|phone number|email address)\b/,
];

const MEETING_TIME_WORDING = /^(?:when|what time|what day|what date)\b.*\b(?:meet|meets|meeting|session|convene)\b/;

export interface CodeReadingInput {
  question: string;
  inventory: readonly BindableEntity[];
  activeSubjects?: readonly AskSubjectRef[];
  priorSubjects?: readonly AskSubjectRef[];
}

export interface CodeReading {
  interpretation: AskInterpretation;
  basis: "SHAPE" | "WORDING";
  subjectId: string;
}

export function codeBestReading(input: CodeReadingInput): CodeReading | null {
  const temporal = interpretWithoutModel(input.question).temporal;
  const context = { activeSubjects: input.activeSubjects ?? [], priorSubjects: input.priorSubjects ?? [] };
  let referent: string | null = null;
  let resolved = resolveInterpretation({ ...unavailableInterpretation(), temporal }, input.question, input.inventory, context);
  if (resolved.binding.kind === "NONE" && isReferential(input.question)) {
    const focused = context.activeSubjects.filter((ref) => ref.focused);
    const candidate = focused.length === 1 ? focused[0] : context.activeSubjects.length === 0 ? context.priorSubjects.at(-1) : undefined;
    if (candidate?.name) {
      referent = candidate.name;
      resolved = resolveInterpretation({ ...unavailableInterpretation(), temporal, referent }, input.question, input.inventory, context);
    }
  }
  if (resolved.binding.kind !== "BOUND") return null;
  const entity = resolved.binding.entity;
  const kind = subjectKindOf(entity);
  if (kind === "PERSON" && moneyQuestionShape(input.question)) {
    return { interpretation: { ...unavailableInterpretation(), intent: "PERSON_RECORD", temporal: { kind: "NONE" }, referent }, basis: "SHAPE", subjectId: entity.id };
  }
  const shaped = shapeIntentFor(input.question, kind, temporal);
  const named = shaped?.intent ?? wordingIntent(input.question, temporal, kind);
  const intent = named ?? (kind === "PERSON" ? "PERSON_RECORD" : kind === "MEASURE" ? "MEASURE" : kind ? "UNKNOWN" : null);
  if (!intent) return null;
  return { interpretation: { ...unavailableInterpretation(), intent, temporal, referent }, basis: shaped ? "SHAPE" : "WORDING", subjectId: entity.id };
}

function wordingIntent(question: string, temporal: AskTemporal, kind: ReturnType<typeof subjectKindOf>): AskIntent | null {
  const normalized = normalizeName(question);
  if (CONTACT_WORDING.some((pattern) => pattern.test(normalized))) return "CONTACT";
  if (kind !== "BODY") return null;
  if (outcomeQuestionClass(question)) return "PAST_MEETING";
  if (asksForBodyAgenda(question)) return "UPCOMING_AGENDA";
  if (MEETING_TIME_WORDING.test(normalized)) return temporal.kind === "LAST" ? "PAST_MEETING" : "MEETING_TIME";
  return null;
}

export interface ReadingOutcome {
  subjectId: string | null;
  bodyIds: readonly string[];
  intent: AskIntent;
  temporal: AskTemporal;
  selection: string;
  writerInput: string;
}

export type SpeculationVerdict =
  | { keep: true; why: "same-subject-body-kind-and-writer-input" }
  | { keep: false; why: "model-reading-unavailable" | "model-reading-needs-no-writer" | "different-subject" | "different-body" | "different-question-kind" | "different-writer-input" };

export function speculationVerdict(
  code: ReadingOutcome,
  model: ReadingOutcome | "MODEL_READING_UNAVAILABLE" | "MODEL_READING_NEEDS_NO_WRITER",
): SpeculationVerdict {
  if (model === "MODEL_READING_UNAVAILABLE") return { keep: false, why: "model-reading-unavailable" };
  if (model === "MODEL_READING_NEEDS_NO_WRITER") return { keep: false, why: "model-reading-needs-no-writer" };
  if (code.subjectId !== model.subjectId) return { keep: false, why: "different-subject" };
  const bodies = (ids: readonly string[]) => JSON.stringify([...new Set(ids)].sort());
  if (bodies(code.bodyIds) !== bodies(model.bodyIds)) return { keep: false, why: "different-body" };
  if (code.selection !== model.selection || JSON.stringify(sortedKeys(code.temporal)) !== JSON.stringify(sortedKeys(model.temporal))) {
    return { keep: false, why: "different-question-kind" };
  }
  if (code.writerInput !== model.writerInput) return { keep: false, why: "different-writer-input" };
  return { keep: true, why: "same-subject-body-kind-and-writer-input" };
}

function sortedKeys(value: AskTemporal): [string, unknown][] {
  return Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b));
}
