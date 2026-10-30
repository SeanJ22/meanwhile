/**
 * Every story branch produces a next step and never says a record is unobtainable; machine constants are
 * disclosure detail, never a rendered sentence; capacity sentences are computed from the record, or a named gap.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { RECORD_CLASS_WORDS, recordClassWords } from "@/lib/control-plane/plain-work.ts";

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

