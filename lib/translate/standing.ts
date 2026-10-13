import type { BallotSet } from "../ballot/types.ts";
import { PLAIN_ENGLISH_TRANSLATION_ROUTINE } from "../civic-data/contracts.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { captureIntact } from "../civic-data/worker-publication-evidence.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { linkingPageFrom, section3Page } from "../control-plane/promotion/section3.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { translationHash, translationScope } from "./records.ts";
import { runMeasureTranslation } from "./runtime.ts";
import { runTextTranslation } from "./text-runtime.ts";

type TranslationInput = Parameters<typeof runMeasureTranslation>[0];
type TranslationResult = Awaited<ReturnType<typeof runMeasureTranslation>>;
export interface TranslationAttempt {
  readonly id: string;
  readonly scope: string;
  readonly subjectId: string;
  readonly sourceHash: string;
  readonly sourceTextHash: string;
  readonly at: string;
  readonly status: "RUNNING" | TranslationResult["status"];
  readonly usage: TranslationResult["usage"];
  readonly versionId: string | null;
  readonly detail?: string;
}

/** The parent leased worker names source-backed subjects; no global document sweep. */
export async function runHeldTextTranslations(input: Pick<Parameters<typeof runTextTranslation>[0], "repos" | "store" | "transportFor" | "now"> & {
  readonly divisions: readonly string[];
  readonly subjects: readonly { readonly subject: Parameters<typeof runTextTranslation>[0]["subject"]; readonly sourceUrl: string; readonly preservedText?: Parameters<typeof runTextTranslation>[0]["preservedText"] }[];
  readonly captures: readonly WorkerPublicationCapture[];
  readonly attempts: readonly TranslationAttempt[];
  readonly saveAttempt: (attempt: TranslationAttempt) => Promise<void>;
}) {
  const now = Date.parse(input.now), divisions = new Set(input.divisions);
  const states = new Set([...divisions].map(division => jurisdictionFromOcdId(division)?.usps));
  if (!Number.isFinite(now) || states.size !== 1 || states.has(undefined)) throw new Error("Text translation admission must name one state and a clock.");
  const pages = input.captures.filter(captureIntact), seen = new Set<string>();
  const outcomes: TranslationAttempt[] = [], deferred: { subjectId: string; reason: string }[] = [];
  for (const entry of input.subjects) {
    const { subject, sourceUrl, preservedText } = entry;
    if (!divisions.has(subject.ocdId)) continue;
    const scope = translationScope(subject.ocdId), key = JSON.stringify([scope, subject.subjectId]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (input.subjects.some(other => other.subject.subjectId === subject.subjectId && other.subject.ocdId === subject.ocdId &&
        JSON.stringify(other) !== JSON.stringify(entry))) {
      deferred.push({ subjectId: subject.subjectId, reason: "Held text subjects disagree." }); continue;
    }
    const candidates = pages.filter(row => row.evidence.canonicalUrl === sourceUrl && row.evidence.text.includes(subject.label))
      .sort((a, b) => Date.parse(b.evidence.retrievedAt) - Date.parse(a.evidence.retrievedAt));
    const primary = candidates[0];
    if (!primary || candidates.some(row => Date.parse(row.evidence.retrievedAt) === Date.parse(primary.evidence.retrievedAt) &&
        (row.evidence.contentHash !== primary.evidence.contentHash || row.evidence.sourceDocument?.contentHash !== primary.evidence.sourceDocument?.contentHash))) {
      deferred.push({ subjectId: subject.subjectId, reason: "No unique complete source capture." }); continue;
    }
    const sourceHash = (primary.evidence.sourceDocument?.contentHash ?? primary.evidence.contentHash).replace(/^sha256-/, "");
    const sourceTextHash = translationHash(primary.evidence.text);
    const matching = input.attempts.filter(row => row.scope === scope && row.subjectId === subject.subjectId &&
      row.sourceHash === sourceHash && row.sourceTextHash === sourceTextHash);
    if (matching.some(row => !Number.isFinite(Date.parse(row.at)))) {
      deferred.push({ subjectId: subject.subjectId, reason: "The existing attempt's retry clock is unreadable." }); continue;
    }
    const last = matching.reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    if (last && ["RUNNING", "HELD"].includes(last.status) && now - Date.parse(last.at) < PLAIN_ENGLISH_TRANSLATION_ROUTINE.retryAfterMs) {
      deferred.push({ subjectId: subject.subjectId, reason: "The existing attempt is running or its retry is not due." }); continue;
    }
    // Source admission precedes the attempt and both paid calls.
    const admitted = section3Page({ url: sourceUrl, text: primary.evidence.text, retrievedAt: primary.evidence.retrievedAt,
      linkingPage: linkingPageFrom(sourceUrl, pages.map(row => row.evidence)), sourcePolicy: primary.sourcePolicy },
    subject.kind === "AGENDA" || subject.kind === "MINUTES" ? "MEETING" : "OFFICIAL_BOARD_DIRECTORY", input.now);
    if (!admitted.ok) { deferred.push({ subjectId: subject.subjectId, reason: admitted.reason ?? "Source admission failed." }); continue; }
    const attempt: TranslationAttempt = { id: `translation:${translationHash(JSON.stringify([scope, subject.subjectId, sourceHash, sourceTextHash, input.now]))}`,
      scope, subjectId: subject.subjectId, sourceHash, sourceTextHash, at: input.now, status: "RUNNING", usage: [], versionId: null };
    await input.saveAttempt(attempt);
    const result = await runTextTranslation({ ...input, subject, preservedText, primary, captures: pages });
    const finished: TranslationAttempt = { ...attempt, status: result.status, usage: result.usage, versionId: result.versionId,
      ...("detail" in result ? { detail: result.detail } : {}) };
    outcomes.push(finished);
    try { await input.saveAttempt(finished); }
    catch (error) { return { outcomes, deferred, persistenceError: sanitizedErrorDiagnostic(error) }; }
  }
  return { outcomes, deferred, persistenceError: null };
}

/**
 * A leased standing worker calls this with its admitted place's held inputs and
 * guarded transport. Attempts use that worker's existing durable attempt
 * repository; this creates no separate clock, spend guard or production table.
 */
export async function runHeldMeasureTranslations(input: Pick<TranslationInput, "repos" | "store" | "transportFor" | "now"> & {
  readonly divisions: readonly string[];
  readonly ballots: readonly BallotSet[];
  readonly captures: readonly WorkerPublicationCapture[];
  readonly attempts: readonly TranslationAttempt[];
  readonly saveAttempt: (attempt: TranslationAttempt) => Promise<void>;
}) {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error("Translation admission requires a clock.");
  const divisions = new Set(input.divisions);
  const states = new Set([...divisions].map(division => jurisdictionFromOcdId(division)?.usps));
  if (states.size !== 1 || states.has(undefined)) throw new Error("Translation admission must stay inside one admitted state.");
  const seen = new Set<string>();
  const outcomes: TranslationAttempt[] = [];
  const deferred: { readonly subjectId: string; readonly reason: string }[] = [];
  const pages = input.captures.filter(captureIntact);
  for (const ballot of input.ballots) {
    for (const measure of ballot.measureRecords ?? []) {
      const contest = ballot.contests.find(row => row.id === measure.contestId && row.type === "MEASURE");
      if (!contest || !divisions.has(contest.ocdId)) continue;
      const scope = translationScope(contest.ocdId);
      const key = JSON.stringify([scope, contest.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      const duplicates = input.ballots.flatMap(row => (row.measureRecords ?? []).filter(record => record.contestId === contest.id &&
        row.contests.some(entry => entry.id === contest.id && entry.ocdId === contest.ocdId && entry.type === "MEASURE")));
      if (duplicates.some(record => JSON.stringify(record) !== JSON.stringify(measure))) {
        deferred.push({ subjectId: contest.id, reason: "Held measure records disagree." }); continue;
      }
      if (measure.parts.some(part => !part.number)) {
        deferred.push({ subjectId: contest.id, reason: "Legacy reaction parts need their source-backed migration before rewriting." }); continue;
      }
      const candidates = pages.filter(capture => capture.evidence.canonicalUrl === measure.sourceUrl &&
        capture.evidence.text.includes(contest.title) && ((capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash).replace(/^sha256-/, "") === measure.sourceHash ||
          Date.parse(capture.evidence.retrievedAt) >= Date.parse(measure.writtenAt)))
        .sort((a, b) => Date.parse(b.evidence.retrievedAt) - Date.parse(a.evidence.retrievedAt));
      const primary = candidates[0];
      if (!primary) { deferred.push({ subjectId: contest.id, reason: "No complete current source capture is held." }); continue; }
      const sourceHash = (primary.evidence.sourceDocument?.contentHash ?? primary.evidence.contentHash).replace(/^sha256-/, "");
      const sourceTextHash = translationHash(primary.evidence.text);
      const sameTime = candidates.filter(capture => Date.parse(capture.evidence.retrievedAt) === Date.parse(primary.evidence.retrievedAt));
      if (sameTime.some(capture => translationHash(capture.evidence.text) !== sourceTextHash ||
          (capture.evidence.sourceDocument?.contentHash ?? capture.evidence.contentHash).replace(/^sha256-/, "") !== sourceHash)) {
        deferred.push({ subjectId: contest.id, reason: "Current source captures disagree." }); continue;
      }
      const page = section3Page({ url: primary.evidence.canonicalUrl, text: primary.evidence.text,
        retrievedAt: primary.evidence.retrievedAt, linkingPage: linkingPageFrom(primary.evidence.canonicalUrl, pages.map(row => row.evidence)), sourcePolicy: primary.sourcePolicy },
      PLAIN_ENGLISH_TRANSLATION_ROUTINE.inputRecordClass, input.now);
      if (!page.ok) { deferred.push({ subjectId: contest.id, reason: page.reason ?? "Source is not yet verified." }); continue; }
      const matchingAttempts = input.attempts.filter(attempt => attempt.scope === scope && attempt.subjectId === contest.id &&
        attempt.sourceHash === sourceHash && attempt.sourceTextHash === sourceTextHash);
      if (matchingAttempts.some(attempt => !Number.isFinite(Date.parse(attempt.at)))) {
        deferred.push({ subjectId: contest.id, reason: "The existing attempt's retry clock is unreadable." }); continue;
      }
      const last = matchingAttempts.reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
      if (last && ["RUNNING", "HELD"].includes(last.status) &&
          nowMs - Date.parse(last.at) < PLAIN_ENGLISH_TRANSLATION_ROUTINE.retryAfterMs) {
        deferred.push({ subjectId: contest.id, reason: "The existing attempt is running or its retry is not due." }); continue;
      }
      const attempt: TranslationAttempt = {
        id: `translation:${translationHash(JSON.stringify([scope, contest.id, sourceHash, sourceTextHash, input.now]))}`,
        scope, subjectId: contest.id, sourceHash, sourceTextHash, at: input.now, status: "RUNNING", usage: [], versionId: null,
      };
      // Refuse to spend if the worker cannot first retain its running attempt.
      await input.saveAttempt(attempt);
      const result = await runMeasureTranslation({ ...input, primary, captures: pages,
        batchPriority: { now: input.now, electionAt: [ballot.election?.date ?? ""] },
        subject: { contestId: contest.id, title: contest.title, ocdId: contest.ocdId,
          state: jurisdictionFromOcdId(contest.ocdId)!.usps, prior: measure } });
      const finished: TranslationAttempt = { ...attempt, status: result.status, usage: result.usage,
        versionId: result.versionId, ...("detail" in result ? { detail: result.detail } : {}) };
      outcomes.push(finished);
      try { await input.saveAttempt(finished); }
      catch (error) {
        // Return charges even when saving fails, and stop before any more paid work.
        return { outcomes, deferred, persistenceError: sanitizedErrorDiagnostic(error) };
      }
    }
  }
  return { outcomes, deferred, persistenceError: null };
}
