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
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

import {
  DELIVERY_TRAIL_VERSION,
  buildDeliveryTrail,
  pendingDelivery,
  promotionChangeSummary,
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

test("a campaign-site approval never presents the Scout biography or platform as verified publication", () => {
  const item = state({ itemId: "site", stage: "APPROVED_FOR_PROMOTION", approved: { recordClass: "candidate-enrichment", at: "2026-09-26T10:00:00Z", recordId: "a", chain: { scouted: "s", confirmed: "c", verified: "v", audited: "u" } } });
  const approval = { ...item.byStage.APPROVED_FOR_PROMOTION!, field: "campaignSite", campaignSite: { url: "https://campaign.example/" } };
  const summary = promotionChangeSummary({ ...item, byStage: { ...item.byStage, APPROVED_FOR_PROMOTION: approval } });
  assert.match(summary, /Verified campaign-site link: https:\/\/campaign.example\//);
  assert.match(summary, /does not verify biography, positions/);
  assert.match(summary, /requires the separate reader readback/);
});

test("pending records show the unresolved verification step without reviving historical duplicate-stage failures", () => {
  const held = state({ itemId: "retained", stage: "CONFIRMED", refusedAt: [{ stage: "CONFIRMED", code: "STAGE_ALREADY_REACHED" }] });
  const row = pendingDelivery(held)!;
  assert.match(row.blocker, /Required VERIFIED evidence has not been accepted/);
  assert.match(row.lastRefusal!, /STAGE_ALREADY_REACHED/);
  assert.match(row.outcome, /Verification incomplete/);
  assert.match(row.correctiveAction, /standing campaign-site verifier/);
  const failed = pendingDelivery(state({ itemId: "failed", stage: "CONFIRMED", refusedAt: [{ stage: "VERIFIED", code: "VERIFICATION_CHECK_NOT_IMPLEMENTED" }] }))!;
  assert.match(failed.blocker, /VERIFICATION_CHECK_NOT_IMPLEMENTED: fixture/);
  const view = buildDeliveryTrail([held, state({ itemId: "approved", stage: "APPROVED_FOR_PROMOTION", approved: { recordClass: "candidate-enrichment", at: "2026-09-26T10:00:00Z", recordId: "approval", chain: { scouted: "s", confirmed: "c", verified: "v", audited: "a" } } })], input());
  assert.equal(view.pending?.length, 1);
});

test("Admin retains failed readback reason and time without turning it into verified delivery", () => {
  const approved = { chain: { scouted: "sc", confirmed: "cf", verified: "vf", audited: "au" }, recordClass: "candidate-enrichment", at: "2026-09-26T08:00:00Z", recordId: "approved" };
  const item = state({ itemId: "a", stage: "APPROVED_FOR_PROMOTION", approved });
  const checkedAt = "2026-09-26T09:00:00Z";
  const read = { checkedAt, errors: [], witnesses: [{ itemId: "a", approvalId: "approved", versionId: "d1", readerKey: "key", url: `${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`, checkedAt, state: "NOT_OBSERVED" as const, reason: "Sources control failed.", responseSha256: null }] };
  const view = buildDeliveryTrail([item], input({ now: checkedAt, servedReader: read }));
  assert.match(view.promotions[0].destination, /NOT_OBSERVED — Sources control failed/);
  assert.equal(view.promotions[0].checkedAt, checkedAt);
  const served = view.stages.find(s => s.key === "publicly_available")!.reached;
  assert.ok(served.held && served.value.value === 0);
  const stale = buildDeliveryTrail([item], input({ now: "2026-09-26T13:00:00Z", servedReader: read }));
  assert.match(stale.promotions[0].destination, /stale readback/);
  const wrongApproval = buildDeliveryTrail([item], input({ now: checkedAt, servedReader: { ...read, witnesses: [{ ...read.witnesses[0], approvalId: "other" }] } }));
  assert.equal(wrongApproval.promotions[0].checkedAt, null);
  assert.doesNotMatch(wrongApproval.promotions[0].destination, /Sources control/);
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
  // MW-053: the time is the approval, named as such; the misleading name is no longer written.
  assert.equal(row.approvedAt, approved.at);
  assert.equal(row.promotedAt, undefined);
  assert.equal(row.version, "pp-1:approved");
  // No served-reader producer wired: the destination is NOT_OBSERVED, never a fabricated URL.
  assert.match(row.destination, /NOT_OBSERVED/);
  assert.equal(row.checkedAt, null);
  // publication reached 1 of 1; availability still a gap.
  assert.ok(view.stages.find((s) => s.key === "publication")!.reached.held);
  assert.equal(view.stages.find((s) => s.key === "publicly_available")!.reached.held, false);
});

test("MW-053: each approved row says what changed, from its own SCOUTED and CONFIRMED records", () => {
  const approved = { chain: { scouted: "sc", confirmed: "cf", verified: "vf", audited: "au" }, recordClass: "meetings", at: "2026-09-22T00:00:00.000Z", recordId: "pp-2:approved" };
  const base = state({ itemId: "m2", recordClass: "meetings", subjectId: "body-2", stage: "APPROVED_FOR_PROMOTION", approved });
  const withChain = {
    ...base,
    byStage: {
      ...base.byStage,
      SCOUTED: {
        stage: "SCOUTED",
        source: {
          kind: "FLEET_EXTRACTION", workItemId: "wi", attemptId: "at", parserResultId: "pr", artifactId: "ar", extractedRecordId: "er",
          factKey: "mtg-9@2026-10-01T17:00:00.000Z", sourceRecordClass: "LEGISTAR_EVENTS", sourceKey: "legistar:pima", applicableAt: "2026-10-01T17:00:00.000Z",
        },
        summary: "Board of Supervisors regular meeting",
        canonicalUrl: "https://pima.legistar.com/Calendar.aspx",
      },
      CONFIRMED: { stage: "CONFIRMED", sameFact: "2026-10-01T17:00:00.000Z" },
    },
  } as unknown as PipelineItemState;
  const row = buildDeliveryTrail([withChain], input()).promotions[0]!;
  assert.match(
    row.changeSummary ?? "",
    /^A meeting time \(mtg-9@2026-10-01T17:00:00\.000Z\) from legistar:pima, for October 1, 2026, 1:00 PM EDT: Board of Supervisors regular meeting <https:\/\/pima\.legistar\.com\/Calendar\.aspx>; the confirming read states 2026-10-01T17:00:00\.000Z$/,
  );
  // An item without its SCOUTED record says so rather than inventing a change.
  assert.equal(buildDeliveryTrail([base], input()).promotions[0]!.changeSummary, "What changed is not recorded: the item holds no SCOUTED record.");
  // A campaign-site lead from a search index names its route, rank and the page it pointed at.
  const pointer = {
    ...base,
    byStage: {
      ...base.byStage,
      SCOUTED: {
        stage: "SCOUTED",
        source: { kind: "DISCOVERY_POINTER", routeId: "candidate-marginalia-index", attemptId: "at", artifactId: "ar", pointerUrl: "https://lilytangwilliams.com/", rank: 2 },
        summary: "Lily Tang Williams for Congress",
        canonicalUrl: null,
      },
    },
  } as unknown as PipelineItemState;
  assert.equal(
    buildDeliveryTrail([pointer], input()).promotions[0]!.changeSummary,
    "A lead from a search index (route candidate-marginalia-index, result 2), read at https://lilytangwilliams.com/: Lily Tang Williams for Congress",
  );
});
