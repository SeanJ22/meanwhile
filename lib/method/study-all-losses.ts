/**
 * Every kind of loss is studied like method failures: each loss and success becomes a reading, and readings of one kind
 * and subject are compared with `studyLosses`. A front-end red at two or more places is the page, not the place. Pure.
 */
import { newFieldManualEntry, type FieldManualEntry } from "../control-plane/field-manual.ts";
import type { NewUpdate } from "../control-plane/updates.ts";
import type { FixMapRow } from "./fix-map.ts";
import { studyLosses, type LossStudy, type PlaceTraits } from "./study-losses.ts";

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

/** Readings to the fix-map row shape `studyLosses` takes: one row per subject and place, a failure anywhere in that place counting as failing there. */
export function lossRows(readings: readonly LossReading[]): FixMapRow[] {
  const rows = new Map<string, FixMapRow>();
  for (const r of readings) {
    const methodId = `${r.kind}|${r.subject}`;
    const key = `${methodId}\u0000${r.placeId}`;
    const held = rows.get(key);
    if (held && held.state === "FAILS") continue;
    if (held && !r.failed) continue;
    rows.set(key, { methodId, placeId: r.placeId, state: r.failed ? "FAILS" : "WORKS", triedAt: r.at, attemptId: null, cause: null, updatedAt: r.at });
  }
  return [...rows.values()];
}

function lessonFor(kind: LossKind, subject: string, words: string, study: LossStudy, now: string): LossLesson {
  const cause = study.shared.map((s) => `${s.trait} (${s.value})`).join("; ");
  const says = `Lesson from ${LOSS_KIND_WORDS[kind]}: ${words} failed in ${plural(study.failures, "place")} that share ${cause}${study.works > 0 ? `, and none of the ${plural(study.works, "place")} where it worked do` : ""}.`;
  const key = `${kind}|${subject}|${study.shared.map((s) => `${s.trait}=${s.value}`).join("|")}`;
  return { kind, subject, key, says, failures: study.failures, works: study.works, entry: entry(kind, key, `${words}: fails where ${cause}`, says, now, study.shared.flatMap((s) => (s.trait === "platform" ? [s.value] : [])), study.shared.flatMap((s) => (s.trait === "state" ? [s.value] : []))) };
}

function entry(kind: LossKind, key: string, title: string, says: string, now: string, platforms: string[] = [], states: string[] = []): FieldManualEntry {
  return newFieldManualEntry(LOSS_LESSON_SOURCE, key, {
    role: "SHARED", kind: "LESSON", title: title.slice(0, 160), summary: says.replace(/\s+/g, " ").slice(0, 280), outcome: "FAILED",
    observedAt: now, platforms, states: states.filter((s) => /^[a-z]{2}$/.test(s)), payload: { lossKind: kind, key },
  });
}

/** A front-end red seen at two or more places: the page itself, whatever the places share. */
function repeatLessons(readings: readonly LossReading[], now: string): LossLesson[] {
  const bySubject = new Map<string, { words: string; places: Set<string>; works: Set<string> }>();
  for (const r of readings) {
    if (r.kind !== "front-end") continue;
    const held = bySubject.get(r.subject) ?? { words: r.subjectWords, places: new Set<string>(), works: new Set<string>() };
    (r.failed ? held.places : held.works).add(r.placeId);
    bySubject.set(r.subject, held);
  }
  return [...bySubject].filter(([, v]) => v.places.size >= 2).map(([subject, v]) => {
    const key = `front-end|${subject}|repeats`;
    const says = `Lesson from ${LOSS_KIND_WORDS["front-end"]}: ${v.words} was red at ${plural(v.places.size, "place")}, so it is the page, not the place; one fix to the page fixes them all.`;
    return { kind: "front-end" as const, subject, key, says, failures: v.places.size, works: [...v.works].filter((p) => !v.places.has(p)).length, entry: entry("front-end", key, `${v.words}: red wherever it shows`, says, now) };
  });
}

/** Study every kind of loss. One lesson per kind, subject and shared cause; a subject whose failures share nothing yields no lesson here. */
export function studyAllLosses(readings: readonly LossReading[], placeTraits: ReadonlyMap<string, PlaceTraits>, now: string): LossLesson[] {
  const words = new Map(readings.map((r) => [`${r.kind}|${r.subject}`, r.subjectWords]));
  const lessons: LossLesson[] = [];
  for (const study of studyLosses(lossRows(readings), placeTraits)) {
    if (study.shared.length === 0) continue;
    const bar = study.methodId.indexOf("|");
    const kind = study.methodId.slice(0, bar) as LossKind;
    const subject = study.methodId.slice(bar + 1);
    lessons.push(lessonFor(kind, subject, words.get(study.methodId) ?? subject, study, now));
  }
  // A red that repeats across places is the page's own fault; what those places happen to share is beside the point.
  const repeats = repeatLessons(readings, now);
  const pageWide = new Set(repeats.map((l) => l.subject));
  return [...lessons.filter((l) => !(l.kind === "front-end" && pageWide.has(l.subject))), ...repeats].sort((a, b) => LOSS_KINDS.indexOf(a.kind) - LOSS_KINDS.indexOf(b.kind) || a.key.localeCompare(b.key));
}

/** The kinds a set of lessons came from. */
export function lessonKinds(lessons: readonly LossLesson[]): LossKind[] {
  return LOSS_KINDS.filter((k) => lessons.some((l) => l.kind === k));
}

/** Admin's updates for a set of lessons: one per lesson, keyed by its field-manual entry, so Now shows each once. A lesson is learned, not proven. */
export function lossLessonUpdates(lessons: readonly LossLesson[], now: string): NewUpdate[] {
  return lessons.map((l) => ({ id: `lesson:${l.entry.id}`, what: l.says, at: now, label: "TESTING" as const }));
}
