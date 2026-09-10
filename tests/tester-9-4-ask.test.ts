import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { decideNamedBody, applyNamedBodyDecision, type BodyConfirmation } from "../lib/ask/body-confirmation.ts";
import { readAskAnswer, type AskAnswerPayload } from "../lib/ask/answer.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";
import { canonicalBodyIdentity, type CanonicalBodyIdentity } from "../lib/ask/body-identity.ts";
import type { Meeting } from "../lib/sources/types.ts";
import type { AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import type { EvidenceRecord } from "../lib/ask/evidence.ts";
import { synthesisPrompt } from "../lib/ask/synthesize.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import { classifyAgendaPublication } from "../lib/ask/agenda-publication.ts";
import { nameAReaderCanSay } from "../lib/routing/named-entity.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
// The canonical native runner strips TypeScript but does not compile TSX.
// Compile only these actual reader leaves through the existing tsx runtime.
const { AskAnswerRecords } = await tsImport("../components/ask/answer-records.tsx", import.meta.url) as typeof import("../components/ask/answer-records.tsx");
const { AskBodyConfirmation } = await tsImport("../components/ask/body-confirmation.tsx", import.meta.url) as typeof import("../components/ask/body-confirmation.tsx");

// Offline actual handler, with no model, database, acquisition or signal writes.
for (const key of ["ANTHROPIC_API_KEY", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
await installRegistryRuntimeFirstSeeds();
const { POST, resetGroundedState } = await import("../app/api/ask/grounded/route.ts");
const { GET: agendaGET } = await import("../app/api/agenda/route.ts");
const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district#board";
const nearby = "ocd-division/country:us/state:az/school_district:sunnyside_unified_district";
async function ask(question: string, confirmation?: BodyConfirmation): Promise<AskAnswerPayload> {
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "tester-9-4-ask" },
    body: JSON.stringify({ question, confirmation, surface: "MAP", ocdIds: [nearby], today: "2026-09-04" }),
  }));
  assert.equal(response.status, 200);
  const answer = readAskAnswer(await response.json()); assert.ok(answer);
  assert.equal(answer.trace.interpretation.ran, false);
  assert.equal(answer.trace.synthesis.ran, false);
  return answer;
}

test("ASK-26 Vail and its clean canonical name bind outside the reader's nearby coverage", async () => {
  for (const question of ["What's on the Vail school district agenda?", "What's on the Vail Unified District agenda?"]) {
    const answer = await ask(question);
    assert.equal(answer.subject?.id, VAIL);
    assert.equal(answer.confirmation, undefined);
    assert.ok(answer.records.every(record => !record.bodyId || record.bodyId === VAIL));
    assert.equal(answer.agendaLead, true);
  }
});

test("ASK-26 typo and mechanical acronym offer ONE guess, no answer, then bind the original question", async () => {
  for (const question of ["What's on the Vial school district agenda?", "What's on the Vial agenda?", "What's on the VUSD agenda?"]) {
    const pending = await ask(question);
    assert.equal(pending.mode, "CLARIFY");
    assert.equal(pending.subject, null); assert.equal(pending.answer, null);
    assert.deepEqual(pending.records, []); assert.deepEqual(pending.meetings, []);
    assert.equal(pending.candidates, undefined);
    assert.equal(pending.confirmation?.bodyId, VAIL);
    assert.equal(pending.confirmation?.question, question);
    assert.equal(pending.trace.retrieval.recordCount, 0);
    const markup = renderToStaticMarkup(createElement(AskBodyConfirmation, { answer: pending, working: false, onConfirm() {}, onClarify() {} }));
    assert.match(markup, /Did you mean Vail Unified/); assert.match(markup, /Yes, answer for this body/);
    const confirmed = await ask(question, pending.confirmation);
    assert.equal(confirmed.subject?.id, VAIL);
    assert.equal(confirmed.trace.resolution.basis, "READER_CONFIRMATION");
    assert.ok(confirmed.records.length > 0);
    assert.ok(confirmed.records.every(record => !record.bodyId || record.bodyId === VAIL));
    const forged = await ask(question, { ...pending.confirmation!, bodyId: `${nearby}#board` });
    assert.equal(forged.subject, null); assert.equal(forged.mode, "CLARIFY");
    const reused = await ask("What's on the Vial school board agenda?", pending.confirmation);
    assert.equal(reused.subject, null);
  }
});

test("ASK-26 tie chooses one stable canonical suggestion without treating an ordering as identity proof", () => {
  const bodies: BindableEntity[] = ["second", "first"].map(id => ({ id, name: "Springfield Unified District", nameClass: "body", divisionType: "school_district", level: "BODY" }));
  const question = "What's on the Springfield school district agenda?";
  const decision = decideNamedBody(question, bodies);
  assert.equal(decision.kind, "CONFIRM");
  if (decision.kind !== "CONFIRM") return;
  assert.equal(decision.candidate.id, "first");
  assert.deepEqual(decideNamedBody(question, [...bodies].reverse()), decision);
  const substituted = applyNamedBodyDecision(decision, { binding: { kind: "BOUND", entity: bodies[0], matchedOn: "a model expansion" }, basis: "MODEL_EXPANSION_NARROWED", boundOn: "Springfield" }, question);
  assert.equal(substituted.binding.kind, "UNRESOLVED");
  assert.equal(decideNamedBody(question, bodies, { bodyId: "first", name: bodies[1].name, question }).kind, "BOUND");
  for (const unnamed of ["What's on the agenda?", "What's on my school district agenda?", "What's on the next meeting agenda?"])
    assert.equal(decideNamedBody(unnamed, bodies).kind, "NONE", "An unnamed question retains the existing context default");
});

