import { measureReference } from "./helpers/measure-reference.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "./helpers/playbooks.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import type { ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { translationHash } from "../lib/translate/records.ts";
import { runHeldMeasureTranslations, type TranslationAttempt } from "../lib/translate/standing.ts";

const now = "2026-10-05T18:00:00Z", division = "ocd-division/country:us/state:oh/county:alder";
const text = "Proposition 12. The levy funds library services. A YES vote adopts the levy. A NO vote keeps the current levy.";
const rawCapture: WorkerPublicationCapture = { evidence: { artifactId: "official", acquiredByAttemptId: "held", sourceId: "Fixture election authority",
  methodRouteId: "official-text", canonicalUrl: "https://elections.example.gov/proposition12", text,
  contentHash: `sha256-${translationHash(text)}`, retrievedAt: now }, observedAt: now, partial: false, httpStatus: 200, transport: "REACHABLE" };
const capture: WorkerPublicationCapture = { ...rawCapture, sourceReference: measureReference(rawCapture.evidence) };
const measure = { contestId: "measure:12", whatItDoes: "The levy funds library services.", yesMeans: "A YES vote adopts the levy.",
  noMeans: "A NO vote keeps the current levy.", parts: [], sourceUrl: capture.evidence.canonicalUrl, sourceHash: translationHash(text), writtenAt: now };
const ballot = { measureRecords: [measure], contests: [{ id: measure.contestId, title: "Proposition 12", type: "MEASURE", ocdId: division }] } as unknown as BallotSet;
const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field, text: measure[field as "whatItDoes"], quote: measure[field as "whatItDoes"] }));
function fixture() {
  const saved: TranslationAttempt[] = [], requests: ModelRequest[] = [];
  let checkerPass = true;
  const input = { repos: createMemoryRepositories(), store: new MemoryRoutineDataStore(), now,
    divisions: [division], ballots: [ballot], captures: [capture], attempts: [] as TranslationAttempt[],
    saveAttempt: async (attempt: TranslationAttempt) => { saved.push(attempt); },
    transportFor: () => async (request: ModelRequest) => {
      requests.push(request);
      const value = request.tools[0].name === "write_measure_translation" ? {
        measure: { ...measure, sourceHash: translationHash(input.captures[0].evidence.text), writtenAt: input.now }, sentences,
      } : { checked: sentences.map(({ field, text }) => ({ field, text, supported: checkerPass })) };
      return { model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "result", name: request.tools[0].name, input: value }],
        usage: { input_tokens: 100, output_tokens: 50 } };
    },
  };
  return { input, saved, requests, failCheck: () => { checkerPass = false; } };
}

test("standing admission writes and independently checks held measures, reuses unchanged bytes and rewrites changed bytes", async () => {
  const f = fixture();
  const first = await runHeldMeasureTranslations(f.input);
  assert.equal(first.outcomes[0].status, "PUBLISHED");
  assert.deepEqual(f.saved.map(row => row.status), ["RUNNING", "PUBLISHED"]);
  assert.equal(first.outcomes[0].usage.length, 2);
  assert.equal(f.requests.length, 2);
  assert.notEqual(f.requests[0].model, f.requests[1].model);
  const reused = await runHeldMeasureTranslations({ ...f.input, attempts: first.outcomes });
  assert.equal(reused.outcomes[0].status, "REUSED");
  assert.equal(f.requests.length, 2, "unchanged source spends nothing");
  assert.deepEqual(reused.outcomes[0].usage, []);
  f.input.now = "2026-10-05T18:01:00Z";
  const changed = `${text} The election office published this revision.`;
  f.input.captures = [{ ...capture, observedAt: f.input.now, evidence: { ...capture.evidence, text: changed,
    contentHash: `sha256-${translationHash(changed)}`, retrievedAt: f.input.now } }];
  f.input.captures[0] = { ...f.input.captures[0], sourceReference: measureReference(f.input.captures[0].evidence) };
  const rewritten = await runHeldMeasureTranslations({ ...f.input, attempts: first.outcomes });
  assert.equal(rewritten.outcomes[0].status, "PUBLISHED");
  assert.notEqual(rewritten.outcomes[0].versionId, first.outcomes[0].versionId);
  assert.equal(f.requests.length, 4);
});

