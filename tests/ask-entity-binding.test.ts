import assert from "node:assert/strict";
import test from "node:test";

import { coverageAt } from "../lib/registry/server.ts";
import { answerQuestion } from "../lib/routing/ask.ts";
import {
  COMMON_QUESTION_NOUNS,
  bindNamedEntity,
  distinctiveTokens,
  mentionBeforeClassPhrase,
  type BindableEntity,
} from "../lib/routing/named-entity.ts";
import { resolveRouting } from "../lib/routing/resolve.ts";

/**
 * **A CONTEXT DEFAULT MAY NOT OVERRIDE AN EXPLICITLY NAMED ENTITY.**
 * (2026-08-27, the ask-entity session.)
 *
 * ## The defect, exactly as a tester found it
 *
 * At a Tucson zip a reader asked *"What's on the Vail school district
 * agenda?"* and the product answered about **Sunnyside Unified District** — a
 * different government about thirty miles away, named nowhere in the question,
 * with no statement that Vail had not been found and no statement that a
 * default was in use.
 *
 * The one-line proof of the mechanism, which is asserted below rather than
 * described: **deleting the word "Vail" produced an identical answer.** The
 * name the reader typed to say WHICH government they meant contributed
 * nothing, and their ZIP decided instead.
 *
 * ## What these tests pin
 *
 * The contract, in both directions, because only pinning one of them is how
 * this comes back:
 *
 * 1. A named government is never silently replaced — bound, disambiguated, or
 *    reported unresolved, and NEVER swapped for the reader's local one.
 * 2. A question that names NO government still gets the context default. A
 *    "fix" that simply stopped answering would pass half of this file and
 *    would have broken the product, so the default is pinned too.
 *
 * The real registry and the real coverage resolver are used throughout — a
 * hand-built fixture would prove the matcher matches itself.
 */

/** Inside Sunnyside Unified's territory — the tester's own context. */
const SUNNYSIDE_ZIP_POINT: [number, number] = [32.15102, -110.94461];
/** 85641, Vail. */
const VAIL_POINT: [number, number] = [32.00932, -110.66108];

/* ─────────────────────────── the reported defect ─────────────────────────── */

test("THE DEFECT: a question naming Vail never answers about Sunnyside", async () => {
  const coverage = await coverageAt(...SUNNYSIDE_ZIP_POINT, 1);

  /* The precondition. If Sunnyside ever stops being the local default here,
   * this test would pass for the wrong reason and must be re-pointed. */
  assert.ok(
    coverage.bodies.some((b) =>
      (b.divisionLabel ?? "").includes("Sunnyside"),
    ),
    "precondition: Sunnyside must be the local school district at this point",
  );

  const asked = answerQuestion(
    "What's on the Vail school district agenda?",
    coverage,
    "85706",
    { entities: [] },
  );

  const named = asked.answer.steps.flatMap((s) => s.bodies.map((b) => b.label));
  assert.ok(
    !named.some((label) => label.includes("Sunnyside")),
    `a question about Vail named ${named.join(", ")} — a government the reader did not ask about`,
  );

  /* And the reader is TOLD what happened rather than left with a silent gap. */
  assert.notEqual(asked.binding.kind, "NONE", "the named government must be seen");
  const gaps = asked.answer.steps.map((s) => s.gap).filter(Boolean).join(" ");
  assert.match(
    gaps,
    /vail/i,
    "the sentence the reader gets must name what they asked about",
  );
});

test("THE PROOF: deleting the name is what changes the answer, and it still defaults", async () => {
  /*
   * The two questions differ by one word. Before the repair they produced the
   * same answer, which is what proved the name was inert. After it they must
   * differ — AND the nameless one must still get the local default, because a
   * repair that merely stopped answering would also make them differ.
   */
  const coverage = await coverageAt(...SUNNYSIDE_ZIP_POINT, 1);
  const withName = answerQuestion(
    "What's on the Vail school district agenda?",
    coverage,
    "85706",
    { entities: [] },
  );
  const withoutName = answerQuestion(
    "What's on the school district agenda?",
    coverage,
    "85706",
    { entities: [] },
  );

  const labels = (a: typeof withName) =>
    a.answer.steps.flatMap((s) => s.bodies.map((b) => b.label));

  assert.equal(withoutName.binding.kind, "NONE", "this question names nobody");
  assert.ok(
    labels(withoutName).some((l) => l.includes("Sunnyside")),
    "the context default MUST still answer a question that names no government",
  );
  assert.notDeepEqual(
    labels(withName),
    labels(withoutName),
    "the name must change the answer — that it did not is the whole defect",
  );
});

