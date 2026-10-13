import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";
import type { AskAnswerPayload } from "../lib/ask/answer.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

test("Ask can answer an explicitly named unmapped official without calling them the reader's representative", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  const { allSeatHolders } = await import("../lib/registry/server.ts");
  resetGroundedState();
  // A held official of another state: named by the reader, never one of an Arizona reader's representatives.
  const holder = (await allSeatHolders()).find((seat) => seat.state === "NJ" && seat.officeTitle === "U.S. Senator");
  assert.ok(holder, "the held registry names a New Jersey senator");
  const id = holder.id;
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", "x-wtp-synthetic-run": "reader-last-mile-all-officials" },
    body: JSON.stringify({ question: `How can I contact ${holder.name}?`, surface: "MAP", ocdIds: ["ocd-division/country:us/state:az"], today: "2026-09-04" }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as AskAnswerPayload;
  assert.equal(body.subject?.id, id);
  assert.ok(body.records.some((record) => record.kind === "OFFICEHOLDER" && record.id === id));
  assert.ok(body.contacts.some((contact) => contact.id === `office:${id}`));
  assert.ok(body.contacts.every((contact) => contact.basis !== "READER_REPRESENTATIVE"));
  assert.equal(body.answer, null, "the held record alone supplies this answer");
});
