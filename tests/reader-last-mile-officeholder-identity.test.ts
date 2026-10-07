import assert from "node:assert/strict";
import test from "node:test";
import type { AskAnswerPayload } from "../lib/ask/answer.ts";

test("Ask can answer an explicitly named unmapped official without calling them the reader's representative", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  resetGroundedState();
  const id = "plural:e60aed5e-cbb4-4b27-ab1b-2ce1dd787dac";
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-all-officials" },
    body: JSON.stringify({ question: "How can I contact Aboul Khan?", surface: "MAP", ocdIds: ["ocd-division/country:us/state:az"], today: "2026-09-04" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as AskAnswerPayload;
  assert.equal(body.subject?.id, id);
  assert.ok(body.records.some((record) => record.kind === "OFFICEHOLDER" && record.id === id));
  assert.ok(body.contacts.some((contact) => contact.id === `office:${id}`));
  assert.ok(body.contacts.every((contact) => contact.basis !== "READER_REPRESENTATIVE"));
  assert.equal(body.answer, null, "the held record alone supplies this answer");
});