test("a reader standing in Vail still gets Vail, bound rather than defaulted", async () => {
  const coverage = await coverageAt(...VAIL_POINT, 1);
  const asked = answerQuestion(
    "What's on the Vail school district agenda?",
    coverage,
    "85641",
    { entities: [] },
  );

  assert.equal(asked.binding.kind, "BOUND");
  if (asked.binding.kind !== "BOUND") return;
  assert.match(asked.binding.entity.id, /vail_unified_district/);

  /*
   * The binding must not COST this reader the answer. Binding and defaulting
   * agree here — the government they named is also their own — and that is
   * the case a repair can silently break by refusing to answer whenever a
   * name appears. Vail is named, out loud.
   */
  const labels = asked.answer.steps.flatMap((s) => s.bodies.map((b) => b.label));
  assert.ok(
    labels.some((l) => /Vail/i.test(l)),
    `the reader's own district was dropped by the binding: ${labels.join(", ") || "(nothing)"}`,
  );
});

/* ─────────────────── the reader's phrasings, as a reader types ────────────── */

const INVENTORY: BindableEntity[] = [
  { id: "vail-sd", name: "Vail Unified District", nameClass: "body", divisionType: "school_district" },
  { id: "vail-place", name: "Vail", nameClass: "place", divisionType: "place" },
  { id: "sunnyside", name: "Sunnyside Unified District", nameClass: "body", divisionType: "school_district" },
  { id: "rock-twp", name: "Rockaway Township", nameClass: "place", divisionType: "place" },
  { id: "rock-boro", name: "Rockaway Borough", nameClass: "place", divisionType: "place" },
  { id: "cawcd", name: "Central Arizona Water Conservation District Board of Directors", nameClass: "body", divisionType: "county" },
  /* A body whose whole identifying vocabulary is a word readers ask WITH. */
  { id: "agenda-cmte", name: "Agenda Committee", nameClass: "body", divisionType: "place" },
];

test("the phrasings a reader actually types all reach the same government", () => {
  for (const question of [
    "Vail school district",
    "Vail Unified",
    "Vail Unified School District",
    "the Vail school board",
    "what's on the Vail school district agenda",
    "when does the Vail school board meet",
  ]) {
    const bound = bindNamedEntity(question, INVENTORY);
    assert.equal(bound.kind, "BOUND", `${question} did not resolve`);
    if (bound.kind !== "BOUND") continue;
    assert.equal(bound.entity.id, "vail-sd", `${question} resolved to ${bound.entity.name}`);
  }
});

test("a name that fits two governments is ASKED about, never chosen between", () => {
  /* "Vail" alone is a place AND a school district; "Rockaway" is two places
     in the New Jersey pilot. Both must refuse to pick. */
  for (const [question, expected] of [
    ["what is Vail discussing", 2],
    ["what is Rockaway discussing", 2],
  ] as const) {
    const bound = bindNamedEntity(question, INVENTORY);
    assert.equal(bound.kind, "AMBIGUOUS", `${question} was decided, not asked`);
    if (bound.kind !== "AMBIGUOUS") continue;
    assert.equal(bound.candidates.length, expected);
  }
});

test("a government we do not hold is reported unresolved, never substituted", () => {
  const bound = bindNamedEntity(
    "what's on the Marana school district agenda",
    INVENTORY,
  );
  assert.equal(bound.kind, "UNRESOLVED");
  if (bound.kind !== "UNRESOLVED") return;
  assert.equal(bound.mention, "marana");
});

