import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "../lib/db/schema.ts";
import {
  mintToken,
  markUsed,
  digestToken,
  tokenRefusalLine,
  verifyToken,
} from "../lib/questionnaire/auth.ts";
import {
  CLASS_QUESTIONS,
  CLOSING_NOTE,
  CORE_QUESTIONS,
  INSTRUMENT_VERSION,
  OFFICE_CLASSES,
  WORD_LIMIT,
  allQuestions,
  checkWordLimit,
  countWords,
  questionsFor,
} from "../lib/questionnaire/instrument.ts";
import {
  buildContestInvitations,
  symmetryBreaches,
  type Invitation,
} from "../lib/questionnaire/invitations.ts";
import { buildQuestionnaireInvitationPlan } from "../lib/questionnaire/invitation-plan.ts";
import { officeClassFor } from "../lib/questionnaire/office-class.ts";
import {
  UNESTABLISHED,
  positionsEmptyLine,
  positionsEmptyState,
} from "../lib/questionnaire/positions-state.ts";
import {
  renderableResponse,
  updatedOn,
  withSubmission,
  withWithdrawal,
  type CandidateResponseRecord,
} from "../lib/questionnaire/responses.ts";
import { render as renderQuestionnaireDoc } from "../scripts/questionnaire-doc.mts";

const ROOT = join(import.meta.dirname, "..");

/* ========================================================================== */
/* RULING 112 — a first-party instrument is symmetric by construction         */
/* ========================================================================== */

test("questionnaire: every candidate for an office class is asked the IDENTICAL five questions", () => {
  for (const officeClass of OFFICE_CLASSES) {
    const a = questionsFor(officeClass);
    const b = questionsFor(officeClass);
    assert.deepEqual(a, b, `${officeClass} produced two different question sets`);
    assert.equal(a.length, 5, `${officeClass} asks ${a.length} questions, not 5`);
  }
});

test("questionnaire: five to seven questions maximum, and it asks five", () => {
  for (const officeClass of OFFICE_CLASSES) {
    const n = questionsFor(officeClass).length;
    assert.ok(n >= 5 && n <= 7, `${officeClass} asks ${n} — outside the 5-to-7 bar`);
  }
});

test("questionnaire: the word limit is ONE number, identical everywhere", () => {
  const limits = new Set(allQuestions().map((q) => q.wordLimit));
  assert.deepEqual(
    [...limits],
    [WORD_LIMIT],
    "a per-question or per-class word limit is a second thing that has to be argued as symmetric",
  );
});

test("questionnaire: every question id is unique across the whole instrument", () => {
  const ids = allQuestions().map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, "a duplicated question id re-points an answer");
});

test("questionnaire: every office class has exactly two class questions", () => {
  for (const officeClass of OFFICE_CLASSES) {
    assert.equal(
      CLASS_QUESTIONS[officeClass].length,
      2,
      `${officeClass} has ${CLASS_QUESTIONS[officeClass].length} class questions`,
    );
  }
});

/* ========================================================================== */
/* The questions themselves — non-leading, plain, and asserting nothing        */
/* ========================================================================== */

/**
 * RULING 110 — SHAPES, not one string.
 *
 * A leading question is not detectable by a keyword. What IS detectable is the
 * shape of one: a question that hands the candidate a position to agree with,
 * that assumes they want a thing changed or kept, or that tells them what the
 * office does before asking about it. Each pattern below is a shape, and the
 * `LEADING_PLANTS` array proves the instrument catches real ones — a sweep that
 * cannot find the defect it was written for is a sweep reporting green about
 * nothing.
 */
const LEADING_SHAPES: ReadonlyArray<[string, RegExp]> = [
  ["asks the candidate to agree or disagree", /\b(do you (agree|support|oppose)|would you support|would you oppose)\b/i],
  ["presupposes they want something changed", /\bwhat would you change\b/i],
  ["presupposes a problem", /\b(fix|broken|failing|wrong with|problem with)\b/i],
  ["offers a side", /\b(too (much|many|little|few)|should we stop|should we cut)\b/i],
  ["tells the candidate what the office decides", /\b(the (board|council|committee|county|office) (decides|is responsible for|handles|controls))\b/i],
];

/** Real leading questions. If the shapes miss these, the shapes are decoration. */
const LEADING_PLANTS: readonly string[] = [
  "Do you agree that property taxes here are too high?",
  "What would you change first about how this district is run?",
  "The board decides the budget, hiring and buildings. Which would you fix?",
  "Would you support cutting the police budget?",
];

