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

import {
  CONTACT_FIELDS_REFUSED,
  EMPTY_CENSUS,
  ENVIRONMENT_WORDS,
  FEEDBACK_CENSUS_SQL,
  FEEDBACK_ENVIRONMENTS,
  FEEDBACK_INBOX_SQL,
  FEEDBACK_STORE_VAR,
  FEEDBACK_SUBJECT_PREFIX,
  PRODUCTION_FEEDBACK_URL_VAR,
  STAGING_STORE_URL_VAR,
  STAGING_OWNER_ACTION,
  TRIAGE_CONSEQUENCE,
  TRIAGE_OPTIONS,
  TRIAGE_STATES,
  TRIAGE_WORDS,
  assertInboxRowIsSafe,
  buildFeedbackInboxView,
  countClaimsOf,
  feedbackDenominatorSentence,
  feedbackSubjectId,
  isFeedbackTriageIntent,
  openFeedbackStore,
  optionToState,
  projectFeedbackRow,
  readFeedbackStore,
  renderedNumbersOf,
  triageBySubject,
  type EnvironmentView,
  type FeedbackEnvironment,
  type FeedbackInboxRow,
  type FeedbackRunCensus,
  type StoreReading,
} from "@/lib/control-plane/feedback-inbox.ts";
import {
  OWNER_SURFACE_FORMAT_VERSION,
  assertAggregateOnly,
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  type OwnerDecisionIntent,
} from "@/lib/control-plane/owner-surface.ts";
import type { Sql } from "@/lib/control-plane/repository/pg-store.ts";

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

function reading(
  environment: FeedbackEnvironment,
  rows: readonly Record<string, unknown>[],
  over: Partial<FeedbackRunCensus> = {},
): StoreReading {
  const projected: FeedbackInboxRow[] = [];
  for (const r of rows) {
    const one = projectFeedbackRow(r, environment);
    if (one !== null) projected.push(one);
  }
  return {
    environment,
    readAt: "2026-09-06T18:00:00.000Z",
    rows: projected,
    unreadable: rows.length - projected.length,
    census: census({ total: Math.max(4, projected.length), ...over }),
  };
}

function connected(environment: FeedbackEnvironment, read: StoreReading | null): EnvironmentView {
  return {
    environment,
    connected: read !== null,
    says: "a reading",
    action: null,
    reading: read,
  };
}

function gatedStaging(): EnvironmentView {
  return {
    environment: "STAGING",
    connected: false,
    says: "The console has no connection to the review site's message store.",
    action: STAGING_OWNER_ACTION,
    reading: null,
  };
}

function intent(over: Partial<OwnerDecisionIntent> = {}): OwnerDecisionIntent {
  return {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    intentId: "i1",
    subjectId: "s1",
    chosenOption: "Read, nothing to do",
    consequenceShown: TRIAGE_CONSEQUENCE,
    decidedAt: "2026-09-06T17:00:00.000Z",
    state: "RECORDED",
    canonicalRef: null,
    refusedReason: null,
    adminSessionRef: "sid-1",
    ownerAnswer: null,
    ...over,
  };
}

