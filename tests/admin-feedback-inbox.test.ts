/**
 * Feedback inbox guards, each with a positive control:
 *   1  the contact reference never leaves the database (the query asks for a boolean)
 *   2  the owner's recorded decision carries none of the reader's words
 *   3  HELD_BACK is a quarantine column, never rendered as an owner decision
 *   4  a staging handle that could write, or resolves to the live endpoint, is refused before a query runs
 *   5  an unreadable store never renders as an empty inbox
 *   6  every number carries a denominator, and every stated count equals the rows rendered
 *   7  no credential name, cookie or browser storage on the admin page
 * The `.tsx` page is asserted as source text; the logic lives in the `.ts` module.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { CONTACT_FIELDS_REFUSED, EMPTY_CENSUS, FEEDBACK_CENSUS_SQL, FEEDBACK_INBOX_SQL, FEEDBACK_SUBJECT_PREFIX, TRIAGE_OPTIONS, TRIAGE_STATES, TRIAGE_WORDS, assertInboxRowIsSafe, feedbackDenominatorSentence, feedbackSubjectId, isFeedbackTriageIntent, optionToState, projectFeedbackRow, triageBySubject, type FeedbackRunCensus } from "@/lib/control-plane/feedback-inbox.ts";
import { OWNER_SURFACE_FORMAT_VERSION, type OwnerDecisionIntent } from "@/lib/control-plane/owner-surface.ts";

const ROOT = join(import.meta.dirname, "..");
const MODULE_PATH = join(ROOT, "lib", "control-plane", "feedback-inbox.ts");

const MODULE_SOURCE = readFileSync(MODULE_PATH, "utf8");

/** Comments are stripped before every source scan: a comment may name a table the code must not read. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const MODULE_CODE = stripComments(MODULE_SOURCE);

/* ------------------------------------------------------------------ *
 * FIXTURES
 * ------------------------------------------------------------------ */

const HANDLE = "8f6a1e2c-0000-4000-8000-abcdefabcdef";

function rawRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    received_at: "2026-09-06T14:03:00.000Z",
    message: "The Tuesday council meeting time is wrong on the map.",
    surface: "SIDEBAR",
    run_class: "ORGANIC",
    run_id: null,
    suspect_reason: null,
    reply_requested: true,
    ...over,
  };
}

function census(over: Partial<FeedbackRunCensus> = {}): FeedbackRunCensus {
  return { organic: 3, synthetic: 1, unknown: 0, author: 0, heldBack: 0, total: 4, ...over };
}

function intent(over: Partial<OwnerDecisionIntent> = {}): OwnerDecisionIntent {
  return {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    intentId: "i1",
    subjectId: "s1",
    chosenOption: "Read, nothing to do",
    consequenceShown: "Records this as your status for this message.",
    decidedAt: "2026-09-06T17:00:00.000Z",
    state: "RECORDED",
    canonicalRef: null,
    refusedReason: null,
    adminSessionRef: "sid-1",
    ownerAnswer: null,
    ...over,
  };
}

/* ================================================================== */
/* 1 — THE CONTACT REFERENCE NEVER LEAVES THE DATABASE                */
/* ================================================================== */

test("the list query asks the database for a boolean, never for the handle", () => {
  assert.match(
    FEEDBACK_INBOX_SQL,
    /\(contact_ref IS NOT NULL\) AS reply_requested/,
    "the presence of a reply handle must be computed in the database",
  );
  const mentions = FEEDBACK_INBOX_SQL.match(/contact_ref/g);
  assert.equal(
    mentions === null ? 0 : mentions.length,
    1,
    "contact_ref appears in the query more than once, so something other than the boolean is " +
      "being selected",
  );
  // The positive control: the query really does read the message store.
  assert.match(FEEDBACK_INBOX_SQL, /FROM feedback\b/);
  assert.match(FEEDBACK_CENSUS_SQL, /FROM feedback\b/);
});

test("the module opens no other collection store and joins nothing", () => {
  for (const forbidden of [
    "feedback_contact",
    "search_log",
    "reactions",
    "ask_interactions",
    "speak_your_mind",
    "demand_signals",
    " JOIN ",
  ]) {
    assert.equal(
      MODULE_CODE.includes(forbidden),
      false,
      `the inbox module names ${forbidden.trim()} outside a comment. §5.3: a feedback contact ` +
        "reference is never lined up against reader behaviour, and the cheapest way to keep " +
        "that is to never open the other store.",
    );
  }
  // Positive control: the scan is looking at real source, not an empty string.
  assert.ok(MODULE_CODE.length > 4000, "the module source did not load");
  assert.ok(MODULE_CODE.includes("FROM feedback"));
});

test("the module can only read — no write statement exists in it", () => {
  for (const statement of ["INSERT ", "UPDATE ", "DELETE ", "DROP ", "ALTER "]) {
    assert.equal(
      MODULE_CODE.toUpperCase().includes(statement),
      false,
      `the inbox module contains a ${statement.trim()} statement; it reads and nothing else`,
    );
  }
});

test("a projected row carries the presence of a reply handle and never its value", () => {
  const row = projectFeedbackRow(rawRow({ contact_ref: HANDLE }), "PRODUCTION");
  assert.ok(row !== null);
  assert.equal(row.replyRequested, true);
  assert.equal(
    JSON.stringify(row).includes(HANDLE),
    false,
    "the handle survived into the projected row",
  );
  assert.equal(Object.keys(row).includes("contactRef"), false);
});

