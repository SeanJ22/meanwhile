/**
 * Shared loss reading types and lesson rendering; the scheduled study folds native observations on scratch disk.
 */
import { newFieldManualEntry, type FieldManualEntry } from "../control-plane/field-manual.ts";
import type { NewUpdate } from "../control-plane/updates.ts";
import type { LossStudy } from "./study-losses.ts";

export const LOSS_KINDS = ["shut-door", "empty-hunt", "checker", "audit", "front-end"] as const;
export type LossKind = (typeof LOSS_KINDS)[number];

export const LOSS_KIND_WORDS: Record<LossKind, string> = {
  "shut-door": "shut doors",
  "empty-hunt": "hunts that came back empty",
  checker: "facts a checker held back",
  audit: "auditors' red flags",
  "front-end": "front-end red flags",
};

export interface LossReading {
  readonly kind: LossKind;
  /** What failed or worked, as a stable key (a platform, a record kind, a hold reason, a screen and element). */
  readonly subject: string;
  /** The same in plain words, for the lesson. */
  readonly subjectWords: string;
  /** The place it happened in: the key place traits are held under. */
  readonly placeId: string;
  readonly failed: boolean;
  readonly at: string;
}

export const LOSS_LESSON_SOURCE = "loss-study-all";

export interface LossLesson {
  readonly kind: LossKind;
  readonly subject: string;
  /** Stable across passes, so a repeat study updates the lesson instead of adding one. */
  readonly key: string;
  /** One plain sentence for Admin's updates and the field manual. */
  readonly says: string;
  readonly failures: number;
  readonly works: number;
  readonly entry: FieldManualEntry;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function lossLessonForStudy(kind: LossKind, subject: string, words: string, study: LossStudy, now: string): LossLesson {
  const cause = study.shared.map((s) => `${s.trait} (${s.value})`).join("; ");
  const says = `Lesson from ${LOSS_KIND_WORDS[kind]}: ${words} failed in ${plural(study.failures, "place")} that share ${cause}${study.works > 0 ? `, and none of the ${plural(study.works, "place")} where it worked do` : ""}.`;
  const key = `${kind}|${subject}|${study.shared.map((s) => `${s.trait}=${s.value}`).join("|")}`;
  return { kind, subject, key, says, failures: study.failures, works: study.works, entry: entry(kind, key, `${words}: fails where ${cause}`, says, now, study.shared.flatMap((s) => (s.trait === "platform" ? [s.value] : [])), study.shared.flatMap((s) => (s.trait === "state" ? [s.value] : []))) };
}

function entry(kind: LossKind, key: string, title: string, says: string, now: string, platforms: string[] = [], states: string[] = []): FieldManualEntry {
  return newFieldManualEntry(LOSS_LESSON_SOURCE, key, {
    role: "SHARED", kind: "LESSON", title: title.slice(0, 160), summary: says.replace(/\s+/g, " ").slice(0, 280), outcome: "FAILED",
    observedAt: now, platforms, states: states.filter((s) => /^[a-z]{2}$/.test(s)),
    ...(platforms.length + states.filter((s) => /^[a-z]{2}$/.test(s)).length === 0 ? { portable: true } : {}), payload: { lossKind: kind, key },
  });
}

export function repeatLossLesson(subject: string, words: string, failures: number, works: number, now: string): LossLesson {
  const key = `front-end|${subject}|repeats`;
  const says = `Lesson from ${LOSS_KIND_WORDS["front-end"]}: ${words} was red at ${plural(failures, "place")}, so it is the page, not the place; one fix to the page fixes them all.`;
  return {kind: "front-end", subject, key, says, failures, works, entry: entry("front-end", key, `${words}: red wherever it shows`, says, now)};
}

/** Admin's updates for a set of lessons: one per lesson, keyed by its field-manual entry, so Now shows each once. A lesson is learned, not proven. */
export function lossLessonUpdates(lessons: readonly LossLesson[], now: string): NewUpdate[] {
  return lessons.map((l) => ({ id: `lesson:${l.entry.id}`, what: l.says, at: now, label: "TESTING" as const }));
}
