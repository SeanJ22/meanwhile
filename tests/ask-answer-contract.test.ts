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

test("every mode carries the whole shape, so no client's `?? []` is load-bearing", () => {
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
  const p = pack({
    records: [
      { kind: "AGENDA_ITEM", id: "m1#0", text: "Rezoning of parcel 44", sourceUrl: "https://x.gov/a" },
    ],
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

test("OFF is a real member and carries a SENTENCE, not an empty panel", () => {
  assert.ok(ANSWER_MODES.includes("OFF"));
  const off = offAnswer("ripcord");
  assert.equal(off.mode, "OFF");
  assert.equal(off.why, "ripcord", "the reason is OPERATOR diagnostics");
  assert.equal(off.gaps.length, 1);
  assert.equal(off.gaps[0].whose, "OURS", "a switched-off capability is a fact about US");
  assert.match(off.gaps[0].statement, /working on getting this info/);
  assert.doesNotMatch(off.gaps[0].statement, /sorry|we failed|error|unavailable/i);
});

test("TRANSPORT_FAILED gives the map the state the ballot already had", () => {
  assert.ok(ANSWER_MODES.includes("TRANSPORT_FAILED"));
  const failed = transportFailure();
  assert.equal(failed.gaps[0].whose, "OURS");
  assert.match(failed.gaps[0].statement, /didn't reach us/);
  assert.doesNotMatch(failed.gaps[0].statement, /found nothing|no results|nothing scheduled/i);

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

test("a reply whose mode is not a member is REFUSED rather than rendered", () => {
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

test("no surface declares its own copy of the answer contract", () => {
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
  assert.match(box, /data-ask-contact-basis=\{c\.basis\}/);
  assert.ok(!/\{c\.basis\}<\//.test(box), "an enum value is being rendered as text");
});

test("a surface reference carries the subject's OWN kind, not PERSON for everything", () => {
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
