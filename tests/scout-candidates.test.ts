/**
 * **MODELS HANDLE NOVELTY; CODE HANDLES LEARNED PROCEDURE — THE GRADUATION PATH.**
 * (Level 1 activation, 2026-09-01. RULING 240.)
 *
 * A Scout's route candidate must be able to enter the EXISTING method-candidate
 * lifecycle, be validated by the canonical validators, and — the moment it
 * works once (DP-25) — be selected for DETERMINISTIC replay by the executor
 * decision rule, so no later worker pays a model to rediscover it. Two
 * Attempts offering the same route id are no longer proof of anything.
 *
 *   1  an opened, evidence-backed candidate is admitted on its first Attempt
 *   2  a candidate whose URL the Attempt never opened is NOT proposed
 *   3  a malformed proposal lands REJECTED with the exact issue, durably
 *   4  after admission the decision rule selects deterministic replay
 */

import assert from "node:assert/strict";
import test from "node:test";

import { emptyCandidateStore } from "../lib/method/candidate.ts";
import { readMethodKnowledge, readMethodVersion } from "../lib/method/manual-bridge.ts";
import { readFieldManual, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { methodMaturityFromManual } from "../lib/control-plane/scheduler/maturity.ts";
import { decideExecutor } from "../lib/control-plane/scheduler/dispatch.ts";
import {
  METHOD_CANDIDATE_STORE_ID,
  candidateStoreCounts,
  learnedRouteFrom,
  proposeScoutCandidates,
  readMethodCandidateStore,
} from "../lib/control-plane/scheduler/scout-candidates.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ScoutCandidate, ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { knowledgeEntries, methodFixture, methodVersionEntry } from "./method-store-fixture.ts";

const STAMP = "2026-09-01";

/** Memory repositories whose field manual holds the frozen method store: the one store the proposal check reads. */
async function seededRepos(): Promise<ReturnType<typeof createMemoryRepositories>> {
  const repos = createMemoryRepositories();
  const store = methodFixture();
  await writeFieldManual(repos, [...knowledgeEntries(store), methodVersionEntry(store)], STAMP);
  return repos;
}

const candidate = (over: Partial<ScoutCandidate> = {}): ScoutCandidate => ({
  routeId: "testville-meetings-ics",
  title: "Testville meetings .ics feed",
  url: "https://testville.gov/meetings.ics",
  procedure: "GET the .ics feed",
  relevance: "linked from the meetings page",
  permission: "ALLOWED",
  permissionReading: "robots.txt allows /",
  evidenceArtifactIds: ["raw-1"],
  observedOn: STAMP,
  recordClass: "meetings",
  deterministic: true,
  unverified: [],
  /* RULING 243: the executor writes these before a candidate reaches this module. */
  claims: { observedOn: "2026-01-01", permission: "ALLOWED", recordClass: "meetings" },
  provenance: { derivedFrom: ["raw-1"], rule: "test derivation" },
  ...over,
});

const result = (candidates: ScoutCandidate[]): ScoutResult => ({
  formatVersion: 1,
  attemptId: "att-test-1",
  obligationId: "freshness:test:scout#novel",
  routeTaskId: "rt-1",
  workItemId: "wi-1",
  subjectId: "ocd-division/country:us/state:az/place:testville",
  routeId: "novel",
  recordClass: "meetings",
  providerId: "test",
  reason: "novel",
  outcome: "ROUTE_CANDIDATE",
  stoppedBy: "MODEL",
  rungs: [],
  distinctEvidenceRungs: 1,
  candidates,
  findings: [],
  nextRungs: [],
  unverified: [],
  narrative: "n",
  worker: { provider: "anthropic", model: "claude-opus-5-5", modelReported: "claude-opus-5-5" },
  usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, turns: 1, toolCalls: 1 },
  usd: 0.01,
  elapsedMs: 1,
  artifactIds: ["raw-1"],
  methodCandidateIds: [],
  refusal: null,
  startedAt: STAMP,
  recordedAt: STAMP,
});

const opened = [
  { artifactId: "raw-1", tier: "RAW" as const, contentHash: "sha256-x", byteLength: 1, contentType: "text/calendar", canonicalUrl: "https://testville.gov/meetings.ics", partial: false, recordedAt: STAMP },
];

const seedFixtureStore = async (repos: ReturnType<typeof createMemoryRepositories>): Promise<void> => {
  await repos.methodCandidates.put(METHOD_CANDIDATE_STORE_ID, emptyCandidateStore(), STAMP);
};