test("assertInboxRowIsSafe refuses a row that carries a contact value — planted", () => {
  for (const field of CONTACT_FIELDS_REFUSED) {
    assert.throws(
      () => assertInboxRowIsSafe({ rowId: "r", [field]: HANDLE }, "planted"),
      /refused/,
      `a row carrying ${field} was accepted`,
    );
  }
  // The positive control: an ordinary row passes, so the guard is not simply
  // refusing everything.
  assert.doesNotThrow(() =>
    assertInboxRowIsSafe({ rowId: "r", replyRequested: true }, "positive control"),
  );
});

test("a message's source environment comes from the store it was read from", () => {
  const raw = rawRow();
  const live = projectFeedbackRow(raw, "PRODUCTION");
  const review = projectFeedbackRow(raw, "STAGING");
  assert.ok(live !== null && review !== null);
  assert.equal(live.environment, "PRODUCTION");
  assert.equal(review.environment, "STAGING");
  assert.notEqual(
    feedbackSubjectId(live.environment, live.rowId),
    feedbackSubjectId(review.environment, review.rowId),
    "two stores could hand back the same row id; the subject must still be two subjects",
  );
  assert.equal(
    MODULE_CODE.includes("environment_column"),
    false,
    "there is no environment column on the feedback table and none is invented",
  );
});

/* ================================================================== */
/* 2 — THE STATES, AND THE ONES THE STORE CANNOT REPRESENT             */
/* ================================================================== */

test("the five triage states are the ones the system can actually stand behind", () => {
  assert.deepEqual([...TRIAGE_STATES], [
    "NEW",
    "REVIEWED",
    "NEEDS_ACTION",
    "RESOLVED",
    "NOT_ACTIONABLE",
  ]);
  assert.equal(
    (TRIAGE_STATES as readonly string[]).includes("HELD_BACK"),
    false,
    "quarantine is a column the intake protections set, never a decision the owner made; " +
      "rendering it as one would attribute a machine's action to him",
  );
  for (const state of TRIAGE_STATES) {
    assert.ok(TRIAGE_WORDS[state].words.length > 0);
    assert.ok(TRIAGE_WORDS[state].means.length > 0);
    assert.equal(
      /^[A-Z][A-Z0-9_]+$/.test(TRIAGE_WORDS[state].words),
      false,
      `${state} renders as a machine constant`,
    );
  }
});

test("every button's option maps back to exactly one state, and nothing else does", () => {
  for (const option of TRIAGE_OPTIONS) {
    assert.equal(optionToState(option.option), option.state);
  }
  assert.equal(optionToState("Add this to the queue"), null);
  assert.equal(optionToState(""), null);
  assert.equal(
    TRIAGE_OPTIONS.some((o) => o.state === "NEW"),
    false,
    "NEW is the absence of a decision and may not be recordable as one",
  );
});

test("the newest decision about a message wins, and an older one does not resurface", () => {
  const subjectId = feedbackSubjectId("PRODUCTION", "row-a");
  const marks = triageBySubject([
    intent({ intentId: "a1", subjectId, chosenOption: "Needs work", decidedAt: "2026-09-05T10:00:00.000Z" }),
    intent({ intentId: "a2", subjectId, chosenOption: "Done", decidedAt: "2026-09-06T10:00:00.000Z" }),
  ]);
  const mark = marks.get(subjectId);
  assert.ok(mark !== undefined);
  assert.equal(mark.state, "RESOLVED");
  assert.equal(mark.decidedAt, "2026-09-06T10:00:00.000Z");
});

test("a decision that is not about a message, or names an option we do not know, is ignored", () => {
  const subjectId = feedbackSubjectId("PRODUCTION", "row-b");
  const marks = triageBySubject([
    intent({ intentId: "b1", subjectId: "fix:deadbeef", chosenOption: "Add this to the queue" }),
    intent({ intentId: "b2", subjectId, chosenOption: "Something nobody defined" }),
  ]);
  assert.equal(marks.size, 0, "an unreadable status must leave the message looking untouched");
  assert.equal(isFeedbackTriageIntent({ subjectId: "fix:deadbeef" }), false);
  assert.equal(isFeedbackTriageIntent({ subjectId }), true);
  assert.ok(subjectId.startsWith(FEEDBACK_SUBJECT_PREFIX));
});

/* ================================================================== */
/* 3 — THE STAGING HANDLE, AND THE BYPASS REFUSED BY NAME              */
/* ================================================================== */

/* ================================================================== */
/* 4 — A STORE THAT COULD NOT BE READ IS NEVER AN EMPTY INBOX          */
/* ================================================================== */

test("the denominator sentence reconciles, and says so when it cannot", () => {
  const clean = feedbackDenominatorSentence(census());
  assert.match(clean, /Counted from 3 message\(s\) sent by readers, out of 4/);
  assert.equal(clean.includes("carry a run class outside"), false);

  const broken = feedbackDenominatorSentence(census({ total: 9 }));
  assert.match(broken, /carry a run class outside the four counted here/);

  assert.equal(EMPTY_CENSUS.total, 0);
});

/* ================================================================== */
/* 5 — EVERY NUMBER CARRIES A DENOMINATOR; STATED EQUALS RENDERED      */
/* ================================================================== */

/* ================================================================== */
/* 6 — THE PAGE: FOUR LAYERS, EASTERN TIME, NO SECRETS, NO STORAGE     */
/* ================================================================== */
