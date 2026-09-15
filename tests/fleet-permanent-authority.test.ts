/**
 * FLEET REPORTING RECOGNIZES PDC'S PERMANENT-AUTHORITY PUBLICATION EVIDENCE.
 *
 * Post-PDC the legacy promotion pipeline is retired: the fact chain reaches AUDITED and stops, and
 * there is no APPROVED_FOR_PROMOTION event (tests/fact-chain.test.ts pins that). The still-supported
 * publication signal is PDC's permanent authority — a GOOD `ValidationReceipt` v2 promotion into the
 * permanent civic data plane. This proves the reporting RECOGNIZES that evidence for a record's
 * class/scope (recordClass MEETING) instead of requiring the retired approval and reporting HELD,
 * keeps historical promoter/1 provenance a separate lane, and never treats a non-GOOD receipt or a
 * mismatched scope as a publication. Isolated inputs only: the fact-chain harness's in-memory plane
 * and ValidationReceipt fixtures — no production database, no retired producer.
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import test from "node:test";
import { projectFleetDelivery } from "../lib/control-plane/fleet-delivery.ts";
import { readFleetOperations, projectPermanentAuthority } from "../lib/control-plane/fleet-operations.ts";
import { projectFactChains } from "../lib/control-plane/promotion/fact-chain.ts";
import { readAutonomousActivity } from "../lib/control-plane/workers/activity.ts";
import { VALIDATION_CHECKS, type ValidationReceipt } from "../lib/civic-data/types.ts";
import { factChainHarness, PIMA_CONTRACT } from "./fact-chain-harness.ts";

/** A validated permanent-authority publication (decision GOOD, all eight checks PASS). */
function goodMeetingReceipt(scope: string, validatedAt: string): ValidationReceipt {
  return {
    contractVersion: 2, decision: "GOOD",
    candidateId: "cv-permanent-authority-fixture", sourceId: "src-permanent-authority-fixture",
    recordClass: "MEETING", scope, validatedAt,
    checks: VALIDATION_CHECKS.map((check) => ({ check, verdict: "PASS" as const, code: "PASS", detail: "isolated permanent-authority fixture" })),
    excludedFacts: [],
  };
}

test("Fleet reporting recognizes PDC permanent-authority publication evidence, not the retired approval, and keeps historical evidence separate", async (t) => {
  const h = await factChainHarness();
  t.after(() => rmSync(h.vaultRoot, { recursive: true, force: true, maxRetries: 3 }));
  const text = readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8");
  const research = await h.hold(text, { role: "SCOUT" });
  await h.hold(text, { role: "ACQUIRER" });
  await h.chain(research);
  const options = { readArtifactText: h.readArtifactText, now: h.now(), registryBodyIds: new Set([PIMA_CONTRACT.subjectId]) };
  const held = await projectFactChains(h.repos, options);
  // The retired approval stage is gone; the chain stops at AUDITED (this is what makes the reporting
  // fall to HELD for every item unless it recognizes the permanent authority).
  assert.equal(held.states.filter((s) => s.stage === "APPROVED_FOR_PROMOTION").length, 0);
  assert.ok(held.states.some((s) => s.stage === "AUDITED"));
  const activity = (await readAutonomousActivity(h.repos, undefined, { observedAt: h.now() })).find((v) => v.workItem.id === h.itemId);
  assert.ok(activity);
  const act = activity!;

  // Baseline: with no publication evidence the reporting has only the retired-approval signal, so
  // every item is HELD and carries no permanent-authority promotion.
  const bare = projectFleetDelivery({ activity: act, windows: [] });
  assert.ok(bare.items.length > 0);
  assert.ok(bare.items.every((item) => item.status === "HELD" && item.permanentAuthorityPromotion === null));
  const subject = bare.items[0].subjectId;
  assert.ok(subject);

  await t.test("a GOOD ValidationReceipt v2 for the record's class/scope is recognized, not reported HELD", () => {
    const evidence = projectPermanentAuthority([goodMeetingReceipt(subject!, h.now())]);
    const report = projectFleetDelivery({ activity: act, windows: [], permanentAuthority: evidence });
    const covered = report.items.filter((item) => item.subjectId === subject);
    assert.ok(covered.length > 0);
    assert.ok(covered.every((item) => item.status === "PERMANENT_AUTHORITY_PROMOTED"));
    assert.ok(covered.every((item) => item.permanentAuthorityPromotion?.recordClass === "MEETING" && item.permanentAuthorityPromotion.scope === subject));
    // A validated promotion is in the plane, never a served-reader claim.
    assert.ok(covered.every((item) => item.gaps.includes("SERVED_READER_PROOF_NOT_OBSERVED")));
  });

  await t.test("only a GOOD decision is a publication; FAIL/CANNOT_TELL and a mismatched scope are not recognized", () => {
    const failReceipt: ValidationReceipt = {
      ...goodMeetingReceipt(subject!, h.now()), decision: "FAIL",
      checks: VALIDATION_CHECKS.map((check, index) => ({ check, verdict: index === 0 ? ("FAIL" as const) : ("PASS" as const), code: "X", detail: "fixture" })),
    };
    assert.equal(projectPermanentAuthority([failReceipt]).length, 0, "a non-GOOD receipt is never a publication");
    const failReport = projectFleetDelivery({ activity: act, windows: [], permanentAuthority: projectPermanentAuthority([failReceipt]) });
    assert.ok(failReport.items.every((item) => item.status !== "PERMANENT_AUTHORITY_PROMOTED"));
    const otherScope = projectFleetDelivery({ activity: act, windows: [], permanentAuthority: projectPermanentAuthority([goodMeetingReceipt("ocd-division/country:us/state:az/place:not-this-body", h.now())]) });
    assert.ok(otherScope.items.every((item) => item.status !== "PERMANENT_AUTHORITY_PROMOTED" && item.permanentAuthorityPromotion === null));
  });

  await t.test("the authenticated read reflects permanent-authority evidence as CONNECTED while historical promoter/1 provenance stays a separate lane", async () => {
    const withEvidence = await readFleetOperations(h.repos, { observedAt: h.now(), permanentAuthority: [goodMeetingReceipt(subject!, h.now())] });
    assert.equal(withEvidence.receiptSource?.permanentAuthority, "CONNECTED");
    assert.equal(withEvidence.receiptSource?.permanentAuthorityPromotions?.length, 1);
    assert.equal(withEvidence.receiptSource?.authority, "HISTORICAL_PROMOTER_1", "the historical receipt lane is untouched and stays distinct");
    const without = await readFleetOperations(h.repos, { observedAt: h.now() });
    assert.equal(without.receiptSource?.permanentAuthority, "NOT_CONNECTED");
    assert.deepEqual(without.receiptSource?.permanentAuthorityPromotions, []);
  });
});