test("questionnaire: the leading-question shapes catch real leading questions", () => {
  for (const plant of LEADING_PLANTS) {
    const caught = LEADING_SHAPES.some(([, pattern]) => pattern.test(plant));
    assert.ok(caught, `no shape caught the planted leading question: ${plant}`);
  }
});

test("questionnaire: no shipped question matches a leading shape", () => {
  for (const q of allQuestions()) {
    for (const [name, pattern] of LEADING_SHAPES) {
      assert.ok(
        !pattern.test(q.text),
        `${q.id} matches the leading shape "${name}": ${q.text}`,
      );
    }
  }
});

/**
 * The 15-year-old comprehension standard, as the rest of the product's reader
 * copy is held to it: no identifiers, no enum values, no civics jargon, and
 * every question a single sentence a person can hold in their head.
 */
const JARGON = [
  "ordinance", "statutory", "fiduciary", "appropriation", "referendum",
  "quorum", "enumerated", "jurisdictional", "promulgate", "ex officio",
  "ocd-division", "OCD-ID", "provision", "sunset clause",
];

test("questionnaire: every question passes the 15-year-old test", () => {
  for (const q of allQuestions()) {
    for (const word of JARGON) {
      assert.ok(
        !q.text.toLowerCase().includes(word.toLowerCase()),
        `${q.id} uses jargon "${word}"`,
      );
    }
    assert.ok(q.text.endsWith("?"), `${q.id} is not phrased as a question`);
    assert.ok(
      q.text.length <= 220,
      `${q.id} is ${q.text.length} characters — too long to hold in one read`,
    );
  }
});

/* ========================================================================== */
/* Word limits — stated up front, never applied silently                      */
/* ========================================================================== */

test("questionnaire: an over-limit answer is REFUSED with its own count, never cut", () => {
  const over = Array.from({ length: WORD_LIMIT + 12 }, (_, i) => `word${i}`).join(" ");
  const verdict = checkWordLimit(over);
  assert.equal(verdict.withinLimit, false);
  assert.equal(verdict.words, WORD_LIMIT + 12);
  assert.ok(verdict.message?.includes(String(WORD_LIMIT + 12)), "the count is not shown");
  assert.ok(verdict.message?.includes(String(WORD_LIMIT)), "the limit is not shown");
  assert.ok(
    /same for everyone/i.test(verdict.message ?? ""),
    "the refusal does not say the limit is the same for everyone",
  );
});

test("questionnaire: an answer at exactly the limit is accepted", () => {
  const exact = Array.from({ length: WORD_LIMIT }, (_, i) => `w${i}`).join(" ");
  assert.equal(checkWordLimit(exact).withinLimit, true);
  assert.equal(countWords(exact), WORD_LIMIT);
  assert.equal(countWords("   "), 0);
});

/* ========================================================================== */
/* Verbatim — enforced by absence, and swept by shape                          */
/* ========================================================================== */

/**
 * There is no summary field and no summarising call anywhere under
 * `lib/questionnaire/`. This is the RULING 110 form of the check: not one
 * string, but every shape a compression would take.
 */
const COMPRESSION_SHAPES: ReadonlyArray<[string, RegExp]> = [
  /*
   * **THE SUFFIX IS PART OF THE SHAPE.** The first version of this list was
   * written with closing word boundaries — `\bparaphrase\b` — and the planted
   * `paraphraseAnswer` walked straight through it, because the boundary is
   * defeated by the very next letter. It is the same defect the county office
   * classifier had an hour earlier with `\bcommissioner\b` against
   * "Commissioners", which is why the plants below are not decoration: they are
   * the only reason either was found.
   */
  ["a summary field", /\b(summar\w*|abstract\w*|excerpt\w*|preview\w*|tldr)/i],
  ["a truncation", /(\btruncat\w*|\.slice\(\s*0\s*,\s*\d|\.substring\(\s*0\s*,\s*\d|\bellipsis\w*)/i],
  ["a model call", /\b(openai|anthropic|claude|gpt-|\bllm\b|generateText|completions?\.create)/i],
  ["a paraphrase", /\b(paraphras\w*|rewrit\w*|condens\w*|compress\w*)/i],
];

test("questionnaire: the compression shapes catch a real compression", () => {
  const plants = [
    "const summary = answer.slice(0, 200);",
    "await openai.chat.completions.create({})",
    "function paraphraseAnswer(text: string) {}",
  ];
  for (const plant of plants) {
    assert.ok(
      COMPRESSION_SHAPES.some(([, p]) => p.test(plant)),
      `no shape caught: ${plant}`,
    );
  }
});

test("questionnaire: nothing under lib/questionnaire/ can shorten a candidate's words", () => {
  const dir = join(ROOT, "lib", "questionnaire");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= 5, `expected the questionnaire modules, found ${files.length}`);
  for (const file of files) {
    const source = readFileSync(join(dir, file), "utf8");
    /*
     * Comments are where this rule is EXPLAINED, so the sweep reads code only.
     * Stripping them is what lets the prohibition be written down in the same
     * file it is enforced over.
     */
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const [name, pattern] of COMPRESSION_SHAPES) {
      assert.ok(
        !pattern.test(code),
        `lib/questionnaire/${file} contains ${name} — answers publish verbatim`,
      );
    }
  }
});

