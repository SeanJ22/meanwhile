import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  answers,
  assertAnswerable,
  evidenceRecordsFor,
  RecordClassRefused,
  ruleOnQuestion,
} from "../lib/answerability/record-class.ts";
import { NEVER_READ } from "../lib/ops/freshness.ts";
import {
  classifyRollCall,
  collectEventOutcomes,
  dispositionGap,
  hasRecordedAction,
  isFailedExtraction,
  minutesPointerFor,
  readDisposition,
  receiptFor,
  rollCallGap,
  rollCallRecordFrom,
  toAgendaRecords,
  toOutcomeRecords,
  type OutcomeContext,
} from "../lib/sources/legistar/outcomes.ts";
import type {
  LegistarEvent,
  LegistarEventItem,
  LegistarVote,
} from "../lib/sources/legistar/types.ts";

function load<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/legistar/${name}`, import.meta.url), "utf8"),
  ) as T;
}

const EVENT_1825 = load<LegistarEvent>("pima-event-1825.json");
const ITEMS_1825 = load<LegistarEventItem[]>("pima-eventitems-1825.json");
const ITEMS_1821 = load<LegistarEventItem[]>("pima-eventitems-1821.json");
const VOTES_329182 = load<LegistarVote[]>("pima-votes-329182.json");
const VOTES_329170 = load<LegistarVote[]>("pima-votes-329170.json");
const VOTES_329177 = load<LegistarVote[]>("pima-votes-329177.json");
const VOTES_323718 = load<LegistarVote[]>("pima-votes-323718.json");

/** The stamp is minted from the recorded read by the same call the live path makes. */
const CONTEXT: OutcomeContext = {
  slug: "pima",
  eventId: 1825,
  sourceOrg: "Pima County Clerk of the Board",
  readOn: receiptFor(
    "https://webapi.legistar.com/v1/pima/events/1825/eventitems",
    ITEMS_1825,
    new Date("2026-08-29T12:00:00.000Z"),
  ),
};
const CONTEXT_1821: OutcomeContext = { ...CONTEXT, eventId: 1821 };

const itemById = (items: LegistarEventItem[], id: number): LegistarEventItem => {
  const found = items.find((item) => item.EventItemId === id);
  assert.ok(found, `fixture is missing event item ${id}`);
  return found;
};

/** An acted item that carries a real per-person roll call. */
const ACTED_WITH_ROLL_CALL = itemById(ITEMS_1825, 329182);
/** The literal "ROLL CALL" attendance item: flagged, no action, zero rows. */
const ROLL_CALL_FLAGGED = itemById(ITEMS_1825, 329170);
/** An item nobody put a question on. */
const NO_ACTION = itemById(ITEMS_1825, 329177);
/** Action, Pass, "unanimously carried by a 5-0 vote", and zero per-person rows. */
const TALLY_ONLY = itemById(ITEMS_1821, 323718);

test("the recorded fixtures carry the shape and the counts claimed for them", () => {
  assert.equal(ITEMS_1825.length, 135);
  assert.equal(ITEMS_1821.length, 145);

  assert.equal(ITEMS_1825.filter((i) => i.EventItemActionName).length, 58);
  assert.equal(ITEMS_1825.filter((i) => i.EventItemPassedFlagName).length, 57);
  assert.equal(ITEMS_1825.filter((i) => i.EventItemRollCallFlag === 1).length, 1);

  assert.equal(ACTED_WITH_ROLL_CALL.EventItemActionName, "approve");
  assert.equal(ACTED_WITH_ROLL_CALL.EventItemPassedFlagName, "Pass");
  assert.equal(ACTED_WITH_ROLL_CALL.EventItemMover, "Rex Scott");
  assert.equal(ACTED_WITH_ROLL_CALL.EventItemSeconder, "Steve Christy");

  assert.equal(VOTES_329182.length, 5);
  assert.equal(VOTES_329170.length, 0);
  assert.equal(VOTES_329177.length, 0);
  assert.equal(VOTES_323718.length, 0);

  // Both fixtures, every flag: "Pass" or nothing. Never "Fail".
  const flags = new Set(
    [...ITEMS_1825, ...ITEMS_1821]
      .map((i) => i.EventItemPassedFlagName)
      .filter((f): f is string => typeof f === "string"),
  );
  assert.deepEqual([...flags], ["Pass"]);
});

test("INVARIANT 1 seeded failure: an item with no recorded action never reads as a defeat", () => {
  assert.equal(NO_ACTION.EventItemActionName ?? null, null);
  assert.equal(NO_ACTION.EventItemPassedFlagName, null);

  const read = readDisposition(NO_ACTION);
  assert.equal(read.disposition, "NOT_RECORDED");
  assert.notEqual(read.disposition, "FAILED");

  assert.equal(hasRecordedAction(NO_ACTION), false);
  const outcomes = toOutcomeRecords([NO_ACTION], CONTEXT);
  assert.equal(outcomes.length, 0);

  const gap = dispositionGap(NO_ACTION);
  assert.ok(gap);
  assert.match(gap, /carries no action at all/);
  assert.match(gap, /not a record of it failing/);
  assert.doesNotMatch(gap, /\bfailed to pass\b|\bdid not pass\b|\bdefeated\b/i);
});

test("INVARIANT 1 positive control: the legitimate nearby case still reads as passed", () => {
  const read = readDisposition(ACTED_WITH_ROLL_CALL);
  assert.equal(read.disposition, "PASSED");
  assert.equal(read.raw, "Pass");
  assert.equal(read.conflict, null);
  assert.equal(dispositionGap(ACTED_WITH_ROLL_CALL), null);

  const outcomes = toOutcomeRecords([ACTED_WITH_ROLL_CALL], CONTEXT);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].disposition, "PASSED");
  assert.equal(outcomes[0].action, "approve");
  assert.equal(outcomes[0].mover, "Rex Scott");
});

test("INVARIANT 1 at corpus scale: 135 items yield 58 outcome records, not 135", () => {
  const agenda = toAgendaRecords(ITEMS_1825, CONTEXT);
  const outcomes = toOutcomeRecords(ITEMS_1825, CONTEXT);

  assert.equal(agenda.length, 135);
  assert.equal(outcomes.length, 58);
  assert.notEqual(agenda.length, outcomes.length);

  assert.equal(outcomes.filter((o) => o.disposition === "FAILED").length, 0);
  assert.equal(outcomes.filter((o) => o.disposition === "PASSED").length, 57);
  assert.equal(outcomes.filter((o) => o.disposition === "NOT_RECORDED").length, 1);
  // The one NOT_RECORDED is an acted item with no flag, and it says so.
  const unflagged = outcomes.find((o) => o.disposition === "NOT_RECORDED");
  assert.ok(unflagged);
  assert.match(String(unflagged.dispositionGap), /missing from their record, not decided against/);
});

test("INVARIANT 2 seeded failure: an action with a null pass flag is NOT_RECORDED, never FAILED", () => {
  const seeded: LegistarEventItem = {
    ...ACTED_WITH_ROLL_CALL,
    EventItemPassedFlagName: null,
    EventItemPassedFlag: null,
  };
  const read = readDisposition(seeded);
  assert.equal(read.disposition, "NOT_RECORDED");
  assert.notEqual(read.disposition, "FAILED");
  assert.equal(read.raw, null);

  // The body did act, so an outcome record is still produced, carrying the gap.
  const outcomes = toOutcomeRecords([seeded], CONTEXT);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].disposition, "NOT_RECORDED");
  assert.match(String(outcomes[0].dispositionGap), /moved to approve this item/);
  assert.match(String(outcomes[0].dispositionGap), /not decided against/);
});

test("INVARIANT 2 seeded failure: an unfamiliar flag string is not guessed at", () => {
  const seeded: LegistarEventItem = {
    ...ACTED_WITH_ROLL_CALL,
    EventItemPassedFlagName: "Held",
    EventItemPassedFlag: null,
  };
  const read = readDisposition(seeded);
  assert.equal(read.disposition, "NOT_RECORDED");
  assert.equal(read.raw, "Held");
});

test("INVARIANT 2 seeded failure: a record contradicting itself decides nothing", () => {
  const seeded: LegistarEventItem = {
    ...ACTED_WITH_ROLL_CALL,
    EventItemPassedFlagName: "Pass",
    EventItemPassedFlag: 0,
  };
  const read = readDisposition(seeded);
  assert.equal(read.disposition, "NOT_RECORDED");
  assert.match(String(read.conflict), /contradicts itself/);
});

test("INVARIANT 2 positive control: the FAILED path exists and is reachable", () => {
  // A constructed row: no measured flag has ever said "Fail".
  const constructed: LegistarEventItem = {
    ...ACTED_WITH_ROLL_CALL,
    EventItemPassedFlagName: "Fail",
    EventItemPassedFlag: 0,
  };
  const read = readDisposition(constructed);
  assert.equal(read.disposition, "FAILED");
  assert.equal(read.raw, "Fail");
  assert.equal(read.conflict, null);

  assert.equal(readDisposition(ACTED_WITH_ROLL_CALL).disposition, "PASSED");
});

test("INVARIANT 3 seeded failure: a 5-0 tally with zero roll-call rows yields NO roll call record", () => {
  assert.match(
    String(TALLY_ONLY.EventItemActionText),
    /unanimously carried by a 5-0 vote/,
  );
  assert.equal(VOTES_323718.length, 0);

  const record = rollCallRecordFrom(323718, VOTES_323718, CONTEXT_1821);
  assert.equal(record, null);

  // The tally text is carried, verbatim, on the ACTION_SUMMARY record only.
  const outcomes = toOutcomeRecords([TALLY_ONLY], CONTEXT_1821, new Map([[323718, VOTES_323718]]));
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].tallyText, TALLY_ONLY.EventItemActionText);

  assert.equal(answers(outcomes[0].recordClass, "WHAT_WAS_DECIDED"), true);
  assert.equal(answers(outcomes[0].recordClass, "HOW_DID_THEY_VOTE"), false);

  const ruling = ruleOnQuestion("HOW_DID_THEY_VOTE", [outcomes[0].recordClass]);
  assert.equal(ruling.answerable, false);
  assert.match(
    ruling.refusedSubstitutions[0].reason,
    /carries the result, not each member's recorded position/,
  );

  assert.equal(outcomes[0].mover, "Jennifer Allen");
  assert.equal(outcomes[0].seconder, "Matt Heinz");
  assert.equal(answers(outcomes[0].recordClass, "HOW_DID_THEY_VOTE"), false);
});

test("INVARIANT 3 structural: a ROLL_CALL record has no field a tally could live in", () => {
  const record = rollCallRecordFrom(329182, VOTES_329182, CONTEXT);
  assert.ok(record);
  const fields = Object.keys(record);
  for (const forbidden of ["tallyText", "disposition", "action", "title", "sequence"]) {
    assert.ok(
      !fields.includes(forbidden),
      `a ROLL_CALL record must not carry ${forbidden} — it is the one class allowed ` +
        "to answer HOW_DID_THEY_VOTE, and a summary field on it is one join from " +
        "being rendered as a member's position",
    );
  }
});

test("INVARIANT 3 positive control: a real roll call names five people and their values", () => {
  const record = rollCallRecordFrom(329182, VOTES_329182, CONTEXT);
  assert.ok(record);
  assert.equal(record.votes.length, 5);
  assert.deepEqual(
    record.votes.map((v) => [v.personName, v.value]),
    [
      ["Rex Scott", "Aye"],
      ["Jennifer Allen", "Aye"],
      ["Matt Heinz", "Not Present"],
      ["Steve Christy", "Aye"],
      ["Andrés Cano", "Aye"],
    ],
  );

  // Mapping values to yes/no would erase "Not Present".
  assert.ok(record.votes.some((v) => v.value === "Not Present"));

  const ruling = assertAnswerable("HOW_DID_THEY_VOTE", [record.recordClass]);
  assert.equal(ruling.answerable, true);
  assert.deepEqual([...ruling.satisfiedBy], ["ROLL_CALL"]);
});

test("INVARIANT 4 seeded failure: all 135 agenda records are refused for WHAT_WAS_DECIDED", () => {
  const agenda = toAgendaRecords(ITEMS_1825, CONTEXT);
  assert.equal(agenda.length, 135);

  const decided = evidenceRecordsFor("WHAT_WAS_DECIDED", agenda);
  assert.equal(decided.admitted.length, 0);
  assert.equal(decided.refused.length, 135);
  // Nothing is silently dropped: every refusal carries its sentence.
  assert.ok(decided.refused.every((r) => r.reason.length > 0));
  assert.match(decided.refused[0].reason, /proves what was NOTICED, not what was decided/);

  const voted = evidenceRecordsFor("HOW_DID_THEY_VOTE", agenda);
  assert.equal(voted.admitted.length, 0);
  assert.equal(voted.refused.length, 135);

  assert.throws(
    () => assertAnswerable("WHAT_WAS_DECIDED", agenda.map((a) => a.recordClass)),
    RecordClassRefused,
  );
});

test("INVARIANT 4 structural: an agenda record has no field a decision could live in", () => {
  const agenda = toAgendaRecords(ITEMS_1825, CONTEXT);
  const fields = Object.keys(agenda[0]);
  for (const forbidden of ["action", "disposition", "mover", "seconder", "tallyText", "rollCall"]) {
    assert.ok(
      !fields.includes(forbidden),
      `an AGENDA record must not carry ${forbidden}`,
    );
  }
  const outcomes = toOutcomeRecords(ITEMS_1825, CONTEXT);
  const outcomeFields = Object.keys(outcomes[0]);
  for (const forbidden of ["title", "sequence", "agendaNumber"]) {
    assert.ok(
      !outcomeFields.includes(forbidden),
      `an ACTION_SUMMARY record must not carry ${forbidden} — it would let an ` +
        "outcome record be printed as the docket",
    );
  }
});

test("INVARIANT 4 positive control: the same 135 agenda records DO answer what was noticed", () => {
  const agenda = toAgendaRecords(ITEMS_1825, CONTEXT);
  const noticed = evidenceRecordsFor("WHAT_WAS_NOTICED", agenda);
  assert.equal(noticed.admitted.length, 135);
  assert.equal(noticed.refused.length, 0);

  const ruling = assertAnswerable("WHAT_WAS_NOTICED", agenda.map((a) => a.recordClass));
  assert.equal(ruling.answerable, true);

  const outcomes = toOutcomeRecords(ITEMS_1825, CONTEXT);
  const decided = evidenceRecordsFor("WHAT_WAS_DECIDED", outcomes);
  assert.equal(decided.admitted.length, 58);
  assert.equal(decided.refused.length, 0);
});

test("INVARIANT 4 mixed corpus: one question, three classes, only the right one admitted", () => {
  const agenda = toAgendaRecords(ITEMS_1825, CONTEXT);
  const outcomes = toOutcomeRecords(ITEMS_1825, CONTEXT, new Map([[329182, VOTES_329182]]));
  const rollCall = rollCallRecordFrom(329182, VOTES_329182, CONTEXT);
  assert.ok(rollCall);

  const mixed = [
    ...agenda.map((r) => ({ recordClass: r.recordClass, kind: "agenda" })),
    ...outcomes.map((r) => ({ recordClass: r.recordClass, kind: "outcome" })),
    { recordClass: rollCall.recordClass, kind: "rollcall" },
  ];

  const noticed = evidenceRecordsFor("WHAT_WAS_NOTICED", mixed);
  assert.deepEqual(new Set(noticed.admitted.map((r) => r.kind)), new Set(["agenda"]));

  const decided = evidenceRecordsFor("WHAT_WAS_DECIDED", mixed);
  assert.deepEqual(
    new Set(decided.admitted.map((r) => r.kind)),
    new Set(["outcome", "rollcall"]),
  );

  const voted = evidenceRecordsFor("HOW_DID_THEY_VOTE", mixed);
  assert.deepEqual(new Set(voted.admitted.map((r) => r.kind)), new Set(["rollcall"]));
  assert.equal(voted.admitted.length, 1);
});

test("INVARIANT 5 seeded failure: zero rows on a roll-call-FLAGGED item is a FAILED extraction", () => {
  assert.equal(ROLL_CALL_FLAGGED.EventItemRollCallFlag, 1);
  assert.equal(VOTES_329170.length, 0);

  const state = classifyRollCall(ROLL_CALL_FLAGGED, VOTES_329170);
  assert.equal(state, "ROLL_CALL_ASSERTED_BUT_ABSENT");
  assert.equal(isFailedExtraction(state), true);

  const gap = rollCallGap(state);
  assert.ok(gap);
  assert.match(gap, /could not retrieve it/);
  assert.match(gap, /not a record that no roll call happened/);

  // An admitted-class record with an empty vote list is worse than none.
  assert.equal(rollCallRecordFrom(329170, VOTES_329170, CONTEXT), null);
});

test("INVARIANT 5 positive control A: zero rows with no recorded action is a LEGITIMATE empty", () => {
  assert.equal(NO_ACTION.EventItemActionName ?? null, null);
  assert.equal(NO_ACTION.EventItemRollCallFlag, 0);

  const state = classifyRollCall(NO_ACTION, VOTES_329177);
  assert.equal(state, "NO_QUESTION_PUT");
  assert.equal(isFailedExtraction(state), false);
  assert.match(String(rollCallGap(state)), /No question was put to the body/);
});

test("INVARIANT 5 positive control B: zero rows on an ACTED item is the publisher's gap, not a failure and not an absence", () => {
  assert.equal(TALLY_ONLY.EventItemActionName, "approve");
  assert.equal(TALLY_ONLY.EventItemPassedFlagName, "Pass");
  assert.equal(TALLY_ONLY.EventItemRollCallFlag, 0);

  const state = classifyRollCall(TALLY_ONLY, VOTES_323718);
  assert.equal(state, "OUTCOME_WITHOUT_ROLL_CALL");
  assert.equal(isFailedExtraction(state), false);

  const gap = rollCallGap(state);
  assert.ok(gap);
  assert.match(gap, /The publisher recorded the action and no per-person roll call/);
  assert.match(gap, /missing from their record/);
  // Never "nobody voted" and never "the vote was unanimous".
  assert.doesNotMatch(gap, /nobody voted|no one voted|unanimous/i);
});

test("INVARIANT 5 positive control C: rows present is RECORDED", () => {
  assert.equal(classifyRollCall(ACTED_WITH_ROLL_CALL, VOTES_329182), "RECORDED");
  assert.equal(isFailedExtraction("RECORDED"), false);
  assert.equal(rollCallGap("RECORDED"), null);
});

test("INVARIANT 5 the fourth state: never asked is not empty", () => {
  // Same discipline as `items: null` on LegistarEventWithClient. A missing key
  // in the votes map is NOT_RETRIEVED; a key holding [] is a zero-row reply.
  assert.equal(classifyRollCall(ACTED_WITH_ROLL_CALL, null), "NOT_RETRIEVED");
  assert.match(String(rollCallGap("NOT_RETRIEVED")), /have not read the roll call/);

  const unasked = toOutcomeRecords([ACTED_WITH_ROLL_CALL], CONTEXT, new Map());
  assert.equal(unasked[0].rollCall, "NOT_RETRIEVED");

  const asked = toOutcomeRecords(
    [ACTED_WITH_ROLL_CALL],
    CONTEXT,
    new Map([[329182, []]]),
  );
  assert.equal(asked[0].rollCall, "OUTCOME_WITHOUT_ROLL_CALL");
  assert.notEqual(unasked[0].rollCall, asked[0].rollCall);
});

test("the minutes pointer has NO record class, so it cannot be offered as evidence", () => {
  const pointer = minutesPointerFor(EVENT_1825);
  assert.equal(pointer.status, "Draft");
  assert.equal(pointer.host, "legistar.granicus.com");
  assert.ok(
    !("recordClass" in (pointer as unknown as Record<string, unknown>)),
    "a minutes document nobody has read is not a MINUTES record; stamping a class " +
      "on it would let 'a minutes file exists' answer 'what did they decide'",
  );
  assert.match(pointer.retrievalNote, /No minutes adapter reads the file on legistar\.granicus\.com yet/);
  assert.doesNotMatch(pointer.retrievalNote, /Disallow/);
  assert.match(pointer.retrievalNote, /contents are not held/);
});

test("a sitting with no published minutes says so without asserting anything", () => {
  const pointer = minutesPointerFor({ ...EVENT_1825, EventMinutesFile: null });
  assert.equal(pointer.url, null);
  assert.equal(pointer.host, null);
  assert.match(pointer.retrievalNote, /names no minutes document/);
});

test("collectEventOutcomes splits one sitting into three record sets and counts the failures", async () => {
  const votes: Record<number, LegistarVote[]> = {
    329182: VOTES_329182,
    329170: VOTES_329170,
  };
  const asked: number[] = [];

  const result = await collectEventOutcomes("pima", 1825, {
    sourceOrg: "Pima County Clerk of the Board",
    fetchItems: async () => ITEMS_1825,
    fetchVotes: async (_slug, id) => {
      asked.push(id);
      return votes[id] ?? [];
    },
    now: () => new Date("2026-08-29T00:00:00.000Z"),
  });

  assert.equal(result.agenda.length, 135);
  assert.equal(result.outcomes.length, 58);
  // One request per acted item plus the roll-call-flagged attendance item.
  assert.equal(asked.length, 59);
  assert.equal(result.rollCalls.length, 1);
  assert.equal(result.rollCalls[0].votes.length, 5);

  assert.deepEqual([...result.failedRollCallExtractions], [329170]);
  assert.equal(result.voteRequestFailures.length, 0);
});

test("a votes request that throws leaves the item NOT_RETRIEVED and is named, never recorded as an empty roll", async () => {
  const result = await collectEventOutcomes("pima", 1825, {
    sourceOrg: "Pima County Clerk of the Board",
    fetchItems: async () => [ACTED_WITH_ROLL_CALL],
    fetchVotes: async () => {
      throw new Error("HTTP 503 for /v1/pima/eventitems/329182/votes");
    },
    now: () => new Date("2026-08-29T00:00:00.000Z"),
  });

  assert.equal(result.rollCalls.length, 0);
  assert.equal(result.outcomes.length, 1);
  assert.equal(result.outcomes[0].rollCall, "NOT_RETRIEVED");
  // A request that never completed is not a failed extraction.
  assert.equal(result.failedRollCallExtractions.length, 0);
  assert.equal(result.voteRequestFailures.length, 1);
  assert.equal(result.voteRequestFailures[0].eventItemId, 329182);
  assert.match(result.voteRequestFailures[0].reason, /503/);
});

test("provenance names the endpoint each record was actually read from", () => {
  const outcomes = toOutcomeRecords([ACTED_WITH_ROLL_CALL], CONTEXT);
  assert.equal(
    outcomes[0].provenance.endpoint,
    "https://webapi.legistar.com/v1/pima/events/1825/eventitems",
  );
  assert.equal(outcomes[0].provenance.sourceOrg, "Pima County Clerk of the Board");

  const rollCall = rollCallRecordFrom(329182, VOTES_329182, CONTEXT);
  assert.ok(rollCall);
  assert.equal(
    rollCall.provenance.endpoint,
    "https://webapi.legistar.com/v1/pima/eventitems/329182/votes",
  );
  assert.doesNotMatch(rollCall.provenance.sourceOrg, /granicus|legistar/i);
});

test("a read that returned rows mints the day it was read", () => {
  const stamp = receiptFor(
    "https://webapi.legistar.com/v1/pima/events/1825/eventitems",
    ITEMS_1825,
    new Date("2026-08-29T12:00:00.000Z"),
  );
  assert.equal(stamp, "2026-08-29");
  assert.equal(toAgendaRecords(ITEMS_1825, CONTEXT)[0].provenance.readOn, "2026-08-29");
});

test("seeded failure: a zero-row reply mints NO date at all", () => {
  // `JSON.stringify([])` is two bytes of nothing and must never date a record.
  const stamp = receiptFor(
    "https://webapi.legistar.com/v1/pima/events/9999/eventitems",
    [],
    new Date("2026-08-29T12:00:00.000Z"),
  );
  assert.equal(stamp, NEVER_READ);
  assert.notEqual(stamp, "2026-08-29");
});

test("positive control: an empty sitting carries a stale stamp, a real one does not", async () => {
  const empty = await collectEventOutcomes("pima", 9999, {
    sourceOrg: "Pima County Clerk of the Board",
    fetchItems: async () => [],
    fetchVotes: async () => [],
    now: () => new Date("2026-08-29T12:00:00.000Z"),
  });
  assert.equal(empty.agenda.length, 0);
  assert.equal(empty.outcomes.length, 0);

  const real = await collectEventOutcomes("pima", 1825, {
    sourceOrg: "Pima County Clerk of the Board",
    fetchItems: async () => ITEMS_1825,
    fetchVotes: async (_slug, id) => (id === 329182 ? VOTES_329182 : []),
    now: () => new Date("2026-08-29T12:00:00.000Z"),
  });
  assert.equal(real.agenda[0].provenance.readOn, "2026-08-29");
  // The roll call is dated by its OWN read, which returned five rows.
  assert.equal(real.rollCalls[0].provenance.readOn, "2026-08-29");
  assert.equal(real.rollCalls.length, 1);
});

test("the same split holds on a second real sitting", () => {
  const agenda = toAgendaRecords(ITEMS_1821, CONTEXT_1821);
  const outcomes = toOutcomeRecords(ITEMS_1821, CONTEXT_1821);

  assert.equal(agenda.length, 145);
  assert.equal(outcomes.length, 65);
  assert.equal(outcomes.filter((o) => o.disposition === "PASSED").length, 61);
  assert.equal(outcomes.filter((o) => o.disposition === "FAILED").length, 0);
  assert.equal(outcomes.filter((o) => o.disposition === "NOT_RECORDED").length, 4);

  const withTally = outcomes.filter((o) => /carried by a/i.test(o.tallyText ?? ""));
  assert.equal(withTally.length, 35);
  assert.ok(withTally.every((o) => !answers(o.recordClass, "HOW_DID_THEY_VOTE")));
});
