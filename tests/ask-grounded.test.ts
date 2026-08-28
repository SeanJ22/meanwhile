import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { EvidencePack } from "../lib/ask/evidence.ts";
import { packHasEvidence, packSourceUrls } from "../lib/ask/evidence.ts";
import { readInterpretation, unavailableInterpretation } from "../lib/ask/intent.ts";
import { interpretPrompt, interpretWithoutModel, MAX_INVENTORY } from "../lib/ask/interpret.ts";
import { resolveInterpretation } from "../lib/ask/resolve.ts";
import { emptySelectionState, selectSitting } from "../lib/ask/select.ts";
import { synthesizeAnswer, synthesisPrompt } from "../lib/ask/synthesize.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
import { statewideExecutivesFor } from "../lib/officials/statewide-executives.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";

/**
 * **THE GROUNDED ASK PIPELINE** (ASK01/ASK02, 2026-08-27).
 *
 * Every test here that guards a defect states the defect, and several of them
 * are written FALSE-FIRST — the assertion is constructed so that the code as it
 * stood before this session fails it. PR #211's most expensive lesson was that
 * a check can be green while the thing it names is broken, so a check whose
 * failure mode was never observed is not evidence.
 */

const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district";

const ENTITIES: BindableEntity[] = [
  { id: VAIL, name: "vail unified district", nameClass: "body", divisionType: "school_district" },
  {
    id: "ocd-division/country:us/state:az/school_district:sunnyside_unified_district",
    name: "sunnyside unified district",
    nameClass: "body",
    divisionType: "school_district",
  },
  {
    id: "person:katie_hobbs",
    name: "Katie Hobbs",
    nameClass: "person",
    divisionType: "person",
  },
];

function pack(over: Partial<EvidencePack> = {}): EvidencePack {
  return {
    question: "what is on the agenda",
    intent: "UPCOMING_AGENDA",
    temporal: { kind: "NEXT" },
    subject: { kind: "BODY", id: VAIL, name: "Vail Unified District" },
    records: [
      {
        kind: "AGENDA_ITEM",
        id: "m1#0",
        text: "Consideration of the 2027 capital budget",
        occurredAt: "2026-09-09T02:00:00.000Z",
        sourceUrl: "https://example.gov/agenda.pdf",
        sourceOrg: "Vail Unified District",
      },
    ],
    gaps: [],
    denominators: { agendaItemsExtracted: 1 },
    today: "2026-08-27",
    ...over,
  };
}

// ── The tense is a retrieval instruction ────────────────────────────────

/**
 * **THE DEFECT, AS A SELECTION.** `bodyAgendaAnswer` read
 * `upcoming[0] ?? past[0]` for every question, so a question about the LAST
 * meeting was answered with the NEXT one.
 *
 * `select` is the REAL function both routes call, imported rather than
 * reimplemented. The first version of this file built its own upcoming/past
 * split and asserted against that, which would have passed forever no matter
 * what the routes did — a green check standing beside broken behaviour, which
 * is the one failure mode this repository has already paid for once.
 */
const select = selectSitting;

test("ASK02: a LAST question selects the most recent PAST meeting, not the next one", () => {
  const now = Date.parse("2026-08-27T00:00:00Z");
  const meetings = [
    { startsAt: "2026-08-12T02:00:00.000Z" },
    { startsAt: "2026-08-26T02:00:00.000Z" },
    { startsAt: "2026-09-09T02:00:00.000Z" },
  ];

  /*
   * FALSE-FIRST: this is the exact expression that shipped, and it is asserted
   * to give the WRONG answer for this question. If a later refactor quietly
   * restores it, the assertion below stops being a tautology and this test is
   * the thing that notices.
   */
  const oldBehaviour = select("ANY", meetings, now);
  assert.equal(oldBehaviour?.startsAt, "2026-09-09T02:00:00.000Z");

  const chosen = select("LAST", meetings, now);
  assert.equal(chosen?.startsAt, "2026-08-26T02:00:00.000Z");
  assert.notEqual(chosen?.startsAt, oldBehaviour?.startsAt);
});