test("0. an absent canonical candidate store refuses instead of becoming an empty tracked/local authority", async () => {
  const repos = await seededRepos();
  await assert.rejects(
    proposeScoutCandidates({ repos, result: result([candidate()]), artifacts: opened, stamp: STAMP }),
    /METHOD_CANDIDATE_STORE_NOT_SEEDED/,
  );
  assert.equal(await repos.methodCandidates.read(METHOD_CANDIDATE_STORE_ID), null);
});

test("1. an opened, evidence-backed candidate is validated and used the moment it works once (DP-25)", async () => {
  const repos = await seededRepos();
  await seedFixtureStore(repos);
  const report = await proposeScoutCandidates({ repos, result: result([candidate()]), artifacts: opened, stamp: STAMP });
  assert.equal(report.proposed.length, 1);
  assert.equal(report.proposed[0].lifecycle, "ADMITTED", report.proposed[0].issues.join("; "));
  assert.deepEqual(report.notProposed, []);
  const store = await readMethodCandidateStore(repos);
  assert.equal(store.candidates.length, 1);
  assert.equal(store.candidates[0].lifecycle, "ADMITTED");
  assert.equal(await readMethodVersion(repos), report.storeVersionObserved + 1, "the route is learned at once");
  assert.deepEqual(await candidateStoreCounts(repos), { PROPOSED: 0, VALIDATED: 0, ADMITTED: 1, REJECTED: 0 });

  /* RULING 243: durable provenance carries the MACHINE's observedOn; the model's 2026-01-01 is a recorded claim beside it. */
  const rec = store.candidates[0];
  assert.match(rec.proposal.origin, new RegExp(`observed ${STAMP}`));
  assert.doesNotMatch(rec.proposal.origin, /2026-01-01/);
  assert.match(rec.proposal.claims?.[0]?.statement ?? "", new RegExp(`on ${STAMP};`));
  assert.deepEqual(rec.modelClaims, { observedOn: "2026-01-01", permission: "ALLOWED", recordClass: "meetings" });

  /* A candidate with no machine derivation is a pre-ruling shape and is not learned. */
  const unowned = { ...candidate({ routeId: "testville-unowned" }) } as Record<string, unknown>;
  delete unowned.provenance;
  const noDerivation = await proposeScoutCandidates({ repos, result: result([unowned as never]), artifacts: opened, stamp: STAMP });
  assert.equal(noDerivation.proposed.length, 0);
  assert.match(noDerivation.notProposed[0].why, /no machine provenance derivation/);

  /* Idempotent: re-proposing the identical offer does not duplicate it. */
  const again = await proposeScoutCandidates({ repos, result: result([candidate()]), artifacts: opened, stamp: STAMP });
  assert.equal(again.proposed[0].already, true);
  assert.equal((await readMethodCandidateStore(repos)).candidates.length, 1);
});

test("2. a candidate whose URL the Attempt never opened is NOT proposed, and the reason is named", async () => {
  const repos = await seededRepos();
  await seedFixtureStore(repos);
  const report = await proposeScoutCandidates({ repos, result: result([candidate({ url: "https://testville.gov/never-opened" })]), artifacts: opened, stamp: STAMP });
  assert.equal(report.proposed.length, 0);
  assert.equal(report.notProposed.length, 1);
  assert.match(report.notProposed[0].why, /not opened/);
});

test("3. a malformed proposal is REJECTED durably with its issue", async () => {
  const repos = await seededRepos();
  await seedFixtureStore(repos);
  const bad = candidate({ routeId: "Bad Route Id!" });
  const report = await proposeScoutCandidates({ repos, result: result([bad]), artifacts: opened, stamp: STAMP });
  assert.equal(report.proposed.length, 0, "a non-kebab id never reaches the store");
  assert.match(report.notProposed[0].why, /kebab-case/);

  /* And a well-formed id whose LearnedRoute the validator refuses lands REJECTED. */
  const route = learnedRouteFrom(candidate({ recordClass: "" }), result([]), opened);
  assert.deepEqual(route.fields, [""]);
  const report2 = await proposeScoutCandidates({ repos, result: result([candidate({ routeId: "testville-empty-fields", recordClass: "" })]), artifacts: opened, stamp: STAMP });
  const store = await readMethodCandidateStore(repos);
  const rec = store.candidates.find((c) => c.proposal.id === "testville-empty-fields");
  assert.ok(rec, "the candidate is durable whatever the verdict");
  assert.ok(["ADMITTED", "REJECTED"].includes(rec!.lifecycle));
  if (rec!.lifecycle === "REJECTED") {
    assert.equal(rec!.rejection?.code, "VALIDATION_FAILED");
    assert.ok((report2.proposed[0]?.issues.length ?? 0) > 0);
  }
});

