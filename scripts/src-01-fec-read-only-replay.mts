/** Replay one state's production FEC normalized rows through the registered publisher and every money card, in memory. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { civicRecordsFor } from "../lib/civic-data/changes.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { projectFecDiscovery } from "../lib/funding/fec-collector.ts";
import { readFecPages } from "../lib/funding/fec-api.ts";
import { getFundingSnapshot, refreshFundingFromPromoted } from "../lib/funding/snapshot.ts";
import { fundingAnswerForTarget } from "../lib/funding/display.ts";
import { FundingDisplay } from "../components/funding/funding-section.tsx";
import type { FundingSnapshot } from "../lib/funding/types.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";

const [state, inputPath, outputPath] = process.argv.slice(2);
assert.ok(/^[A-Z]{2}$/.test(state) && inputPath && outputPath, "Pass state, readonly state export, and result path");
const bytes = await readFile(inputPath);
const input = JSON.parse(bytes.toString()) as {
  snapshots: { id: string; retrieved_at: string; retrieval: RoutineCandidate["retrieval"]; snapshot: FundingSnapshot }[];
  directory_version: string; roster: OfficeholderSet;
};
const failed = input.snapshots.find(row => row.id === "cv-5557822ce8f71240a9df9554d31a1a95")!;
const prior = input.snapshots.find(row => row.id === "cv-e65b24eba8737733c2a1ea1bac7e5a7e")!;
assert.ok(failed && prior && input.directory_version && input.roster);
assert.ok(failed.snapshot.candidates.length > 0);
assert.ok([...failed.snapshot.candidates, ...prior.snapshot.candidates].every(row => row.state === state));
const missing = prior.snapshot.candidates.filter(row => !failed.snapshot.candidates.some(next => next.fecCandidateId === row.fecCandidateId));

// Native registration/totals fields reconstructed from normalized production rows.
// This makes no archived HTTP-byte or new provider-observation claim.
const discovery = {
  route: "api" as const,
  registrations: failed.snapshot.candidates.map(row => ({
    candidateId: row.fecCandidateId, name: row.name, state: row.state, office: row.office, district: row.district,
    electionYear: row.registration!.electionYear, principalCommitteeId: row.principalCommitteeId,
    observedAt: row.registration!.collectedAt,
  })),
  totals: (await Promise.all(failed.snapshot.candidates.filter(row =>
    [row.totals.receipts, row.totals.disbursements, row.totals.cashOnHand].some(amount => amount !== null)).map(row =>
    readFecPages(async () => ({ results: [{
      candidate_id: row.fecCandidateId, cycle: row.cycle, receipts: row.totals.receipts,
      disbursements: row.totals.disbursements, last_cash_on_hand_end_period: row.totals.cashOnHand,
      coverage_end_date: row.totals.coverageEndDate,
    }], pagination: { count: 1, pages: 1 }, sourceObservedAt: row.provenance.collectedAt }), "/candidates/totals/", {})
  ))).flat(),
};
const store = new MemoryRoutineDataStore();
const candidate = (snapshot: FundingSnapshot, retrieval: RoutineCandidate["retrieval"]) => ({
  ...fecFundingCandidate({ snapshot, rawBodies: [], rawHashes: [retrieval.rawHash!], finalUrl: retrieval.finalUrl!,
    retrievedAt: retrieval.retrievedAt, sourceCheck: retrieval.sourceCheck, excludedFacts: [] }), retrieval,
});
const now = Date.now;
const runAt = "2026-10-23T09:00:00.000Z";
Date.now = () => Date.parse(runAt);
const evidence: Record<string, unknown> = {
  state, status: "FAILED", productionWrites: 0, inputSha256: createHash("sha256").update(bytes).digest("hex"),
  sourceCandidate: failed.id, priorCandidate: prior.id, directoryVersion: input.directory_version,
  sourceRecords: failed.snapshot.candidates.length, priorRecords: prior.snapshot.candidates.length,
  directoryPeople: input.roster.officeholders.length,
};
try {
  if (prior.snapshot.candidates.length) {
    const base = await processRegisteredRoutineCandidate(store, "fec-funding", candidate(prior.snapshot, prior.retrieval), prior.retrieved_at);
    assert.ok(base.promoted, JSON.stringify(base.candidate.receipt));
  }
  if (missing.length) {
    const unpatched = await processRegisteredRoutineCandidate(store, "fec-funding", candidate(failed.snapshot, failed.retrieval), runAt);
    assert.equal(unpatched.candidate.failureCode, "INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED");
    evidence.originalFailureReproduced = unpatched.candidate.failureCode;
  }
  const runs: unknown[] = [];
  for (const at of [runAt, "2026-10-24T09:00:00.000Z", "2026-10-30T09:00:00.000Z"]) {
    Date.now = () => Date.parse(at);
    const held = await store.readPromotion<FundingSnapshot>("FEC_FUNDING", "federal-supported");
    const projected = projectFecDiscovery(discovery, failed.snapshot.cycle, input.roster, held?.payload.candidates ?? []);
    for (const row of missing) assert.deepEqual(projected.find(value => value.fecCandidateId === row.fecCandidateId), row);
    for (const source of failed.snapshot.candidates) {
      const row = projected.find(value => value.fecCandidateId === source.fecCandidateId)!;
      for (const field of ["receipts", "disbursements", "cashOnHand", "coverageEndDate"] as const) assert.equal(row.totals[field], source.totals[field]);
      assert.equal(row.provenance.collectedAt, source.provenance.collectedAt);
    }
    const secondHop = [...new Map([...(held?.payload.secondHop ?? []), ...(failed.snapshot.secondHop ?? [])].map(row => [row.committeeId, row])).values()];
    const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", candidate({ ...failed.snapshot, candidates: projected, secondHop }, failed.retrieval), at);
    assert.ok(outcome.promoted, JSON.stringify(outcome.candidate.receipt));
    assert.equal(outcome.candidate.candidate.changeSet?.removed.length, 0);
    const pointer = (await store.readPromotion<FundingSnapshot>("FEC_FUNDING", "federal-supported"))!;
    assert.equal(pointer.versionId, outcome.promoted.versionId);
    assert.equal(pointer.payload.candidates.length, projected.length);
    await refreshFundingFromPromoted({ store, now: at, bypassCache: true });
    const read = getFundingSnapshot();
    assert.equal(read.candidates.length, projected.length);
    const htmlHashes = createHash("sha256"), preserved: unknown[] = [];
    let cards = 0, amountCards = 0, joinedHolderCards = 0;
    for (const row of read.candidates) {
      const answer = fundingAnswerForTarget(`fec:${row.fecCandidateId}`);
      assert.equal(answer.kind, "funding");
      if (answer.kind !== "funding") throw new Error("Missing card");
      assert.equal(answer.data.collectedAt, row.provenance.collectedAt);
      const html = renderToStaticMarkup(createElement(FundingDisplay, { data: answer.data, context: null }));
      assert.ok(html.includes("Campaign money"));
      assert.ok(answer.data.sourceUrl?.startsWith("https://www.fec.gov/"));
      if ([row.totals.receipts, row.totals.disbursements, row.totals.cashOnHand].some(value => value !== null)) amountCards++;
      const congressKey = row.targetKeys.find(key => key.startsWith("congress:"));
      if (congressKey) { assert.equal(fundingAnswerForTarget(congressKey).kind, "funding"); joinedHolderCards++; }
      htmlHashes.update(row.fecCandidateId).update(html); cards++;
      if (missing.some(value => value.fecCandidateId === row.fecCandidateId)) preserved.push({
        id: row.fecCandidateId, personKey: congressKey, receipts: row.totals.receipts, sourceDate: row.provenance.collectedAt,
      });
    }
    runs.push({ at, state: outcome.candidate.state, version: pointer.versionId, confirmed: Boolean(outcome.confirmed),
      publishedRecords: pointer.payload.candidates.length, publishedCommitteeRecords: pointer.payload.secondHop?.length ?? 0,
      publishedCivicRecords: civicRecordsFor("FEC_FUNDING", pointer.payload).length, readerRecords: read.candidates.length,
      cardsRendered: cards, cardsWithAmounts: amountCards, registrationOnlyCards: cards - amountCards, joinedHolderCards,
      removed: 0, readerReadback: outcome.readerReadback?.status ?? "unchanged-version-confirmed", preserved,
      cardHtmlSha256: htmlHashes.digest("hex") });
  }
  const task = routineTaskFromContract(requiredRoutineContract("fec-funding"));
  const clock = { lastAttemptedAt: runAt, lastSucceededAt: runAt, lastSucceededObservedAt: runAt,
    lastSucceededParserVersion: task.parserVersion };
  const tomorrowDue = routineTaskDue(task, clock, Date.parse("2026-10-24T09:00:00.000Z"));
  const nextScheduledDue = routineTaskDue(task, clock, Date.parse("2026-10-30T09:00:00.000Z"));
  assert.equal(tomorrowDue, false); assert.equal(nextScheduledDue, true);
  Object.assign(evidence, { status: "PASS", schedule: { cadenceDays: 7, tomorrowDue, nextScheduledDue,
    tomorrowReplayWasControlled: true }, runs });
} catch (error) {
  evidence.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  Date.now = now;
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ state, status: evidence.status, result: outputPath }));
}