test("ASK-26 unknown named body asks neutrally; another nearby body cannot inherit the question", async () => {
  for (const question of ["What's on the Fictional Nonexistent school district agenda?", "What's on the Zzznonexistent agenda?"]) {
  const answer = await ask(question);
  assert.equal(answer.mode, "CLARIFY");
  assert.equal(answer.subject, null); assert.equal(answer.confirmation, undefined); assert.equal(answer.candidates, undefined);
  assert.deepEqual(answer.records, []); assert.match(answer.clarification ?? "", /Which government/);
  assert.doesNotMatch(answer.clarification ?? "", /no match|nothing recorded|don't have/i);
  }
});

test("ASK-27 real Ask and meeting route retain identical document/version IDs and agenda titles across school and county bodies", async () => {
  const snapshot = readSnapshot(); assert.ok(snapshot);
  const documents = snapshot.agendaDocuments;
  for (const divisionType of ["school_district", "county"]) {
    const meeting: Meeting | undefined = snapshot.meetings.find(meeting => {
      const body = meeting.bodyId ? canonicalBodyIdentity(meeting.bodyId) : null;
      return body?.divisionType === divisionType && classifyAgendaPublication({ bodyName: body.name, meetingId: meeting.id,
        documentsForMeeting: documents.filter(document => document.meetingId === meeting.id), documentsAcrossCorpus: documents,
        meetingsAcrossCorpus: snapshot.meetings, now: Date.now() }).acquisition === "ITEMS_READER_READY";
    });
    assert.ok(meeting, `A substantive ${divisionType} control must be held`);
    const body: CanonicalBodyIdentity = canonicalBodyIdentity(meeting.bodyId!)!;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: meeting.timeZone ?? "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(meeting.startsAt));
    const answer = await ask(`What's on the ${nameAReaderCanSay(body.name, body.divisionLabel)} agenda on ${date}?`);
    assert.equal(answer.subject?.id, body.bodyId);
    assert.equal(answer.agendaLead, true);
    assert.ok(answer.meetings.some(row => row.id === meeting.id && row.title === meeting.title));
    const surface: { documents: AgendaDocument[] } = await (await agendaGET(new Request(`https://wtp.test/api/agenda?meetingId=${encodeURIComponent(meeting.id)}`))).json();
    const held: AgendaDocument[] = documents.filter(document => document.meetingId === meeting.id);
    assert.deepEqual(surface.documents.map((row: { id: string }) => row.id).sort(), held.map(row => row.id).sort());
    const returned: EvidenceRecord[] = answer.records.filter(record => record.kind === "AGENDA_DOCUMENT" && record.meetingId === meeting.id);
    assert.deepEqual(returned.map(record => record.documentId).sort(), held.map(row => row.id).sort());
    for (const record of returned) assert.equal(record.agendaDocument?.contentHash, held.find(row => row.id === record.documentId)?.contentHash);
    const reading = classifyAgendaPublication({ bodyName: body.name, meetingId: meeting.id, documentsForMeeting: held, documentsAcrossCorpus: documents, meetingsAcrossCorpus: snapshot.meetings, now: Date.now() });
    for (const item of reading.items) assert.ok(answer.records.some(record => record.kind === "AGENDA_ITEM" && record.meetingId === meeting.id && record.text === item));
    assert.ok(answer.records.every(record => !record.bodyId || record.bodyId === body.bodyId), "No cross-body agenda leakage");
    const markup = renderToStaticMarkup(createElement(AskAnswerRecords, { records: answer.records, initiallyOpen: false, agendaLead: answer.agendaLead, prose: "School boards generally decide policy." }));
    assert.ok(markup.indexOf("data-ask-agenda-lead") < markup.indexOf("School boards generally"), "Held agenda always leads optional synthesis prose");
    assert.ok(markup.includes(meeting.id));
    const prompt = synthesisPrompt({ question: "What's on this agenda?", intent: "UPCOMING_AGENDA", temporal: { kind: "NEXT" }, subject: answer.subject, records: answer.records, gaps: answer.gaps, denominators: answer.denominators, today: "2026-09-04" });
    assert.match(prompt, /LEAD WITH THE HELD AGENDA/);
    assert.doesNotMatch(prompt, /LEAD WITH THE PLAIN DEFINITION/);
  }
});

test("ASK-27 an unavailable agenda remains an OURS holding gap, never an empty docket claim", async () => {
  const answer = await ask("What's on the Vail school district agenda?");
  assert.ok(answer.gaps.some(gap => gap.whose === "OURS" && /agenda|publication/i.test(gap.statement)));
  assert.ok(!answer.gaps.some(gap => gap.whose === "THEIRS" && /no agenda|not published/i.test(gap.statement)));
  assert.ok(!answer.records.some(record => /nothing is on the agenda|no agenda items exist/i.test(record.text)));
});