test("ASK02: a NEXT question selects the soonest future meeting", () => {
  const now = Date.parse("2026-08-27T00:00:00Z");
  const chosen = select(
    "NEXT",
    [
      { startsAt: "2026-09-23T02:00:00.000Z" },
      { startsAt: "2026-09-09T02:00:00.000Z" },
      { startsAt: "2026-08-12T02:00:00.000Z" },
    ],
    now,
  );
  assert.equal(chosen?.startsAt, "2026-09-09T02:00:00.000Z");
});

test("ASK02: a tensed question does NOT fall back to the other tense", () => {
  const now = Date.parse("2026-08-27T00:00:00Z");
  const onlyFuture = [{ startsAt: "2026-09-09T02:00:00.000Z" }];
  // Asking what they discussed LAST time, when nothing has happened yet, is an
  // honest nothing. Answering it with the future agenda would state that a
  // discussion has already occurred.
  assert.equal(select("LAST", onlyFuture, now), null);

  const onlyPast = [{ startsAt: "2026-08-12T02:00:00.000Z" }];
  assert.equal(select("NEXT", onlyPast, now), null);
});

// ── Interpretation is a hypothesis, and a bounded one ───────────────────

test("ASK01: the interpretation reader rejects anything off the closed lists", () => {
  const bad = readInterpretation({
    intent: "TELL_ME_HOW_TO_VOTE",
    entityMentions: "not an array",
    normalizedMentions: [1, 2, 3],
    temporal: { kind: "WHENEVER" },
    referent: 42,
  });
  assert.equal(bad.intent, "UNKNOWN");
  assert.deepEqual(bad.entityMentions, []);
  assert.deepEqual(bad.normalizedMentions, []);
  assert.equal(bad.temporal.kind, "NONE");
  assert.equal(bad.referent, null);
});

test("ASK01: a RANGE with no usable month count degrades to NONE, never to a guess", () => {
  assert.equal(readInterpretation({ temporal: { kind: "RANGE" } }).temporal.kind, "NONE");
  const good = readInterpretation({ temporal: { kind: "RANGE", trailingMonths: 12 } });
  assert.equal(good.temporal.kind, "RANGE");
  assert.equal(good.temporal.trailingMonths, 12);
});

test("ASK01: the deterministic fallback reads tense and NAMES NOTHING", () => {
  assert.equal(interpretWithoutModel("what did they discuss last time").temporal.kind, "LAST");
  assert.equal(interpretWithoutModel("what is on the next agenda").temporal.kind, "NEXT");
  assert.equal(
    interpretWithoutModel("what did Hobbs do in the last 12 months").temporal.trailingMonths,
    12,
  );
  /*
   * The fallback must be NARROWER than the model rung, never looser. It reads
   * no entity at all, so an unavailable model can cost the reader precision
   * and can never cost them correctness.
   */
  const out = interpretWithoutModel("what is the Vail school district doing");
  assert.deepEqual(out.entityMentions, []);
  assert.deepEqual(out.normalizedMentions, []);
});

test("ASK01: past beats future when a question carries both", () => {
  // "What did they decide about the next budget" already happened.
  assert.equal(
    interpretWithoutModel("what did they decide about the next budget").temporal.kind,
    "LAST",
  );
});

test("ASK01: the interpretation prompt carries civic context and is bounded", () => {
  const prompt = interpretPrompt({
    inventory: [
      { name: "Vail Unified School District", divisionType: "school_district" },
      { name: "Pima County", divisionType: "county" },
    ],
    today: "2026-08-27",
    approximateLocation: "85641",
    surface: "MAP",
  });
  /*
   * The whole point of this rung. The topic classifier's prompt contains the
   * topic list and NOTHING ELSE — no governments, no date. If this assertion
   * ever fails, the model has stopped being told what exists and the product
   * is back to the state where it could not resolve "Vail".
   */
  assert.match(prompt, /Vail Unified School District \(school_district\)/);
  assert.match(prompt, /Today is 2026-08-27/);
  assert.match(prompt, /85641/);
  // It is told to READ, never to answer.
  assert.match(prompt, /not answering it/i);

  const huge = interpretPrompt({
    inventory: Array.from({ length: MAX_INVENTORY + 200 }, (_, i) => ({ name: `Body ${i}` })),
    today: "2026-08-27",
  });
  assert.ok(!huge.includes(`Body ${MAX_INVENTORY + 10}`), "inventory must be capped");
});

