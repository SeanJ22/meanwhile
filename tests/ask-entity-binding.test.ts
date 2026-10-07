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
import { canonicalBodyIdentity } from "../lib/ask/body-identity.ts";
import { snapshotEntities } from "../lib/ask/inventory.ts";
import { resolveInterpretation } from "../lib/ask/resolve.ts";

const SUNNYSIDE_ZIP_POINT: [number, number] = [32.15102, -110.94461];
const VAIL_POINT: [number, number] = [32.00932, -110.66108];

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

  assert.notEqual(asked.binding.kind, "NONE", "the named government must be seen");
  const gaps = asked.answer.steps.map((s) => s.gap).filter(Boolean).join(" ");
  assert.match(
    gaps,
    /vail/i,
    "the sentence the reader gets must name what they asked about",
  );
});

test("THE PROOF: deleting the name is what changes the answer, and it still defaults", async () => {
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

  const labels = asked.answer.steps.flatMap((s) => s.bodies.map((b) => b.label));
  assert.ok(
    labels.some((l) => /Vail/i.test(l)),
    `the reader's own district was dropped by the binding: ${labels.join(", ") || "(nothing)"}`,
  );
});

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
  const board = bindNamedEntity("the Vail school board", INVENTORY);
  assert.equal(board.kind, "BOUND");
  if (board.kind === "BOUND") assert.equal(board.entity.divisionType, "school_district");
});

test("PLANTED: a body named for a common question word cannot capture the question", () => {
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
  assert.equal(mentionBeforeClassPhrase("what's on the school district agenda?"), null);
  assert.equal(mentionBeforeClassPhrase("who is on my school board"), null);
  assert.equal(mentionBeforeClassPhrase("when does the city council meet"), null);
  /* A real name still comes back. */
  assert.equal(mentionBeforeClassPhrase("what's on the Marana school district agenda"), "marana");
});

test("binding constrains retrieval by IDENTITY, never by label", async () => {
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

  const local = answerQuestion(
    "who do I call about a pothole",
    coverage,
    "85706",
    { entities: [] },
  );
  assert.equal(local.binding.kind, "NONE", "this question names no government");
});

test("dedupe does NOT collapse two genuinely distinct governments that share a name", () => {
  /* Dedupe runs across the two inventories, never within coverage: two real governments can share a name. */
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
  assert.match(gaps, /vail/i, "the reader is not told which name went unmatched");
});

test("the ambiguous sentence asks for something the product actually does", async () => {
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

const TUCSON = "ocd-division/country:us/state:az/place:tucson";
const TUCSON_PHA = `${TUCSON}#public-housing-authority`;
const NO_INTERPRETATION = { entityMentions: [], normalizedMentions: [] } as unknown as Parameters<typeof resolveInterpretation>[0];

function tucsonAskInventory(): BindableEntity[] {
  return snapshotEntities(
    [
      { bodyId: `${TUCSON}#governing`, ocdId: TUCSON },
      { bodyId: TUCSON_PHA, ocdId: TUCSON },
      { bodyId: `${TUCSON}#tucson-parks-and-recreation-commission`, ocdId: TUCSON },
    ],
    (bodyId) => canonicalBodyIdentity(bodyId),
  );
}

test("R12: a topic word does not bind the body named for it; the question stays about the city", () => {
  const entities = tucsonAskInventory();
  const pha = entities.find((e) => e.id === TUCSON_PHA);
  assert.ok(pha && /^Tucson .*Housing Authority/.test(pha.name), `precondition: the authority is named "${pha?.name}" for a reader`);

  const housing = resolveInterpretation(NO_INTERPRETATION, "What is Tucson doing about housing?", entities);
  assert.notEqual(
    housing.binding.kind === "BOUND" ? housing.binding.entity.id : null,
    TUCSON_PHA,
    "the reader named a city and asked about a subject; they did not name the housing authority",
  );
  const without = resolveInterpretation(NO_INTERPRETATION, "What is Tucson doing?", entities);
  assert.deepEqual(housing.binding, without.binding);
  assert.equal(housing.binding.kind, "BOUND");
  if (housing.binding.kind === "BOUND") assert.equal(housing.binding.entity.id, `${TUCSON}#governing`);
});

test("R12: saying what kind of body it is still names the authority", () => {
  const entities = tucsonAskInventory();
  for (const question of [
    "Tucson Housing Authority",
    "What is the Tucson Public Housing Authority doing?",
    "tucson housing board of commissioners",
  ]) {
    const bound = bindNamedEntity(question, entities);
    assert.equal(bound.kind, "BOUND", question);
    if (bound.kind === "BOUND") assert.equal(bound.entity.id, TUCSON_PHA, question);
  }
  /* A name with an identifying word of its own past the topic word is untouched. */
  const parks = bindNamedEntity("tucson parks and recreation", entities);
  assert.equal(parks.kind, "BOUND");
  if (parks.kind === "BOUND") assert.equal(parks.entity.id, `${TUCSON}#tucson-parks-and-recreation-commission`);
});
