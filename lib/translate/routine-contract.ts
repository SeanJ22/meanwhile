import type { RoutineSourceTask } from "../civic-data/runner.ts";
import { PLAIN_ENGLISH_TRANSLATION_ROUTINE } from "../civic-data/contracts.ts";
import { REGISTRY_STATES, requireBallotState } from "../civic-data/state-scopes.ts";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import { translationScope } from "./records.ts";

export const measureTranslationRoutineId = (state: string) => `measure-translations:${requireBallotState(state)}`;

export function measureTranslationRoutineTask(state: string): RoutineSourceTask {
  const code = requireBallotState(state);
  const jurisdiction = US_JURISDICTIONS.find(row => row.usps === code);
  if (!jurisdiction) throw new Error(`The translation schedule has no jurisdiction for ${code}.`);
  return {
    id: measureTranslationRoutineId(code),
    sourceId: "curated-reader-primary-sources",
    recordClass: "CURATED_READER_RECORD",
    scope: translationScope(`ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}`),
    acquisitionFailureDomain: `routine-source:measure-translations:${code}`,
    requestedUrl: "",
    authorityMode: "DERIVED",
    parserVersion: "curated-reader-records/2",
    command: ["scripts/measure-translation-routine.mts", `--state=${code}`],
    cadenceMs: PLAIN_ENGLISH_TRANSLATION_ROUTINE.retryAfterMs,
    retryMs: PLAIN_ENGLISH_TRANSLATION_ROUTINE.retryAfterMs,
    childTimeoutMs: 0,
    contract: {
      cadence: {
        description: "Keep every missing measure explainer open on the standing translation retry clock; unchanged checked sources spend nothing",
        defaultEveryMs: PLAIN_ENGLISH_TRANSLATION_ROUTINE.retryAfterMs,
      },
      readerProjection: { id: "plain-english-translations", consumers: ["/ballot", "Ask", "Admin"] },
    },
  };
}

/**
 * The routine supervisor owns these clocks independently of the research cycle.
 * Publication still uses the existing manual translation contract and its
 * source/checker checks; scheduling does not grant routine promotion authority.
 */
export const MEASURE_TRANSLATION_ROUTINE_TASKS: readonly RoutineSourceTask[] = REGISTRY_STATES.map(measureTranslationRoutineTask);