test("questionnaire: the response table has no summary-shaped column", () => {
  const config = getTableConfig(schema.questionnaireResponses);
  for (const column of config.columns) {
    for (const [name, pattern] of COMPRESSION_SHAPES) {
      assert.ok(
        !pattern.test(column.name),
        `questionnaire_responses.${column.name} is ${name}`,
      );
    }
  }
});

/* ========================================================================== */
/* Editing, withdrawal, and the neutral state                                  */
/* ========================================================================== */

function emptyRecord(): CandidateResponseRecord {
  return { candidacyId: "ballot-nj-morris:us-senate:booker", versions: [], withdrawnAt: null };
}

test("questionnaire: an edit adds a version and the LATEST renders", () => {
  let record = emptyRecord();
  record = withSubmission(record, {
    submittedAt: "2026-09-10T00:00:00.000Z",
    instrumentVersion: INSTRUMENT_VERSION,
    officeClass: "federal_legislative",
    answers: [{ questionId: "q1_why_running", text: "first" }],
  });
  assert.equal(updatedOn(record), null, "a first submission must not read as revised");

  record = withSubmission(record, {
    submittedAt: "2026-09-20T00:00:00.000Z",
    instrumentVersion: INSTRUMENT_VERSION,
    officeClass: "federal_legislative",
    answers: [{ questionId: "q1_why_running", text: "second" }],
  });
  assert.equal(record.versions.length, 2, "the earlier version was not retained");
  assert.equal(renderableResponse(record)?.answers[0].text, "second");
  assert.equal(updatedOn(record), "2026-09-20T00:00:00.000Z");
});

test("questionnaire: a WITHDRAWAL is indistinguishable from never having answered", () => {
  let record = emptyRecord();
  record = withSubmission(record, {
    submittedAt: "2026-09-10T00:00:00.000Z",
    instrumentVersion: INSTRUMENT_VERSION,
    officeClass: "federal_legislative",
    answers: [{ questionId: "q1_why_running", text: "something" }],
  });
  record = withWithdrawal(record, "2026-09-12T00:00:00.000Z");

  assert.equal(
    renderableResponse(record),
    renderableResponse(emptyRecord()),
    "a withdrawn record must render exactly what a never-answered one renders",
  );
  assert.equal(record.versions.length, 1, "the withdrawal erased our own record");
});

test("questionnaire: answering again clears a withdrawal", () => {
  let record = withWithdrawal(emptyRecord(), "2026-09-12T00:00:00.000Z");
  record = withSubmission(record, {
    submittedAt: "2026-09-14T00:00:00.000Z",
    instrumentVersion: INSTRUMENT_VERSION,
    officeClass: "school_board",
    answers: [{ questionId: "q1_why_running", text: "back" }],
  });
  assert.equal(record.withdrawnAt, null);
  assert.equal(renderableResponse(record)?.answers[0].text, "back");
});

/* ========================================================================== */
/* The three empty states — and none may read as evasion                       */
/* ========================================================================== */

test("questionnaire: the three Positions empty states are distinguishable", () => {
  const asked = { invitedOn: "2026-09-08", remindedOn: ["2026-09-22"], hasFiledContact: true };
  const noContact = { invitedOn: null, remindedOn: [], hasFiledContact: false };

  assert.equal(positionsEmptyState(asked), "ASKED_AWAITING_ANSWER");
  assert.equal(positionsEmptyState(noContact), "NO_FILED_CONTACT");
  assert.equal(positionsEmptyState(UNESTABLISHED), "NOT_YET_ASKED");

  const lines = [asked, noContact, UNESTABLISHED].map(positionsEmptyLine);
  assert.equal(new Set(lines).size, 3, "two states render the same sentence");
});

