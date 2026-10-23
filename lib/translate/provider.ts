import type { BallotSet } from "../ballot/types.ts";
import { readGenericBallotProjection } from "../ballot/generic-projection.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { readTranslations, withMeasureTranslations } from "./projection-reader.ts";
import { translationRecordIssue, type TranslationRecord } from "./records.ts";
import { runHeldMeasureTranslations, type TranslationAttempt } from "./standing.ts";

type HeldInput = Parameters<typeof runHeldMeasureTranslations>[0];
type MeasureWork = { readonly subjectId: string; readonly division: string };

/** Read the same current, promoted state ballot authority used by readers. */
export async function loadPromotedMeasureBallots(state: string, options: Pick<HeldInput, "store" | "now">): Promise<readonly BallotSet[]> {
  const read = await readGenericBallotProjection(state, { ...options, bypassCache: true });
  if (read.kind !== "PROMOTED") throw new Error(`The held ballot for ${state.toUpperCase()} is ${read.kind}.`);
  return Object.values(read.value.ballots);
}

function isChecked(ballot: BallotSet, work: MeasureWork, records: readonly TranslationRecord[]): boolean {
  return records.some(row => {
    if (row.kind !== "MEASURE" || row.subjectId !== work.subjectId || row.ocdId !== work.division || translationRecordIssue(row)) return false;
    const attached = withMeasureTranslations(ballot, [row]).measureRecords?.find(record => record.contestId === work.subjectId);
    return attached?.sourceHash === row.sourceHash && attached.sourceUrl === row.sourceUrl && attached.writtenAt === row.writtenAt &&
      attached.whatItDoes === row.measure.whatItDoes && attached.yesMeans === row.measure.yesMeans && attached.noMeans === row.measure.noMeans;
  });
}

export interface MeasureTranslationProviderInput extends Pick<HeldInput, "repos" | "store" | "now" | "saveAttempt"> {
  /** The runner passes its current state, or a sequence processed one state at a time. */
  readonly states: readonly string[];
  readonly modelLaneEnabled: boolean | null;
  readonly modelLaneReason?: string | null;
  /** Existing paid-worker capacity, re-read before admissions; this is never a dollar cap. */
  readonly paidWorkerCapacity: () => number;
  /** Both writer and checker must use the runner's existing paid-work guards. */
  readonly guardedTransportFor: HeldInput["transportFor"];
  readonly loadBallotsForState?: (state: string) => Promise<readonly BallotSet[]>;
  readonly loadCapturesForState: (state: string, ballots: readonly BallotSet[]) => Promise<readonly WorkerPublicationCapture[]>;
  readonly readAttemptsForState: (state: string) => Promise<readonly TranslationAttempt[]>;
  /** Pages found for measures whose cited pages never name them, by contest. */
  readonly foundSources?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Standing work for every missing checked explainer, including hand-written
 * summaries whose vote meanings or independent checks are still missing.
 * State source bytes leave scope before the next state's inputs are loaded.
 */
export async function runMeasureTranslationPass(input: MeasureTranslationProviderInput) {
  if (!Number.isFinite(Date.parse(input.now))) throw new Error("Measure translation scheduling requires a clock.");
  const states = [...new Set(input.states.map(state => state.toUpperCase()))];
  if (states.some(state => !/^[A-Z]{2}$/.test(state))) throw new Error("Measure translation scheduling requires state codes.");
  const outcomes: TranslationAttempt[] = [];
  const held: { state: string; subjectId: string; reason: string }[] = [];
  const unreadable: { state: string; reason: string }[] = [];
  let totalMeasures = 0, checkedBefore = 0, checkedAfter = 0;
  let persistenceError: string | null = null;
  for (const state of states) {
    try {
      const ballots = await (input.loadBallotsForState?.(state) ?? loadPromotedMeasureBallots(state, input));
      const work = new Map<string, MeasureWork>();
      for (const ballot of ballots) {
        if (ballot.election.state.toUpperCase() !== state || ballot.contests.some(contest => jurisdictionFromOcdId(contest.ocdId)?.usps !== state))
          throw new Error("The held ballot contains records outside its scheduled state.");
        for (const contest of ballot.contests.filter(row => row.type === "MEASURE")) {
          work.set(JSON.stringify([contest.ocdId, contest.id]), { subjectId: contest.id, division: contest.ocdId });
        }
      }
      const checked = await readTranslations([...new Set([...work.values()].map(row => row.division))], {
        store: input.store, now: input.now, bypassCache: true,
      });
      const missing = [...work.values()].filter(row => !ballots.some(ballot =>
        ballot.contests.some(contest => contest.id === row.subjectId && contest.ocdId === row.division) && isChecked(ballot, row, checked)));
      totalMeasures += work.size;
      checkedBefore += work.size - missing.length;
      checkedAfter += work.size - missing.length;
      const laneHold = input.modelLaneEnabled === true ? null : input.modelLaneReason?.trim() ||
        (input.modelLaneEnabled === false ? "The paid model lane is closed." : "The paid model lane could not be read.");
      if (laneHold || persistenceError) {
        held.push(...missing.map(row => ({ state, subjectId: row.subjectId, reason: persistenceError ?? laneHold! })));
        continue;
      }
      if (!missing.length) continue;
      // Source and retry reads stay free. Failure to read either never starts a paid call.
      const [captures, attempts] = await Promise.all([
        input.loadCapturesForState(state, ballots), input.readAttemptsForState(state),
      ]);
      let cursor = 0;
      const active = new Set<Promise<void>>();
      while (cursor < missing.length || active.size) {
        const capacity = input.paidWorkerCapacity();
        if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error("The existing paid-worker capacity could not be read.");
        while (!persistenceError && cursor < missing.length && active.size < capacity) {
          const row = missing[cursor++];
          const run = (async () => {
            try {
              const result = await runHeldMeasureTranslations({ ...input, transportFor: input.guardedTransportFor,
                divisions: [row.division], captures, attempts,
                ballots: ballots.map(ballot => ({ ...ballot, contests: ballot.contests.filter(contest =>
                  contest.id === row.subjectId && contest.ocdId === row.division) })),
              });
              outcomes.push(...result.outcomes);
              held.push(...result.deferred.map(entry => ({ state, ...entry })));
              for (const outcome of result.outcomes) {
                if (outcome.status === "PUBLISHED" || outcome.status === "REUSED") checkedAfter++;
                else held.push({ state, subjectId: outcome.subjectId, reason: outcome.detail ?? "The explainer is held for source checking." });
              }
              if (result.persistenceError) persistenceError = result.persistenceError;
            } catch (error) {
              persistenceError = sanitizedErrorDiagnostic(error);
              held.push({ state, subjectId: row.subjectId, reason: persistenceError });
            }
          })();
          active.add(run);
          void run.finally(() => active.delete(run));
        }
        if (active.size) await Promise.race(active);
        else if (cursor < missing.length) {
          const reason = persistenceError ?? "The existing paid-worker capacity is closed.";
          held.push(...missing.slice(cursor).map(row => ({ state, subjectId: row.subjectId, reason })));
          break;
        }
      }
    } catch (error) {
      unreadable.push({ state, reason: sanitizedErrorDiagnostic(error) });
    }
  }
  return { totalMeasures, checkedBefore, checkedAfter, outcomes, held, unreadable, persistenceError };
}
