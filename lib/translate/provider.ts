import type { BallotSet } from "../ballot/types.ts";
import { readGenericBallotProjection } from "../ballot/generic-projection.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { readTranslations, withMeasureTranslations } from "./projection-reader.ts";
import { compactMeasureSource, needsMeasureRewrite } from "./source-evidence.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { captureIntact } from "../civic-data/worker-publication-evidence.ts";
import { linkingPageFrom, section3Page } from "../control-plane/promotion/section3.ts";
import { publishTranslation } from "./publication.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { translationHash, translationRecordIssue, translationSourceContains, type MeasureTranslation, type TranslationRecord } from "./records.ts";
import { runHeldMeasureTranslations, type TranslationAttempt } from "./standing.ts";

type HeldInput = Parameters<typeof runHeldMeasureTranslations>[0];
type MeasureWork = { readonly subjectId: string; readonly division: string };

/** Read the same current, promoted state ballot authority used by readers. */
export async function loadPromotedMeasureBallots(state: string, options: Pick<HeldInput, "store" | "now">): Promise<readonly BallotSet[]> {
  const read = await readGenericBallotProjection(state, { ...options });
  if (read.kind !== "PROMOTED") throw new Error(`The held ballot for ${state.toUpperCase()} is ${read.kind}.`);
  return Object.values(read.value.ballots);
}

export function isCheckedMeasureTranslation(ballot: BallotSet, work: MeasureWork, records: readonly TranslationRecord[]): boolean {
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
  readonly vault?: EvidenceStore;
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
      let checked = await readTranslations([...new Set([...work.values()].map(row => row.division))], {
        store: input.store, now: input.now,
      });
      let stateCaptures: readonly WorkerPublicationCapture[] | null = null;
      // Storage maintenance never buys another model call for unchanged source bytes.
      // A stale capture needs a real re-fetch; its writer date remains unchanged.
      const compactionDebt = new Set<string>();
      const legacyDivisions = [...new Set(checked.filter(row => row.kind === "MEASURE" && !row.sourceCapture).map(row => row.ocdId))];
      for (const division of legacyDivisions) {
        const legacy = checked.filter((row): row is MeasureTranslation => row.kind === "MEASURE" && !row.sourceCapture && row.ocdId === division);
        try {
          const heldCaptures: WorkerPublicationCapture[] = legacy.map(row => ({
            evidence: { artifactId: `translation-held:${row.sourceTextHash}`, acquiredByAttemptId: `translation-held:${row.sourceTextHash}`,
              canonicalUrl: row.sourceUrl, sourceId: new URL(row.sourceUrl).hostname, methodRouteId: "held-translation-source",
              retrievedAt: row.retrievedAt, text: row.sourceText, contentHash: `sha256-${row.sourceTextHash}`,
              ...(row.sourceHash !== row.sourceTextHash ? { sourceDocument: { artifactId: `translation-original:${row.sourceHash}`,
                contentHash: `sha256-${row.sourceHash}`, kind: "PDF_TEXT" as const } } : {}) },
            observedAt: row.retrievedAt, partial: false, httpStatus: 200, transport: "REACHABLE" }));
          const admitted = (capture: WorkerPublicationCapture) => section3Page({ url: capture.evidence.canonicalUrl,
            text: capture.evidence.text, retrievedAt: capture.evidence.retrievedAt,
            linkingPage: linkingPageFrom(capture.evidence.canonicalUrl, (stateCaptures ?? []).filter(captureIntact).map(row => row.evidence)),
            sourcePolicy: capture.sourcePolicy }, "BALLOT_MEASURE", input.now).ok;
          if (legacy.some(row => !isOfficialSource(row.sourceUrl)) || heldCaptures.some(capture => !admitted(capture))) {
            stateCaptures ??= await input.loadCapturesForState(state, ballots);
          }
          const compact: MeasureTranslation[] = [], captures: WorkerPublicationCapture[] = [];
          for (const [index, heldRow] of legacy.entries()) {
            let row = heldRow, primary = { ...heldCaptures[index], ...(stateCaptures?.[0]?.sourcePolicy ? { sourcePolicy: stateCaptures[0].sourcePolicy } : {}) };
            if (!admitted(primary)) {
              const fresh = (stateCaptures ?? []).filter(capture => captureIntact(capture) && capture.evidence.canonicalUrl === row.sourceUrl &&
                (capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash) === `sha256-${row.sourceHash}` &&
                row.sentences.every(sentence => translationSourceContains(capture.evidence.text, sentence.quote)) &&
                (!row.subjectQuote || translationSourceContains(capture.evidence.text, row.subjectQuote)) && admitted(capture))
                .sort((a, b) => Date.parse(b.evidence.retrievedAt) - Date.parse(a.evidence.retrievedAt))[0];
              if (!fresh) throw new Error("Compacting this source needs a current, complete capture of the same official document.");
              primary = fresh;
              row = { ...row, sourceText: fresh.evidence.text, sourceTextHash: translationHash(fresh.evidence.text), retrievedAt: fresh.evidence.retrievedAt };
            }
            compact.push(await compactMeasureSource(row, { vault: input.vault, evidence: primary.evidence }));
            captures.push(primary);
          }
          const published = await publishTranslation(input.store, { record: compact[0], additionalRecords: compact.slice(1), now: input.now,
            captures: [...captures, ...(stateCaptures ?? [])] });
          if (!published.promoted || published.readerReadback?.status !== "PASS") throw new Error(published.candidate.failureDetail ?? "The compact explanations did not reach their reader.");
          const byId = new Map(compact.map(row => [row.id, row]));
          checked = checked.map(row => row.ocdId === division ? byId.get(row.id) ?? row : row);
        } catch (error) {
          for (const row of legacy) compactionDebt.add(JSON.stringify([row.ocdId, row.subjectId]));
          held.push(...legacy.map(row => ({ state, subjectId: row.subjectId, reason: sanitizedErrorDiagnostic(error) })));
        }
      }
      const missing = [...work.values()].filter(row => compactionDebt.has(JSON.stringify([row.division, row.subjectId])) || !ballots.some(ballot =>
        ballot.contests.some(contest => contest.id === row.subjectId && contest.ocdId === row.division) && isCheckedMeasureTranslation(ballot, row, checked)) ||
        checked.some(held => held.kind === "MEASURE" && held.subjectId === row.subjectId && held.ocdId === row.division && needsMeasureRewrite(held)));
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
        stateCaptures ?? input.loadCapturesForState(state, ballots), input.readAttemptsForState(state),
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
                divisions: [row.division], captures, attempts, held: checked,
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
