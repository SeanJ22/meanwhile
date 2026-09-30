import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import test from "node:test";

import { factChainHarness, PIMA_CONTRACT } from "./fact-chain-harness.ts";
import { factItemId, projectFactChains, readFactItemStates } from "../lib/control-plane/promotion/fact-chain.ts";
import {
  factFreshnessFromPermanentMeetings,
  factObligationId,
  factSubjectsFromStates,
  permanentMeetingsReceiptId,
  type PermanentMeetingsReceipt,
} from "../lib/control-plane/promotion/fact-freshness.ts";
import { meetingPartitionForRow } from "../lib/civic-data/meeting-partitions.ts";
import type { RoutineContractObservation } from "../lib/civic-data/observability.ts";
import { evaluateItems } from "../lib/control-plane/promotion/window.ts";
import { ACTIVATION_GATE } from "../lib/control-plane/promotion/activation-gate.ts";

/**
 * **PRDY-3 — THE CHAIN, END TO END, ON AN ISOLATED PLANE.** (2026-09-06.)
 *
 * The real parser, validator and auditor procedures run in their isolated
 * processes over the real held Pima capture; the projection then offers every
 * stage through the one gated path. After PDC, the old meeting-fact classes
 * remain immutable evidence only: they read the permanent meetings receipt
 * but can neither install an acquisition clock nor become a second promotion
 * authority.
 */

const TEXT = readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8");
const REGISTRY = new Set([PIMA_CONTRACT.subjectId]);

function permanentMeetingsReceiptFixture(input: {
  readonly promotedAt: string;
  readonly nextDueAt: string;
  readonly freshness?: "FRESH" | "DUE" | "STALE" | "UNKNOWN";
  readonly currentState?: "PROMOTED" | "SOURCE_BLOCKED";
  readonly lkgServing?: boolean;
}): PermanentMeetingsReceipt {
  const partition = meetingPartitionForRow("legistar", PIMA_CONTRACT.subjectId);
  const versionId = "meetings-permanent-v1";
  const value = {
    contractId: partition.id,
    sourceId: "meetings-public-bodies",
    recordClass: "MEETING",
    scope: partition.scope,
    currentState: { kind: "MEASURED", value: input.currentState ?? "PROMOTED" },
    canonicalPromotion: {
      kind: "MEASURED",
      value: {
        versionId,
        promotedAt: input.promotedAt,
        authorityOrigin: "LIVE_SOURCE_ACQUISITION" as const,
        receipt: {
          contractVersion: 2,
          decision: "GOOD",
          candidateId: versionId,
          sourceId: "meetings-public-bodies",
          recordClass: "MEETING",
          scope: partition.scope,
          validatedAt: input.promotedAt,
          checks: [],
          excludedFacts: [],
        },
        pointerProof: [`pointer:MEETING:${partition.scope}:${versionId}`],
      },
    },
    readerVisible: {
      kind: "MEASURED",
      value: {
        projectionId: "meetings-snapshot",
        versionId,
        observedAt: input.promotedAt,
        eventId: `reader-event:${versionId}`,
        evidenceKind: "TYPED_READER_READ_MODEL",
        verifierId: "lib/meetings/snapshot.ts#readMeetingsProjection",
        verifierCodeSha: "e".repeat(40),
        detail: "The typed meetings Reader returned the exact promoted version.",
        proof: [`reader:${versionId}`],
      },
    },
    cadence: {
      clock: "STANDING",
      description: "daily through the 2026 general election, then weekly",
      activeEveryMs: 24 * 3_600_000,
      retryDescription: "one hour after a failed source-isolated attempt",
      nextDue: { kind: "MEASURED", value: input.nextDueAt },
      operationalState: input.currentState === "SOURCE_BLOCKED" ? "RETRYING" : "HEALTHY",
      operationalDetail: input.currentState === "SOURCE_BLOCKED" ? "fixture source retry" : "fixture source healthy",
      freshness: input.freshness ?? "FRESH",
      freshnessDetail: "fixture canonical GOOD acquisition is inside the active cadence",
    },
    lkg: {
      kind: "MEASURED",
      value: {
        versionId,
        currentlyServing: input.lkgServing ?? false,
        state: input.lkgServing ? "SERVING_AFTER_LATER_ATTEMPT" : "CURRENT_PROMOTION",
        detail: "fixture LKG proof",
      },
    },
  } satisfies Pick<RoutineContractObservation,
    "contractId" | "sourceId" | "recordClass" | "scope" | "currentState" |
    "canonicalPromotion" | "readerVisible" | "cadence" | "lkg">;
  return { kind: "HELD", value: [value] };
}