function fakeSql(list: readonly Record<string, unknown>[], counted: Record<string, unknown>) {
  const asked: string[] = [];
  const sql: Sql = {
    async query(text: string) {
      asked.push(text);
      if (text === FEEDBACK_CENSUS_SQL) return [counted];
      return list;
    },
  };
  return { sql, asked };
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

test("the decision recorded about a message carries none of the reader's words", () => {
  const row = projectFeedbackRow(rawRow(), "PRODUCTION");
  assert.ok(row !== null);
  const subjectId = feedbackSubjectId(row.environment, row.rowId);

  assert.equal(subjectId.includes(row.message), false);
  assert.equal(TRIAGE_CONSEQUENCE.includes(row.message), false);
  assert.equal(subjectId.includes(HANDLE), false);
  assert.match(subjectId, /^feedback:PRODUCTION:11111111-/);

  // What the console would append; it must survive the aggregate-only walk and carry no message text.
  const recorded = intent({ subjectId, intentId: `${subjectId}:2026-09-06T17:00:00.000Z` });
  assert.doesNotThrow(() => assertAggregateOnly(recorded, "feedback triage"));
  assert.equal(JSON.stringify(recorded).includes(row.message), false);

  // Positive control: the walk really would catch reader text under a reader
  // field name, so the assertion above is not vacuous.
  assert.throws(
    () => assertAggregateOnly({ ...recorded, freeText: row.message }, "planted"),
    /refused/,
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

test("quarantine and triage are separate facts, and neither hides the other", () => {
  const held = rawRow({ id: "held-1", suspect_reason: "VELOCITY", received_at: "2026-09-06T10:00:00.000Z" });
  const clean = rawRow({ id: "clean-1", received_at: "2026-09-06T11:00:00.000Z" });
  const view = buildFeedbackInboxView({
    environments: [connected("PRODUCTION", reading("PRODUCTION", [held, clean]))],
    decisions: [],
  });

  assert.equal(view.items.length, 2, "a quarantined message is shown, never dropped");
  assert.equal(view.heldBack, 1);
  assert.equal(view.byState.NEW, 2, "quarantine does not set a status on the owner's behalf");
  assert.equal(
    view.waiting,
    1,
    "a quarantined message is not counted as work waiting on him until he looks at it",
  );
});

/* ================================================================== */
/* 3 — THE STAGING HANDLE, AND THE BYPASS REFUSED BY NAME              */
/* ================================================================== */

const LIVE_URL = "postgresql://app_owner:secret@ep-live.example.neon.tech/wtp";
const STAGING_RW = "postgresql://app_owner:secret@ep-staging.example.neon.tech/wtp";
const STAGING_RO = "postgresql://readonly:secret@ep-staging.example.neon.tech/wtp";

/** The refusal, narrowed — a handle that opened where it should not have is the failure. */
function refusalOf(
  environment: FeedbackEnvironment,
  env: Record<string, string | undefined>,
): { reason: string; says: string; action: string | null } {
  const handle = openFeedbackStore(environment, env);
  if (handle.ok) assert.fail(`${environment} opened a store it should have refused`);
  return { reason: handle.reason, says: handle.says, action: handle.action };
}

test("with no connection the review site is a named gap, with the owner action spelled out", () => {
  const refusal = refusalOf("STAGING", { [PRODUCTION_FEEDBACK_URL_VAR]: LIVE_URL });
  assert.equal(refusal.reason, "NOT_CONNECTED");
  assert.equal(refusal.action, STAGING_OWNER_ACTION);
  assert.match(refusal.says, /have not been lost/);
});

test("a review-site handle that can write is refused before a query runs", () => {
  const refusal = refusalOf("STAGING", {
    [PRODUCTION_FEEDBACK_URL_VAR]: LIVE_URL,
    [STAGING_STORE_URL_VAR]: STAGING_RW,
  });
  assert.equal(refusal.reason, "NOT_READ_ONLY");
});

test("a review-site handle that IS the live handle is refused as the bypass it would be", () => {
  const refusal = refusalOf("STAGING", {
    [PRODUCTION_FEEDBACK_URL_VAR]: LIVE_URL,
    [STAGING_STORE_URL_VAR]: LIVE_URL,
  });
  assert.equal(refusal.reason, "SAME_STORE_AS_LIVE");
});

test("a review-site connection whose isolation cannot be established is refused, not read", () => {
  const refusal = refusalOf("STAGING", {
    // No scheme, but an `@` and a `:` — a connection string that failed to
    // parse, which the isolation module refuses to read as a bare host.
    [PRODUCTION_FEEDBACK_URL_VAR]: "app_owner@ep-live.example.neon.tech:5432/wtp",
    [STAGING_STORE_URL_VAR]: STAGING_RO,
  });
  assert.equal(
    refusal.reason,
    "UNPROVEN_ISOLATION",
    "null is not false: a pair whose endpoints could not be established must refuse, so nothing " +
      "can be permitted by failing to measure",
  );
});

test("a read-only handle on its own branch opens — the positive control", () => {
  const handle = openFeedbackStore("STAGING", {
    [PRODUCTION_FEEDBACK_URL_VAR]: LIVE_URL,
    [STAGING_STORE_URL_VAR]: STAGING_RO,
  });
  assert.equal(handle.ok, true, "a correctly provisioned read-only handle must actually open");
});

test("an unset live store is an ordinary state, told plainly and with nothing to do", () => {
  const refusal = refusalOf("PRODUCTION", {});
  assert.equal(refusal.reason, "NOT_CONNECTED");
  assert.equal(refusal.action, null);
});

test("no refusal the owner reads names a credential or a variable", () => {
  const said: string[] = [STAGING_OWNER_ACTION];
  for (const environment of FEEDBACK_ENVIRONMENTS) {
    const refusal = refusalOf(environment, {});
    said.push(refusal.says);
    if (refusal.action !== null) said.push(refusal.action);
  }
  const writable = refusalOf("STAGING", {
    [PRODUCTION_FEEDBACK_URL_VAR]: LIVE_URL,
    [STAGING_STORE_URL_VAR]: STAGING_RW,
  });
  said.push(writable.says);
  const bypass = refusalOf("STAGING", {
    [PRODUCTION_FEEDBACK_URL_VAR]: LIVE_URL,
    [STAGING_STORE_URL_VAR]: LIVE_URL,
  });
  said.push(bypass.says);

  for (const sentence of said) {
    assert.equal(
      /[A-Z][A-Z0-9]*_[A-Z0-9_]+/.test(sentence),
      false,
      `a sentence the owner reads carries a machine name: ${sentence}`,
    );
    assert.equal(sentence.includes("postgres"), false);
    assert.equal(sentence.includes("secret"), false);
  }
  // Positive control: the detector fires on the real variable names.
  assert.equal(/[A-Z][A-Z0-9]*_[A-Z0-9_]+/.test(STAGING_STORE_URL_VAR), true);
  assert.equal(FEEDBACK_STORE_VAR.PRODUCTION, PRODUCTION_FEEDBACK_URL_VAR);
  assert.equal(FEEDBACK_STORE_VAR.STAGING, STAGING_STORE_URL_VAR);
});

/* ================================================================== */
/* 4 — A STORE THAT COULD NOT BE READ IS NEVER AN EMPTY INBOX          */
/* ================================================================== */

test("a reading returns the rows, the census and the rows it could not read", async () => {
  const { sql, asked } = fakeSql(
    [rawRow(), rawRow({ id: "", message: "" })],
    { organic: 5, synthetic: 2, unknown: 1, author: 0, held_back: 1, total: 8 },
  );
  const outcome = await readFeedbackStore(sql, "PRODUCTION", "2026-09-06T18:00:00.000Z", 50);
  assert.equal(outcome.kind, "HELD");
  if (outcome.kind !== "HELD") return;
  assert.equal(outcome.value.rows.length, 1);
  assert.equal(outcome.value.unreadable, 1, "a row that could not be read is counted, not dropped");
  assert.equal(outcome.value.census.total, 8);
  assert.equal(outcome.value.census.organic, 5);
  assert.equal(asked.length, 2, "the list and its denominator are read together");
  assert.ok(asked.includes(FEEDBACK_INBOX_SQL));
  assert.ok(asked.includes(FEEDBACK_CENSUS_SQL));
});

test("a store that throws reports that it could not be asked, and holds no rows", async () => {
  const sql: Sql = {
    async query() {
      throw new Error("connection refused");
    },
  };
  const outcome = await readFeedbackStore(sql, "STAGING", "2026-09-06T18:00:00.000Z");
  assert.equal(outcome.kind, "STORE_UNREACHABLE");
  if (outcome.kind !== "STORE_UNREACHABLE") return;
  assert.match(outcome.detail, /nothing is being claimed/);
  assert.equal(outcome.detail.includes("0 messages"), false);
});

test("an unread review store leaves the inbox owner-gated, never silently active", () => {
  const gated = buildFeedbackInboxView({
    environments: [connected("PRODUCTION", reading("PRODUCTION", [rawRow()])), gatedStaging()],
    decisions: [],
  });
  assert.equal(gated.stagingFeedback, "OWNER_GATED");
  assert.equal(gated.stagingAction, STAGING_OWNER_ACTION);

  const active = buildFeedbackInboxView({
    environments: [
      connected("PRODUCTION", reading("PRODUCTION", [rawRow()])),
      connected("STAGING", reading("STAGING", [rawRow({ id: "s-1" })])),
    ],
    decisions: [],
  });
  assert.equal(active.stagingFeedback, "ACTIVE");
  assert.equal(active.items.length, 2);
  assert.deepEqual(
    active.items.map((i) => i.row.environment).sort(),
    ["PRODUCTION", "STAGING"],
    "a review-site message is listed beside a live one, labelled, never merged into it",
  );
});

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

test("every number this view prints carries a denominator and a contract", () => {
  const view = buildFeedbackInboxView({
    environments: [
      connected("PRODUCTION", reading("PRODUCTION", [rawRow(), rawRow({ id: "r2", suspect_reason: "VELOCITY" })])),
      gatedStaging(),
    ],
    decisions: [intent({ subjectId: feedbackSubjectId("PRODUCTION", "11111111-2222-4333-8444-555555555555"), chosenOption: "Needs work" })],
  });
  const verdict = auditRenderedNumbers(renderedNumbersOf(view));
  assert.equal(verdict.ok, true, verdict.detail);
  assert.ok(verdict.checked >= 10, `only ${verdict.checked} number(s) declared`);

  const claims = checkStatedEqualsRendered(countClaimsOf(view));
  assert.equal(claims.ok, true, claims.detail);

  assert.equal(view.byState.NEEDS_ACTION, 1, "the recorded decision reached the message");
  assert.equal(view.byState.NEW, 1);
});

test("the stated-equals-rendered check really would catch a drift — planted", () => {
  const view = buildFeedbackInboxView({
    environments: [connected("PRODUCTION", reading("PRODUCTION", [rawRow()]))],
    decisions: [],
  });
  const tampered = { ...view, byState: { ...view.byState, NEW: view.byState.NEW + 1 } };
  const claims = checkStatedEqualsRendered(countClaimsOf(tampered));
  assert.equal(claims.ok, false, "a stated count larger than the rendered rows was not caught");
});

test("a console with no store connected states nothing rather than zero readers", () => {
  const view = buildFeedbackInboxView({
    environments: [
      { environment: "PRODUCTION", connected: false, says: "not connected", action: null, reading: null },
      gatedStaging(),
    ],
    decisions: [],
  });
  assert.equal(view.items.length, 0);
  assert.equal(view.shown.denominator, 0);
  assert.equal(auditRenderedNumbers(renderedNumbersOf(view)).ok, true);
  assert.equal(checkStatedEqualsRendered(countClaimsOf(view)).ok, true);
});

/* ================================================================== */
/* 6 — THE PAGE: FOUR LAYERS, EASTERN TIME, NO SECRETS, NO STORAGE     */
/* ================================================================== */
