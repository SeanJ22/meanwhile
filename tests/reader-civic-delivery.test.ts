import assert from "node:assert/strict";
import { test } from "node:test";
import { EVERYDAY_CONTACTS, buildEverydayRoutingProjection, readerEligibleEverydayContact, everydayContactsFor } from "../lib/routing/everyday.ts";
import { answerQuestion, showGroundedAnswer } from "../lib/routing/ask.ts";
import { coverageAt } from "../lib/registry/server.ts";
import { readAskAnswer } from "../lib/ask/answer.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();
const everydayRouting = buildEverydayRoutingProjection();

test("reader civic contacts exclude a planted unverified acquisition", () => {
  const held = EVERYDAY_CONTACTS[0];
  assert.ok(readerEligibleEverydayContact(held));
  assert.equal(readerEligibleEverydayContact({ ...held, verification: "PENDING_BROWSER" }), false);
  for (const record of EVERYDAY_CONTACTS) for (const zip of record.zips) {
    assert.equal(everydayContactsFor(record.topicId, zip, everydayRouting).some(contact => contact.sourceUrl === record.sourceUrl && contact.topicId === record.topicId && contact.body === record.body), record.verification === "PAGE_FETCHED");
  }
});

test("an empty unbound engine cannot contradict a held civic answer, while identity and loader states remain visible", async () => {
  const coverage = await coverageAt(32.2217, -110.9265, 0);
  const routed = answerQuestion("Who owns potholes in my street?", coverage, "85701", { everydayRouting });
  assert.ok(routed.contacts.length > 0);
  const empty = readAskAnswer({ mode: "NO_EVIDENCE" })!;
  assert.equal(showGroundedAnswer(routed, empty), false);
  assert.equal(showGroundedAnswer(null, empty), true);
  for (const mode of ["UNRESOLVED", "CLARIFY", "OFF", "TRANSPORT_FAILED"] as const) {
    assert.equal(showGroundedAnswer(routed, { ...empty, mode }), true, mode);
  }
  assert.equal(showGroundedAnswer(routed, { ...empty, subject: { kind: "BODY", id: "body:explicit", name: "Explicit body" } }), true);
});