test("questionnaire: the default asserts nothing about whether we hold a contact", () => {
  assert.equal(UNESTABLISHED.hasFiledContact, null);
  assert.equal(UNESTABLISHED.invitedOn, null);
  assert.deepEqual(UNESTABLISHED.remindedOn, []);
});

test("questionnaire: the asked state names the dates and the symmetry", () => {
  const line = positionsEmptyLine({
    invitedOn: "2026-09-08",
    remindedOn: ["2026-09-22", "2026-10-06"],
    hasFiledContact: true,
  });
  assert.match(line, /September 8, 2026/);
  assert.match(line, /September 22, 2026 and October 6, 2026/);
  assert.match(line, /same questions on the same day/);
});

/**
 * RULING 110 again — shapes. A sentence implying a candidate CHOSE not to
 * answer is the failure, whatever words it uses, and the plants prove the sweep
 * would catch one.
 */
const EVASION_SHAPES: ReadonlyArray<[string, RegExp]> = [
  ["refusal", /\b(refus|declin|reject)\w*/i],
  ["avoidance", /\b(avoid|evad|dodg|duck|ignor)\w*/i],
  ["non-participation as a choice", /\b(chose not to|did not want to|would not|unwilling|failed to)\b/i],
  ["silence as a verdict", /\b(stayed silent|no comment|silent on)\b/i],
];

test("questionnaire: the evasion shapes catch a real prejudicial sentence", () => {
  const plants = [
    "This candidate declined to answer our questions.",
    "This candidate ignored our questions.",
    "This candidate chose not to respond.",
    "This candidate failed to answer.",
  ];
  for (const plant of plants) {
    assert.ok(EVASION_SHAPES.some(([, p]) => p.test(plant)), `no shape caught: ${plant}`);
  }
});

test("questionnaire: no empty-state sentence reads as evasion", () => {
  const states = [
    { invitedOn: "2026-09-08", remindedOn: ["2026-09-22"], hasFiledContact: true },
    { invitedOn: null, remindedOn: [], hasFiledContact: false },
    UNESTABLISHED,
  ];
  for (const state of states) {
    const line = positionsEmptyLine(state);
    for (const [name, pattern] of EVASION_SHAPES) {
      assert.ok(!pattern.test(line), `the ${name} shape matched: ${line}`);
    }
  }
});

test("questionnaire: the invitation message never implies an obligation to answer", () => {
  const message = readFileSync(join(ROOT, "docs", "candidate-questionnaire-invitation.md"), "utf8");
  assert.match(message, /you don't owe us an answer/i);
  assert.match(message, /identical email today/i);
  assert.match(message, /exactly as you write them/i);
});

/* ========================================================================== */
/* The token — proves control of a filed mailbox and nothing else              */
/* ========================================================================== */

test("questionnaire: a minted token is never the stored value", () => {
  const minted = mintToken({ candidacyId: "c1", issuedAt: new Date("2026-09-08T00:00:00Z") });
  assert.notEqual(minted.token, minted.record.tokenDigest);
  assert.equal(minted.record.tokenDigest, digestToken(minted.token));
  assert.equal(minted.record.tokenDigest.length, 64);
  assert.equal(minted.record.usedAt, null);
  assert.ok(!JSON.stringify(minted.record).includes(minted.token), "the token is in the record");
});

test("questionnaire: a token is single-use, and reuse is told apart from expiry", () => {
  const issuedAt = new Date("2026-09-08T00:00:00Z");
  const minted = mintToken({ candidacyId: "c1", issuedAt });
  const now = new Date("2026-09-10T00:00:00Z");

  assert.deepEqual(verifyToken({ token: minted.token, record: minted.record, now }), {
    ok: true,
    candidacyId: "c1",
  });

  const used = markUsed(minted.record, now);
  assert.deepEqual(verifyToken({ token: minted.token, record: used, now }), {
    ok: false,
    reason: "ALREADY_USED",
  });

  const late = new Date("2026-12-01T00:00:00Z");
  assert.deepEqual(verifyToken({ token: minted.token, record: minted.record, now: late }), {
    ok: false,
    reason: "EXPIRED",
  });

  assert.deepEqual(verifyToken({ token: "nonsense", record: minted.record, now }), {
    ok: false,
    reason: "UNKNOWN",
  });
  assert.deepEqual(verifyToken({ token: minted.token, record: null, now }), {
    ok: false,
    reason: "UNKNOWN",
  });
});

test("questionnaire: two mints of the same candidacy produce different tokens", () => {
  const issuedAt = new Date("2026-09-08T00:00:00Z");
  const a = mintToken({ candidacyId: "c1", issuedAt });
  const b = mintToken({ candidacyId: "c1", issuedAt });
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.record.tokenDigest, b.record.tokenDigest);
});

