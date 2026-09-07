import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import test from "node:test";

import { factChainHarness, PIMA_CONTRACT } from "./fact-chain-harness.ts";
import { factItemId, projectFactChains, readFactItemStates } from "../lib/control-plane/promotion/fact-chain.ts";
import { factObligationId, factSubjectsFromStates, readFactFreshness } from "../lib/control-plane/promotion/fact-freshness.ts";
import { promotedFactsProvider } from "../lib/control-plane/scheduler/providers/promoted-facts.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { evaluateItems } from "../lib/control-plane/promotion/window.ts";
import { ACTIVATION_GATE } from "../lib/control-plane/promotion/activation-gate.ts";

/**
 * **PRDY-3 — THE CHAIN, END TO END, ON AN ISOLATED PLANE.** (2026-09-06.)
 *
 * The real parser, validator and auditor procedures run in their isolated
 * processes over the real held Pima capture; the projection then offers every
 * stage through the one gated path. The positive control reaches
 * APPROVED_FOR_PROMOTION only after the fact class's obligation exists; every
 * refusal below is a hold the log records by name.
 */

const TEXT = readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8");
const REGISTRY = new Set([PIMA_CONTRACT.subjectId]);

test("PRDY-3: two independent acquisitions plus a validated and audited extraction carry 36 facts to AUDITED; approval waits for the governed freshness obligation and then lands", async (t) => {
  const h = await factChainHarness();
  t.after(() => rmSync(h.vaultRoot, { recursive: true, force: true, maxRetries: 3 }));
  const first = await h.hold(TEXT);
  const second = await h.hold(TEXT);
  const chain = await h.chain(first);
  assert.equal(chain.parser.result.verdict, "EXTRACTED");
  assert.equal(chain.validator.result.verdict, "PASS");
  assert.equal(chain.auditor.result.verdict, "SURVIVED", JSON.stringify(chain.auditor.result));

  const now = h.now();
  const options = { readArtifactText: h.readArtifactText, now, registryBodyIds: REGISTRY };
  const pass1 = await projectFactChains(h.repos, options);
  assert.equal(pass1.chains, 1);
  assert.equal(pass1.bridged, 1);
  assert.equal(pass1.facts, 36);
  assert.deepEqual(pass1.refusals, []);
  assert.equal(pass1.byClass["meeting-times"].items, 18);
  assert.equal(pass1.byClass.agendas.items, 18);
  assert.equal(pass1.byClass["meeting-times"].byStage.AUDITED, 18, JSON.stringify(pass1.byClass));
  assert.equal(pass1.byClass.agendas.byStage.AUDITED, 18);
  assert.equal(pass1.counts.byStage.APPROVED_FOR_PROMOTION, 0);
  const approvalRefusals = pass1.offers.filter((o) => o.stage === "APPROVED_FOR_PROMOTION");
  assert.equal(approvalRefusals.length, 36);
  assert.ok(approvalRefusals.every((o) => !o.accepted && o.refusalCodes.includes("APPROVAL_BURDEN_FAILED") && o.error === null));
  const state1801 = pass1.states.find((s) => s.itemId === factItemId("meeting-times", "legistar:pima:1801@2026-05-12T13:00:00-07:00"))!;
  assert.equal(state1801.stage, "AUDITED");
  assert.match(state1801.refused!.reasons[0].detail, /FRESHNESS_NOT_STALE: NOT_SCHEDULED/);
  assert.equal(state1801.byStage.SCOUTED!.actor.instance, first.attemptId);
  assert.equal(state1801.byStage.CONFIRMED!.actor.instance, second.attemptId);
  assert.deepEqual(state1801.byStage.CONFIRMED!.confirmingArtifactIds, [second.artifactId]);
  assert.equal(state1801.byStage.CONFIRMED!.factAgreement?.sameFact, true);
  assert.equal(state1801.byStage.VERIFIED!.workerResultId, chain.validator.id);
  assert.ok(state1801.byStage.VERIFIED!.checks.every((c) => c.result === "PASS"), JSON.stringify(state1801.byStage.VERIFIED!.checks));
  assert.equal(state1801.byStage.AUDITED!.workerResultId, chain.auditor.id);
  assert.equal(state1801.byStage.AUDITED!.survived, true);
  assert.ok(state1801.byStage.AUDITED!.controls !== null && state1801.byStage.AUDITED!.controls.recall === 1 && state1801.byStage.AUDITED!.controls.falseAbsences === 0);
  assert.equal(pass1.freshness.length, 2, "one freshness reading per (class, body)");
  assert.ok(pass1.freshness.every((r) => r.state === "NOT_SCHEDULED" && r.hold));

  /* The scheduler registers the fact classes from the pipeline's own records. */
  const subjects = factSubjectsFromStates(await readFactItemStates(h.repos), now);
  assert.deepEqual(subjects.map((s) => `${s.recordClass}|${s.subjectId}|${s.facts}`), [
    `agendas|${PIMA_CONTRACT.subjectId}|18`, `meeting-times|${PIMA_CONTRACT.subjectId}|18`,
  ]);
  assert.equal(subjects[0].lastAcquiredAt, second.recordedAt);
  assert.equal(subjects[0].nextApplicableAt, null, "every held sitting is in the past, so no reader deadline is pending");
  const registry = buildRegistry([promotedFactsProvider(subjects)], { root: process.cwd(), nowIso: now });
  assert.deepEqual(registry.obligations.map((o) => o.id), [factObligationId("agendas", PIMA_CONTRACT.subjectId), factObligationId("meeting-times", PIMA_CONTRACT.subjectId)]);
  assert.equal(registry.byProvider[0].units, 2);
  await syncObligations(h.repos, registry.obligations, now);
  const reading = await readFactFreshness(h.repos, { recordClass: "meeting-times", subjectId: PIMA_CONTRACT.subjectId, now, lastSuccessfulAcquisitionAt: second.recordedAt });
  assert.equal(reading.state, "FRESH");
  assert.equal(reading.hold, false);
  assert.equal(reading.cadenceHours, 24);

  const pass2 = await projectFactChains(h.repos, options);
  assert.equal(pass2.counts.byStage.APPROVED_FOR_PROMOTION, 36, JSON.stringify({ byClass: pass2.byClass, refused: pass2.states[0]?.refused?.reasons, offers: pass2.offers.slice(0, 3) }));
  assert.ok(pass2.offers.every((o) => o.error === null));
  const approved = pass2.states.find((s) => s.itemId === state1801.itemId)!.byStage.APPROVED_FOR_PROMOTION!;
  assert.equal(approved.actor.role, "RELEASE_ORCHESTRATOR");
  assert.deepEqual(approved.chain, { scouted: state1801.byStage.SCOUTED!.recordId, confirmed: state1801.byStage.CONFIRMED!.recordId, verified: state1801.byStage.VERIFIED!.recordId, audited: state1801.byStage.AUDITED!.recordId });
  assert.ok(approved.burdens!.every((b) => b.result === "PASS"), JSON.stringify(approved.burdens));

  /* A third projection re-offers nothing new and errors on nothing. */
  const pass3 = await projectFactChains(h.repos, options);
  assert.equal(pass3.offers.filter((o) => o.appended).length, 0);
  assert.equal(pass3.offers.filter((o) => o.error !== null).length, 0);
  assert.equal(pass3.counts.byStage.APPROVED_FOR_PROMOTION, 36);

  /* The live gate stays OFF: every approved item is REFUSE_WOULD at the real gate. */
  const verdicts = evaluateItems(pass3.states, ACTIVATION_GATE);
  assert.equal(ACTIVATION_GATE.promotionEnabled, false);
  assert.ok(verdicts.verdicts.every((v) => v.verdict === "REFUSE_WOULD" && /not open at the activation gate/.test(v.reason)));
});

