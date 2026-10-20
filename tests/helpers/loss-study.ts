import { stateOf, type DoorLike, type WorkItemLike } from "../../lib/method/loss-readings.ts";
import { LOSS_KINDS, lossLessonForStudy, repeatLossLesson, type LossReading, type LossKind, type LossLesson } from "../../lib/method/study-all-losses.ts";
import type { FixMapRow } from "../../lib/method/fix-map.ts";
import { studyLosses, type PlaceTraits } from "../../lib/method/study-losses.ts";

/** Complete fixture reference for the streamed production reducer. */
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
    return repeatLossLesson(subject, v.words, v.places.size, [...v.works].filter((p) => !v.places.has(p)).length, now);
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
    lessons.push(lossLessonForStudy(kind, subject, words.get(study.methodId) ?? subject, study, now));
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


/** The traits we hold for each place: a door's adapter as its platform (when its doors agree), and the state its id or plan names. */
export function placeTraitsFrom(input: { readonly doors: readonly DoorLike[]; readonly items: readonly WorkItemLike[]; readonly places: readonly string[] }): Map<string, PlaceTraits> {
  const out = new Map<string, PlaceTraits>();
  const platforms = new Map<string, Set<string>>();
  for (const d of input.doors) if (d.ocdId) platforms.set(d.ocdId, (platforms.get(d.ocdId) ?? new Set()).add(d.kind.toLowerCase()));
  const planState = new Map<string, string>();
  for (const i of input.items) if (i.autonomousPlan?.jurisdiction && /^[a-z]{2}$/i.test(i.autonomousPlan.jurisdiction)) planState.set(i.subject, i.autonomousPlan.jurisdiction.toLowerCase());
  for (const place of new Set([...input.places, ...platforms.keys()])) {
    const kinds = platforms.get(place);
    const traits: PlaceTraits = {
      ...(kinds && kinds.size === 1 ? { platform: [...kinds][0] } : {}),
      ...((stateOf(place) ?? planState.get(place)) ? { state: stateOf(place) ?? planState.get(place)! } : {}),
    };
    if (Object.keys(traits).length) out.set(place, traits);
  }
  return out;
}
