import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ANSWER_MODES,
  answerSaysSomething,
  askAnswer,
  clarifyAnswer,
  offAnswer,
  readAskAnswer,
  transportFailure,
  unresolvedAnswer,
  type AskAnswerPayload,
} from "../lib/ask/answer.ts";
import { contactReadLine } from "../lib/ask/contacts.ts";
import { emptyTrace } from "../lib/ask/trace.ts";
import { subjectKindOf } from "../lib/ask/subject.ts";
import type { EvidencePack } from "../lib/ask/evidence.ts";

/**
 * **ASK-05 — ONE READER ANSWER SHAPE.** (2026-08-28.)
 *
 * Three routes answered readers and not one of them declared a response type.
 * The contract existed only as hand-copied interfaces inside two components,
 * and it had already drifted in five separate ways — each of which reached a
 * reader as something worse than a type error:
 *
 * | Drift | What the reader got |
 * |---|---|
 * | `mode: "OFF"` was not in `AnswerMode` | an EMPTY PANEL |
 * | `AskContact.basis`/`retrievedAt` dropped | sourced provenance, unrenderable |
 * | `AskTrace` absent from both copies | nothing, but also nothing checkable |
 * | `EvidenceRecord.kind` flattened to `string` | a branch on an impossible kind would compile |
 * | `NamedEntityBinding` re-spelled `kind`→`state`, `NONE` dropped | a binding that vanished in transit |
 *
 * These tests hold the contract itself. The route-level proof that a reader
 * receives it is in `tests/ask-grounded-route.test.ts`.
 */

const ROOT = join(import.meta.dirname, "..");

