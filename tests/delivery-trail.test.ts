/**
 * **THE DELIVERY TRAIL — fleet-wide acquisition → validation → publication →
 * public availability, honest about the gaps.** (MW-053, MW-054.)
 *
 * The load-bearing assertions: cumulative "reached >= this stage" counts (not
 * furthest==stage), the between-stage refusals bucketed by the transition they
 * refused, public availability rendered as a NAMED GAP (no served-reader
 * producer is wired) rather than a measured zero, and the blockers that hold
 * each stage stated rather than hidden. Pure — no clock, no store.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERY_TRAIL_VERSION,
  buildDeliveryTrail,
  deliveryTrailRenderedNumbers,
  type DeliveryTrailInput,
} from "../lib/control-plane/delivery-trail.ts";
import { auditRenderedNumbers, gap, type Held, type Measured } from "../lib/control-plane/owner-surface.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import type { PipelineItemState, PipelineStage } from "../lib/control-plane/promotion/types.ts";

/** A minimal pipeline state carrying only the fields the trail reads. */
function state(p: {
  itemId: string;
  recordClass?: string | null;
  subjectId?: string | null;
  stage: PipelineStage | null;
  refusedAt?: { stage: PipelineStage; code: string }[];
  approved?: { chain: { scouted: string; confirmed: string; verified: string; audited: string }; recordClass: string; at: string; recordId: string };
}): PipelineItemState {
  const records = (p.refusedAt ?? []).map((r) => ({
    stage: "REFUSED",
    atStage: r.stage,
    reasons: [{ code: r.code, detail: "fixture" }],
  }));
  return {
    itemId: p.itemId,
    recordClass: p.recordClass ?? "candidate-enrichment",
    subjectId: p.subjectId ?? p.itemId,
    stage: p.stage,
    refused: null,
    refusals: (p.refusedAt ?? []).length,
    records: records as unknown as PipelineItemState["records"],
    byStage: p.approved ? ({ APPROVED_FOR_PROMOTION: { stage: "APPROVED_FOR_PROMOTION", ...p.approved } } as PipelineItemState["byStage"]) : {},
  } as PipelineItemState;
}

const NO_COST: DeliveryTrailInput["costPerVerifiedRecord"] = gap<Measured>("OURS", "no record reached VERIFIED yet.");
const input = (over: Partial<DeliveryTrailInput> = {}): DeliveryTrailInput => ({
  activation: readActivationGate(""),
  servedReader: null,
  costSummary: { measuredUsd: 153.73, attemptsMeasured: 2126 },
  costPerVerifiedRecord: NO_COST,
  ...over,
});

test("empty pipeline: every stage is a named gap, the blockers are named, promotions empty", () => {
  /* A closed gate is named as a blocker; the live gate now opens campaign sites (2026-09-21), so it is not one. */
  const open = buildDeliveryTrail([], input());
  assert.ok(!open.blockers.some((b) => b.what === "Activation gate (publication)"));
  const closedGate = { ...readActivationGate(""), promotionEnabled: false, openRecordClasses: [], openFields: {}, reason: "promotion OFF" };
  const view = buildDeliveryTrail([], input({ activation: closedGate }));
  assert.equal(view.version, DELIVERY_TRAIL_VERSION);
  assert.equal(view.items, 0);
  for (const s of view.stages) assert.equal(s.reached.held, false, `${s.key} must be a gap when nothing has entered`);
  assert.equal(view.promotions.length, 0);
  assert.equal(view.servedReader.state, "NO_PRODUCER");
  // Both blockers named: the activation gate and the served-reader witness.
  assert.deepEqual(view.blockers.map((b) => b.what).sort(), ["Activation gate (publication)", "Served-reader witness (public availability)"]);
});

test("cumulative reached counts, between-stage failures bucketed, availability is a gap not zero", () => {
  const states: PipelineItemState[] = [
    state({ itemId: "a", stage: "SCOUTED" }),
    state({ itemId: "b", stage: "SCOUTED", refusedAt: [{ stage: "CONFIRMED", code: "STAGE_ALREADY_REACHED" }] }),
    state({ itemId: "c", stage: "CONFIRMED" }),
    state({ itemId: "d", stage: "VERIFIED" }),
    state({ itemId: "e", stage: "AUDITED", refusedAt: [{ stage: "APPROVED_FOR_PROMOTION", code: "STAGE_OUT_OF_ORDER" }] }),
  ];
  const view = buildDeliveryTrail(states, input());
  const reached = (k: string): Held<Measured> => view.stages.find((s) => s.key === k)!.reached;

  // reached >= SCOUTED = all 5; >= VERIFIED = d + e = 2; >= APPROVED = 0 (held, not gap).
  const acq = reached("acquisition");
  assert.ok(acq.held && acq.value.value === 5 && acq.value.denominator === 5);
  const val = reached("validation");
  assert.ok(val.held && val.value.value === 2);
  const pub = reached("publication");
  assert.ok(pub.held && pub.value.value === 0, "0 approved is a MEASURED zero, out of 5 — the pipeline is real, just empty at the top");
  // Public availability: no producer wired -> a NAMED GAP, never a measured 0.
  assert.equal(reached("publicly_available").held, false);

  // Between-stage failures bucketed by the transition refused, with the reason code.
  const conf = view.betweenFailures.find((f) => f.atStage === "CONFIRMED")!;
  assert.equal(conf.transition, "SCOUTED → CONFIRMED");
  assert.equal(conf.refusals, 1);
  assert.equal(conf.topReasons[0]?.code, "STAGE_ALREADY_REACHED");
  const appr = view.betweenFailures.find((f) => f.atStage === "APPROVED_FOR_PROMOTION")!;
  assert.equal(appr.transition, "AUDITED → APPROVED_FOR_PROMOTION");
  assert.equal(appr.topReasons[0]?.code, "STAGE_OUT_OF_ORDER");

  // The rendered numbers all carry a denominator and pass the render audit; the gap stage is omitted.
  const nums = deliveryTrailRenderedNumbers(view);
  assert.equal(nums.length, 3, "acquisition/validation/publication render; publicly_available is a gap and is omitted");
  assert.equal(auditRenderedNumbers(nums).ok, true, auditRenderedNumbers(nums).detail);
  assert.ok(view.costs.measuredUsd === 153.73 && view.costs.attemptsMeasured === 2126);
});

test("MW-054: an approved record becomes a promotion-history row with evidence, time, version and (honest) destination", () => {
  const approved = { chain: { scouted: "sc", confirmed: "cf", verified: "vf", audited: "au" }, recordClass: "meetings", at: "2026-09-22T00:00:00.000Z", recordId: "pp-1:approved" };
  const view = buildDeliveryTrail([state({ itemId: "m", recordClass: "meetings", subjectId: "body-1", stage: "APPROVED_FOR_PROMOTION", approved })], input());
  assert.equal(view.promotions.length, 1);
  const row = view.promotions[0]!;
  assert.equal(row.subjectId, "body-1");
  assert.equal(row.recordClass, "meetings");
  assert.deepEqual(row.evidenceChain, approved.chain);
  assert.equal(row.promotedAt, approved.at);
  assert.equal(row.version, "pp-1:approved");
  // No served-reader producer wired: the destination is NOT_OBSERVED, never a fabricated URL.
  assert.match(row.destination, /NOT_OBSERVED/);
  assert.equal(row.checkedAt, null);
  // publication reached 1 of 1; availability still a gap.
  assert.ok(view.stages.find((s) => s.key === "publication")!.reached.held);
  assert.equal(view.stages.find((s) => s.key === "publicly_available")!.reached.held, false);
});
