import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "./helpers/playbooks.ts";

import type { EvidencePack } from "../lib/ask/evidence.ts";
import { packHasEvidence, packSourceUrls } from "../lib/ask/evidence.ts";
import { readInterpretation, unavailableInterpretation } from "../lib/ask/intent.ts";
import { interpretPrompt, interpretWithoutModel, MAX_INVENTORY } from "../lib/ask/interpret.ts";
import { resolveInterpretation } from "../lib/ask/resolve.ts";
import { emptySelectionState, selectSitting } from "../lib/ask/select.ts";
import { synthesizeAnswer, synthesisPrompt, synthesisDateBlock } from "../lib/ask/synthesize.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
import { statewideExecutivesFor } from "../lib/officials/statewide-executives.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

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

const select = selectSitting;

test("ASK02: a LAST question selects the most recent PAST meeting, not the next one", () => {
  const now = Date.parse("2026-08-27T00:00:00Z");
  const meetings = [
    { startsAt: "2026-08-12T02:00:00.000Z" },
    { startsAt: "2026-08-26T02:00:00.000Z" },
    { startsAt: "2026-09-09T02:00:00.000Z" },
  ];

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
  /* NONE means no government was named; a named government we cannot find must never become NONE. */
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

test("a MEETING record belonging to another body FAILS validation", () => {
  const p = pack({
    subject: { kind: "BODY", id: VAIL, name: "Vail Unified District" },
    records: [
      {
        kind: "MEETING",
        id: "civicclerk:capaz:696",
        bodyId: "ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district",
        text: "Vail: CAP University, Monday, August 31.",
        occurredAt: "2026-08-31T16:00:00.000Z",
        sourceUrl: "https://example.gov/agenda.pdf",
      },
    ],
  });
  const verdict = validateAnswer("Vail's next meeting is on Monday.", [], p);
  assert.equal(verdict.kind, "FAILED");
  assert.ok(
    verdict.kind === "FAILED" &&
      verdict.failed.some((f) => f.startsWith("record-from-another-body")),
    `expected a body-identity failure, got ${JSON.stringify(verdict)}`,
  );
});

test("a record carrying the RESOLVED body's id passes", () => {
  /* The positive control. A check that failed everything would be no check. */
  const p = pack({
    subject: { kind: "BODY", id: `${VAIL}#board`, name: "Vail Unified District" },
    records: [
      {
        kind: "MEETING",
        id: "apptegy:vail:1",
        bodyId: `${VAIL}#board`,
        text: "Vail Unified District: Governing Board Meeting.",
        occurredAt: "2026-09-09T02:00:00.000Z",
        sourceUrl: "https://example.gov/agenda.pdf",
      },
    ],
  });
  assert.equal(validateAnswer("Vail's board meets on the 9th.", [], p).kind, "PASSED");
});

test("a record with NO body id is not failed — it belongs to no single body", () => {
  /*
   * Ballot measures, statewide officeholders and deliberately wider topic
   * sweeps legitimately belong to no one body. Failing them would discard
   * correct answers, which is its own kind of wrong, so the check binds
   * exactly where identity is stated and nowhere else.
   */
  assert.equal(validateAnswer("Vail will consider the 2027 capital budget.", [], pack()).kind, "PASSED");
});

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
  const p = pack({ temporal: { kind: "LAST" } });
  const verdict = validateAnswer("Vail will consider the 2027 capital budget.", [], p);
  assert.equal(verdict.kind, "FAILED");
  assert.ok(
    verdict.kind === "FAILED" &&
      verdict.failed.includes("past-question-answered-with-future-records"),
  );
});

const PIMA_BOARD = "ocd-division/country:us/state:az/county:pima#governing";
const CAWCD_BODY =
  "ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district";

/** The known-subject universe the grounded route passes: its body inventory. */
const KNOWN_BODIES = [
  { id: PIMA_BOARD, name: "Pima County Board of Supervisors" },
  { id: CAWCD_BODY, name: "Central Arizona Water Conservation District" },
  { id: `${VAIL}#board`, name: "Vail Unified School District Governing Board" },
  /* A derived body nothing has named yet still reaches the inventory under
     its division's label — one word, a geography, not a government's name. */
  { id: "ocd-division/country:us/state:az/place:mesa#governing", name: "Mesa" },
];

/** A correct exact-body pack for the Board, records carrying the Board's id. */
function pimaPack(over: Partial<EvidencePack> = {}): EvidencePack {
  return pack({
    subject: { kind: "BODY", id: PIMA_BOARD, name: "Pima County Board of Supervisors" },
    records: [
      {
        kind: "MEETING",
        id: "granicus:pima:2331",
        bodyId: PIMA_BOARD,
        text: "Board of Supervisors Regular Meeting, Tuesday, September 1.",
        occurredAt: "2026-09-01T16:00:00.000Z",
        sourceUrl: "https://example.gov/agenda.pdf",
      },
    ],
    ...over,
  });
}