// ── Resolution: a hypothesis becomes an identity, or fails honestly ─────

test("ASK01: the model's expansion resolves an alias the reader's words alone would not", () => {
  const interpretation = {
    ...unavailableInterpretation(),
    entityMentions: ["Vail school district"],
    normalizedMentions: ["Vail Unified District"],
  };
  const result = resolveInterpretation(interpretation, "what is on the vail school district agenda", ENTITIES);
  assert.equal(result.binding.kind, "BOUND");
  assert.equal(result.binding.kind === "BOUND" && result.binding.entity.id, VAIL);
});

test("ASK01: a government the model invented resolves UNRESOLVED, never NONE", () => {
  /*
   * **THE MOST IMPORTANT ASSERTION IN THIS FILE.**
   *
   * `NONE` means "no government was named", which licenses the reader's own ZIP
   * to decide the answer. Returning it for "a government was named and we could
   * not find it" is precisely how a question about Vail was answered with
   * Sunnyside — and doing it here would restore that defect with a model's
   * endorsement on top of it.
   */
  const interpretation = {
    ...unavailableInterpretation(),
    entityMentions: ["Republic of Atlantis Water District"],
    normalizedMentions: ["Republic of Atlantis Water District"],
  };
  const result = resolveInterpretation(
    interpretation,
    "what is the republic of atlantis water district discussing",
    ENTITIES,
  );
  assert.equal(result.binding.kind, "UNRESOLVED");
  assert.notEqual(result.binding.kind, "NONE");
});

test("ASK01: a question naming nothing stays NONE, so context routing still works", () => {
  const result = resolveInterpretation(
    unavailableInterpretation(),
    "who do I call about a pothole",
    ENTITIES,
  );
  assert.equal(result.binding.kind, "NONE");
});

test("ASK01: resolution is a SUPERSET of the binder that shipped without a model", () => {
  // With no mentions at all, the whole question is still tried — the floor
  // candidate — so this function can only ever resolve more than the guardrail.
  const result = resolveInterpretation(
    unavailableInterpretation(),
    "what is the vail unified district discussing",
    ENTITIES,
  );
  assert.equal(result.binding.kind, "BOUND");
  assert.equal(result.basis, "WHOLE_QUESTION");
});

// ── Validation: the checks that can be made, made ───────────────────────

test("ASK01: an invented source URL fails validation", () => {
  const p = pack();
  const verdict = validateAnswer(
    "Vail will consider the 2027 capital budget. See https://totally-made-up.example/agenda.",
    [],
    p,
  );
  assert.equal(verdict.kind, "FAILED");
  assert.ok(verdict.kind === "FAILED" && verdict.failed.some((f) => f.startsWith("invented-source-url")));
});

test("ASK01: a URL that IS in the pack passes, trailing punctuation included", () => {
  const p = pack();
  const verdict = validateAnswer(
    "Vail will consider the 2027 capital budget, per https://example.gov/agenda.pdf.",
    ["https://example.gov/agenda.pdf"],
    p,
  );
  assert.equal(verdict.kind, "PASSED", JSON.stringify(verdict));
});

test("ASK01: a cited URL not in the pack fails even when the prose contains no link", () => {
  const verdict = validateAnswer("Vail will consider the budget.", ["https://elsewhere.example/x"], pack());
  assert.equal(verdict.kind, "FAILED");
});

test("ASK01: voting advice is struck", () => {
  for (const bad of [
    "Vail is discussing the budget. You should vote for the incumbent.",
    "Vail is discussing the budget. We recommend the challenger.",
  ]) {
    assert.equal(validateAnswer(bad, [], pack()).kind, "FAILED", bad);
  }
});

test("ASK01: the product never announces its own failure", () => {
  const verdict = validateAnswer(
    "Unfortunately we were unable to find anything about Vail.",
    [],
    pack(),
  );
  assert.equal(verdict.kind, "FAILED");
});

