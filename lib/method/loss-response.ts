/**
 * Lessons from losses. For each method whose failures share a trait: one field-manual lesson, a predicted failure for
 * every untried place with the same traits, and one variant case unless one is open. When the failures share
 * nothing, one item goes to the engineers, once per method. Pure: the caller writes what it is handed.
 */

import { newFieldManualEntry, type FieldManualEntry } from "../control-plane/field-manual.ts";
import type { FixMapRow } from "./fix-map.ts";
import { studyLosses, valuesOf, type LossStudy, type PlaceTraits } from "./study-losses.ts";

export const PREDICTED_FAIL_PREFIX = "PREDICTED_FAIL:";
export const LOSS_LESSON_SOURCE = "loss-study";

export interface VariantCase {
  readonly methodId: string;
  /** The shared traits the variant has to get around, in plain words. */
  readonly sharedCause: string;
  readonly failingPlaceIds: readonly string[];
  /** What the detective is asked to build. */
  readonly brief: string;
}

export interface EngineerItem {
  readonly methodId: string;
  /** Fix-queue `where` and `says`. */
  readonly where: string;
  readonly says: string;
}

export interface LossResponse {
  readonly lessons: readonly FieldManualEntry[];
  readonly predictions: readonly FixMapRow[];
  readonly variantCases: readonly VariantCase[];
  readonly engineerItems: readonly EngineerItem[];
}

export interface LossResponseInput {
  readonly fixMap: readonly FixMapRow[];
  readonly placeTraits: ReadonlyMap<string, PlaceTraits> | Readonly<Record<string, PlaceTraits>>;
  readonly now: string;
  /** Methods that already have an open variant case. */
  readonly openVariantMethodIds?: ReadonlySet<string>;
  readonly engineerMethodIds?: ReadonlySet<string>;
}

function placeIdsOf(traits: LossResponseInput["placeTraits"]): string[] {
  return (traits instanceof Map ? [...traits.keys()] : Object.keys(traits)).sort();
}

function traitsOf(traits: LossResponseInput["placeTraits"], placeId: string): PlaceTraits | undefined {
  return traits instanceof Map ? traits.get(placeId) : (traits as Record<string, PlaceTraits>)[placeId];
}

/** Where a loss lesson applies: the platforms and states its failures share, or, when they share neither, wherever the method is tried. */
function lessonReach(shared: LossStudy["shared"]): Pick<FieldManualEntry, "platforms" | "states" | "portable"> {
  const platforms = shared.flatMap((s) => (s.trait === "platform" ? [s.value] : []));
  const states = shared.flatMap((s) => (s.trait === "state" && /^[a-z]{2}$/.test(s.value) ? [s.value] : []));
  return platforms.length + states.length > 0 ? { platforms, states } : { platforms, states, portable: true };
}

function causeText(study: LossStudy): string {
  return study.shared.map((s) => `${s.trait} (${s.value})`).join("; ");
}

export function respondToLosses(input: LossResponseInput): LossResponse {
  const lessons: FieldManualEntry[] = [];
  const predictions: FixMapRow[] = [];
  const variantCases: VariantCase[] = [];
  const engineerItems: EngineerItem[] = [];
  const places = placeIdsOf(input.placeTraits);
  for (const study of studyLosses(input.fixMap, input.placeTraits)) {
    const rows = input.fixMap.filter((r) => r.methodId === study.methodId);
    const failing = rows.filter((r) => r.state === "FAILS").map((r) => r.placeId).sort();
    if (study.shared.length === 0) {
      if (input.engineerMethodIds?.has(study.methodId)) continue;
      engineerItems.push({
        methodId: study.methodId,
        where: `Method ${study.methodId}`,
        says: `It fails in ${study.failures} places and they share nothing we hold about them. Engineers need to look at why.`,
      });
      continue;
    }
    const cause = causeText(study);
    lessons.push(newFieldManualEntry(LOSS_LESSON_SOURCE, `${study.methodId}|${study.shared.map((s) => `${s.trait}=${s.value}`).join("|")}`, {
      role: "SHARED",
      kind: "LESSON",
      title: `Method ${study.methodId} fails where ${cause}`,
      summary: `Method ${study.methodId} fails where ${cause}; ${study.says}.`.replace(/\s+/g, " ").slice(0, 280),
      outcome: "FAILED",
      observedAt: input.now,
      ...lessonReach(study.shared),
      payload: { methodId: study.methodId, shared: study.shared, failures: study.failures, works: study.works },
    }));
    const known = new Set(rows.filter((r) => r.state !== "UNTRIED").map((r) => r.placeId));
    for (const placeId of places) {
      if (known.has(placeId)) continue;
      const values = valuesOf(traitsOf(input.placeTraits, placeId));
      if (!study.shared.every((s) => values.get(s.trait) === s.value)) continue;
      predictions.push({
        methodId: study.methodId, placeId, state: "UNTRIED", triedAt: null, attemptId: null,
        cause: `${PREDICTED_FAIL_PREFIX} ${cause}`, updatedAt: input.now,
      });
    }
    if (input.openVariantMethodIds?.has(study.methodId)) continue;
    variantCases.push({
      methodId: study.methodId,
      sharedCause: cause,
      failingPlaceIds: failing,
      brief: `Method ${study.methodId} fails in ${study.failures} places that share: ${cause}. Build a variant that works where these are true. It enters Testing as a new method.`,
    });
  }
  return { lessons, predictions, variantCases, engineerItems };
}
