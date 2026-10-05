import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { ballotAskInventory, ballotRecordsFor, measureDesignations } from "../lib/ask/ballot-inventory.ts";
import { lineupForContest } from "../lib/ballot/general-lineup.ts";
import { contactRecord, contactsForBody, contactsForRepresentatives } from "../lib/ask/contacts.ts";
import { evidenceProvenance } from "../lib/ask/evidence.ts";
import { localDate, localTime, localWeekday, readableSitting } from "../lib/ask/meeting-time.ts";
import { unavailableInterpretation, type AskInterpretation } from "../lib/ask/intent.ts";
import { isReferential, resolveInterpretation } from "../lib/ask/resolve.ts";
import { readSubjectRefs } from "../lib/ask/subject.ts";
import { readLocationOrigin, stampResidency, countsAsResident, zipCohortOnly, cohortLabel } from "../lib/ask/residency.ts";
import {
  askKeyHash,
  captureAskInteraction,
  prepareAskInteraction,
  scrubStoredAnswer,
  normalizeApproximateLocation,
  type AskCaptureInput,
  type AskInteractionRow,
} from "../lib/db/ask-signal.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

/**
 * **THE PR #212 FOLLOW-UP — the integration that was missing, planted.**
 * (2026-08-28.)
 *
 * PR #212 built a grounded Ask engine and left five things undone, each of
 * which had a green test suite standing beside it:
 *
 * 1. The map Ask box never called the new engine.
 * 2. A model's alias expansion could outrank the entity the reader NAMED.
 * 3. `referent` was produced by the interpretation rung and read by nobody.
 * 4. The ballot's own contests, candidates and measures were not entities.
 * 5. `captureAskInteraction` had no production caller, while being described
 *    as one-flip activation.
 *
 * Every test below is written so that the code as it stood before this session
 * FAILS it. A check whose failure mode was never observed is not evidence —
 * that is the lesson PR #211 paid for and this file is built on it.
 */

const ROOT = process.cwd();

const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district";
const SUNNYSIDE = "ocd-division/country:us/state:az/school_district:sunnyside_unified_district";

const ENTITIES: BindableEntity[] = [
  { id: VAIL, name: "vail unified district", nameClass: "body", divisionType: "school_district" },
  { id: SUNNYSIDE, name: "sunnyside unified district", nameClass: "body", divisionType: "school_district" },
  { id: "person:katie_hobbs", name: "Katie Hobbs", nameClass: "person", divisionType: "person" },
  { id: "person:adrian_fontes", name: "Adrian Fontes", nameClass: "person", divisionType: "person" },
  { id: "cand:biggs", name: "Andy Biggs", nameClass: "person", divisionType: "person" },
];

function reading(over: Partial<AskInterpretation> = {}): AskInterpretation {
  return { ...unavailableInterpretation(), ...over };
}

/* ══════════════════════════════════════════════════════════════════════
   1 · THE MAP ASK BOX USES THE GROUNDED ENGINE
   ══════════════════════════════════════════════════════════════════════ */

const ASK_BOX = readFileSync(join(ROOT, "components", "ask", "ask-box.tsx"), "utf8");
const BALLOT_ASK = readFileSync(join(ROOT, "components", "ask", "ballot-ask.tsx"), "utf8");
const GROUNDED_ROUTE = readFileSync(
  join(ROOT, "app", "api", "ask", "grounded", "route.ts"),
  "utf8",
);

/** Comments stripped: this repo's guards read raw text, and the modules that
 *  DOCUMENT a removal quote the call they deleted. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("BLOCKER 1: the map Ask box posts to the grounded engine", () => {
  /*
   * THE DEFECT, EXACTLY. At merged main this file fetched `/api/ask/classify`
   * and `/api/ask/agenda` and nothing else. The grounded pipeline existed, was
   * tested, answered the Vail question correctly through a harness — and the
   * product's primary Ask surface routed around it.
   */
  assert.match(
    code(ASK_BOX),
    /fetch\("\/api\/ask\/grounded"/,
    "the map Ask box must call the grounded engine",
  );
});

test("BLOCKER 1: the grounded call is AWAITED on every ask, so nothing can bypass it", () => {
  /*
   * Present-in-the-file is not enough: a call inside a branch nothing reaches
   * would satisfy a grep and answer no reader. The pin is on the unconditional
   * await that every non-navigation submission passes through.
   *
   * **UPDATED BY ASK-05 (2026-08-28).** This used to pin
   * `await Promise.all([ askGrounded(question)` — and that `Promise.all` was
   * itself the ASK-05 defect: the second entry in it was a SECOND engine whose
   * reply rendered as a competing civic answer on the same screen. The
   * property being asserted has not changed at all; the expression carrying it
   * has, and the single await is the stronger form because there is no longer
   * a second call to race.
   */
  const source = code(ASK_BOX);
  assert.match(
    source,
    /const groundedAnswer = await askGrounded\(question, confirmation\);/,
    "the grounded engine must be awaited on the main submission path",
  );
  /* And it must not be behind a condition that could skip it. */
  assert.ok(
    !/if \([^)]*\)\s*\{?\s*(?:const \w+ = )?await askGrounded/.test(source),
    "the grounded call must not sit behind a condition",
  );
  /* Nor may a second engine come back beside it. */
  assert.ok(
    !/Promise\.all/.test(source),
    "the map surface must not race a second answer against the grounded engine",
  );
});

