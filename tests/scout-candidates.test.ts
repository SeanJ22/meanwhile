/**
 * **MODELS HANDLE NOVELTY; CODE HANDLES LEARNED PROCEDURE — THE GRADUATION PATH.**
 * (Level 1 activation, 2026-09-01. RULING 240.)
 *
 * A Scout's route candidate must be able to enter the EXISTING method-candidate
 * lifecycle, be validated by the canonical validators, and — once a session
 * admits it — be selected for DETERMINISTIC replay by the executor decision
 * rule, so no later worker pays a model to rediscover it.
 *
 *   1  an opened, evidence-backed candidate lands VALIDATED (never ADMITTED here)
 *   2  a candidate whose URL the Attempt never opened is NOT proposed
 *   3  a malformed proposal lands REJECTED with the exact issue, durably
 *   4  after admission the decision rule selects deterministic replay
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { markAdmitted, readCandidateStore, writeCandidateStore, writeMethodStore, readMethodStore } from "../lib/method/candidate.ts";
import { learnBatch } from "../lib/method/learn-batch.ts";
import { methodMaturityFrom } from "../lib/control-plane/scheduler/maturity.ts";
import { decideExecutor } from "../lib/control-plane/scheduler/dispatch.ts";
import { candidateStoreCounts, learnedRouteFrom, proposeScoutCandidates } from "../lib/control-plane/scheduler/scout-candidates.ts";
import type { ScoutCandidate, ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";

const REPO = join(import.meta.dirname, "..");
const STAMP = "2026-09-01";

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "wtp-scout-candidates-"));
  mkdirSync(join(root, "data", "method"), { recursive: true });
  writeFileSync(join(root, "data", "method", "knowledge.json"), readFileSync(join(REPO, "data", "method", "knowledge.json")));
  return root;
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
  worker: { provider: "anthropic", model: "claude-opus-5", modelReported: "claude-opus-5" },
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

test("1. an opened, evidence-backed candidate is proposed and VALIDATED — never admitted by the Scout", () => {
  const root = tempRoot();
  const report = proposeScoutCandidates({ root, result: result([candidate()]), artifacts: opened, stamp: STAMP });
  assert.equal(report.proposed.length, 1);
  assert.equal(report.proposed[0].lifecycle, "VALIDATED", report.proposed[0].issues.join("; "));
  assert.deepEqual(report.notProposed, []);
  const store = readCandidateStore(join(root, "data", "method", "candidates.json"));
  assert.equal(store.candidates.length, 1);
  assert.equal(store.candidates[0].lifecycle, "VALIDATED");
  assert.equal(store.candidates[0].admission, null, "the Scout may not promote its own proposal");
  assert.equal(readMethodStore(join(root, "data", "method", "knowledge.json")).version, report.storeVersionObserved, "the method store did not move");
  assert.deepEqual(candidateStoreCounts(root), { PROPOSED: 0, VALIDATED: 1, ADMITTED: 0, REJECTED: 0 });

  /* RULING 243: durable provenance carries the MACHINE's observedOn; the model's 2026-01-01 is a recorded claim beside it. */
  const rec = store.candidates[0];
  assert.match(rec.proposal.origin, new RegExp(`observed ${STAMP}`));
  assert.doesNotMatch(rec.proposal.origin, /2026-01-01/);
  assert.match(rec.proposal.claims?.[0]?.statement ?? "", new RegExp(`on ${STAMP};`));
  assert.deepEqual(rec.modelClaims, { observedOn: "2026-01-01", permission: "ALLOWED", recordClass: "meetings" });

  /* A candidate with no machine derivation is a pre-ruling shape and is not learned. */
  const unowned = { ...candidate({ routeId: "testville-unowned" }) } as Record<string, unknown>;
  delete unowned.provenance;
  const noDerivation = proposeScoutCandidates({ root, result: result([unowned as never]), artifacts: opened, stamp: STAMP });
  assert.equal(noDerivation.proposed.length, 0);
  assert.match(noDerivation.notProposed[0].why, /no machine provenance derivation/);

  /* Idempotent: re-proposing the identical offer does not duplicate it. */
  const again = proposeScoutCandidates({ root, result: result([candidate()]), artifacts: opened, stamp: STAMP });
  assert.equal(again.proposed[0].already, true);
  assert.equal(readCandidateStore(join(root, "data", "method", "candidates.json")).candidates.length, 1);
});