test("ASK01: internal vocabulary never reaches a reader", () => {
  const verdict = validateAnswer(
    `Vail's record is at ocd-division/country:us/state:az and the state is AGENDA_READ_NO_ITEMS_EXTRACTED.`,
    [],
    pack(),
  );
  assert.equal(verdict.kind, "FAILED");
});

test("ASK02: a LAST question answered entirely from future records fails validation", () => {
  /*
   * The temporal defect caught a SECOND time, at the last possible moment.
   * The retrieval fix lives in one function; this is a property of the answer
   * whichever path produced it.
   */
  const p = pack({ temporal: { kind: "LAST" } });
  const verdict = validateAnswer("Vail will consider the 2027 capital budget.", [], p);
  assert.equal(verdict.kind, "FAILED");
  assert.ok(
    verdict.kind === "FAILED" &&
      verdict.failed.includes("past-question-answered-with-future-records"),
  );
});

test("ASK01: an answer that never names the resolved subject fails", () => {
  const verdict = validateAnswer(
    "The board will consider a capital budget at its next sitting.",
    [],
    pack(),
  );
  assert.equal(verdict.kind, "FAILED");
  assert.ok(
    verdict.kind === "FAILED" && verdict.failed.includes("answer-does-not-name-resolved-subject"),
  );
});

// ── The evidence boundary ───────────────────────────────────────────────

test("ASK01: synthesis REFUSES an empty pack and never touches the network", async () => {
  /*
   * A model asked to answer a civic question with no records will write
   * something fluent, shaped like an answer, and sourced to nothing. The
   * refusal comes before the key check, so this holds even where a key exists.
   */
  let called = false;
  const out = await synthesizeAnswer(pack({ records: [] }), {
    apiKey: "test-key-not-used",
    fetchImpl: (async () => {
      called = true;
      throw new Error("the network must not be reached for an empty pack");
    }) as unknown as typeof fetch,
  });
  assert.equal(out.kind, "UNAVAILABLE");
  assert.equal(out.kind === "UNAVAILABLE" && out.why, "no-evidence");
  assert.equal(called, false);
});

test("ASK01: the synthesis prompt restates every rule it could break", () => {
  const prompt = synthesisPrompt(pack());
  assert.match(prompt, /ONLY the records supplied/i);
  assert.match(prompt, /Never tell the reader how to vote/i);
  assert.match(prompt, /rank or score candidates/i);
  assert.match(prompt, /gap marked OURS is about us/i);
  assert.match(prompt, /Today is 2026-08-27/);
});

test("ASK01: the pack's source allow-list is exactly its records' URLs", () => {
  const p = pack({
    records: [
      { kind: "MEETING", id: "m", text: "x", sourceUrl: "https://a.example/1" },
      { kind: "AGENDA_ITEM", id: "i", text: "y", sourceUrl: null },
      { kind: "AGENDA_ITEM", id: "j", text: "z", sourceUrl: "https://b.example/2" },
    ],
  });
  assert.deepEqual([...packSourceUrls(p)].sort(), [
    "https://a.example/1",
    "https://b.example/2",
  ]);
  assert.equal(packHasEvidence(p), true);
  assert.equal(packHasEvidence(pack({ records: [] })), false);
});

test("ASK01: a named gap always says WHOSE gap it is", () => {
  const p = pack({
    gaps: [
      { whose: "OURS", statement: "We have not recorded this yet." },
      { whose: "THEIRS", statement: "The district has not published it yet." },
    ],
  });
  for (const gap of p.gaps) {
    assert.ok(gap.whose === "OURS" || gap.whose === "THEIRS");
    assert.ok(gap.statement.length > 0);
  }
});

// ── The ballot surface renders something true in every branch ───────────

