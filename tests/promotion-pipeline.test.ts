/**
 * THE VERIFICATION PIPELINE'S RULES, each refusal seeded. (RULING 242.)
 *
 * Every guard below has a positive control: the same transition with the
 * guarded property restored is ACCEPTED, so a checker that refused everything
 * could not pass.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { WorkerRole } from "../lib/control-plane/attempt.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import {
  appendTransition,
  confirmationFromArtifacts,
  deriveItemState,
  isPipelineRecord,
  readPipelineStates,
  scoutedFromMethodCandidate,
  scoutedFromScoutResult,
  stageCounts,
  validateTransition,
  type PipelineContext,
} from "../lib/control-plane/promotion/pipeline.ts";
import {
  PROMOTION_PIPELINE_FORMAT_VERSION,
  VERIFICATION_CHECKS,
  type ApprovedRecord,
  type AuditedRecord,
  type ConfirmedRecord,
  type PipelineActor,
  type ScoutedRecord,
  type VerificationCheck,
  type VerifiedRecord,
} from "../lib/control-plane/promotion/types.ts";
import type { MethodCandidate } from "../lib/method/candidate.ts";
import { mapEvidenceIntoPipeline } from "../lib/control-plane/promotion/mapping.ts";

const T0 = "2026-09-02T04:00:00.000Z";
const T1 = "2026-09-02T04:05:00.000Z";

const SCOUT: PipelineActor = { role: "SCOUT", lane: "BOUNDED_MODEL_WORKER", instance: "at-scout-1" };
const ACQUIRER: PipelineActor = { role: "ACQUIRER", lane: "DETERMINISTIC", instance: "at-acq-1" };
const VALIDATOR: PipelineActor = { role: "VALIDATOR", lane: "DETERMINISTIC", instance: "validator-1" };
const AUDITOR: PipelineActor = { role: "ADVERSARIAL_AUDITOR", lane: "DETERMINISTIC", instance: "auditor-1" };
const ORCHESTRATOR: PipelineActor = { role: "RELEASE_ORCHESTRATOR", lane: "SESSION", instance: "window-1" };

const URL = "https://example.gov/meetings";

function artifact(id: string, attemptId: string, canonicalUrl = URL): ArtifactRecord {
  return {
    artifactId: id,
    workItemId: "wi-1",
    routeTaskId: null,
    attemptId,
    tier: "A1" as never,
    contentHash: `hash-${id}`,
    byteLength: 10,
    contentType: "text/html",
    canonicalUrl,
    partial: false,
    recordedAt: T0,
  };
}

function context(artifacts: readonly ArtifactRecord[], roles: Record<string, WorkerRole>): PipelineContext {
  return {
    artifactById: (id) => artifacts.find((a) => a.artifactId === id) ?? null,
    attemptRoleById: (id) => roles[id] ?? null,
  };
}

function scouted(itemId = "pp-1"): ScoutedRecord {
  return {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION,
    recordId: `${itemId}:scouted`,
    itemId,
    at: T0,
    actor: SCOUT,
    stage: "SCOUTED",
    source: { kind: "SCOUT_RESULT", attemptId: "at-scout-1", obligationId: "ob-1", outcome: "ROUTE_CANDIDATE", routeId: "r-1" },
    recordClass: "meetings",
    subjectId: "body-1",
    canonicalUrl: URL,
    artifactIds: ["art-scout"],
    scoutAttemptId: "at-scout-1",
    summary: "a route",
  };
}

function confirmed(overrides: Partial<ConfirmedRecord> = {}): ConfirmedRecord {
  return {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION,
    recordId: "pp-1:confirmed",
    itemId: "pp-1",
    at: T1,
    actor: ACQUIRER,
    stage: "CONFIRMED",
    basis: "SECOND_ACQUISITION",
    confirmingArtifactIds: ["art-acq"],
    sameFact: null,
    ...overrides,
  };
}

function allPass(): VerificationCheck[] {
  return VERIFICATION_CHECKS.map((name) => ({ name, result: "PASS", detail: "seeded" }));
}

function verified(checks: VerificationCheck[] = allPass(), actor: PipelineActor = VALIDATOR): VerifiedRecord {
  return { formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION, recordId: "pp-1:verified", itemId: "pp-1", at: T1, actor, stage: "VERIFIED", checks };
}

function audited(overrides: Partial<AuditedRecord> = {}): AuditedRecord {
  return {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION,
    recordId: "pp-1:audited",
    itemId: "pp-1",
    at: T1,
    actor: AUDITOR,
    stage: "AUDITED",
    startedFrom: ["PUBLISHER_SOURCE_UNIVERSE", "EVIDENCE_VAULT"],
    survived: true,
    controls: { knownPresentCount: 4, knownAbsenceCount: 1, recalled: 4, absencesRecalled: 1, falseAbsences: 0, falsePresences: 0, unobserved: 0, recall: 1, falseAbsenceRate: 0, falsePresenceRate: 0 },
    findings: [],
    ...overrides,
  };
}

function approved(actor: PipelineActor = ORCHESTRATOR): ApprovedRecord {
  return {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION,
    recordId: "pp-1:approved",
    itemId: "pp-1",
    at: T1,
    actor,
    stage: "APPROVED_FOR_PROMOTION",
    chain: { scouted: "pp-1:scouted", confirmed: "pp-1:confirmed", verified: "pp-1:verified", audited: "pp-1:audited" },
    recordClass: "meetings",
  };
}

const GOOD_CTX = context([artifact("art-scout", "at-scout-1"), artifact("art-acq", "at-acq-1")], { "at-scout-1": "SCOUT", "at-acq-1": "ACQUIRER" });

function codes(result: ReturnType<typeof validateTransition>): string[] {
  return result.ok ? [] : result.record.reasons.map((r) => r.code);
}

/* ------------------------------------------------------------ the chain */

