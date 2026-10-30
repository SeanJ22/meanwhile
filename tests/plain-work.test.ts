/**
 * Every story branch produces a next step and never says a record is unobtainable; machine constants are
 * disclosure detail, never a rendered sentence; capacity sentences are computed from the record, or a named gap.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { RECORD_CLASS_WORDS, recordClassWords } from "@/lib/control-plane/plain-work.ts";
import { metricGroupLead, researchDigestRows } from "@/lib/control-plane/research-digest.ts";
import type { ResearchMetrics } from "@/lib/control-plane/research-metrics.ts";

/** Every machine constant that must never appear in a rendered sentence. */
const MACHINE = /[A-Z][A-Z0-9]*_[A-Z0-9_]+/;

test("a record class reads as the record, and an unknown one still reads as words", () => {
  assert.equal(recordClassWords("candidate-enrichment"), "candidate record");
  assert.equal(recordClassWords("campaign-finance"), "campaign finance filings");
  assert.equal(recordClassWords("OFFICIAL_MEETING_DOCUMENT_INVENTORY"), "list of the meeting documents published");
  assert.equal(recordClassWords("SOME_NEW_CLASS"), "some new class", "an unmapped class de-underscores rather than throwing");
  assert.equal(recordClassWords(null), "public record");
  assert.equal(recordClassWords("   "), "public record");
  for (const words of Object.values(RECORD_CLASS_WORDS)) assert.doesNotMatch(words, MACHINE);
});

const METRICS: ResearchMetrics = {
  computedAt: "2026-09-06T16:00:00.000Z",
  capacity: { meanUsdPerAttempt: 0.31, measuredAttempts: 9, unmeasuredAttempts: 2, windowHours: 24, ceilingUsd: 25, attemptsPerDayAtCap: 79, denominator: "measured SCOUT cost-ledger entries in the trailing 24h window (9 measured, 2 unmeasured)" },
  ordering: null,
  funnel: {
    stages: [
      { stage: "SCOUTED", count: 22, source: "distinct obligations with a non-refused Scout result in repos.scoutResults" },
      { stage: "VERIFIED", count: 0, source: "none recorded — the promotion pipeline (lib/control-plane/promotion) is another lane's; plug its reader in here (none recorded for VERIFIED)" },
      { stage: "VALIDATED", count: 7, source: "cp_method_candidates/live lifecycle counts" },
      { stage: "ADMITTED", count: 0, source: "cp_method_candidates/live lifecycle counts" },
      { stage: "DETERMINISTIC_REPLAYS", count: 0, source: "deterministic dispatches on routes an ADMITTED candidate learned, from the run records read" },
    ],
    pipelineSource: "none recorded — the promotion pipeline (lib/control-plane/promotion) is another lane's; plug its reader in here",
  },
  share: { thisCycle: { deterministic: 0, model: 0, modelShare: null }, window: { deterministic: 211, model: 21, modelShare: 21 / 232, cycles: 18, since: "2026-09-01T00:00:00.000Z" }, delta: null },
  cacheByRole: [],
  costPerOutcome: [],
  cacheDefects: { defective: 0, instrumented: 0 },
};

test("SEEDED: the capacity lead is COMPUTED from the record, to the cent, and becomes a named gap when nothing was measured", () => {
  // e.g. "the $25 daily limit buys about 79 Scout attempts at roughly $0.31 each."
  const lead = metricGroupLead(METRICS);
  assert.equal(lead.capacity, "The $25.00 daily budget buys about 79 scout attempts at $0.31 each.");
  // Positive control: it moves with the record rather than being written in.
  const cheaper = metricGroupLead({ ...METRICS, capacity: { ...METRICS.capacity, meanUsdPerAttempt: 0.05, attemptsPerDayAtCap: 500 } });
  assert.equal(cheaper.capacity, "The $25.00 daily budget buys about 500 scout attempts at $0.05 each.");
  // Nothing measured is a named gap, never a zero and never a silent omission.
  const unmeasured = metricGroupLead({ ...METRICS, capacity: { ...METRICS.capacity, meanUsdPerAttempt: null, attemptsPerDayAtCap: null, measuredAttempts: 0, unmeasuredAttempts: 4 } });
  assert.match(unmeasured.capacity ?? "", /^Not measured yet: none of the 4 scout attempt\(s\)/);
  assert.match(unmeasured.capacity ?? "", /It is not that the budget buys nothing\./);
});

test("SEEDED: a zero share says WHY, and the two reasons for a zero are told apart (ADM-47)", () => {
  assert.equal(
    metricGroupLead(METRICS).share,
    "0% model work this cycle — nothing was dispatched at all, so there was nothing to split between a paid model and plain code.",
  );
  const allPlainCode = metricGroupLead({ ...METRICS, share: { ...METRICS.share, thisCycle: { deterministic: 9, model: 0, modelShare: 0 } } });
  assert.match(allPlainCode.share ?? "", /^0% model work this cycle — all 9 job\(s\) ran as plain code/);
  const mixed = metricGroupLead({ ...METRICS, share: { ...METRICS.share, thisCycle: { deterministic: 9, model: 1, modelShare: 0.1 } } });
  assert.match(mixed.share ?? "", /^10\.0% of this cycle's 10 job\(s\) needed a paid model/);
});

test("SEEDED: a funnel zero says which kind of zero it is, and no row prints a code path (ADM-46)", () => {
  const rows = researchDigestRows(METRICS).funnel;
  const byLabel = new Map(rows.map((r) => [r.label, r]));
  assert.deepEqual([...byLabel.keys()], ["Found by a hunter", "Checked against the source", "Methods that passed validation", "Methods admitted to the toolbox", "Repeat runs without a model"]);
  // A disconnected stage says it is disconnected, not empty.
  assert.match(byLabel.get("Checked against the source")?.meaning ?? "", /Not counted yet — this stage's data is not connected to this view/);
  assert.equal(byLabel.get("Checked against the source")?.denominator, "counted by the promotion pipeline once it is connected to this view");
  // A real zero says why it is really zero.
  assert.match(byLabel.get("Methods admitted to the toolbox")?.meaning ?? "", /a work session's decision, and none of the 7 that passed validation has been admitted yet/);
  assert.match(byLabel.get("Repeat runs without a model")?.meaning ?? "", /no method has been admitted, so there is nothing for ordinary code to replay/);
  // A non-zero stage gets no why-zero clause.
  assert.doesNotMatch(byLabel.get("Found by a hunter")?.meaning ?? "", /Zero/);
  // No code path leads. Every one of them survives in the disclosure line.
  for (const row of rows) {
    assert.doesNotMatch(row.denominator, /repos\.|lib\/|data\/|\.json|\.ts/, `${row.label} prints a code path as its denominator`);
    assert.ok((row.technical ?? "").length > 0, `${row.label} lost the instrument's own words`);
  }
  assert.match(rows[1].technical ?? "", /lib\/control-plane\/promotion/, "the code path is kept, one disclosure away");
  // The group lead counts the disconnected stages rather than implying the pipeline is empty.
  assert.match(metricGroupLead(METRICS).funnel ?? "", /1 of the stages below are not connected to this view yet/);
});

test("the plain rows carry dollars to the cent, never four decimal places", () => {
  const rows = researchDigestRows(METRICS);
  assert.equal(rows.capacity[1].value, "$0.31");
  for (const group of Object.values(rows)) {
    for (const row of group) assert.doesNotMatch(row.value, /\$\d+\.\d{3,}/, `${row.label} prints more than cents`);
  }
});