test("questions that name NO government leave the context default alone", () => {
  for (const question of [
    "what's on the school district agenda?",
    "who is on my school board",
    "who fixes the pothole outside my house",
    "when is the next city council meeting",
    "when does school start",
  ]) {
    assert.equal(
      bindNamedEntity(question, INVENTORY).kind,
      "NONE",
      `${question} names no government and must not block the default`,
    );
  }
});

test("the class the reader names separates a district from a town of that name", () => {
  /* Both entities are called Vail. The words "school board" are the reader's
     own, and they are what decides — not a preference for one class. */
  const board = bindNamedEntity("the Vail school board", INVENTORY);
  assert.equal(board.kind, "BOUND");
  if (board.kind === "BOUND") assert.equal(board.entity.divisionType, "school_district");
});

/* ──────────────────── adversarial: the rung's own failure modes ───────────── */

test("PLANTED: a body named for a common question word cannot capture the question", () => {
  /*
   * "Agenda Committee" is a real shape, and on the first implementation of
   * this rung it bound EVERY question containing the word "agenda" — including
   * the Vail question this module was written for. A matcher able to override
   * the default is able to override it wrongly, so the guard is pinned here.
   */
  const bound = bindNamedEntity(
    "what's on the Vail school district agenda",
    INVENTORY,
  );
  assert.equal(bound.kind, "BOUND");
  if (bound.kind !== "BOUND") return;
  assert.notEqual(bound.entity.id, "agenda-cmte", "the word 'agenda' captured the question");

  /* And it is unbindable on its own terms, not merely outranked. */
  assert.equal(
    bindNamedEntity("what is on the agenda", INVENTORY).kind,
    "NONE",
  );
  assert.ok(
    distinctiveTokens("Agenda Committee").every((t) => COMMON_QUESTION_NOUNS.has(t)),
    "this test is only meaningful while that body's whole name is common vocabulary",
  );
});

test("PLANTED: punctuation and interrogatives never become a government's name", () => {
  /*
   * Both of these shipped as bugs in the first implementation and both would
   * have rendered a sentence to a reader: `normalizeName` turns "what's" into
   * "what s", which put a government called "s" in front of "school district",
   * and walking back past "my"/"on"/"is" reached "who".
   */
  assert.equal(mentionBeforeClassPhrase("what's on the school district agenda?"), null);
  assert.equal(mentionBeforeClassPhrase("who is on my school board"), null);
  assert.equal(mentionBeforeClassPhrase("when does the city council meet"), null);
  /* A real name still comes back. */
  assert.equal(mentionBeforeClassPhrase("what's on the Marana school district agenda"), "marana");
});

test("binding constrains retrieval by IDENTITY, never by label", async () => {
  /*
   * Two governments can share a name, so a label match would let the
   * substitution back in through a different door. The constraint is asserted
   * against a bound entity whose id belongs to nothing in this coverage: the
   * correct result is no bodies at all, not the nearest lookalike.
   */
  const coverage = await coverageAt(...SUNNYSIDE_ZIP_POINT, 1);
  const answer = resolveRouting("schools-policy", coverage, {
    kind: "BOUND",
    entity: {
      id: "ocd-division/country:us/state:az/school_district:vail_unified_district",
      name: "Sunnyside Unified District",
      nameClass: "body",
    },
    matchedOn: "vail",
  });
  const labels = answer.steps.flatMap((s) => s.bodies.map((b) => b.label));
  assert.deepEqual(
    labels,
    [],
    `a body was matched on its LABEL rather than its id: ${labels.join(", ")}`,
  );
});

test("an unresolved or ambiguous name silences the default in routing too", async () => {
  const coverage = await coverageAt(...SUNNYSIDE_ZIP_POINT, 1);
  for (const binding of [
    { kind: "UNRESOLVED", mention: "marana" } as const,
    {
      kind: "AMBIGUOUS",
      mention: "Rockaway",
      candidates: INVENTORY.filter((e) => e.id.startsWith("rock-")),
    } as const,
  ]) {
    const answer = resolveRouting("schools-policy", coverage, binding);
    const labels = answer.steps.flatMap((s) => s.bodies.map((b) => b.label));
    assert.deepEqual(labels, [], `${binding.kind} still let a default body answer`);
    assert.ok(
      answer.steps.some((s) => s.gap),
      `${binding.kind} rendered nothing at all — the reader must be told which case this is`,
    );
  }
});