test("the full chain is ACCEPTED when every burden is met — the positive control for every refusal below", async () => {
  const repos = createMemoryRepositories();
  const s = await appendTransition(repos, scouted(), GOOD_CTX, T0);
  assert.equal(s.accepted, true);
  const c = await appendTransition(repos, confirmed(), GOOD_CTX, T1);
  assert.equal(c.accepted, true, JSON.stringify(c.record));
  const v = await appendTransition(repos, verified(), GOOD_CTX, T1);
  assert.equal(v.accepted, true, JSON.stringify(v.record));
  const a = await appendTransition(repos, audited(), GOOD_CTX, T1);
  assert.equal(a.accepted, true, JSON.stringify(a.record));
  const p = await appendTransition(repos, approved(), GOOD_CTX, T1);
  assert.equal(p.accepted, true, JSON.stringify(p.record));
  assert.equal(p.state.stage, "APPROVED_FOR_PROMOTION");
  const states = await readPipelineStates(repos);
  assert.equal(stageCounts(states).byStage.APPROVED_FOR_PROMOTION, 1);
  assert.equal(stageCounts(states).items, 1);
});

test("a stage out of order is refused, the refusal is APPENDED as history, and it refuses the OFFER, not the item", async () => {
  const repos = createMemoryRepositories();
  const out = await appendTransition(repos, confirmed(), GOOD_CTX, T1);
  assert.equal(out.accepted, false);
  assert.equal(out.record.stage, "REFUSED");
  assert.deepEqual(codes(validateTransition(deriveItemState("pp-1", []), confirmed(), GOOD_CTX)), ["STAGE_OUT_OF_ORDER"]);
  const log = await repos.promotionPipeline.read("pp-1");
  assert.equal(log.length, 1, "the refusal is in the log");
  assert.equal(log[0].stage, "REFUSED");
  const s = await appendTransition(repos, scouted(), GOOD_CTX, T0);
  assert.equal(s.accepted, true, "a refused offer does not make the item terminal");
  assert.equal(s.state.stage, "SCOUTED");
  assert.equal(s.state.refusals, 1);
  const c = await appendTransition(repos, confirmed(), GOOD_CTX, T1);
  assert.equal(c.accepted, true, "the same confirmation, now in order, is accepted on its own burdens");
});

test("an identical re-offer of a held record is a NO-OP SUCCESS, so a re-map cannot refuse what it already mapped", async () => {
  const repos = createMemoryRepositories();
  const first = await appendTransition(repos, scouted(), GOOD_CTX, T0);
  assert.equal(first.accepted, true);
  assert.equal(first.appended, true);
  const again = await appendTransition(repos, scouted(), GOOD_CTX, T1);
  assert.equal(again.accepted, true);
  assert.equal(again.appended, false, "already held");
  assert.equal(again.state.refusals, 0, "no refusal was written");
  assert.equal((await repos.promotionPipeline.read("pp-1")).length, 1);
  const different = await appendTransition(repos, { ...scouted(), summary: "reworded" }, GOOD_CTX, T1);
  assert.equal(different.accepted, false);
  assert.deepEqual(codes(validateTransition(first.state, { ...scouted(), summary: "reworded" }, GOOD_CTX)), ["STAGE_ALREADY_REACHED"]);
  const refusedAgain = await appendTransition(repos, { ...scouted(), summary: "reworded" }, GOOD_CTX, T1);
  assert.equal(refusedAgain.appended, false, "an identical refusal is not a duplicate history entry");
});