test("4. the first Attempt that makes it work admits the candidate into the manual and selects deterministic replay", async () => {
  const repos = await seededRepos();
  await seedFixtureStore(repos);
  const before = await methodMaturityFromManual(repos);
  assert.equal(before("testville-meetings-ics"), "UNGRADUATED");
  assert.equal(
    decideExecutor({ routeId: "testville-meetings-ics", descriptor: { executorClass: "BOUNDED_MODEL_WORKER", open: { kind: "HTTP_GET" } }, maturity: before }).kind,
    "BOUNDED_MODEL_WORKER",
  );

  const input = { repos, result: result([candidate()]), artifacts: opened, stamp: STAMP };
  const report = await proposeScoutCandidates(input);
  assert.equal(report.proposed[0].lifecycle, "ADMITTED");
  const candidates = (await readMethodCandidateStore(repos)).candidates;
  assert.equal(candidates.length, 1);
  const manual = await readFieldManual(repos, { role: "SCOUT", recordClass: "meetings" });
  const entry = manual.store.entries.find((entry) => entry.source === "scout-candidate");
  assert.ok(entry);
  assert.equal(entry.kind, "ROUTE");
  assert.equal(entry.url, candidate().url);
  assert.deepEqual(entry.payload, (await readMethodKnowledge(repos)).routes.find((route) => route.id === candidate().routeId));
  assert.ok(manual.projection.entryIds.includes(entry.id), "the next Scout inherits the route through the ordinary manual read");
  assert.ok(manual.projection.lines.some((line) => line.includes("Worked in Attempt att-test-1")));
  assert.ok(!manual.projection.lines.some((line) => /Independently reached/.test(line)), "two Attempts are not offered as proof");
  const repeated = await proposeScoutCandidates(input);
  assert.equal(repeated.proposed[0].lifecycle, "ADMITTED");
  assert.equal(repeated.proposed[0].already, true);

  const after = await methodMaturityFromManual(repos);
  assert.equal(after("testville-meetings-ics"), "GRADUATED");
  assert.equal((await readMethodVersion(repos))!, report.storeVersionObserved + 1, "a learned route raises the method version by one");
  assert.ok((await readMethodKnowledge(repos)).routes.some((r) => r.id === "testville-meetings-ics"), "and the floor reads the whole route record");
  const decision = decideExecutor({
    routeId: "testville-meetings-ics",
    descriptor: { executorClass: "BOUNDED_MODEL_WORKER", open: { kind: "HTTP_GET" } },
    maturity: after,
  });
  assert.equal(decision.kind, "DETERMINISTIC", "a learned procedure is replayed by code, never rediscovered by a model");
  assert.match(decision.disagreement ?? "", /GRADUATED_SINCE_DECLARED/);
});

test("5. replaying one Attempt on another date learns the same route once", async () => {
  const repos = await seededRepos();
  await seedFixtureStore(repos);
  const first = await proposeScoutCandidates({ repos, result: result([candidate()]), artifacts: opened, stamp: STAMP });
  const replay = await proposeScoutCandidates({ repos, result: result([candidate()]), artifacts: opened, stamp: "2026-09-02" });
  assert.equal(replay.proposed[0].lifecycle, "ADMITTED");
  assert.equal(await readMethodVersion(repos), first.storeVersionObserved + 1, "one route, learned once");
  assert.equal((await methodMaturityFromManual(repos))(candidate().routeId), "GRADUATED");
});

test("6. a failed manual write leaves the candidate validated and a replay finishes admission", async () => {
  const repos = await seededRepos();
  await seedFixtureStore(repos);
  const write = repos.fieldManual.compareAndSet.bind(repos.fieldManual);
  repos.fieldManual.compareAndSet = async () => { throw new Error("manual unavailable"); };
  const input = { repos, result: result([candidate()]), artifacts: opened, stamp: STAMP };
  const failed = await proposeScoutCandidates(input);
  assert.equal(failed.proposed[0].lifecycle, "VALIDATED");
  assert.match(failed.proposed[0].issues.join(), /manual unavailable/);
  assert.equal((await methodMaturityFromManual(repos))(candidate().routeId), "UNGRADUATED");
  repos.fieldManual.compareAndSet = write;
  assert.equal((await proposeScoutCandidates(input)).proposed[0].lifecycle, "ADMITTED");
  assert.equal((await readMethodVersion(repos)), failed.storeVersionObserved + 1);
});