test("PLANTED: one government arriving under TWO id spaces is not a tie", async () => {
  /*
   * **THE SEARCH INDEX AND COVERAGE DISAGREE ABOUT A GOVERNMENT'S ID, AND THE
   * FIRST MERGE ASKED THE READER TO CHOOSE BETWEEN A THING AND ITSELF.**
   *
   * `lib/search/index.ts` mints `body:<venue key>` and labels a body with
   * `meeting.bodyName`; coverage carries the registry's own `bodyId`. So one
   * government reached `bindNamedEntity` twice under two ids, and distinct ids
   * are the tie test — correctly so, because two REAL governments can share a
   * name. The result was AMBIGUOUS between "Sunnyside Unified District" and
   * "Sunnyside Unified District".
   *
   * A question carrying a class phrase hid it: the class tie-break picked the
   * coverage row and the answer came out right. Only a question with NO class
   * phrase exposed it — which is the shape a reader actually types.
   */
  const coverage = await coverageAt(...SUNNYSIDE_ZIP_POINT, 1);
  const local = coverage.bodies.find((b) => b.divisionType === "school_district");
  assert.ok(local, "precondition: this point must have a school district");
  if (!local) return;
  const label = local.name ?? local.divisionLabel ?? "";

  /* The search index's own row for the SAME government, as ask-box builds it. */
  const entities = [{ id: "body:some-venue-key", name: label, nameClass: "body" as const }];

  for (const question of [
    `what is ${label.split(" ")[0]} discussing`,
    `tell me about ${label}`,
  ]) {
    const asked = answerQuestion(question, coverage, "85706", { entities });
    assert.notEqual(
      asked.binding.kind,
      "AMBIGUOUS",
      `${question} asked the reader to choose between two rows for one government`,
    );
    if (asked.binding.kind === "BOUND") {
      assert.equal(
        asked.binding.entity.id,
        local.bodyId,
        "the canonical registry id must win over the search index's own key",
      );
    }
  }
});

test("a named government the reader's context cannot satisfy silences the CONTACTS too", async () => {
  /*
   * `everydayContactsFor(topicId, zip)` reads a curated direct line for the
   * topic AT THE ZIP IN VIEW. It has never seen the question and cannot know
   * one named a government, so suppressing the wrong BODY while still printing
   * the reader's own city service number under a question about a district
   * thirty miles away would answer it wrongly in a smaller font. Same defect,
   * different door.
   */
  const coverage = await coverageAt(...SUNNYSIDE_ZIP_POINT, 1);

  const named = answerQuestion(
    "What's on the Vail school district agenda?",
    coverage,
    "85706",
    { entities: [] },
  );
  assert.notEqual(named.binding.kind, "NONE");
  assert.deepEqual(
    named.contacts.map((c) => c.body),
    [],
    "a government we could not resolve must not carry the reader's own local contacts",
  );

  /* And the reader's OWN questions keep theirs — the rule is about the name,
   * not a blanket suppression. */
  const local = answerQuestion(
    "who do I call about a pothole",
    coverage,
    "85706",
    { entities: [] },
  );
  assert.equal(local.binding.kind, "NONE", "this question names no government");
});

test("dedupe does NOT collapse two genuinely distinct governments that share a name", () => {
  /*
   * The other half of the dedupe rule, and the half that makes it safe.
   * Deduplication runs ACROSS the two inventories (search index vs coverage)
   * and never WITHIN coverage — because two real governments can share a
   * normalized name, and for them AMBIGUOUS is the correct answer rather than a
   * bug. Collapsing them would put the substitution back with a tidier
   * implementation.
   */
  const twoRealOnes: BindableEntity[] = [
    {
      id: "ocd-division/country:us/state:az/school_district:springfield_a#board",
      name: "Springfield School District",
      nameClass: "body",
      divisionType: "school_district",
    },
    {
      id: "ocd-division/country:us/state:nj/school_district:springfield_b#board",
      name: "Springfield School District",
      nameClass: "body",
      divisionType: "school_district",
    },
  ];

  const bound = bindNamedEntity(
    "what is on the Springfield school district agenda",
    twoRealOnes,
  );
  assert.equal(
    bound.kind,
    "AMBIGUOUS",
    "two distinct governments sharing a name must be asked about, not collapsed",
  );
  if (bound.kind === "AMBIGUOUS") assert.equal(bound.candidates.length, 2);
});