test("a foreign row under the pipeline log is not an item", async () => {
  const repos = createMemoryRepositories();
  await repos.promotionPipeline.append("conformance-x", "r-1", { formatVersion: 1, note: "conformance" } as never, T0);
  await appendTransition(repos, scouted(), GOOD_CTX, T0);
  const states = await readPipelineStates(repos);
  assert.deepEqual(states.map((s) => s.itemId), ["pp-1"]);
});

test("item states come from one paged read of the log, equal to reading every item's key", async () => {
  // 2026-09-24: one read per key issued 629 sequential requests and a research
  // cycle reached its wall waiting on them.
  const repos = createMemoryRepositories();
  await repos.promotionPipeline.append("conformance-x", "r-1", { formatVersion: 1, note: "conformance" } as never, T0);
  for (const itemId of ["pp-2", "pp-1", "pp-3"]) {
    await appendTransition(repos, { ...scouted(), itemId, recordId: `${itemId}:scouted` }, GOOD_CTX, T0);
  }
  await appendTransition(repos, confirmed(), GOOD_CTX, T1);
  await appendTransition(repos, { ...confirmed(), itemId: "pp-3", recordId: "pp-3:confirmed", actor: SCOUT }, GOOD_CTX, T1);
  const perKey = [];
  for (const key of await repos.promotionPipeline.keys()) {
    const records = (await repos.promotionPipeline.read(key)).filter(isPipelineRecord);
    if (records.length > 0) perKey.push(deriveItemState(key, records));
  }
  let keyReads = 0;
  const observed = { ...repos, promotionPipeline: { ...repos.promotionPipeline,
    read: async (key: string) => { keyReads += 1; return repos.promotionPipeline.read(key); } } };
  const states = await readPipelineStates(observed);
  assert.deepEqual(states, perKey);
  assert.deepEqual(states.map((s) => s.itemId), ["pp-1", "pp-2", "pp-3"]);
  assert.ok(states.find((s) => s.itemId === "pp-3")?.refused, "a refusal is part of its item's state, not lost by the grouping");
  assert.equal(keyReads, 0, "no item is read by its key");
});

/* ------------------------------------------------------------- CONFIRMED */

test("CONFIRMED refuses an artifact vaulted by the Scout's own Attempt — model prose never confirms model prose", () => {
  const state = deriveItemState("pp-1", [scouted()]);
  const out = validateTransition(state, confirmed({ confirmingArtifactIds: ["art-scout"] }), GOOD_CTX);
  assert.ok(codes(out).includes("CONFIRMATION_SAME_ATTEMPT"), codes(out).join(","));
  assert.ok(codes(out).includes("CONFIRMATION_BY_SCOUT_ROLE"));
});

test("CONFIRMED refuses an artifact from a SCOUT-role Attempt even when it is a different Attempt", () => {
  const ctx = context([artifact("art-scout", "at-scout-1"), artifact("art-other-scout", "at-scout-2")], { "at-scout-1": "SCOUT", "at-scout-2": "SCOUT" });
  const out = validateTransition(deriveItemState("pp-1", [scouted()]), confirmed({ confirmingArtifactIds: ["art-other-scout"] }), ctx);
  assert.deepEqual(codes(out), ["CONFIRMATION_BY_SCOUT_ROLE"]);
});

test("CONFIRMED refuses no artifact, an unknown artifact, an unknown Attempt, and a URL mismatch", () => {
  const state = deriveItemState("pp-1", [scouted()]);
  assert.deepEqual(codes(validateTransition(state, confirmed({ confirmingArtifactIds: [] }), GOOD_CTX)), ["CONFIRMATION_WITHOUT_ARTIFACT"]);
  assert.deepEqual(codes(validateTransition(state, confirmed({ confirmingArtifactIds: ["art-missing"] }), GOOD_CTX)), ["CONFIRMATION_ARTIFACT_UNKNOWN"]);
  const noRole = context([artifact("art-acq", "at-ghost")], {});
  assert.deepEqual(codes(validateTransition(state, confirmed(), noRole)), ["CONFIRMATION_ATTEMPT_UNKNOWN"]);
  const elsewhere = context([artifact("art-acq", "at-acq-1", "https://example.gov/elsewhere")], { "at-acq-1": "ACQUIRER" });
  assert.deepEqual(codes(validateTransition(state, confirmed(), elsewhere)), ["CONFIRMATION_URL_MISMATCH"]);
});