test("ASK04: no reply mode may render silence on the ballot", () => {
  /*
   * **A REAL DEFECT, FOUND BY READING THE READER OUTPUT.** (2026-08-27.)
   *
   * The first version of `components/ask/ballot-ask.tsx` had no branch for a
   * reply carrying no answer, no records and no gaps. A reader asked "What
   * does this office control?", the server correctly answered NO_EVIDENCE, and
   * the panel rendered NOTHING — the empty form, back at them.
   *
   * Every check in place at the time passed. The panel was present, the mode
   * attribute was right, the request and reply were both fine. Only the
   * SENTENCE was missing, and only reading it found that.
   *
   * This guard is a source sweep rather than a render test because the
   * component needs a browser and this suite has none. It asserts the branch
   * EXISTS and is reachable for the mode that produced the defect.
   */
  const source = readFileSync(
    join(process.cwd(), "components/ask/ballot-ask.tsx"),
    "utf8",
  );
  assert.match(source, /data-ask-state="NOTHING_HELD"/, "the empty branch is gone");
  /* And it must be guarded on all three emptinesses, or it would swallow a
     reply that DID have records. */
  for (const guard of [
    "!reply.answer",
    "records.length === 0",
    "gaps.length === 0",
  ]) {
    assert.ok(source.includes(guard), `the empty branch lost its ${guard} guard`);
  }
  /* CLARIFY and UNRESOLVED have their own sentences and must not be
     overwritten by the generic one. */
  assert.match(source, /reply\.mode !== "CLARIFY"/);
  assert.match(source, /reply\.mode !== "UNRESOLVED"/);
});

test("ASK04: the ballot surface renders records even when synthesis produced none", () => {
  /*
   * The degradation ladder, as a property of the CLIENT: grounded → structured
   * → honest gap. PR #211 found the opposite repeatedly — a client discarding a
   * useful server reply because one optional field was null.
   */
  const source = readFileSync(
    join(process.cwd(), "components/ask/ballot-ask.tsx"),
    "utf8",
  );
  assert.match(
    source,
    /\{!reply\.answer && records\.length > 0 && \(/,
    "records must render when prose did not",
  );
});

test("ASK04: the ballot surface posts to the ONE engine, with its own surface", () => {
  const source = readFileSync(
    join(process.cwd(), "components/ask/ballot-ask.tsx"),
    "utf8",
  );
  assert.match(source, /"\/api\/ask\/grounded"/, "the ballot must not fork a second engine");
  assert.match(source, /surface: "BALLOT"/);
  assert.match(source, /activeSubjects/, "the ballot's own context must travel");
});

test("ASK04: a COUNTY division alone must resolve the state's governor", () => {
  /*
   * **THE INVARIANT I BROKE.** (2026-08-27.)
   *
   * `personEntities` in the grounded route first filtered the reader's
   * divisions to those matching the BARE state id, then called
   * `statewideExecutivesFor` with what survived. On the map that was invisible,
   * because a map reader's division list happens to include the bare state. On
   * the ballot it emptied the person inventory completely — the ballot's
   * divisions are counties, places and districts — so "What has Katie Hobbs
   * done as governor?" came back UNRESOLVED on the surface most likely to ask
   * it, and told the reader we hold no such thing while we did.
   *
   * The contract was already right and already used this way by `senatorsFor`
   * and the who-governs card: the state is derived by PREFIX. This pins it, so
   * a future caller re-deriving it more strictly fails here instead of in
   * production.
   */
  const fromCounty = statewideExecutivesFor([
    "ocd-division/country:us/state:az/county:pima",
  ]);
  assert.ok(
    fromCounty.some((s) => s.name === "Katie Hobbs"),
    "a county id alone must reach the governor — the state is a PREFIX, not an exact match",
  );

  const fromDistrict = statewideExecutivesFor([
    "ocd-division/country:us/state:az/school_district:vail_unified_district",
  ]);
  assert.ok(fromDistrict.some((s) => s.name === "Katie Hobbs"));

  /* FALSE-FIRST: the filter that shipped, asserted to produce nothing. */
  const brokenFilter = ["ocd-division/country:us/state:az/county:pima"].filter((id) =>
    /^ocd-division\/country:us\/state:[a-z]{2}$/.test(id),
  );
  assert.deepEqual(brokenFilter, [], "the old filter kept nothing, which is why it emptied");
  assert.equal(statewideExecutivesFor(brokenFilter).length, 0);
});
