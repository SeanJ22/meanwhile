import assert from "node:assert/strict";
import type { PromotionOutcome } from "../../lib/civic-data/promotion.ts";
import { promotionProofIssue } from "../../lib/civic-data/read-model.ts";
import { parseValidationReceipt } from "../../lib/civic-data/receipt.ts";
import { parseReaderProjectionReadback, READER_PROJECTION_READBACK_PREFIX } from "../../lib/civic-data/reader-readback.ts";
import { CANDIDATE_STATES, type CandidateEvent } from "../../lib/civic-data/types.ts";
import DATA from "./retained-lkg-promotion.json" with { type: "json" };

/** The historical pointer, candidate hashes, receipts and event identities stay one immutable fixture. */
const value: unknown = DATA;
assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
export const RETAINED_LKG_FIXTURE = value as { readonly outcome: PromotionOutcome; readonly events: readonly CandidateEvent[] };
const { outcome, events } = RETAINED_LKG_FIXTURE;
assert.ok(outcome && outcome.candidate && outcome.candidate.candidate && outcome.promoted);
assert.ok(parseValidationReceipt(outcome.candidate.receipt));
assert.ok(parseValidationReceipt(outcome.promoted.receipt));
assert.ok(parseReaderProjectionReadback(READER_PROJECTION_READBACK_PREFIX + JSON.stringify(outcome.readerReadback)));
const candidate = outcome.candidate.candidate;
assert.equal(promotionProofIssue(candidate.recordClass, candidate.scope, outcome.promoted, outcome.candidate), null);
assert.ok(Array.isArray(events));
for (const event of events) {
  assert.equal(event.candidateId, candidate.id);
  assert.ok(Number.isInteger(event.sequence) && event.sequence > 0);
  assert.ok(CANDIDATE_STATES.includes(event.state));
  assert.ok(typeof event.at === "string" && Number.isFinite(Date.parse(event.at)));
  assert.equal(typeof event.detail, "string");
}