test("a SECOND_ROUTE confirmation must name the shared fact; with it, a different URL is accepted", () => {
  const state = deriveItemState("pp-1", [scouted()]);
  const elsewhere = context([artifact("art-acq", "at-acq-1", "https://example.gov/elsewhere")], { "at-acq-1": "ACQUIRER" });
  assert.deepEqual(codes(validateTransition(state, confirmed({ basis: "SECOND_ROUTE", sameFact: null }), elsewhere)), ["CONFIRMATION_SECOND_ROUTE_UNNAMED"]);
  assert.equal(validateTransition(state, confirmed({ basis: "SECOND_ROUTE", sameFact: "the 2026-09-09 meeting time" }), elsewhere).ok, true);
});

test("CONFIRMED by the Scout actor is SELF_CERTIFICATION even with good artifacts", () => {
  const out = validateTransition(deriveItemState("pp-1", [scouted()]), confirmed({ actor: SCOUT }), GOOD_CTX);
  assert.ok(codes(out).includes("SELF_CERTIFICATION"));
});

/* -------------------------------------------------------------- VERIFIED */

test("VERIFIED refuses a FAILED check, a NOT_IMPLEMENTED check and a MISSING check — never a silent pass", () => {
  const state = deriveItemState("pp-1", [scouted(), confirmed()]);
  const failed = allPass().map((c) => (c.name === "FALSE_ZERO" ? { ...c, result: "FAIL" as const } : c));
  assert.deepEqual(codes(validateTransition(state, verified(failed), GOOD_CTX)), ["VERIFICATION_CHECK_FAILED"]);
  const notImplemented = allPass().map((c) => (c.name === "NEUTRALITY_AND_RENDERING_SYMMETRY" ? { ...c, result: "NOT_IMPLEMENTED" as const } : c));
  assert.deepEqual(codes(validateTransition(state, verified(notImplemented), GOOD_CTX)), ["VERIFICATION_CHECK_NOT_IMPLEMENTED"]);
  const missing = allPass().filter((c) => c.name !== "CANONICAL_IDENTITY_UNIQUE");
  assert.deepEqual(codes(validateTransition(state, verified(missing), GOOD_CTX)), ["VERIFICATION_CHECK_MISSING"]);
  assert.equal(validateTransition(state, verified(), GOOD_CTX).ok, true, "positive control");
});

test("VERIFIED by the confirming actor is SELF_CERTIFICATION", () => {
  const state = deriveItemState("pp-1", [scouted(), confirmed()]);
  assert.deepEqual(codes(validateTransition(state, verified(allPass(), ACQUIRER), GOOD_CTX)), ["SELF_CERTIFICATION"]);
});

/* --------------------------------------------------------------- AUDITED */

test("AUDITED refuses an unmeasured control score, a dependent starting point, a non-surviving audit, and a non-independent auditor", () => {
  const state = deriveItemState("pp-1", [scouted(), confirmed(), verified()]);
  assert.deepEqual(codes(validateTransition(state, audited({ controls: null }), GOOD_CTX)), ["AUDIT_CONTROLS_NOT_MEASURED"]);
  assert.deepEqual(codes(validateTransition(state, audited({ startedFrom: ["OUR_SUMMARY"] }), GOOD_CTX)), ["AUDIT_STARTING_POINT_NOT_INDEPENDENT"]);
  assert.deepEqual(codes(validateTransition(state, audited({ survived: false, findings: ["the denominator was larger"] }), GOOD_CTX)), ["AUDIT_DID_NOT_SURVIVE"]);
  const byValidator = codes(validateTransition(state, audited({ actor: VALIDATOR }), GOOD_CTX));
  assert.ok(byValidator.includes("SELF_CERTIFICATION") && byValidator.includes("AUDIT_NOT_INDEPENDENT"), byValidator.join(","));
  const byScout = codes(validateTransition(state, audited({ actor: SCOUT }), GOOD_CTX));
  assert.ok(byScout.includes("AUDIT_NOT_INDEPENDENT"), byScout.join(","));
  assert.equal(validateTransition(state, audited(), GOOD_CTX).ok, true, "positive control");
});

/* -------------------------------------------------------------- APPROVED */