test("questionnaire: each refusal reason gets its own sentence", () => {
  const lines = (["EXPIRED", "ALREADY_USED", "UNKNOWN"] as const).map(tokenRefusalLine);
  assert.equal(new Set(lines).size, 3, "two refusals say the same thing");
  for (const line of lines) assert.match(line, /reply to the email/i);
});

/* ========================================================================== */
/* The stores — the questionnaire adds nothing to the sold ones                */
/* ========================================================================== */

const QUESTIONNAIRE_TABLES = [
  "questionnaireInvitations",
  "questionnaireResponses",
  "questionnaireTokens",
] as const;

test("questionnaire: nothing new lands on the search log or the reactions store", () => {
  /*
   * The exact column sets, written out, so that ADDING one to either store
   * fails here by name. A count would move for a legitimate reason and tell
   * nobody which column arrived (RULING 62's lesson about names versus counts).
   */
  const searchLogColumns = getTableConfig(schema.searchLog)
    .columns.map((c) => c.name)
    .sort();
  const reactionColumns = getTableConfig(schema.reactions)
    .columns.map((c) => c.name)
    .sort();

  for (const name of searchLogColumns) {
    assert.ok(
      !/question|questionnaire|candidacy|invitation|token/i.test(name),
      `search_log.${name} — the questionnaire may not write to a collection store`,
    );
  }
  for (const name of reactionColumns) {
    assert.ok(
      !/questionnaire|invitation|instrument_version/i.test(name),
      `reactions.${name} — the questionnaire may not write to a collection store`,
    );
  }
});

test("questionnaire: the questionnaire tables carry no foreign key to any store", () => {
  for (const name of QUESTIONNAIRE_TABLES) {
    const table = (schema as Record<string, unknown>)[name];
    assert.ok(table, `${name} missing from the schema`);
    const config = getTableConfig(table as Parameters<typeof getTableConfig>[0]);
    assert.equal(
      config.foreignKeys.length,
      0,
      `${name} references another table — it must stand alone`,
    );
  }
});

test("questionnaire: the questionnaire tables key on public ballot ids, never on a reader", () => {
  const READER_FRAGMENTS = [
    "device", "fingerprint", "session", "ip_", "user_", "account",
    "continuity", "subscriber", "reader",
  ];
  for (const name of QUESTIONNAIRE_TABLES) {
    const config = getTableConfig(
      (schema as Record<string, unknown>)[name] as Parameters<typeof getTableConfig>[0],
    );
    for (const column of config.columns) {
      for (const fragment of READER_FRAGMENTS) {
        assert.ok(
          !column.name.toLowerCase().includes(fragment),
          `${name}.${column.name} matches reader fragment "${fragment}"`,
        );
      }
    }
  }
});

/* ========================================================================== */
/* The invitation list — contest as the unit, all or none                      */
/* ========================================================================== */

const SOURCE = {
  sourceUrl: "https://example.gov/filing.pdf",
  sourceOrg: "County Clerk",
  collectedAt: "2026-08-23",
};

test("questionnaire: a contest with one unreachable candidate invites NOBODY", () => {
  const result = buildContestInvitations({
    contestId: "contest-1",
    officeClass: "school_board",
    instrumentVersion: INSTRUMENT_VERSION,
    plannedInvitedOn: "2026-09-08",
    plannedRemindersOn: ["2026-09-22"],
    deadline: "2026-10-13",
    candidates: [
      { candidacyId: "a", contestId: "contest-1", email: "a@example.com", contactSource: SOURCE },
      { candidacyId: "b", contestId: "contest-1", email: null, contactSource: null },
    ],
  });
  assert.equal(result.invitations.length, 0, "a partial contest is the asymmetry this prevents");
  assert.equal(result.uninvitable.length, 2, "both candidates must be named as uninvited");
});