test("PRDY-3/PDC: immutable facts can read the permanent meetings receipt, but cannot install or run their own acquisition clock", async (t) => {
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

  /* The evidence projection remains readable, but it creates no scheduler row. */
  const subjects = factSubjectsFromStates(await readFactItemStates(h.repos), now);
  assert.deepEqual(subjects.map((s) => `${s.recordClass}|${s.subjectId}|${s.facts}`), [
    `agendas|${PIMA_CONTRACT.subjectId}|18`, `meeting-times|${PIMA_CONTRACT.subjectId}|18`,
  ]);
  assert.equal(subjects[0].lastAcquiredAt, second.recordedAt);
  assert.equal(subjects[0].nextApplicableAt, null, "every held sitting is in the past, so no reader deadline is pending");
  assert.deepEqual(await h.repos.obligations.list(), [], "immutable fact projection must not create a second acquisition clock");
  const receipt = permanentMeetingsReceiptFixture({
    promotedAt: second.recordedAt,
    nextDueAt: new Date(Date.parse(second.recordedAt) + 24 * 3_600_000).toISOString(),
  });
  const freshness = async (input: { recordClass: "meeting-times" | "agendas"; subjectId: string; meetingSource: string; lastSuccessfulAcquisitionAt: string | null }) =>
    factFreshnessFromPermanentMeetings(receipt, input);
  const reading = await freshness({ recordClass: "meeting-times", subjectId: PIMA_CONTRACT.subjectId, meetingSource: "legistar", lastSuccessfulAcquisitionAt: second.recordedAt });
  assert.equal(reading.state, "FRESH");
  assert.equal(reading.hold, false);
  assert.equal(reading.cadenceHours, 24);
  const partition = meetingPartitionForRow("legistar", PIMA_CONTRACT.subjectId);
  assert.equal(reading.obligationId, permanentMeetingsReceiptId(partition.id, partition.scope));

  const pass2 = await projectFactChains(h.repos, { ...options, freshness });
  assert.equal(pass2.counts.byStage.APPROVED_FOR_PROMOTION, 36, "reviewed meeting classes may enter the sole permanent partition door");
  assert.ok(pass2.offers.every((o) => o.error === null));
  const held = pass2.states.find((s) => s.itemId === state1801.itemId)!;
  assert.equal(held.stage, "APPROVED_FOR_PROMOTION");
  assert.ok(held.byStage.APPROVED_FOR_PROMOTION!.burdens!.every(burden => burden.result === "PASS"));

  /* A third projection re-offers nothing new and errors on nothing. */
  const pass3 = await projectFactChains(h.repos, { ...options, freshness });
  assert.equal(pass3.offers.filter((o) => o.appended).length, 0);
  assert.equal(pass3.offers.filter((o) => o.error !== null).length, 0);
  assert.equal(pass3.counts.byStage.APPROVED_FOR_PROMOTION, 36);

  /* Meeting facts are open under §3 (2026-09-29): every approved fact is a would-promote. They
     reach readers through the permanent meeting partition; the window itself stays SHADOW and writes nothing. */
  const verdicts = evaluateItems(pass3.states, ACTIVATION_GATE);
  assert.ok(ACTIVATION_GATE.openRecordClasses.includes("meeting-times") && ACTIVATION_GATE.openRecordClasses.includes("agendas"));
  assert.equal(verdicts.verdicts.filter((v) => v.verdict === "PROMOTE_WOULD").length, 36);
});

test("PDC: a failed permanent meetings attempt stays a data-plane LKG/retry receipt and never becomes a legacy acquisition clock", () => {
  const promotedAt = "2026-09-08T12:00:00.000Z";
  const nextDueAt = "2026-09-08T13:00:00.000Z";
  const receipt = permanentMeetingsReceiptFixture({
    promotedAt,
    nextDueAt,
    currentState: "SOURCE_BLOCKED",
    lkgServing: true,
  });
  const reading = factFreshnessFromPermanentMeetings(receipt, {
    recordClass: "agendas",
    subjectId: PIMA_CONTRACT.subjectId,
    meetingSource: "legistar",
    lastSuccessfulAcquisitionAt: promotedAt,
  });
  assert.equal(reading.state, "SOURCE_FAILING");
  assert.equal(reading.hold, false, "fresh LKG remains usable while the permanent runner retries");
  assert.equal(reading.sourceFailureWithoutFalseEmpty, true);
  assert.equal(reading.retryAt, nextDueAt);
  assert.equal(reading.obligation, null, "no legacy standing-obligation row is revived");
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