test("APPROVED_FOR_PROMOTION carries the full chain by record id and refuses a chain the log does not hold", () => {
  const state = deriveItemState("pp-1", [scouted(), confirmed(), verified(), audited()]);
  const wrong = { ...approved(), chain: { ...approved().chain, audited: "pp-1:audited-elsewhere" } };
  assert.deepEqual(codes(validateTransition(state, wrong, GOOD_CTX)), ["APPROVAL_CHAIN_INCOMPLETE"]);
  assert.deepEqual(codes(validateTransition(state, approved(AUDITOR), GOOD_CTX)), ["SELF_CERTIFICATION"]);
  assert.equal(validateTransition(state, approved(), GOOD_CTX).ok, true);
  assert.deepEqual(codes(validateTransition(deriveItemState("pp-1", [scouted(), confirmed(), verified()]), approved(), GOOD_CTX)), ["STAGE_OUT_OF_ORDER"]);
});

test("a DIFFERENT record at a stage already reached is refused rather than duplicated", () => {
  const state = deriveItemState("pp-1", [scouted()]);
  assert.deepEqual(codes(validateTransition(state, { ...scouted(), recordId: "pp-1:scouted-2" }, GOOD_CTX)), ["STAGE_ALREADY_REACHED"]);
  assert.equal(validateTransition(state, scouted(), GOOD_CTX).ok, true, "the identical record is a no-op success");
});

/* --------------------------------------------------------------- mapping */

function scoutResult(overrides: Partial<ScoutResult> = {}): ScoutResult {
  return {
    formatVersion: 1,
    attemptId: "at-scout-1",
    obligationId: "ob-1",
    routeTaskId: "rt-1",
    workItemId: "wi-1",
    subjectId: "body-1",
    routeId: null,
    recordClass: "meetings",
    providerId: "meetings",
    reason: "novelty",
    outcome: "ROUTE_CANDIDATE",
    stoppedBy: "MODEL",
    rungs: [],
    distinctEvidenceRungs: 1,
    candidates: [
      {
        routeId: "r-1",
        title: "the meetings page",
        url: URL,
        procedure: "GET",
        relevance: "meetings",
        permission: "ALLOWED" as never,
        permissionReading: "robots allows",
        evidenceArtifactIds: ["art-scout"],
        observedOn: "2026-09-02",
        recordClass: "meetings",
        deterministic: true,
        unverified: [],
      },
    ],
    findings: [],
    nextRungs: [],
    unverified: [],
    narrative: "n",
    worker: { provider: "anthropic", model: "m", modelReported: null },
    usage: { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, turns: 1, toolCalls: 1 },
    usd: null,
    elapsedMs: 1,
    artifactIds: ["art-scout"],
    methodCandidateIds: [],
    refusal: null,
    startedAt: T0,
    recordedAt: T0,
    ...overrides,
  };
}

test("mapping: ROUTE_CANDIDATE and EVIDENCE_FOUND become SCOUTED; refused and absence-shaped results map to nothing", () => {
  assert.equal(scoutedFromScoutResult(scoutResult()).length, 1);
  assert.equal(scoutedFromScoutResult(scoutResult({ outcome: "EVIDENCE_FOUND", findings: [{ summary: "found", artifactIds: ["art-scout"], kind: "RECORD" }] })).length, 1);
  assert.equal(scoutedFromScoutResult(scoutResult({ outcome: "NO_PROGRESS" })).length, 0);
  assert.equal(scoutedFromScoutResult(scoutResult({ refusal: [{ code: "SCOUT_NO_TOOL_USED", detail: "x" }] })).length, 0);
  const item = scoutedFromScoutResult(scoutResult())[0];
  assert.equal(item.actor.role, "SCOUT");
  assert.equal(item.scoutAttemptId, "at-scout-1");
  assert.equal(item.canonicalUrl, URL);
  assert.equal(scoutedFromScoutResult(scoutResult())[0].itemId, item.itemId, "the id is derived, so a re-map collides");
});

test("mapping: a VALIDATED method candidate is SCOUTED, not VERIFIED", () => {
  const candidate: MethodCandidate = {
    id: "mc-1",
    attemptId: "at-scout-1",
    proposal: { id: "r-1", title: "t", tier: "A1", fields: ["meetings"], note: "n", origin: "o", outcome: { jurisdiction: "body-1", rows: 1, outcome: "YIELDED", note: "n" } },
    submittedAt: "2026-09-02",
    observedMethodVersion: 1,
    lifecycle: "VALIDATED",
    validation: null,
    admission: null,
    rejection: null,
  };
  const item = scoutedFromMethodCandidate(candidate, new Map([["at-scout-1", scoutResult()]]));
  assert.ok(item !== null);
  assert.equal(item.stage, "SCOUTED");
  assert.equal(item.canonicalUrl, URL);
  assert.equal(scoutedFromMethodCandidate({ ...candidate, lifecycle: "REJECTED" }, new Map()), null);
});

