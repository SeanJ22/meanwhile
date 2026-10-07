import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";
import { decideNamedBody, applyNamedBodyDecision, type BodyConfirmation } from "../lib/ask/body-confirmation.ts";
import { readAskAnswer, type AskAnswerPayload } from "../lib/ask/answer.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
// The canonical native runner strips TypeScript but does not compile TSX.
// Compile only these actual reader leaves through the existing tsx runtime.
const { AskBodyConfirmation } = await tsImport("../components/ask/body-confirmation.tsx", import.meta.url) as typeof import("../components/ask/body-confirmation.tsx");

// Offline actual handler, with no model, database, acquisition or signal writes.
for (const key of ["ANTHROPIC_API_KEY", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
await installRegistryRuntimeFirstSeeds();
const { POST } = await import("../app/api/ask/grounded/route.ts");
const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
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

test("ASK-26 unknown named body gets a plain gap; another nearby body cannot inherit the question", async () => {
  for (const [question, gap] of [
    ["What's on the Fictional Nonexistent school district agenda?", "We don't have Fictional Nonexistent School District's agendas yet."],
    ["When does the Fictional Nonexistent City Council meet next?", "We don't have Fictional Nonexistent City Council's calendar yet."],
  ]) {
    const answer = await ask(question);
    assert.equal(answer.mode, "NO_EVIDENCE");
    assert.equal(answer.answer, gap);
    assert.equal(answer.subject, null); assert.equal(answer.confirmation, undefined); assert.equal(answer.candidates, undefined);
    assert.deepEqual(answer.records, []); assert.deepEqual(answer.meetings, []);
    assert.equal(answer.clarification, undefined);
    assert.doesNotMatch(answer.answer ?? "", /Sunnyside|Vail/i);
  }
  // A bare unknown name still needs identification; never default to a nearby body.
  const unnamed = await ask("What's on the Zzznonexistent agenda?");
  assert.equal(unnamed.mode, "CLARIFY");
  assert.equal(unnamed.subject, null); assert.equal(unnamed.confirmation, undefined); assert.equal(unnamed.candidates, undefined);
  assert.deepEqual(unnamed.records, []); assert.deepEqual(unnamed.meetings, []);
  assert.match(unnamed.clarification ?? "", /Which government/);
});

test("ASK-27 an unavailable agenda remains an OURS holding gap, never an empty docket claim", async () => {
  const answer = await ask("What's on the Vail school district agenda?");
  assert.ok(answer.gaps.some(gap => gap.whose === "OURS" && /agenda|publication/i.test(gap.statement)));
  assert.ok(!answer.gaps.some(gap => gap.whose === "THEIRS" && /no agenda|not published/i.test(gap.statement)));
  assert.ok(!answer.records.some(record => /nothing is on the agenda|no agenda items exist/i.test(record.text)));
});