test("ASK-05: the map surface calls exactly ONE engine for an answer", () => {
  /*
   * **THE BOUNDARY IS NO LONGER A FLAG A CLIENT DECLARES.**
   *
   * This test used to assert that the component sent `scope: "TOPIC_ONLY"` and
   * that the server refused the named-body docket under it. That was a promise
   * enforced by a conditional, and the conditional was the only thing standing
   * between the reader and two answers.
   *
   * The component does not call `/api/ask/agenda` at all now, and the route
   * has no topic or body-agenda branch left to gate. Both halves of the old
   * assertion are replaced by their stronger forms: there is nothing to
   * declare, and nothing to reach.
   */
  const source = code(ASK_BOX);
  assert.ok(
    !/fetch\("\/api\/ask\/agenda"/.test(source),
    "the map surface must not fetch a second civic answer",
  );
  assert.ok(
    !/scope: "TOPIC_ONLY"/.test(source),
    "a scope flag means the second answer is still reachable and merely declined",
  );
  assert.ok(
    !/body-agenda/.test(source),
    "the map surface must not read the old body-agenda answer",
  );
});

test("ASK-05: the SERVER holds no second civic answer, so the boundary is structural", () => {
  /*
   * A discipline held in a conditional drifts back the first time somebody
   * edits the conditional. The topic sweep and the named-body docket are not
   * declined here — they are ABSENT, and what remains is a lookup by meeting
   * id that binds nothing and makes no claim about which government a question
   * is about.
   */
  const route = code(
    readFileSync(join(ROOT, "app", "api", "ask", "agenda", "route.ts"), "utf8"),
  );
  for (const gone of [
    "TOPIC_ONLY",
    "bodyAgendaAnswer",
    "bindNamedEntity",
    "asksForBodyAgenda",
    "searchAgendas",
    "agendaTopicFor",
    "namedEntity",
  ]) {
    assert.ok(
      !route.includes(gone),
      `${gone} is still reachable in /api/ask/agenda — the second answer has not actually left`,
    );
  }
  /* And the one thing it still does is declared rather than inline. */
  assert.match(route, /export interface AgendaMeetingReply/);
  assert.match(route, /const reply: AgendaMeetingReply = \{/);
});

test("ASK-05: the topic sweep survived the move, with its scope and its denominators", () => {
  /*
   * **DELETING THE SECOND ANSWER MUST NOT DELETE THE CAPABILITY.** *"Is there
   * a data centre coming?"* is a real question with a real denominator, and
   * the risk in this refactor was always that removing the surface removed the
   * answer with it. The sweep now lives in one module, emits into the one
   * pack, and narrows to a bound body rather than sweeping the reader's whole
   * area under an answer about one government.
   */
  const sweep = code(
    readFileSync(join(ROOT, "lib", "ask", "agenda-topic.ts"), "utf8"),
  );
  assert.match(sweep, /kind: "AGENDA_MENTION"/, "hits enter the ONE evidence pack");
  assert.match(sweep, /agendasSweptForTopic/, "the denominator survives as a number");
  assert.match(sweep, /agendasHeldButUnreadable/, "unreadable is still its own fact");

  const route = code(GROUNDED_ROUTE);
  assert.match(route, /agendaTopicEvidence\(\{/, "the one engine runs the sweep");
  assert.match(
    route,
    /subject\?\.kind === "BODY"\s*\?\s*\{ meetings: meetingsForBody\(/,
    "a bound body must NARROW the sweep, not merely coexist with it",
  );
  /*
   * **AND IT MUST NARROW ON THE BODY, NOT ON THE GEOGRAPHY.** (2026-08-29.)
   *
   * The assertion above passed throughout the Pima defect: the sweep WAS
   * narrowed, to `m.ocdId === subject.id`, which on a division carrying two
   * governments narrows to the wrong set rather than to none. "Narrowed" and
   * "narrowed correctly" are different claims and only the second is worth
   * guarding, so the rule the repair turns on is pinned here too.
   */
  assert.match(
    route,
    /function meetingsForBody\([\s\S]*?bound\.level !== "BODY"[\s\S]*?m\.bodyId === bound\.id/,
    "the body sweep must select on bodyId — selecting on ocdId is the Pima defect",
  );
});

test("the unified input's SEARCH half is untouched — an exact name still navigates", () => {
  /*
   * The map input has two legitimate jobs and only one of them is an Ask. The
   * exact-name branch returns BEFORE any question is asked or logged, which is
   * the "two logs must not blur" rule, and it must survive this refactor.
   */
  const source = code(ASK_BOX);
  assert.match(source, /if \(result\.exactName && onSearchPick\)/);
  assert.match(source, /setWorking\(false\);\s*pick\(hit\);\s*return;/);
  /* And the autocomplete pick path still exists. */
  assert.match(source, /function pick\(item: SearchItem\)/);
  assert.match(source, /onSearchPick\?\.\(item\)/);
});

/* ══════════════════════════════════════════════════════════════════════
   2 · IDENTITY PRECEDENCE
   ══════════════════════════════════════════════════════════════════════ */

test("BLOCKER 2: the reader's explicit entity beats a conflicting model expansion", () => {
  /*
   * **THE ADVERSARIAL CASE, AND IT IS THE WHOLE BLOCKER.**
   *
   * Both candidates bind. Both are real entities. The binder is not wrong
   * about either — so no amount of binder correctness decides this, and the
   * shipped ORDER decided it wrongly: `MODEL_EXPANSION` was tried first and
   * returned first, so Claude's hypothesis beat the name the reader typed.
   */
  const result = resolveInterpretation(
    reading({
      entityMentions: ["Katie Hobbs"],
      normalizedMentions: ["Adrian Fontes"],
    }),
    "What has Katie Hobbs done?",
    ENTITIES,
  );
  assert.equal(result.binding.kind, "BOUND");
  assert.equal(
    result.binding.kind === "BOUND" ? result.binding.entity.id : null,
    "person:katie_hobbs",
    "the entity the reader NAMED must win a conflict with a valid model expansion",
  );
  assert.equal(result.basis, "READER_WORDS");
});

test("BLOCKER 2: an ordinary alias still benefits from model normalization", () => {
  /*
   * The other direction, and it must not be lost to the fix. "VUSD" binds
   * nothing verbatim — no entity's distinctive tokens appear in it — so the
   * model's expansion is what makes the question answerable. A precedence rule
   * that suppressed this would have traded one defect for a duller product.
   */
  const result = resolveInterpretation(
    reading({
      entityMentions: ["VUSD"],
      normalizedMentions: ["Vail Unified District"],
    }),
    "What is VUSD doing next?",
    ENTITIES,
  );
  assert.equal(result.binding.kind, "BOUND");
  assert.equal(result.binding.kind === "BOUND" ? result.binding.entity.id : null, VAIL);
  assert.equal(result.basis, "MODEL_EXPANSION");
});

test("BLOCKER 2: a model expansion may NARROW the reader's ambiguity, only from inside it", () => {
  /*
   * "Vail" with no class word fits both a town and a school district. The
   * model saying which is the alias job. The model answering with a THIRD
   * government is a substitution, and that is the line.
   */
  const withPlace: BindableEntity[] = [
    ...ENTITIES,
    { id: "ocd-division/country:us/state:az/place:vail", name: "vail", nameClass: "place", divisionType: "place" },
  ];

  const narrowed = resolveInterpretation(
    reading({ entityMentions: ["Vail"], normalizedMentions: ["Vail Unified District"] }),
    "What is Vail up to?",
    withPlace,
  );
  assert.equal(narrowed.binding.kind, "BOUND");
  assert.equal(narrowed.binding.kind === "BOUND" ? narrowed.binding.entity.id : null, VAIL);
  assert.equal(narrowed.basis, "MODEL_EXPANSION_NARROWED");

  const substituted = resolveInterpretation(
    reading({ entityMentions: ["Vail"], normalizedMentions: ["Sunnyside Unified District"] }),
    "What is Vail up to?",
    withPlace,
  );
  assert.equal(
    substituted.binding.kind,
    "AMBIGUOUS",
    "an expansion outside the reader's own candidates is a substitution and is refused",
  );
});

test("BLOCKER 2: named-but-unresolved is never NONE, and never falls through to a ZIP default", () => {
  /*
   * The PR #211 invariant, re-asserted through the new precedence. `NONE`
   * licenses the reader's own divisions to decide the answer, which is exactly
   * how a question about Vail was answered with Sunnyside.
   */
  const result = resolveInterpretation(
    reading({ entityMentions: ["Cienega"], normalizedMentions: ["Cienega School District"] }),
    "What is on the Cienega school district agenda?",
    ENTITIES,
  );
  assert.notEqual(result.binding.kind, "NONE");
  assert.notEqual(result.binding.kind, "BOUND");
  assert.equal(result.binding.kind, "UNRESOLVED");
});

test("BLOCKER 2: an UNRESOLVED explicit name is not repaired by a model expansion to a DIFFERENT government", () => {
  const result = resolveInterpretation(
    reading({
      entityMentions: ["Cienega school district"],
      normalizedMentions: ["Vail Unified District"],
    }),
    "What is on the Cienega school district agenda?",
    ENTITIES,
  );
  assert.equal(
    result.binding.kind,
    "UNRESOLVED",
    "the reader named Cienega; answering about Vail would be the substitution defect with an alias table in front of it",
  );
});

/* ══════════════════════════════════════════════════════════════════════
   3 · THE REFERENT IS ACTUALLY CONSUMED
   ══════════════════════════════════════════════════════════════════════ */

test("BLOCKER 3: `resolveInterpretation` reads the referent field at all", () => {
  /*
   * The defect was mechanical and invisible: `interpretQuestion` returned
   * `referent`, a comment claimed page context resolved "what has she done?",
   * and a repository-wide search found the word only in the intent layer.
   * A comment stronger than its code reads as covered and is not.
   */
  const resolve = code(readFileSync(join(ROOT, "lib", "ask", "resolve.ts"), "utf8"));
  assert.match(resolve, /interpretation\.referent/, "the referent must be consumed");
});

test("BLOCKER 3: one unambiguous focused person resolves a pronoun", () => {
  const result = resolveInterpretation(
    reading({ referent: "Katie Hobbs" }),
    "What has she done?",
    ENTITIES,
    {
      activeSubjects: [
        { id: "person:katie_hobbs", name: "Katie Hobbs", kind: "PERSON", focused: true },
      ],
    },
  );
  assert.equal(result.binding.kind, "BOUND");
  assert.equal(result.binding.kind === "BOUND" ? result.binding.entity.id : null, "person:katie_hobbs");
  assert.equal(result.basis, "PAGE_CONTEXT");
});

test("BLOCKER 3: an UNCORROBORATED model referent does not bind", () => {
  /*
   * Claude may SUGGEST the referent. Claude does not make it true. A referent
   * naming somebody the surface never said was on screen is the model reaching
   * into its own memory for a subject, which is the one thing this pipeline
   * exists to prevent — and it is the failure mode a naive "trust the
   * referent" implementation would have shipped.
   */
  const result = resolveInterpretation(
    reading({ referent: "Adrian Fontes" }),
    "What has she done?",
    ENTITIES,
    {
      activeSubjects: [
        { id: "person:katie_hobbs", name: "Katie Hobbs", kind: "PERSON", focused: true },
      ],
    },
  );
  assert.equal(result.binding.kind, "BOUND");
  assert.equal(
    result.binding.kind === "BOUND" ? result.binding.entity.id : null,
    "person:katie_hobbs",
    "an uncorroborated referent falls back to the page's own evidence, never to the model's name",
  );
});

test("BLOCKER 3: more than one plausible person on screen CLARIFIES rather than choosing", () => {
  const result = resolveInterpretation(
    reading(),
    "What has she done?",
    ENTITIES,
    {
      activeSubjects: [
        { id: "person:katie_hobbs", name: "Katie Hobbs", kind: "PERSON" },
        { id: "cand:biggs", name: "Andy Biggs", kind: "PERSON" },
      ],
    },
  );
  assert.equal(result.binding.kind, "AMBIGUOUS");
  assert.equal(
    result.binding.kind === "AMBIGUOUS" ? result.binding.candidates.length : 0,
    2,
  );
});

test("BLOCKER 3: an explicit name overrides an active card", () => {
  /*
   * The motivating example. A reader looking at one candidate's card who
   * types another candidate's NAME is asking about the person they typed.
   */
  const result = resolveInterpretation(
    reading({ entityMentions: ["Katie Hobbs"] }),
    "What has Katie Hobbs done?",
    ENTITIES,
    {
      activeSubjects: [{ id: "cand:biggs", name: "Andy Biggs", kind: "PERSON", focused: true }],
    },
  );
  assert.equal(result.binding.kind === "BOUND" ? result.binding.entity.id : null, "person:katie_hobbs");
});

test("BLOCKER 3: an explicit name we do NOT hold stays unresolved rather than taking the open card", () => {
  /*
   * The dangerous half of the same rule. A reader who names somebody we do not
   * hold, while a card is open, must not be answered about the card — that is
   * the substitution defect arriving through the follow-up feature.
   */
  const result = resolveInterpretation(
    reading({ entityMentions: ["Ruben Gallego"] }),
    "What has Ruben Gallego done for her district?",
    ENTITIES,
    {
      activeSubjects: [{ id: "cand:biggs", name: "Andy Biggs", kind: "PERSON", focused: true }],
    },
  );
  assert.equal(result.binding.kind, "UNRESOLVED");
});

test("BLOCKER 3: a bounded prior turn resolves a follow-up when the page offers nothing", () => {
  const result = resolveInterpretation(
    reading(),
    "And what has she done since?",
    ENTITIES,
    {
      priorSubjects: [{ id: "person:katie_hobbs", name: "Katie Hobbs", kind: "PERSON" }],
    },
  );
  assert.equal(result.binding.kind === "BOUND" ? result.binding.entity.id : null, "person:katie_hobbs");
  assert.equal(result.basis, "PRIOR_TURN");
});

test("a question with no pronoun and no mention never picks up page context", () => {
  assert.equal(isReferential("what is on the agenda"), false);
  const result = resolveInterpretation(reading(), "what is on the agenda", ENTITIES, {
    activeSubjects: [{ id: "cand:biggs", name: "Andy Biggs", kind: "PERSON", focused: true }],
  });
  assert.equal(result.binding.kind, "NONE");
});

test("both Ask surfaces send page context as canonical REFERENCES, not display strings", () => {
  /*
   * The strings used to travel to the interpretation model and stop there —
   * the binder never saw them, so nothing on the ballot was resolvable.
   */
  assert.match(code(BALLOT_ASK), /priorSubjects/);
  assert.match(code(ASK_BOX), /priorSubjects/);
  const page = code(readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8"));
  assert.match(page, /const askSubjects: \{/, "the ballot page must build typed references");
  assert.match(page, /id: c\.id,/, "a contest reference must carry the contest's canonical id");
});

test("readSubjectRefs refuses anything that is neither a name nor an id", () => {
  const refs = readSubjectRefs([
    "Andy Biggs",
    { id: "ballot-az-pima:governor", name: "Governor", kind: "CONTEST", focused: true },
    { kind: "PERSON" },
    42,
    null,
  ]);
  assert.equal(refs.length, 2);
  assert.equal(refs[1].kind, "CONTEST");
  assert.equal(refs[1].focused, true);
});

/* ══════════════════════════════════════════════════════════════════════
   4 · THE BALLOT'S CANONICAL INVENTORY
   ══════════════════════════════════════════════════════════════════════ */

const AZ_BALLOT = JSON.parse(
  readFileSync(join(ROOT, "data", "states", "az", "ballot", "az-pima-2026.json"), "utf8"),
) as BallotSet;

/** The live inventory: the same lineup lookup the ballot page renders from. */
const nominees = (contestId: string) => lineupForContest(contestId)?.nominees ?? [];

test("BLOCKER 4: a non-statewide CHALLENGER on the reader's ballot is a resolvable entity", () => {
  /*
   * **THE DEFECT, NAMED.** Katie Hobbs answered on the ballot because she is a
   * sitting statewide executive, not because the ballot contributed anything.
   * Andy Biggs is on the same governor line and was not an entity this product
   * held at all — nor was any challenger, any contest, or any of the fifteen
   * propositions the same page renders.
   */
  const inventory = ballotAskInventory(AZ_BALLOT, AZ_BALLOT.contests, nominees);
  const biggs = inventory.entities.find((e) => e.name === "Andy Biggs");
  assert.ok(biggs, "a challenger on the general-election ballot must be in the Ask inventory");
  assert.equal(
    biggs?.id,
    "ballot-az-pima:governor|Andy Biggs",
    "keyed exactly as app/ballot/page.tsx keys him — a differently derived id retrieves nothing",
  );
  assert.equal(inventory.subjects.get(biggs!.id)?.kind, "PERSON");
  assert.equal(
    inventory.subjects.get(biggs!.id)?.candidacyId,
    "ballot-az-pima:governor:biggs-andy",
    "and the filing row rides along, so one human is one subject across two stores",
  );
});

test("BLOCKER 4: a person the two stores key differently does NOT become two entities", () => {
  /*
   * The false clarification, planted. The filing calls him
   * `…:biggs-andy` and the general lineup keys him `…|Andy Biggs`. Offering
   * both put two distinct ids behind one name, and the binder — correctly, by
   * its own tie rule — reported AMBIGUOUS. The reader was asked which Andy
   * Biggs they meant, about a distinction that exists only in our storage.
   */
  const inventory = ballotAskInventory(AZ_BALLOT, AZ_BALLOT.contests, nominees);
  const ids = new Set(
    inventory.entities.filter((e) => e.name === "Andy Biggs").map((e) => e.id),
  );
  assert.equal(ids.size, 1, "one human, one canonical id");
});

test("BLOCKER 4: contests and measures are resolvable, with the designations a reader types", () => {
  const inventory = ballotAskInventory(AZ_BALLOT, AZ_BALLOT.contests, nominees);
  const ids = new Set(inventory.entities.map((e) => e.id));
  assert.ok(ids.has("ballot-az-pima:governor"), "a contest is an entity");
  assert.ok(ids.has("ballot-az-pima:prop-423"), "a measure is an entity");

  /* The clerk files "Proposition 423: …". A reader types "Prop 423". The binder
     needs every distinctive token present, so the filing title alone can never
     be bound by a person. */
  assert.deepEqual(
    measureDesignations("Proposition 423: Vail Unified School District budget override continuation"),
    ["Proposition 423", "Prop 423"],
  );
  const shortForm = inventory.entities.filter((e) => e.name === "Prop 423");
  assert.equal(shortForm.length, 1);
  assert.equal(shortForm[0].id, "ballot-az-pima:prop-423", "an alias shares the measure's canonical id");
});

test("BLOCKER 4: a measure retrieves its verbatim question, not a paraphrase", () => {
  const inventory = ballotAskInventory(AZ_BALLOT, AZ_BALLOT.contests);
  const record = inventory.subjects.get("ballot-az-pima:prop-423");
  assert.ok(record);
  const { records } = ballotRecordsFor(record!, {
    set: AZ_BALLOT,
    contests: AZ_BALLOT.contests,
    absences: AZ_BALLOT.absences,
  });
  const question = records.find((r) => r.kind === "MEASURE_QUESTION");
  assert.ok(question, "the official question text must travel as its own record");
  const filed = AZ_BALLOT.measures.find((m) => m.contestId === "ballot-az-pima:prop-423");
  assert.equal(question!.text, filed!.questionText, "verbatim, never paraphrased");
});

test("BLOCKER 4: retrieval selects on the canonical id, never on a display name", () => {
  const inventory = ballotAskInventory(AZ_BALLOT, AZ_BALLOT.contests, nominees);
  const hobbs = inventory.subjects.get("ballot-az-pima:governor|Katie Hobbs");
  assert.ok(hobbs);
  const { records } = ballotRecordsFor(hobbs!, {
    set: AZ_BALLOT,
    contests: AZ_BALLOT.contests,
    absences: AZ_BALLOT.absences,
  });
  const candidacies = records.filter((r) => r.kind === "CANDIDACY");
  assert.equal(candidacies.length, 1, "one candidate's question retrieves one candidacy");
  assert.equal(candidacies[0].id, "ballot-az-pima:governor:hobbs-katie");
});

test("BLOCKER 4: a filing that does not state incumbency renders as UNKNOWN, never as 'not the incumbent'", () => {
  const inventory = ballotAskInventory(AZ_BALLOT, AZ_BALLOT.contests);
  const anyCandidate = [...inventory.subjects.values()].find((s) => s.kind === "PERSON");
  assert.ok(anyCandidate);
  const { records } = ballotRecordsFor(anyCandidate!, {
    set: AZ_BALLOT,
    contests: AZ_BALLOT.contests,
    absences: AZ_BALLOT.absences,
  });
  const candidacy = records.find((r) => r.kind === "CANDIDACY");
  const filed = AZ_BALLOT.candidacies.find((c) => c.id === anyCandidate!.id);
  if (filed && filed.incumbent === null) {
    assert.match(candidacy!.text, /does not state whether they are the incumbent/);
  }
});

test("BLOCKER 4: the authority's own statement of ABSENCE is evidence, with its citation", () => {
  const inventory = ballotAskInventory(AZ_BALLOT, AZ_BALLOT.contests);
  /* Vail's school board race: two seats up, two filed, the election cancelled
     as uncontested. That is a fact a reader needs, in the county's words. */
  const vailAbsence = AZ_BALLOT.absences.find((a) => a.ocdId === VAIL);
  assert.ok(vailAbsence, "the committed ballot holds Pima County's own statement");
  assert.match(vailAbsence!.statement, /no Vail Unified School District governing board race/i);
  assert.ok(vailAbsence!.provenance?.sourceUrl, "an absence carries a citation like any contest");
  void inventory;
});

/* ══════════════════════════════════════════════════════════════════════
   5 · THE SITTING IS PRINTED IN THE BODY'S OWN ZONE
   ══════════════════════════════════════════════════════════════════════ */

test("RED CONTROL: a Vail sitting reads as its LOCAL day, not its UTC day", () => {
  /*
   * **THE WRONG FACT, IN A SMALL FONT.** Every Vail row in the corpus is stored
   * at 02:00Z, which is 7:00 p.m. the PREVIOUS evening in Arizona — and 7:00
   * p.m. is when the board actually sits, on the second and fourth Tuesday, as
   * the district says on its own portal page.
   *
   * The grounded route's meeting record used to read `starting
   * 2026-09-09T02:00:00.000Z in time zone America/Phoenix`, which printed a
   * Wednesday for a meeting held on a Tuesday, and put an identifier on a
   * reader surface while doing it.
   */
  const sitting = { startsAt: "2026-09-09T02:00:00.000Z", timeZone: "America/Phoenix" };
  assert.equal(localDate(sitting), "2026-09-08", "the LOCAL calendar date is the 8th");
  assert.equal(localWeekday(sitting), "Tuesday");
  assert.match(localTime(sitting), /7:00\s?PM/);

  const readable = readableSitting(sitting);
  assert.match(readable, /Tuesday, September 8th, 2026 at 7:00 PM MST/);
  assert.ok(!/T02:00/.test(readable), "no ISO instant may reach a reader");
  assert.ok(!/America\/Phoenix/.test(readable), "no IANA zone id may reach a reader");
});

test("a body with no recorded zone SAYS SO rather than printing UTC as local", () => {
  const readable = readableSitting({ startsAt: "2026-09-09T02:00:00.000Z", timeZone: null });
  assert.match(readable, /have not recorded this body's time zone/);
});

test("the grounded route prints sittings through the shared formatter", () => {
  assert.match(code(GROUNDED_ROUTE), /readableSitting\(chosen\)/);
  assert.ok(
    !/starting \$\{chosen\.startsAt\}/.test(GROUNDED_ROUTE),
    "the raw instant must not be interpolated into a record a reader sees",
  );
});

/* ══════════════════════════════════════════════════════════════════════
   6 · CONTACTS COME ONLY FROM VERIFIED RELATIONSHIPS
   ══════════════════════════════════════════════════════════════════════ */

test("CONTACTS: Vail's board and superintendent come back, each with a source", () => {
  const contacts = contactsForBody(
    { bodyId: `${VAIL}#board`, ocdId: VAIL, divisionType: "school_district" },
    "Vail Unified District",
  );
  assert.ok(contacts.length >= 5, `expected the Vail roster, got ${contacts.length}`);
  for (const contact of contacts) {
    assert.ok(contact.sourceUrl, `${contact.name} must carry the record it was read from`);
    assert.ok(contact.relationship.length > 0);
  }
  const superintendent = contacts.find((c) => /superintendent/i.test(c.officeTitle));
  assert.ok(superintendent, "the superintendent is the most useful contact for a district question");
  assert.equal(
    superintendent!.basis,
    "BODY_STAFF",
    "hired by the board, not seated on it — and the record says which",
  );
  const president = contacts.find((c) => /president/i.test(c.officeTitle));
  assert.equal(president?.basis, "BODY_MEMBER");
});

test("CONTACTS: nothing is invented for a body whose roster we do not hold", () => {
  const unheld = "ocd-division/country:us/state:az/school_district:not_a_real_district";
  const contacts = contactsForBody(
    { bodyId: `${unheld}#board`, ocdId: unheld, divisionType: "school_district" },
    "Nowhere Unified",
  );
  assert.deepEqual(contacts, [], "an unheld roster is an empty answer, never a plausible one");
});

test("CONTACTS: a contact record states the relationship and never an assessment", () => {
  const record = contactRecord({
    id: "roster:vail#1",
    name: "Allison Pratt",
    officeTitle: "Governing Board President",
    relationship: "Governing Board President on Vail Unified District",
    basis: "BODY_MEMBER",
    email: null,
    phone: null,
    websiteUrl: null,
    sourceUrl: "https://www.vailschooldistrict.org/o/vsd/page/governing-board",
    sourceOrg: "Vail Unified School District",
    retrievedAt: "2026-08-13",
  });
  assert.match(record.text, /Allison Pratt — Governing Board President on Vail Unified District\./);
  /* The words this product may never use about a person. */
  for (const banned of [/most influential/i, /best person/i, /you should contact/i, /most likely to help/i]) {
    assert.ok(!banned.test(record.text), `a contact may not carry ${banned}`);
  }
  /* A person with no published email carries no email — never a fabricated route. */
  assert.ok(!/Published contact/.test(record.text));
});

test("CONTACTS: a representative's relationship is bounded by what a division proves", () => {
  const contacts = contactsForRepresentatives([
    {
      id: "az-sldu-19",
      name: "A Senator",
      officeTitle: "State Senator",
      email: "senator@azleg.gov",
      phone: null,
      websiteUrl: null,
      sourceUrl: "https://www.azleg.gov/",
      sourceOrg: "Arizona Legislature",
      collectedAt: "2026-08-13",
    },
  ]);
  assert.equal(contacts[0].relationship, "Your state senator");
  assert.equal(contacts[0].basis, "READER_REPRESENTATIVE");
});

/* ══════════════════════════════════════════════════════════════════════
   7 · SIGNAL CAPTURE — A REAL CALLER, SHIPPED GATED
   ══════════════════════════════════════════════════════════════════════ */

function captureInput(over: Partial<AskCaptureInput> = {}): AskCaptureInput {
  return {
    question: "What's on the Vail school district agenda?",
    intent: "UPCOMING_AGENDA",
    temporalKind: "NEXT",
    subjectIds: [VAIL],
    resolutionState: "BOUND",
    answerMode: "GROUNDED_CLAUDE",
    answerText: "The next Vail Unified District board meeting is on Tuesday, September 8th, 2026.",
    answerModel: "claude-opus-5",
    validationPassed: true,
    evidenceRecordCount: 2,
    evidenceSourceCount: 1,
    namedGapCount: 1,
    evidenceProvenance: evidenceProvenance([
      {
        kind: "MEETING",
        id: "apptegy:vail:60703698",
        text: "…",
        sourceUrl: "https://vailschooldistrict.community.highbond.com/Portal/",
        sourceOrg: "Vail School District Governing Board",
        retrievedAt: "2026-08-13T21:01:25.791Z",
      },
    ]),
    surface: "MAP",
    approximateLocation: "85641",
    ocdIds: ["ocd-division/country:us/state:az/county:pima"],
    divisionVintage: "TIGER_GENZ2025",
    residencyRelation: "CURRENT_HOME",
    locationConfidence: "SELF_DECLARED_ZIP",
    continuityKey: "browser-minted-abc123",
    runClass: "SYNTHETIC",
    runId: null,
    occurredAt: "2026-08-28T12:00:00.000Z",
    ...over,
  };
}

test("ASK SIGNAL: there is a REAL production call site, in the route, after the answer", () => {
  /*
   * **THE DEFECT.** PR #212 described this as one-flip activation. It was not:
   * `captureAskInteraction` was referenced only by its own module and its
   * tests, and the route's own header said it stored nothing. Pulling the
   * ripcord up would have changed nothing whatsoever.
   */
  const route = code(GROUNDED_ROUTE);
  assert.match(route, /captureAskInteraction\(/, "the route must actually call the capture path");
  /* And it must be called with the DELIVERED answer, which is only known at
     the end — a call before synthesis would record an intention. */
  const captureAt = route.indexOf("await capture(mode,");
  // The route calls the writing ladder (2026-09-25); synthesizeAnswer is its last rung.
  const synthesisAt = route.indexOf("await synthesizeWithLadder(");
  assert.ok(captureAt > 0 && synthesisAt > 0);
  assert.ok(
    captureAt > synthesisAt,
    "the row must be written after the delivered answer and mode are known",
  );
});

test("ASK SIGNAL: the map and the ballot share the call path because they share the engine", () => {
  /* Neither component writes a signal row of its own — there is exactly one
     write path, and it is behind the one engine both surfaces call. */
  assert.ok(!/captureAskInteraction/.test(code(ASK_BOX)));
  assert.ok(!/captureAskInteraction/.test(code(BALLOT_ASK)));
  assert.match(code(ASK_BOX), /fetch\("\/api\/ask\/grounded"/);
  assert.match(code(BALLOT_ASK), /fetch\("\/api\/ask\/grounded"/);
});

test("ASK SIGNAL: a call without a continuity key writes zero rows", async () => {
  const written: AskInteractionRow[] = [];
  const outcome = await captureAskInteraction(captureInput({ continuityKey: "" }), async (row) => {
    written.push(row);
  });
  assert.equal(outcome.kind, "FAILED");
  assert.equal(written.length, 0, "no key, no row");
});

test("ASK SIGNAL: with the gate lifted, one Ask writes exactly one row of the right shape", async () => {
  /*
   * The controlled test the ripcord's activation has to be able to pass. The
   * flag itself is not touched — the ripcord's own module reads process state
   * and this asserts the SHAPE through the pure builder, which is the same
   * object the write receives.
   */
  const row = prepareAskInteraction({
    ...captureInput(),
    coverageTier: "TIER_1",
    coverageTierDistribution: "T0:1,T1:1,T2:0,T3:0",
  });

  assert.equal(row.answerMode, "GROUNDED_CLAUDE");
  assert.equal(row.validationPassed, true);
  assert.equal(row.resolutionState, "BOUND");
  assert.deepEqual(row.subjectIds, [VAIL]);
  assert.equal(row.intent, "UPCOMING_AGENDA");
  assert.equal(row.temporalKind, "NEXT");
  assert.equal(row.surface, "MAP");
  assert.equal(row.residencyRelation, "CURRENT_HOME");
  assert.equal(row.locationConfidence, "SELF_DECLARED_ZIP");
  assert.equal(row.askKeyHash, askKeyHash("browser-minted-abc123"));
  assert.ok(row.answerText && row.answerText.length > 0);
});

test("ASK SIGNAL: enabling the flag without minting a key writes NOTHING, loudly", async () => {
  /*
   * `askKeyHash("")` is a perfectly good digest of the empty string, and it is
   * the SAME digest for every reader. A store enabled without minting would
   * report one distinct reader forever, with nothing anywhere raising an
   * error. The refusal makes the coupling structural.
   */
  const written: AskInteractionRow[] = [];
  const outcome = await captureAskInteraction(
    captureInput({ continuityKey: "" }),
    async (row) => {
      written.push(row);
    },
  );
  assert.notEqual(outcome.kind, "WROTE");
  assert.equal(written.length, 0);
});

test("ASK SIGNAL: one Ask writes exactly one row — and one only", async () => {
  {
    const written: AskInteractionRow[] = [];
    const outcome = await captureAskInteraction(captureInput(), async (row) => {
      written.push(row);
    });

    assert.equal(outcome.kind, "WROTE");
    assert.equal(written.length, 1, "one Ask, one row — never two, never none");

    const row = written[0];
    /* The commercial unit, whole: question, interpretation, subject, answer,
       mode, evidence provenance, surface, cohort and confidence. */
    assert.ok(row.questionScrubbed.length > 0, "the scrubbed question");
    assert.equal(row.intent, "UPCOMING_AGENDA");
    assert.equal(row.temporalKind, "NEXT");
    assert.deepEqual(row.subjectIds, [VAIL]);
    assert.equal(row.resolutionState, "BOUND");
    assert.equal(row.answerMode, "GROUNDED_CLAUDE");
    assert.ok(row.answerText && row.answerText.length > 0, "the delivered answer");
    assert.equal(row.validationPassed, true);
    assert.ok(row.evidenceRecordRefs.length > 0, "WHICH records, not merely how many");
    assert.ok(row.evidenceSourceUrls.length > 0);
    assert.equal(row.surface, "MAP");
    assert.equal(row.residencyRelation, "CURRENT_HOME");
    assert.equal(row.locationConfidence, "SELF_DECLARED_ZIP");
    assert.equal(row.askKeyHash, askKeyHash("browser-minted-abc123"));
    assert.equal(row.runClass, "SYNTHETIC", "a test run is never counted as reader signal");

    /* The coverage stamp is DERIVED at the write path — no route names a
       field the reader's tree is forbidden to hold. */
    assert.ok(row.coverageTier.length > 0);
    assert.ok(row.coverageTierDistribution.length > 0);

    /* And the raw continuity value never reaches the row. */
    assert.ok(
      !JSON.stringify(row).includes("browser-minted-abc123"),
      "the browser-minted key is digested, never stored",
    );
  }
});
test("ASK SIGNAL: the surfaces mint the returning-reader ID in the Ask store's own slot", () => {
  for (const [name, source] of [["ask-box", ASK_BOX], ["ballot-ask", BALLOT_ASK]] as const) {
    assert.match(code(source), /getOrCreateBrowserKey\("wtp\.ask_key"\)/, `${name} must mint its own key`);
    assert.ok(!/readBrowserKey/.test(code(source)), `${name} still reads without minting`);
  }
});

/* ══════════════════════════════════════════════════════════════════════
   8 · THE STORED ANSWER IS SCRUBBED TOO
   ══════════════════════════════════════════════════════════════════════ */

test("PII: a name the reader introduced and the model echoed survives in NEITHER column", () => {
  /*
   * **THE PLANT.** The question scrub was correct and the answer was only
   * truncated, so a reader who introduced themselves and a model that replied
   * politely would put the name straight back into the row one column over —
   * the store defeating its own redaction.
   *
   * A shape-based pass cannot find this. "Alma" in an answer is a word. What
   * finds it is knowing which value was removed from the question.
   */
  const row = prepareAskInteraction({
    ...captureInput({
      question:
        "My name is Alma Hernandez, my email is alma@example.com, I live at 4821 Camino Verde and my number is 520-555-0134. When does the board meet?",
      answerText:
        "Alma, the Vail Unified District board meets on Tuesday, September 8th, 2026. We can reach you at alma@example.com or 520-555-0134 about 4821 Camino Verde.",
    }),
    coverageTier: "TIER_1",
    coverageTierDistribution: "T0:1,T1:1,T2:0,T3:0",
  });

  for (const value of ["Alma Hernandez", "Alma", "alma@example.com", "520-555-0134", "4821 Camino Verde"]) {
    assert.ok(
      !row.questionScrubbed.includes(value),
      `the stored QUESTION still contains ${value}`,
    );
    assert.ok(
      !(row.answerText ?? "").includes(value),
      `the stored ANSWER still contains ${value}`,
    );
  }
  /* And the row remembers WHAT KIND was found, so the export gate can read it. */
  assert.ok(row.selfDisclosure.includes("SELF_NAMED"));
  assert.ok(row.selfDisclosure.includes("EMAIL"));
});

test("PII: the scrub does not eat the answer's own meaning", () => {
  /*
   * The other direction, and it is why the answer does not use the reader-text
   * pass wholesale: `STREET_ADDRESS_SHAPED` is "a number followed by
   * capitalised words", which is the shape of every spelled-out date this
   * product prints. Running it over an answer replaces the meeting date with a
   * redaction mark and files a false STREET_ADDRESS flag on the row.
   */
  const scrubbed = scrubStoredAnswer(
    "The board meets on Tuesday, September 8th, 2026 at 7:00 PM MST at 13801 E. Benson Highway.",
  );
  assert.match(scrubbed.text, /September 8th, 2026/, "the meeting date must survive");
  assert.ok(!scrubbed.flags.includes("STREET_ADDRESS"), "a date is not a self-disclosed address");
});

test("PII: an email in the answer is removed even when the reader never typed one", () => {
  const scrubbed = scrubStoredAnswer("Write to board@vail.example.org about it.");
  assert.ok(!scrubbed.text.includes("board@vail.example.org"));
  assert.ok(scrubbed.flags.includes("EMAIL"));
});

test("approximateLocation cannot drift from coarse orientation into precision", () => {
  assert.equal(normalizeApproximateLocation("85641"), "85641");
  assert.equal(normalizeApproximateLocation("Vail, AZ"), "Vail, AZ");
  assert.equal(
    normalizeApproximateLocation("13801 E Benson Highway, Vail AZ 85641"),
    null,
    "an address may not be stored in a column documented as a coarse ZIP",
  );
  assert.equal(normalizeApproximateLocation("85641-1234"), null, "ZIP+4 is more precise than the column means");
  assert.equal(normalizeApproximateLocation("32.0,-110.7"), null, "a coordinate pair is refused");
});

/* ══════════════════════════════════════════════════════════════════════
   9 · EVIDENCE PROVENANCE SURVIVES INTO THE ROW
   ══════════════════════════════════════════════════════════════════════ */

test("PROVENANCE: which records and which sources, not merely how many", () => {
  const provenance = evidenceProvenance([
    {
      kind: "MEETING",
      id: "apptegy:vail:60703698",
      text: "…",
      sourceUrl: "https://vailschooldistrict.community.highbond.com/Portal/",
      sourceOrg: "Vail School District Governing Board",
      retrievedAt: "2026-08-13T21:01:25.791Z",
    },
    {
      kind: "AGENDA_DOCUMENT",
      id: "https://vailschooldistrict.community.highbond.com/Portal/",
      text: "…",
      sourceUrl: "https://vailschooldistrict.community.highbond.com/Portal/",
      sourceOrg: "Vail School District Governing Board",
      retrievedAt: "2026-08-20T15:45:20.085Z",
    },
  ]);

  assert.deepEqual(provenance.recordRefs, [
    "MEETING:apptegy:vail:60703698",
    "AGENDA_DOCUMENT:https://vailschooldistrict.community.highbond.com/Portal/",
  ]);
  assert.equal(provenance.sourceUrls.length, 1, "distinct sources, in first-seen order");
  assert.equal(provenance.retrievedFrom, "2026-08-13T21:01:25.791Z");
  assert.equal(provenance.retrievedTo, "2026-08-20T15:45:20.085Z");

  const row = prepareAskInteraction({
    ...captureInput({ evidenceProvenance: provenance }),
    coverageTier: "TIER_1",
    coverageTierDistribution: "T0:1,T1:1,T2:0,T3:0",
  });
  assert.deepEqual(row.evidenceRecordRefs, provenance.recordRefs);
  assert.deepEqual(row.evidenceSourceUrls, provenance.sourceUrls);
  assert.equal(row.evidenceRetrievedFrom, provenance.retrievedFrom);
});

/* ══════════════════════════════════════════════════════════════════════
   10 · LOCATION / CONSTITUENCY, STAMPED FROM PRODUCT STATE
   ══════════════════════════════════════════════════════════════════════ */

test("RESIDENCY: a typed ZIP is a self-declared HOME ZIP — the author's rule, exactly", () => {
  assert.deepEqual(stampResidency("TYPED_ZIP"), {
    relation: "CURRENT_HOME",
    confidence: "SELF_DECLARED_ZIP",
  });
});

test("RESIDENCY: a demonstration chip is BROWSING and cannot count as a resident", () => {
  const stamp = stampResidency("DEMO_ZIP");
  assert.equal(stamp.relation, "BROWSING");
  assert.equal(countsAsResident(stamp.relation), false);
});

test("RESIDENCY: a device fix proves PRESENCE, never residence", () => {
  const stamp = stampResidency("DEVICE_LOCATION");
  assert.equal(stamp.relation, "UNKNOWN");
  assert.equal(stamp.confidence, "UNVERIFIED");
});

test("RESIDENCY: a prospective mover is never counted as a current resident", () => {
  const stamp = stampResidency("PROSPECTIVE_ENTRY");
  assert.equal(stamp.relation, "PROSPECTIVE_HOME");
  assert.equal(countsAsResident(stamp.relation), false);
  assert.equal(
    cohortLabel(stamp.relation, stamp.confidence, "85641"),
    "readers researching a move to 85641",
  );
});

test("RESIDENCY: a ZIP cohort may not be spoken as exact district residency", () => {
  const stamp = stampResidency("TYPED_ZIP");
  assert.equal(zipCohortOnly(stamp.confidence), true);
  assert.equal(
    cohortLabel(stamp.relation, stamp.confidence, "85641"),
    "readers who identified 85641 as their home ZIP",
  );
  assert.ok(
    !/resident/i.test(cohortLabel(stamp.relation, stamp.confidence, "Vail Unified District")),
    "a typed ZIP may never produce the word 'resident' about a district it merely overlaps",
  );
});

test("RESIDENCY: the wire carries the ACT and the server decides what it proves", () => {
  /* An arbitrary enum on the wire is refused rather than trusted. */
  assert.equal(readLocationOrigin("ADDRESS_VALIDATED"), "UNKNOWN");
  assert.equal(readLocationOrigin("TYPED_ZIP"), "TYPED_ZIP");
  assert.equal(readLocationOrigin(null), "UNKNOWN");
  assert.equal(readLocationOrigin({ relation: "CURRENT_HOME" }), "UNKNOWN");

  /* And no client sends a confidence directly. */
  for (const [name, source] of [["ask-box", ASK_BOX], ["ballot-ask", BALLOT_ASK]] as const) {
    assert.ok(
      !/locationConfidence|residencyRelation/.test(code(source)),
      `${name} must send the act, never the conclusion`,
    );
    assert.match(code(source), /locationOrigin: readLocationOriginFor\(zip\)/);
  }
});

test("RESIDENCY: ZIP and device entry retain their origin without a pilot showcase", () => {
  const welcome = code(readFileSync(join(ROOT, "components", "map", "welcome-overlay.tsx"), "utf8"));
  assert.match(welcome, /recordLocationOrigin\(result\.centroid\.zip, origin\)/, "a typed zip");
  assert.match(welcome, /recordLocationOrigin\(near\.zip, "DEVICE_LOCATION"\)/, "a device fix");
  assert.doesNotMatch(welcome, /QUICK_ZIPS|submit\(quick\.zip/, "FE-39 removes the pilot showcase");
  assert.match(welcome, /submit\(zip, "UNKNOWN"\)/, "recent ZIPs retain their unknown origin");

  const switcher = code(readFileSync(join(ROOT, "components", "map", "zip-switcher.tsx"), "utf8"));
  assert.match(switcher, /recordLocationOrigin\(found\.zip, origin\)/);
});