test("a vaulted PDF transcription keeps the held text hash from admission through checked publication", async () => {
  const f = fixture();
  const originalHash = translationHash("%PDF original publisher document");
  const primary: WorkerPublicationCapture = { ...capture, evidence: { ...capture.evidence,
    sourceDocument: { artifactId: "original-pdf", contentHash: `sha256-${originalHash}`, kind: "PDF_TEXT" } } };
  f.input.captures = [primary];
  f.input.ballots = [{ ...ballot, measures: [{ id: measure.contestId, contestId: measure.contestId,
    questionText: "Shall the levy be adopted?", officialStatement: null, officialText: primary.sourceReference,
    provenance: { sourceUrl: capture.evidence.canonicalUrl } as BallotSet["measures"][number]["provenance"] }] }];
  const result = await runHeldMeasureTranslations(f.input);
  assert.deepEqual(result.deferred, []);
  assert.equal(result.outcomes[0].status, "PUBLISHED", result.outcomes[0].detail);
  assert.equal(result.outcomes[0].sourceHash, measure.sourceHash);
  assert.notEqual(result.outcomes[0].sourceHash, originalHash);
  assert.equal(f.requests.length, 2);
});

test("failed checks retain both calls' usage and wait for the existing retry before spending again", async () => {
  const f = fixture(); f.failCheck();
  const failed = await runHeldMeasureTranslations(f.input);
  assert.equal(failed.outcomes[0].status, "HELD");
  assert.equal(failed.outcomes[0].usage.length, 2);
  const waiting = await runHeldMeasureTranslations({ ...f.input, attempts: failed.outcomes, now: "2026-10-05T18:14:59Z" });
  assert.equal(waiting.outcomes.length, 0); assert.equal(waiting.deferred.length, 1); assert.equal(f.requests.length, 2);
  f.input.now = "2026-10-05T18:15:00Z";
  await runHeldMeasureTranslations({ ...f.input, attempts: failed.outcomes });
  assert.equal(f.requests.length, 4);
});

test("admission never pays for another district, a partial capture, conflicting bytes or unmapped legacy reaction parts", async () => {
  for (const kind of ["district", "partial", "conflict", "legacy", "ballot-conflict"]) {
    const f = fixture();
    if (kind === "district") f.input.divisions = ["ocd-division/country:us/state:oh/county:birch"];
    if (kind === "partial") f.input.captures = [{ ...capture, partial: true }];
    if (kind === "conflict") f.input.captures.push({ ...capture, evidence: { ...capture.evidence, retrievedAt: "2026-10-05T18:00:00.000Z",
      text: `${text} Conflicting revision.`, contentHash: `sha256-${translationHash(`${text} Conflicting revision.`)}` } });
    if (kind === "legacy") f.input.ballots = [{ ...ballot, measureRecords: [{ ...measure,
      parts: [{ id: "legacy-reaction", number: null, kind: "FUNDING", label: "Funding", what: measure.whatItDoes }] }] }];
    if (kind === "ballot-conflict") f.input.ballots.push({ ...ballot, measureRecords: [{ ...measure, noMeans: "Different held meaning." }] });
    const result = await runHeldMeasureTranslations(f.input);
    assert.equal(result.outcomes.length, 0, kind); assert.equal(f.requests.length, 0, kind);
  }
  const f = fixture();
  await assert.rejects(runHeldMeasureTranslations({ ...f.input, divisions: [division, "ocd-division/country:us/state:mi"] }), /one admitted state/);
  assert.equal(f.requests.length, 0);
});

test("a durable attempt must exist before spending; final persistence failure returns charges and stops the batch", async () => {
  const f = fixture();
  await assert.rejects(runHeldMeasureTranslations({ ...f.input, saveAttempt: async () => { throw new Error("attempt store unavailable"); } }), /attempt store unavailable/);
  assert.equal(f.requests.length, 0);
  const result = await runHeldMeasureTranslations({ ...f.input, saveAttempt: async row => {
    if (row.status !== "RUNNING") throw new Error("finished attempt not saved");
  } });
  assert.equal(result.persistenceError, "finished attempt not saved");
  assert.equal(result.outcomes[0].usage.length, 2);
  assert.equal(result.outcomes[0].status, "PUBLISHED");
});