test("questionnaire: a generated invitation claims NO send that has not happened", () => {
  const result = buildContestInvitations({
    contestId: "contest-1",
    officeClass: "school_board",
    instrumentVersion: INSTRUMENT_VERSION,
    plannedInvitedOn: "2026-09-08",
    plannedRemindersOn: ["2026-09-22"],
    deadline: "2026-10-13",
    candidates: [
      { candidacyId: "a", contestId: "contest-1", email: "a@example.com", contactSource: SOURCE },
    ],
  });
  assert.equal(result.invitations[0].invitedOn, null, "a plan stamped itself as an act");
  assert.deepEqual(result.invitations[0].remindedOn, []);
  assert.equal(result.invitations[0].plannedInvitedOn, "2026-09-08");
});

test("questionnaire: the symmetry check catches an asymmetric contest", () => {
  const base: Invitation = {
    candidacyId: "a",
    contestId: "contest-1",
    email: "a@example.com",
    instrumentVersion: INSTRUMENT_VERSION,
    officeClass: "school_board",
    plannedInvitedOn: "2026-09-08",
    plannedRemindersOn: ["2026-09-22"],
    invitedOn: null,
    remindedOn: [],
    deadline: "2026-10-13",
    contactSource: SOURCE,
  };
  assert.deepEqual(symmetryBreaches([base, { ...base, candidacyId: "b" }]), []);

  const breaches = symmetryBreaches([
    base,
    { ...base, candidacyId: "b", plannedRemindersOn: ["2026-09-22", "2026-10-06"] },
    { ...base, candidacyId: "c", deadline: "2026-10-20" },
  ]);
  const fields = breaches.map((b) => b.field).sort();
  assert.deepEqual(fields, ["deadline", "plannedRemindersOn"]);
});

/* ========================================================================== */
/* The generated artifact and the generated document                           */
/* ========================================================================== */

test("questionnaire: the canonical NJ filing derives a complete unsent plan without a tracked output", () => {
  const ballot = JSON.parse(
    readFileSync(join(ROOT, "data", "states", "nj", "ballot", "nj-morris-2026.json"), "utf8"),
  ) as { contests: { id: string; ocdId: string; title: string }[]; candidacies: { id: string; contestId: string }[] };
  const contacts = JSON.parse(
    readFileSync(join(ROOT, "data", "states", "nj", "ballot", "nj-morris-2026-contacts.json"), "utf8"),
  ) as { contacts: { candidacyId: string; email: string | null; sourceUrl: string; sourceOrg: string; collectedAt: string }[] };
  const plan = buildQuestionnaireInvitationPlan({
    ballot,
    contacts,
    plannedInvitedOn: "2026-09-08",
    plannedRemindersOn: ["2026-09-22", "2026-10-06"],
    deadline: "2026-10-13",
  });

  assert.equal(plan.statedCandidacies, ballot.candidacies.length);
  assert.equal(
    plan.invitations.length + plan.uninvitable.length,
    ballot.candidacies.length,
    "RULING 100: a partial that reconciles is still a failure — account for every candidacy",
  );
  assert.deepEqual(plan.symmetryBreaches, []);
  for (const invitation of plan.invitations) {
    assert.equal(invitation.invitedOn, null, `${invitation.candidacyId} claims a send`);
    assert.deepEqual(invitation.remindedOn, []);
    assert.ok(invitation.email.includes("@"), `${invitation.candidacyId} has no usable email`);
  }
});

test("questionnaire: the committed question-set document is what the generator writes", () => {
  const committed = readFileSync(join(ROOT, "docs", "candidate-questionnaire.md"), "utf8");
  assert.equal(
    committed,
    renderQuestionnaireDoc(),
    "docs/candidate-questionnaire.md was hand-edited — run `corepack pnpm questionnaire:doc --write`",
  );
});

test("questionnaire: the document carries every question the instrument asks", () => {
  const doc = readFileSync(join(ROOT, "docs", "candidate-questionnaire.md"), "utf8");
  for (const q of allQuestions()) {
    assert.ok(doc.includes(q.text), `the document is missing ${q.id}`);
  }
  assert.ok(doc.includes(INSTRUMENT_VERSION), "the document does not state its version");
});

/* ========================================================================== */
/* Office class — the division decides it, and the plural is part of the shape */
/* ========================================================================== */

