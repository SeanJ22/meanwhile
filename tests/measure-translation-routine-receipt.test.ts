import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { durableRoutineRunnerReceiptIssue, parseRoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { publishTranslation } from "../lib/translate/publication.ts";
import { translationHash, type MeasureTranslation } from "../lib/translate/records.ts";
import { measureTranslationRoutineReceipt } from "../lib/translate/routine-receipt.ts";
import { measureTranslationRoutineTask } from "../lib/translate/routine-contract.ts";

const now = "2026-10-20T18:00:00.000Z", later = "2026-10-20T18:01:00.000Z";
const sourceUrl = "https://elections.example.gov/measures", ocdId = "ocd-division/country:us/state:oh";
const whatItDoes = "The levy funds library services.", yesMeans = "A YES vote adopts the levy.", noMeans = "A NO vote keeps the current levy.";
const text = `Proposition 12. ${whatItDoes} ${yesMeans} ${noMeans}`;

async function publish(store: MemoryRoutineDataStore) {
  const measure = { contestId: "measure:12", whatItDoes, yesMeans, noMeans, parts: [], sourceUrl, sourceHash: translationHash(text), writtenAt: now };
  const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field, text: measure[field as "whatItDoes"], quote: measure[field as "whatItDoes"] }));
  const record: MeasureTranslation = { id: "translation:measure:12", kind: "MEASURE", subjectId: "measure:12", ocdId,
    sourceUrl, sourceHash: translationHash(text), sourceText: text, sourceTextHash: translationHash(text), retrievedAt: now, writtenAt: now,
    writerModel: "writer", checkerModel: "checker", playbookVersion: translationHash("fixture"), measure, sentences,
    checked: sentences.map(({ field, text }) => ({ field, text, supported: true })),
  };
  const result = await publishTranslation(store, { record, now, captures: [{
    evidence: { artifactId: "held", acquiredByAttemptId: "held", sourceId: "Election office", methodRouteId: "measure", canonicalUrl: sourceUrl,
      text, contentHash: `sha256-${translationHash(text)}`, retrievedAt: now },
    observedAt: now, partial: false, httpStatus: 200, transport: "REACHABLE",
  }] });
  assert.ok(result.promoted);
  return result.promoted;
}

test("an unavailable paid lane records a durable held routine outcome even before any explainer exists", async () => {
  const store = new MemoryRoutineDataStore(), task = measureTranslationRoutineTask("OH");
  const result = await measureTranslationRoutineReceipt({ store, state: "OH", now, holdReason: "The paid model lane is closed." });
  assert.equal(result.exitCode, 2);
  assert.equal(result.receipt.state, "SOURCE_BLOCKED");
  assert.equal(result.receipt.acquisitionSucceeded, false);
  assert.equal(result.receipt.promotedVersion, null);
  assert.equal(parseRoutineRunnerReceipt(result.line).ok, true);
  assert.equal(await durableRoutineRunnerReceiptIssue(result.receipt, task, store, "HELD"), null);
  assert.equal(await store.readPromotionIdentity(task.recordClass, task.scope), null);
});

test("a held checker sentence preserves the existing explainer and schedules another attempt", async () => {
  const store = new MemoryRoutineDataStore(), task = measureTranslationRoutineTask("OH");
  const previous = await publish(store);
  const result = await measureTranslationRoutineReceipt({ store, state: "OH", now: later, holdReason: "A sentence failed its independent check." });
  assert.equal(result.exitCode, 2);
  assert.equal(result.receipt.lastKnownGoodVersion, previous.versionId);
  assert.equal((await store.readPromotionIdentity(task.recordClass, task.scope))?.versionId, previous.versionId);
  const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(clock.lastAttemptedAt, later);
});

test("a completed held-source pass confirms the existing exact translation scope without advancing publisher freshness", async () => {
  const store = new MemoryRoutineDataStore(), task = measureTranslationRoutineTask("OH");
  const previous = await publish(store);
  const result = await measureTranslationRoutineReceipt({ store, state: "OH", now: later, holdReason: null });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.receipt.promotedVersion, previous.versionId);
  assert.equal(result.receipt.confirmedAt, later);
  assert.equal((await store.readCandidate(previous.versionId))?.candidate.retrieval.retrievedAt, now);
  assert.equal(await durableRoutineRunnerReceiptIssue(result.receipt, task, store, "SUCCESS"), null);
  const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
  assert.equal(clock.lastSucceededObservedAt, later);
});

test("a successful local pass cannot claim the statewide routine scope without a checked statewide record", async () => {
  const result = await measureTranslationRoutineReceipt({ store: new MemoryRoutineDataStore(), state: "OH", now, holdReason: null });
  assert.equal(result.exitCode, 2);
  assert.match(result.holdReason!, /No checked statewide explainer/);
  assert.equal(result.receipt.state, "SOURCE_BLOCKED");
});