test("NH288: correct prose that says 'The Board' instead of the full name PASSES", () => {
  const verdict = validateAnswer(
    "The Board voted 5-0 to approve the fiscal 2027 budget.",
    [],
    pimaPack(),
    KNOWN_BODIES,
  );
  assert.equal(verdict.kind, "PASSED", JSON.stringify(verdict));
});

test("NH288: prose naming a DIFFERENT known government fails mechanically", () => {
  const verdict = validateAnswer(
    "The Central Arizona Water Conservation District meets Monday to discuss allocations.",
    [],
    pimaPack(),
    KNOWN_BODIES,
  );
  assert.equal(verdict.kind, "FAILED");
  assert.ok(
    verdict.kind === "FAILED" &&
      verdict.failed.some((f) => f.startsWith("answer-names-foreign-subject")),
    JSON.stringify(verdict),
  );
});

test("NH288: foreign naming still fails when the prose ALSO says the subject's name", () => {
  const verdict = validateAnswer(
    "Pima County heard a presentation from the Central Arizona Water Conservation District.",
    [],
    pimaPack(),
    KNOWN_BODIES,
  );
  assert.equal(verdict.kind, "FAILED");
  assert.ok(
    verdict.kind === "FAILED" &&
      verdict.failed.some((f) => f.startsWith("answer-names-foreign-subject")),
  );
});

test("NH288: 'Pima County' and 'the Supervisors' are the subject, not a substitution", () => {
  for (const prose of [
    "Pima County will take up the budget on Tuesday.",
    "The Supervisors approved the item unanimously.",
  ]) {
    const verdict = validateAnswer(prose, [], pimaPack(), KNOWN_BODIES);
    assert.equal(verdict.kind, "PASSED", `${prose} → ${JSON.stringify(verdict)}`);
  }
});

test("NH288: a one-word division label in the universe is a geography, never a naming", () => {
  /* "Mesa" stands in for a body nothing has named yet. Prose placing a meeting
     IN Mesa has not named a government, and failing it would discard correct
     answers over a place word. */
  const verdict = validateAnswer(
    "The Board meets in Mesa on Tuesday.",
    [],
    pimaPack(),
    KNOWN_BODIES,
  );
  assert.equal(verdict.kind, "PASSED", JSON.stringify(verdict));
});

test("NH288: with no known-subject universe the check checks nothing, honestly", () => {
  const verdict = validateAnswer(
    "The board will consider a capital budget at its next sitting.",
    [],
    pack(),
  );
  assert.equal(verdict.kind, "PASSED", JSON.stringify(verdict));
});

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
  // The date sentence is not in the cacheable system prefix: it is a block of the first user turn, so the
  // instructions above are byte-stable across a midnight.
  assert.doesNotMatch(prompt, /Today is/);
  assert.equal(synthesisDateBlock(pack()), "Today is 2026-08-27.");
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
      {
        whose: "THEIRS",
        statement:
          "As of 2026-08-29, Pima County had not posted an agenda for that meeting. We are still checking.",
      },
    ],
  });
  for (const gap of p.gaps) {
    assert.ok(gap.whose === "OURS" || gap.whose === "THEIRS");
    assert.ok(gap.statement.length > 0);
  }
});

test("ASK04: no reply mode may render silence on the ballot", () => {
  const source = readFileSync(
    join(process.cwd(), "components/ask/ballot-ask.tsx"),
    "utf8",
  );
  assert.match(source, /"data-ask-state": "NOTHING_HELD"/, "the empty branch is gone");
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
  const source = readFileSync(
    join(process.cwd(), "components/ask/ballot-ask.tsx"),
    "utf8",
  );
  const renderer = source.match(/<AskAnswerRecords\b[^>]*\/>/)?.[0] ?? "";
  assert.match(renderer, /\brecords=\{records\}/, "the ballot must reach the same complete record renderer as map Ask");
  assert.match(renderer, /\binitiallyOpen=\{!reply\.answer\}/, "records must remain visible when synthesis is absent");
  const markup = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { AskAnswerRecords } from './components/ask/answer-records.tsx';
    const records = Array.from({length: 17}, (_, i) => ({ kind: 'VOTE', id: 'held:' + i, text: 'Held vote ' + i }));
    console.log(renderToStaticMarkup(createElement(AskAnswerRecords, { records, initiallyOpen: true })));
  `], { encoding: "utf8", timeout: 120_000 });
  assert.match(markup, /data-ask-record-count="17"/);
  assert.equal([...markup.matchAll(/data-ask-record-id=/g)].length, 17);
  assert.ok(markup.includes('data-ask-record-id="held:16"'));
  assert.ok(markup.includes('open=""'), "all structured records remain reachable when synthesis is absent");
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

  const brokenFilter = ["ocd-division/country:us/state:az/county:pima"].filter((id) =>
    /^ocd-division\/country:us\/state:[a-z]{2}$/.test(id),
  );
  assert.deepEqual(brokenFilter, [], "the old filter kept nothing, which is why it emptied");
  assert.equal(statewideExecutivesFor(brokenFilter).length, 0);
});