test("questionnaire: office class is read from the DIVISION wherever it can be", () => {
  const cases: ReadonlyArray<[string, string, string, string]> = [
    ["ocd-division/country:us/state:nj/school_district:rockaway_township", "Member of the Board of Education", "school_board", "division"],
    ["ocd-division/country:us/state:nj/place:boonton", "Member of the Town Council - Ward 1", "municipal_governing", "division"],
    ["ocd-division/country:us/state:nj/cd:11", "Member of the House of Representatives", "federal_legislative", "division"],
    ["ocd-division/country:us/state:nj/sldl:25", "Member of the General Assembly", "state_legislative", "division"],
  ];
  for (const [ocdId, title, expected, basis] of cases) {
    const verdict = officeClassFor({ ocdId, title });
    assert.equal(verdict.officeClass, expected, `${ocdId} resolved to ${verdict.officeClass}`);
    assert.equal(verdict.basis, basis);
  }
});

test("questionnaire: the PLURAL is part of the shape — Commissioners resolves", () => {
  /*
   * RULING 110 in miniature: the first version of this list read
   * `\bcommissioner\b`, which cannot match "Commissioners". Every Morris County
   * commissioner contest fell to `other` and the run reported a clean 272 while
   * doing it, because a fallback that works is invisible.
   */
  for (const title of [
    "Member of the Board of County Commissioners",
    "Member of the Board of Chosen Freeholders",
    "County Commissioner",
  ]) {
    const verdict = officeClassFor({
      ocdId: "ocd-division/country:us/state:nj/county:morris",
      title,
    });
    assert.equal(verdict.officeClass, "county_governing", `"${title}" did not resolve`);
  }
});

test("questionnaire: a title that matches nothing falls to `other`, never to a guess", () => {
  const verdict = officeClassFor({
    ocdId: "ocd-division/country:us/state:nj",
    title: "Member of Something Nobody Has Heard Of",
  });
  assert.equal(verdict.officeClass, "other");
  assert.equal(verdict.basis, "fallback");
  assert.equal(questionsFor("other").length, 5, "`other` must be a complete instrument");
});

test("questionnaire: every NJ contest classifies, and none falls back", () => {
  const ballot = JSON.parse(
    readFileSync(join(ROOT, "data", "states", "nj", "ballot", "nj-morris-2026.json"), "utf8"),
  ) as { contests: Array<{ ocdId: string; title: string }> };

  const fallbacks = ballot.contests.filter(
    (c) => officeClassFor({ ocdId: c.ocdId, title: c.title }).basis === "fallback",
  );
  assert.equal(
    fallbacks.length,
    0,
    `contests with no office class: ${fallbacks.map((c) => c.title).join(", ")}`,
  );
  /*
   * A FLOOR, not an equality — RULING 116. This asserted `=== 90` and went red
   * on 2026-08-25 when the parser learned that MAYOR is an office heading and
   * nine mayoral contests were recovered. A guard that freezes a size fails on
   * the day somebody makes the number move for a good reason, and the cheapest
   * way to make it green is to edit the constant. What matters here is that
   * every contest classifies, and that the set never silently shrinks under a
   * classifier that would then have fewer things to fail on.
   */
  assert.ok(
    ballot.contests.length >= 99,
    `the contest count fell to ${ballot.contests.length} from a floor of 99`,
  );
});

/* ========================================================================== */
/* The core is genuinely core                                                  */
/* ========================================================================== */

test("questionnaire: the core three are asked of every office class, unchanged", () => {
  for (const officeClass of OFFICE_CLASSES) {
    const asked = questionsFor(officeClass);
    assert.deepEqual(
      asked.slice(0, CORE_QUESTIONS.length),
      [...CORE_QUESTIONS],
      `${officeClass} does not open with the identical core`,
    );
  }
});

/* ========================================================================== */
/* v2 (2026-08-25) — the revision, and the symmetry guarantee under it         */
/* ========================================================================== */

/*
 * **A version bump that leaves the symmetry tests behind breaks the guarantee
 * SILENTLY**, which is why these ship in the same commit as the bump rather
 * than after it. Every one of them is about the four changes `v2` carries.
 */

test("questionnaire v2: the instrument is at v2, and the limit is 200 everywhere", () => {
  assert.equal(INSTRUMENT_VERSION, "v2", "the four v2 changes shipped without the version moving");
  assert.equal(WORD_LIMIT, 200);
  // Restated against the LITERAL rather than the constant. Asserting
  // `wordLimit === WORD_LIMIT` proves the file equals itself (RULING 147); the
  // number Sean asked for is 200 and that is what a candidate is held to.
  for (const q of allQuestions()) {
    assert.equal(q.wordLimit, 200, `${q.id} is not at the v2 limit`);
  }
});

