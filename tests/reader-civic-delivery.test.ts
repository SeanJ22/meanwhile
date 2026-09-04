import assert from "node:assert/strict";
import { test } from "node:test";
import { EVERYDAY_CONTACTS, readerEligibleEverydayContact, everydayContactsFor } from "../lib/routing/everyday.ts";

test("reader civic contacts exclude a planted unverified acquisition", () => {
  const held = EVERYDAY_CONTACTS[0];
  assert.ok(readerEligibleEverydayContact(held));
  assert.equal(readerEligibleEverydayContact({ ...held, verification: "PENDING_BROWSER" }), false);
  for (const record of EVERYDAY_CONTACTS) for (const zip of record.zips) {
    assert.equal(everydayContactsFor(record.topicId, zip).includes(record), record.verification === "PAGE_FETCHED");
  }
});