function pack(over: Partial<EvidencePack> = {}): EvidencePack {
  return {
    question: "what is on the agenda",
    intent: "UPCOMING_AGENDA",
    temporal: { kind: "NEXT" },
    subject: null,
    records: [],
    gaps: [],
    denominators: {},
    today: "2026-08-28",
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════
   EVERY FIELD TRAVELS ON EVERY MODE
   ══════════════════════════════════════════════════════════════════════ */

test("every mode carries the whole shape, so no client's `?? []` is load-bearing", () => {
  /*
   * `CLARIFY`, `UNRESOLVED` and `OFF` used to answer with two or three keys
   * and nothing else. That is what made a client's optional chaining the thing
   * standing between a reader and a crash, and it is why every field in the
   * client copies was optional — which in turn is why a missing one was
   * invisible.
   */
  const built: AskAnswerPayload[] = [
    askAnswer({ mode: "NO_EVIDENCE", pack: pack(), answer: null, contacts: [], trace: emptyTrace() }),
    clarifyAnswer("vail", ["Vail Unified District", "Town of Vail"], emptyTrace()),
    unresolvedAnswer("nowheresville", emptyTrace()),
    offAnswer("ripcord"),
    transportFailure(),
  ];

  for (const payload of built) {
    assert.ok(ANSWER_MODES.includes(payload.mode), payload.mode);
    assert.ok(Array.isArray(payload.records), `${payload.mode}: records`);
    assert.ok(Array.isArray(payload.gaps), `${payload.mode}: gaps`);
    assert.ok(Array.isArray(payload.contacts), `${payload.mode}: contacts`);
    assert.equal(typeof payload.denominators, "object", `${payload.mode}: denominators`);
    assert.ok("subject" in payload, `${payload.mode}: subject`);
    assert.ok("answer" in payload, `${payload.mode}: answer`);
    assert.ok(payload.trace, `${payload.mode}: trace`);
  }
});

test("the answer is built FROM the pack, so a reader cannot see a record validation did not", () => {
  /*
   * `askAnswer` takes the pack rather than loose arrays for one reason: the
   * records the reader sees are then by construction the ones the synthesis
   * rung was given and the validator checked against. A route assembling its
   * reply separately could ship a record the validator never saw.
   */
  const p = pack({
    records: [
      { kind: "AGENDA_ITEM", id: "m1#0", text: "Rezoning of parcel 44", sourceUrl: "https://x.gov/a" },
    ],
    /* An OURS acquisition gap, not the old `THEIRS: "No agenda has been
       published yet."` — this test is about pass-through and any gap would
       exercise it, so the fixture is the one the route actually emits rather
       than a sentence ASK-07 removed for asserting an absence nothing
       measured. A fixture is a worked example, and a wrong worked example
       gets copied. */
    gaps: [{ whose: "OURS", statement: "We have not yet acquired the agenda for that meeting." }],
    denominators: { agendaItemsExtracted: 1 },
  });
  const payload = askAnswer({
    mode: "STRUCTURED_GROUNDED",
    pack: p,
    answer: null,
    contacts: [],
    trace: emptyTrace(),
  });
  assert.deepEqual(payload.records, p.records);
  assert.deepEqual(payload.gaps, p.gaps);
  assert.deepEqual(payload.denominators, p.denominators);
});

/* ══════════════════════════════════════════════════════════════════════
   THE TWO MODES NEITHER SURFACE COULD RENDER
   ══════════════════════════════════════════════════════════════════════ */

test("OFF is a real member and carries a SENTENCE, not an empty panel", () => {
  /*
   * **THE LIVE BUG.** `app/api/ask/grounded/route.ts` answered
   * `{ mode: "OFF", why: "ripcord" }` when its ripcord was pulled. `"OFF"` was
   * not a member of `AnswerMode`; both clients typed `mode` as a bare `string`
   * so it typechecked, it matched no render branch, and a reader who had just
   * typed a question got their own empty form back. A switched-off capability
   * was indistinguishable from a working one with nothing to say.
   */
  assert.ok(ANSWER_MODES.includes("OFF"));
  const off = offAnswer("ripcord");
  assert.equal(off.mode, "OFF");
  assert.equal(off.why, "ripcord", "the reason is OPERATOR diagnostics");
  assert.equal(off.gaps.length, 1);
  assert.equal(off.gaps[0].whose, "OURS", "a switched-off capability is a fact about US");
  assert.match(off.gaps[0].statement, /working on getting this info/);
  /* RULING 139: the attribution is required, the verdict on ourselves is
     struck. No "we failed", no "sorry", no apology for our own state. */
  assert.doesNotMatch(off.gaps[0].statement, /sorry|we failed|error|unavailable/i);
});

test("TRANSPORT_FAILED gives the map the state the ballot already had", () => {
  /*
   * The ballot surface has reported this honestly since it shipped
   * (`data-ask-state="TRANSPORT_FAILED"`). The map's `askGrounded` caught,
   * returned null, and the panel rendered NOTHING — the same failure, the same
   * engine, two different degradations, and the silent one is the worse.
   */
  assert.ok(ANSWER_MODES.includes("TRANSPORT_FAILED"));
  const failed = transportFailure();
  assert.equal(failed.gaps[0].whose, "OURS");
  assert.match(failed.gaps[0].statement, /didn't reach us/);
  /* Deliberately NOT "we found nothing", which would be a claim about a
     government made out of a failed request. */
  assert.doesNotMatch(failed.gaps[0].statement, /found nothing|no results|nothing scheduled/i);

  /* And it is not an ANSWER: nothing was asked of the records, so nothing may
     be concluded about them in either direction. */
  assert.equal(answerSaysSomething(failed), false);
});

test("a named gap IS an answer, and that could not be said before", () => {
  const gapOnly = askAnswer({
    mode: "NO_EVIDENCE",
    pack: pack({
      gaps: [
        {
          whose: "OURS",
          statement: "We hold Warren Petersen as State Senator. None of the 24 roll calls we have recorded carries a vote by them.",
        },
      ],
    }),
    answer: null,
    contacts: [],
    trace: emptyTrace(),
  });
  assert.equal(answerSaysSomething(gapOnly), true);
  assert.equal(answerSaysSomething(null), false);
});

/* ══════════════════════════════════════════════════════════════════════
   THE WIRE IS PARSED, NOT CAST
   ══════════════════════════════════════════════════════════════════════ */

test("a reply whose mode is not a member is REFUSED rather than rendered", () => {
  /*
   * A cast is what let `"OFF"` reach a render that had no branch for it. The
   * parse is deliberately narrow for exactly that reason: a body this product
   * cannot render is refused here, where the caller turns it into a stated
   * transport failure, rather than silently becoming an empty panel.
   */
  assert.equal(readAskAnswer({ mode: "SOMETHING_NEW", records: [] }), null);
  assert.equal(readAskAnswer(null), null);
  assert.equal(readAskAnswer("not an object"), null);
  assert.equal(readAskAnswer({ why: "no mode at all" }), null);

  const read = readAskAnswer({ mode: "CLARIFY", mention: "vail", candidates: ["a", "b"] });
  assert.ok(read);
  assert.deepEqual(read.records, [], "a missing array becomes an empty array, never undefined");
  assert.deepEqual(read.gaps, []);
  assert.deepEqual(read.contacts, []);
  assert.deepEqual(read.denominators, {});
  assert.ok(read.trace, "and a missing trace becomes the empty trace");
});

/* ══════════════════════════════════════════════════════════════════════
   THE HAND-COPIED DUPLICATES ARE GONE
   ══════════════════════════════════════════════════════════════════════ */

test("no surface declares its own copy of the answer contract", () => {
  /*
   * The duplicates are the mechanism, not the symptom. Every drift above was
   * possible because two files described a shape a third produced, and nothing
   * held the three together.
   */
  const box = readFileSync(join(ROOT, "components", "ask", "ask-box.tsx"), "utf8");
  const code = box.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

  for (const dead of [
    "interface GroundedReply",
    "interface GroundedRecord",
    "interface GroundedContact",
    "interface AgendaAnswer",
  ]) {
    assert.ok(!code.includes(dead), `${dead} is back — the contract has been copied again`);
  }
  assert.match(
    code,
    /from "@\/lib\/ask\/answer"/,
    "the surface must IMPORT the contract rather than restate it",
  );

  /*
   * And the producer declares what it returns.
   *
   * Comments are STRIPPED first: the route's own doc block quotes the untyped
   * literal it deleted, which is the right thing for a doc block to do and
   * would fail a raw text sweep for a reason that is not a defect.
   */
  const grounded = readFileSync(
    join(ROOT, "app", "api", "ask", "grounded", "route.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.match(grounded, /const payload: AskAnswerPayload = askAnswer\(\{/);
  assert.ok(
    !/mode: "OFF", why: "ripcord"/.test(grounded),
    "the untyped OFF literal is back",
  );
});

test("the contact's provenance is declared AND reachable from a render", () => {
  /*
   * `AskContact` has always carried `basis` and `retrievedAt` and both client
   * copies dropped them, so the publisher and read date behind a claim about a
   * named person's role were **on the wire and unrenderable by declaration**.
   * `lib/ask/contacts.ts` says a contact with no source behind it is exactly
   * what a contact may never be.
   */
  assert.equal(
    contactReadLine({
      id: "x",
      name: "Allison Pratt",
      officeTitle: "Governing Board President",
      relationship: "Governing Board President on Vail Unified District",
      basis: "BODY_MEMBER",
      email: null,
      phone: null,
      websiteUrl: null,
      sourceUrl: "https://vail.gov/board",
      sourceOrg: "Vail Unified School District",
      retrievedAt: "2026-08-20T00:00:00.000Z",
    }),
    "Vail Unified School District, read August 20th, 2026",
  );

  /* Null where nothing is held — never "source unknown", which reads as an
     attribution and is not one. */
  assert.equal(
    contactReadLine({
      id: "x",
      name: "n",
      officeTitle: "t",
      relationship: "r",
      basis: "BODY_MEMBER",
      email: null,
      phone: null,
      websiteUrl: null,
      sourceUrl: null,
      sourceOrg: null,
      retrievedAt: null,
    }),
    null,
  );

  const box = readFileSync(join(ROOT, "components", "ask", "answer-contacts.tsx"), "utf8");
  assert.match(box, /contactReadLine\(c\)/, "the read line must actually render");
  /* The BASIS stays machine-readable and off the page: `BODY_MEMBER` is an
     enum value and no enum value reaches a reader. Its plain-language form is
     the relationship sentence that is already beside it. */
  assert.match(box, /data-ask-contact-basis=\{c\.basis\}/);
  assert.ok(!/\{c\.basis\}<\//.test(box), "an enum value is being rendered as text");
});

test("a surface reference carries the subject's OWN kind, not PERSON for everything", () => {
  /*
   * `ask-box.tsx` pushed `kind: "PERSON" as const` for EVERY resolved subject —
   * districts, measures and contests all recorded as people in the very list a
   * later pronoun resolves against. It did not usually produce a wrong answer,
   * because the ids were right and the id is tried first. It produced a wrong
   * REASON, and the moment a reference arrived without an id — which
   * `readSubjectRefs` explicitly accepts — the kind would have decided it.
   */
  assert.equal(subjectKindOf("BODY"), "BODY");
  assert.equal(subjectKindOf("MEASURE"), "MEASURE");
  assert.equal(subjectKindOf("CONTEST"), "CONTEST");
  assert.equal(subjectKindOf("OFFICE"), "OFFICE");
  assert.equal(subjectKindOf("PERSON"), "PERSON");

  const box = readFileSync(join(ROOT, "components", "ask", "ask-box.tsx"), "utf8");
  assert.ok(
    !/kind: "PERSON" as const/.test(box),
    "every subject is being recorded as a person again",
  );
  assert.match(box, /kind: subjectKindOf\(resolved\.kind\)/);
});