test("questionnaire v2: the closing note is NOT part of the instrument", () => {
  /*
   * "Structurally distinct" is a claim, so it is held as one. The offer may
   * never be reachable through the function that produces what a candidate is
   * asked — a solicitation inside a symmetric instrument lets a candidate read
   * the five questions as conditioned on it.
   */
  assert.ok(CLOSING_NOTE.length > 0);
  const everyQuestionText = allQuestions()
    .map((q) => `${q.id} ${q.text}`)
    .join(" \u0000 ");
  assert.ok(
    !everyQuestionText.includes("aggregate insight"),
    "the closing note leaked into the question set",
  );
  for (const officeClass of OFFICE_CLASSES) {
    const asked = questionsFor(officeClass);
    assert.ok(
      !asked.some((q) => q.text.includes("published rates") || q.text.includes("sign up here")),
      `${officeClass} would be asked the business offer as a question`,
    );
    // And the count is unchanged by the addition — five questions, still.
    assert.equal(asked.length, 5, `${officeClass} no longer asks exactly five`);
  }
});

test("questionnaire v2: the closing note carries NO timing promise", () => {
  /*
   * Searched BY SHAPE, never by string (RULING 110). A promise is a commitment
   * to a WHEN, and it can be spelled a hundred ways; what they share is a
   * future-dated commitment attached to us delivering something.
   */
  const TIMING_SHAPES: Array<[string, RegExp]> = [
    ["a named month", /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i],
    ["a week or day count", /\b(?:in|within|after)\s+\d+\s*(?:days?|weeks?|months?)\b/i],
    ["soon / shortly", /\b(soon|shortly|imminently|any day now)\b/i],
    ["a will-by promise", /\bwill (?:be )?(?:available|ready|published|released|sent)\b/i],
    ["before the election", /\bbefore (?:the )?(?:election|november|the vote)\b/i],
    ["a date", /\b\d{4}-\d{2}-\d{2}\b/],
  ];
  for (const [name, shape] of TIMING_SHAPES) {
    assert.ok(!shape.test(CLOSING_NOTE), `the closing note carries a timing promise (${name})`);
  }
  // The instrument is shown catching a real one, so a sweep that matches
  // nothing can never be mistaken for copy that is clean.
  const planted = `${CLOSING_NOTE} Insights will be available before the election.`;
  assert.ok(
    TIMING_SHAPES.some(([, shape]) => shape.test(planted)),
    "the timing sweep cannot catch a planted promise — it is measuring nothing",
  );
});

test("questionnaire v2: the invitation names the product, and only in the invitation", () => {
  const message = readFileSync(join(ROOT, "docs", "candidate-questionnaire-invitation.md"), "utf8");
  assert.match(message, /We're Meanwhile\./, "the invitation does not name the product");
  assert.ok(
    !/>\s*— We The People/i.test(message),
    "a sign-off still carries the repo name",
  );
  /*
   * **SCOPE: the invitation string only.** The name is leaning Meanwhile and is
   * NOT settled (`B01`), and the repo name is deliberately unchanged — the
   * outbound User-Agent carries the repo URL as its contact route for public
   * bodies, and a body with our identifier in last week's logs must find the
   * same one this week. A repo-wide rename here would be a session failure.
   */
  const brand = readFileSync(join(ROOT, "lib", "brand.ts"), "utf8");
  assert.match(brand, /export const PRODUCT_NAME = "Meanwhile";/);
});

test("questionnaire v2: the closing note publishes verbatim, exactly as Sean wrote it", () => {
  // A paraphrase of a commercial offer is a different offer, so the text is
  // pinned rather than described.
  assert.equal(
    CLOSING_NOTE,
    "One more thing, separate from the questionnaire: Meanwhile offers campaigns " +
      "and organizations anonymized, aggregate insight into what constituents in a " +
      "race care about — available to everyone, at the same published rates. If " +
      "you'd like to hear when insights for your race are available, sign up here.",
  );
  const message = readFileSync(join(ROOT, "docs", "candidate-questionnaire-invitation.md"), "utf8");
  const inDoc = message.replace(/\n>\s*/g, " ").replace(/\s+/g, " ");
  assert.ok(
    inDoc.includes("One more thing, separate from the questionnaire: Meanwhile offers campaigns"),
    "the invitation document and the constant carry different offers",
  );
});
