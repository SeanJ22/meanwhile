/** Replay AZ's production FEC normalized snapshots in memory; never opens a database write handle. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { projectFecDiscovery } from "../lib/funding/fec-collector.ts";
import { refreshFundingFromPromoted } from "../lib/funding/snapshot.ts";
import { fundingAnswerForTarget } from "../lib/funding/display.ts";
import { FundingDisplay } from "../components/funding/funding-section.tsx";
import type { FundingSnapshot } from "../lib/funding/types.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";

const [inputPath, rosterPath, outputPath] = process.argv.slice(2);
assert.ok(inputPath && rosterPath && outputPath, "Pass the readonly AZ snapshot export, readonly AZ directory export, and result path");
const input = await readFile(inputPath), rosterInput = await readFile(rosterPath);
const rows = JSON.parse(input.toString()) as { id: string; retrieved_at: string; retrieval: RoutineCandidate["retrieval"]; snapshot: FundingSnapshot }[];
const rosterRows = JSON.parse(rosterInput.toString()) as { current_version_id: string; roster: OfficeholderSet }[];
const failed = rows.find(row => row.id === "cv-5557822ce8f71240a9df9554d31a1a95")!;
const prior = rows.find(row => row.id === "cv-e65b24eba8737733c2a1ea1bac7e5a7e")!;
assert.equal(failed.snapshot.candidates.length, 90);
assert.equal(prior.snapshot.candidates.length, 8);
assert.equal(rosterRows[0].roster.officeholders.length, 11);
const missing = prior.snapshot.candidates.filter(row => !failed.snapshot.candidates.some(next => next.fecCandidateId === row.fecCandidateId));
assert.deepEqual(missing.map(row => row.fecCandidateId).sort(), ["S0AZ00350", "S4AZ00139"]);

// Production normalized rows reconstruct their native registration/totals fields.
// This is a projection replay, not a claim to replay archived HTTP bytes.
const discovery = {
  route: "api" as const,
  registrations: failed.snapshot.candidates.map(row => ({
    candidateId: row.fecCandidateId, name: row.name, state: row.state, office: row.office, district: row.district,
    electionYear: row.registration!.electionYear, principalCommitteeId: row.principalCommitteeId,
    observedAt: row.registration!.collectedAt,
  })),
  totals: failed.snapshot.candidates.filter(row => row.totals.receipts !== null).map(row => ({
    candidate_id: row.fecCandidateId, cycle: row.cycle, receipts: row.totals.receipts,
    disbursements: row.totals.disbursements, last_cash_on_hand_end_period: row.totals.cashOnHand,
    coverage_end_date: row.totals.coverageEndDate,
  })),
};
const store = new MemoryRoutineDataStore();
const candidate = (snapshot: FundingSnapshot, retrieval: RoutineCandidate["retrieval"]) => ({
  ...fecFundingCandidate({ snapshot, rawBodies: [], rawHashes: [retrieval.rawHash!], finalUrl: retrieval.finalUrl!,
    retrievedAt: retrieval.retrievedAt, sourceCheck: retrieval.sourceCheck, excludedFacts: [] }), retrieval,
});
const now = Date.now;
const runAt = "2026-10-23T09:00:00.000Z";
Date.now = () => Date.parse(runAt);
try {
  const base = await processRegisteredRoutineCandidate(store, "fec-funding", candidate(prior.snapshot, prior.retrieval), prior.retrieved_at);
  assert.ok(base.promoted, JSON.stringify(base.candidate.receipt));
  const unpatched = await processRegisteredRoutineCandidate(store, "fec-funding", candidate(failed.snapshot, failed.retrieval), runAt);
  assert.equal(unpatched.candidate.failureCode, "INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED");

  const runs: unknown[] = [];
  for (const at of [runAt, "2026-10-24T09:00:00.000Z", "2026-10-30T09:00:00.000Z"]) {
    Date.now = () => Date.parse(at);
    const held = (await store.readPromotion<FundingSnapshot>("FEC_FUNDING", "federal-supported"))!;
    const projected = projectFecDiscovery(discovery, failed.snapshot.cycle, rosterRows[0].roster, held.payload.candidates);
    for (const row of missing) assert.deepEqual(projected.find(value => value.fecCandidateId === row.fecCandidateId), row);
    const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", candidate({ ...failed.snapshot, candidates: projected }, failed.retrieval), at);
    assert.ok(outcome.promoted, JSON.stringify(outcome.candidate.receipt));
    assert.equal(outcome.candidate.candidate.changeSet?.removed.length, 0);
    await refreshFundingFromPromoted({ store, now: at, bypassCache: true });
    const cards = missing.map(row => {
      const answer = fundingAnswerForTarget(row.targetKeys[0]);
      assert.equal(answer.kind, "funding");
      if (answer.kind !== "funding") throw new Error("Missing card");
      assert.equal(answer.data.totals!.receipts, row.totals.receipts);
      assert.equal(answer.data.collectedAt, row.provenance.collectedAt);
      const html = renderToStaticMarkup(createElement(FundingDisplay, { data: answer.data, context: null }));
      assert.ok(html.includes("Campaign money"));
      assert.ok(html.includes("This campaign has raised"));
      return { id: row.fecCandidateId, personKey: row.targetKeys[0], receipts: answer.data.totals!.receipts,
        sourceDate: answer.data.collectedAt, sentences: answer.data.sentences, htmlSha256: createHash("sha256").update(html).digest("hex") };
    });
    runs.push({ at, state: outcome.candidate.state, version: outcome.promoted.versionId, confirmed: Boolean(outcome.confirmed),
      records: projected.length, removed: 0, readerReadback: outcome.readerReadback?.status ?? "unchanged-version-confirmed", cards });
  }
  const task = routineTaskFromContract(requiredRoutineContract("fec-funding"));
  const clock = { lastAttemptedAt: runAt, lastSucceededAt: runAt, lastSucceededObservedAt: runAt,
    lastSucceededParserVersion: task.parserVersion };
  const tomorrowDue = routineTaskDue(task, clock, Date.parse("2026-10-24T09:00:00.000Z"));
  const nextScheduledDue = routineTaskDue(task, clock, Date.parse("2026-10-30T09:00:00.000Z"));
  assert.equal(tomorrowDue, false); assert.equal(nextScheduledDue, true);
  const evidence = {
    kind: "production-read-only-normalized-projection-replay", productionWrites: 0,
    scope: "AZ sample; national candidate source metadata retained; second-hop rows omitted from export",
    limitation: "No archived FEC HTTP body replay or live deployment claim. Future source checks are not fabricated; stored source observations retain their production dates.",
    inputs: { failedCandidate: failed.id, priorCandidate: prior.id, directoryVersion: rosterRows[0].current_version_id,
      snapshotsSha256: createHash("sha256").update(input).digest("hex"), rosterSha256: createHash("sha256").update(rosterInput).digest("hex") },
    upstream: "FEC current-election registrations and filed totals, plus exact native FEC IDs from the production Congressional directory",
    downstream: "fecFundingCandidate → registered routine publisher → readFundingSnapshot → fundingAnswerForTarget → FundingDisplay",
    originalFailureReproduced: unpatched.candidate.failureCode,
    schedule: { cadenceDays: 7, tomorrowDue, nextScheduledDue, tomorrowReplayWasControlled: true }, runs,
  };
  await writeFile(outputPath, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ status: "PASS", result: outputPath, runs: runs.length, tomorrowDue, nextScheduledDue }));
} finally { Date.now = now; }