test("PRDY-3: a second acquisition that moves a sitting is a CONFIRMATION_FACT_CONFLICT hold for that fact and confirms the others; a stale class is refused at approval; a malformed capture bridges nothing", async (t) => {
  const h = await factChainHarness();
  t.after(() => rmSync(h.vaultRoot, { recursive: true, force: true, maxRetries: 3 }));
  const rows = JSON.parse(TEXT) as Record<string, unknown>[];
  const moved = JSON.stringify(rows.map((r) => (r.EventId === 1801 ? { ...r, EventTime: "2:00 PM" } : r)));
  const first = await h.hold(TEXT);
  const chain = await h.chain(first);
  assert.equal(chain.auditor.result.verdict, "SURVIVED");
  /* The moved acquisition arrives AFTER the audit; held before it, the auditor's coverage attack breaks the claim on the conflict — its own correct refusal. */
  await h.hold(moved);
  const now = h.now();
  const stale = async (input: { recordClass: "meeting-times" | "agendas"; subjectId: string; lastSuccessfulAcquisitionAt: string | null }) => ({
    recordClass: input.recordClass, subjectId: input.subjectId, obligationId: factObligationId(input.recordClass, input.subjectId), state: "STALE" as const, hold: true,
    reason: "seeded stale reading", obligation: null, cadenceHours: 24, cadenceBasis: null, lastSuccessfulAcquisitionAt: input.lastSuccessfulAcquisitionAt,
    nextDueAt: null, staleAfter: null, debt: null, retryAt: null, sourceFailureWithoutFalseEmpty: false,
  });
  const report = await projectFactChains(h.repos, { readArtifactText: h.readArtifactText, now, registryBodyIds: REGISTRY, freshness: stale });
  const conflicted = report.states.find((s) => s.itemId === factItemId("meeting-times", "legistar:pima:1801@2026-05-12T13:00:00-07:00"))!;
  assert.equal(conflicted.stage, "SCOUTED", "the moved sitting confirms nothing and the item holds");
  assert.deepEqual(conflicted.refused!.reasons.map((r) => r.code), ["CONFIRMATION_FACT_CONFLICT"]);
  assert.match(conflicted.refused!.reasons[0].detail, /states 2026-05-12T14:00:00-07:00/);
  assert.equal(conflicted.byStage.CONFIRMED, undefined);
  const agendaOf1801 = report.states.find((s) => s.recordClass === "agendas" && s.byStage.SCOUTED?.source.kind === "FLEET_EXTRACTION" && s.byStage.SCOUTED.source.factKey.startsWith("legistar:pima:1801#agenda"))!;
  assert.equal(agendaOf1801.stage, "AUDITED", "the agenda link of the moved sitting is unchanged, so its own fact confirms");
  assert.equal(report.byClass["meeting-times"].byStage.SCOUTED, 1);
  assert.equal(report.byClass["meeting-times"].byStage.AUDITED, 17);
  assert.equal(report.counts.byStage.APPROVED_FOR_PROMOTION, 0);
  const staleRefusal = report.states.find((s) => s.stage === "AUDITED")!.refused!;
  assert.equal(staleRefusal.atStage, "APPROVED_FOR_PROMOTION");
  assert.match(staleRefusal.reasons[0].detail, /FRESHNESS_NOT_STALE: STALE: seeded stale reading/);

  const malformed = await h.hold("{\"value\": [", { canonicalUrl: "https://webapi.legistar.com/v1/pima/events?$top=1" });
  const failed = await h.run(malformed, "PARSER");
  assert.equal(failed.result.verdict, "FAILED");
  const after = await projectFactChains(h.repos, { readArtifactText: h.readArtifactText, now: h.now(), registryBodyIds: REGISTRY, freshness: stale });
  assert.ok(after.refusals.some((r) => r.code === "EXTRACTION_NOT_CLEAN" && r.artifactId === malformed.artifactId && /JSON_MALFORMED/.test(r.detail)));
  assert.equal(after.facts, 36, "a malformed capture adds no fact");
});