test("mapping reuses accepted confirmation at a later clock instead of stranding it behind a duplicate-stage refusal", async () => {
  const repos = createMemoryRepositories();
  const result = scoutResult();
  await repos.scoutResults.append(result.obligationId, result.attemptId, result, T0);
  const scout = scoutedFromScoutResult(result)[0];
  await appendTransition(repos, scout, GOOD_CTX, T0);
  const confirmation = confirmed({ itemId: scout.itemId, recordId: `${scout.itemId}:confirmed` });
  await appendTransition(repos, confirmation, GOOD_CTX, T1);
  const before = await repos.promotionPipeline.read(scout.itemId);
  const later = await mapEvidenceIntoPipeline(repos, ".", "2026-09-03T04:05:00.000Z");
  assert.equal(later.scouted.alreadyHeld, 1);
  assert.equal(later.confirmed.alreadyHeld, 1);
  assert.equal(later.confirmed.refused, 0);
  assert.equal(later.states[0].stage, "CONFIRMED", "reused confirmation does not imply verification or approval");
  assert.deepEqual(await repos.promotionPipeline.read(scout.itemId), before, "no new receipt, timestamp or refusal is manufactured");
});

test("method lifecycle advancement reuses its scouting evidence but changed source identity is still refused", async () => {
  const repos = createMemoryRepositories();
  const result = scoutResult();
  await repos.scoutResults.append(result.obligationId, result.attemptId, result, T0);
  const candidate: MethodCandidate = { id: "mc-reuse", attemptId: result.attemptId,
    proposal: { id: "r-1", title: "t", tier: "A1", fields: ["meetings"], note: "n", origin: "o", outcome: { jurisdiction: "body-1", rows: 1, outcome: "YIELDED", note: "n" } },
    submittedAt: T0, observedMethodVersion: 1, lifecycle: "PROPOSED", validation: null, admission: null, rejection: null };
  await repos.methodCandidates.put("live", { storeVersion: 1, updatedOn: T0, candidates: [candidate] }, T0);
  await mapEvidenceIntoPipeline(repos, ".", T0);
  const row = await repos.methodCandidates.mustRead("live");
  await repos.methodCandidates.compareAndSet("live", row.revision, { ...row.value, candidates: [{ ...candidate, lifecycle: "VALIDATED" }] }, T1);
  const replay = await mapEvidenceIntoPipeline(repos, ".", T1);
  assert.equal(replay.scouted.alreadyHeld, 2);
  assert.equal(replay.scouted.refused, 0);
  const item = scoutedFromMethodCandidate(candidate, new Map([[result.attemptId, result]]))!;
  const state = replay.states.find(s => s.itemId === item.itemId)!;
  assert.deepEqual(codes(validateTransition(state, { ...item, subjectId: "different-body" }, GOOD_CTX)), ["STAGE_ALREADY_REACHED"]);
});

test("mapping: CONFIRMED exists only where an ACQUIRER artifact at the same URL comes from another Attempt", () => {
  const s = scouted();
  const roles: Record<string, WorkerRole> = { "at-scout-1": "SCOUT", "at-acq-1": "ACQUIRER", "at-scout-2": "SCOUT" };
  const role = (id: string): WorkerRole | null => roles[id] ?? null;
  assert.equal(confirmationFromArtifacts(s, [artifact("art-scout", "at-scout-1")], role, T1), null, "the Scout's own artifact confirms nothing");
  assert.equal(confirmationFromArtifacts(s, [artifact("art-x", "at-scout-2")], role, T1), null, "another Scout confirms nothing");
  assert.equal(confirmationFromArtifacts(s, [artifact("art-y", "at-acq-1", "https://example.gov/other")], role, T1), null, "a different URL is not a second acquisition");
  const c = confirmationFromArtifacts(s, [artifact("art-acq", "at-acq-1")], role, T1);
  assert.ok(c !== null);
  assert.deepEqual(c.confirmingArtifactIds, ["art-acq"]);
  assert.equal(c.actor.role, "ACQUIRER");
});