test("2. a candidate whose URL the Attempt never opened is NOT proposed, and the reason is named", () => {
  const root = tempRoot();
  const report = proposeScoutCandidates({ root, result: result([candidate({ url: "https://testville.gov/never-opened" })]), artifacts: opened, stamp: STAMP });
  assert.equal(report.proposed.length, 0);
  assert.equal(report.notProposed.length, 1);
  assert.match(report.notProposed[0].why, /not opened/);
});

test("3. a malformed proposal is REJECTED durably with its issue", () => {
  const root = tempRoot();
  const bad = candidate({ routeId: "Bad Route Id!" });
  const report = proposeScoutCandidates({ root, result: result([bad]), artifacts: opened, stamp: STAMP });
  assert.equal(report.proposed.length, 0, "a non-kebab id never reaches the store");
  assert.match(report.notProposed[0].why, /kebab-case/);

  /* And a well-formed id whose LearnedRoute the validator refuses lands REJECTED. */
  const route = learnedRouteFrom(candidate({ recordClass: "" }), result([]), opened);
  assert.deepEqual(route.fields, [""]);
  const report2 = proposeScoutCandidates({ root, result: result([candidate({ routeId: "testville-empty-fields", recordClass: "" })]), artifacts: opened, stamp: STAMP });
  const store = readCandidateStore(join(root, "data", "method", "candidates.json"));
  const rec = store.candidates.find((c) => c.proposal.id === "testville-empty-fields");
  assert.ok(rec, "the candidate is durable whatever the verdict");
  assert.ok(["VALIDATED", "REJECTED"].includes(rec!.lifecycle));
  if (rec!.lifecycle === "REJECTED") {
    assert.equal(rec!.rejection?.code, "VALIDATION_FAILED");
    assert.ok((report2.proposed[0]?.issues.length ?? 0) > 0);
  }
});

test("4. POSITIVE CONTROL: once a session ADMITS the candidate, the decision rule selects deterministic replay", () => {
  const root = tempRoot();
  const report = proposeScoutCandidates({ root, result: result([candidate()]), artifacts: opened, stamp: STAMP });
  const candidatePath = join(root, "data", "method", "candidates.json");
  const methodPath = join(root, "data", "method", "knowledge.json");
  const before = methodMaturityFrom(root)("testville-meetings-ics");
  assert.equal(before, "UNGRADUATED");
  assert.equal(
    decideExecutor({ routeId: "testville-meetings-ics", descriptor: { executorClass: "BOUNDED_MODEL_WORKER", open: { kind: "HTTP_GET" } }, maturity: methodMaturityFrom(root) }).kind,
    "BOUNDED_MODEL_WORKER",
  );

  /* The session's act, through the governed writer — the ONLY door into the method store. */
  const store = readCandidateStore(candidatePath);
  const c = store.candidates.find((x) => x.id === report.proposed[0].candidateId)!;
  const knowledge = readMethodStore(methodPath);
  const learned = learnBatch(knowledge, [c.proposal], STAMP);
  writeMethodStore(methodPath, learned.knowledge, { expectedVersion: knowledge.version, stamp: STAMP });
  writeCandidateStore(
    candidatePath,
    markAdmitted(store, c.id, { at: STAMP, admittedAs: c.proposal.id, effect: "LEARNED", methodVersionAfter: learned.knowledge.version }).store,
    STAMP,
  );

  assert.equal(methodMaturityFrom(root)("testville-meetings-ics"), "GRADUATED");
  const decision = decideExecutor({
    routeId: "testville-meetings-ics",
    descriptor: { executorClass: "BOUNDED_MODEL_WORKER", open: { kind: "HTTP_GET" } },
    maturity: methodMaturityFrom(root),
  });
  assert.equal(decision.kind, "DETERMINISTIC", "a learned procedure is replayed by code, never rediscovered by a model");
  assert.match(decision.disagreement ?? "", /GRADUATED_SINCE_DECLARED/);
});