test("the unresolved sentence claims only what was SEARCHED, never what we hold", async () => {
  /*
   * **THE SENTENCE I WROTE WAS FALSE, AND IT WAS A CLAIM ABOUT US.**
   *
   * It read *"We don't have a government recorded under 'vail'"*. At a Tucson
   * zip that is false: the product holds Vail Unified District with eleven
   * meetings and nine documents. What the binder actually did was search the
   * reader's OWN AREA — the search index for what is in view, plus their
   * covered bodies — and it never looks further, because from the client it
   * cannot.
   *
   * So a local lookup produced a statement about the WHOLE corpus. Same class
   * as a failed fetch becoming a recorded absence, pointed inward.
   *
   * `scripts/verify-ask-entity.mts` asserts the rendered text too, but it needs
   * a browser and a production build. This guards the copy at the layer the
   * defect lived in, so it cannot come back through a refactor nobody walks.
   */
  const coverage = await coverageAt(...SUNNYSIDE_ZIP_POINT, 1);
  const answer = resolveRouting("schools-policy", coverage, {
    kind: "UNRESOLVED",
    mention: "vail",
  });
  const gaps = answer.steps.map((s) => s.gap).filter(Boolean).join(" ");

  assert.ok(gaps.length > 0, "an unresolved name must still say something to the reader");
  assert.ok(
    !/do(n't| not) have a government/i.test(gaps),
    `the sentence claims the corpus holds no such government from a LOCAL lookup: ${gaps}`,
  );
  /* And it must still name what the reader typed — scoping the claim is not a
   * licence to stop telling them which word failed to match. */
  assert.match(gaps, /vail/i, "the reader is not told which name went unmatched");
});

test("the ambiguous sentence asks for something the product actually does", async () => {
  /*
   * **IT USED TO PROMISE AN INTERACTION THAT DOES NOT EXIST.**
   *
   * The sentence read *"Choose one and we'll answer for it"* — and nothing on
   * the surface is choosable. The candidates render as prose: no buttons, no
   * links, nothing to click. A reader following that instruction finds nothing
   * to follow, which is a claim about the product rather than about a
   * government, and false in the same way.
   *
   * What the product DOES do is read the class of government out of the
   * reader's own words. So the sentence now asks for that — and this test ties
   * the instruction to the behaviour, so the copy cannot promise one thing
   * while the binder does another.
   */
  const coverage = await coverageAt(...SUNNYSIDE_ZIP_POINT, 1);
  const answer = resolveRouting("schools-policy", coverage, {
    kind: "AMBIGUOUS",
    mention: "Vail",
    candidates: INVENTORY.filter((e) => e.id.startsWith("vail-")),
  });
  const gaps = answer.steps.map((s) => s.gap).filter(Boolean).join(" ");

  assert.ok(
    !/choose one/i.test(gaps),
    `the sentence asks the reader to choose, and nothing is choosable: ${gaps}`,
  );

  /* And the instruction it DOES give must work. "school district" is exactly
     what the sentence suggests, and it must resolve the tie it was offered for. */
  const ambiguous = bindNamedEntity("what is Vail discussing", INVENTORY);
  assert.equal(ambiguous.kind, "AMBIGUOUS", "precondition: this really is a tie");
  const disambiguated = bindNamedEntity("what is the Vail school district discussing", INVENTORY);
  assert.equal(
    disambiguated.kind,
    "BOUND",
    "the sentence tells the reader to say which kind, and saying it must resolve the tie",
  );
  if (disambiguated.kind === "BOUND") assert.equal(disambiguated.entity.id, "vail-sd");
});
