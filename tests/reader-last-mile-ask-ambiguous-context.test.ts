import assert from "node:assert/strict";
import test from "node:test";
import { resolveInterpretation } from "../lib/ask/resolve.ts";
import { unavailableInterpretation } from "../lib/ask/intent.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { lineupRowForCard } from "../lib/identity/az-2026.ts";
import type { AskAnswerPayload } from "../lib/ask/answer.ts";

test("focused canonical context narrows a tied name only within that exact candidate set", () => {
  const inventory = ["one", "two", "other"].map((id) => ({ id, name: id === "other" ? "Other Person" : "Chris King", nameClass: "person" as const, divisionType: "person" }));
  const ask = (ids: string[]) => resolveInterpretation(unavailableInterpretation(), "What does Chris King say?", inventory, { activeSubjects: ids.map((id) => ({ id, name: "Chris King", kind: "PERSON", focused: true })) });
  const exact = ask(["one"]);
  assert.equal(exact.binding.kind, "BOUND");
  if (exact.binding.kind === "BOUND") assert.equal(exact.binding.entity.id, "one");
  for (const ids of [["wrong"], ["other"], ["one", "two"], []]) assert.equal(ask(ids).binding.kind, "AMBIGUOUS");
});

test("Hourihan's exact card corpus answers while the unresolved party/candidacy bridge stays withheld", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const cardKey = "ballot-az-pima:governor|Teri Ann Hourihan";
  assert.equal(lineupRowForCard(cardKey)?.outcome, "PARTY_CONFLICT");
  assert.deepEqual(readerPersonKeys(cardKey).keys, [cardKey]);
  const { POST, resetGroundedState } = await import("../app/api/ask/grounded/route.ts");
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", { method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test" }, body: JSON.stringify({ question: "What does Teri Ann Hourihan say about Arizona?", surface: "BALLOT", ocdIds: ["ocd-division/country:us/state:az"], activeSubjects: [{ id: cardKey, name: "Teri Ann Hourihan", kind: "PERSON", focused: true }] }) }));
  const payload = await response.json() as AskAnswerPayload;
  assert.equal(payload.subject?.id, cardKey);
  assert.ok(payload.records.some((record) => record.kind === "POSITION" && record.canonicalSubjectId === cardKey));
  assert.ok(payload.records.every((record) => record.canonicalSubjectId !== "ballot-az-pima:governor:hourihan-teri-ann"));
  assert.equal(payload.answer, null);
});
