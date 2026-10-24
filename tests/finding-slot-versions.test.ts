import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CHECKLIST_ITEMS } from "../lib/coverage/checklist-map.ts";
import { FINDING_SLOT_VERSIONS, slotFor } from "../lib/facts/finding-slots.ts";

/** The routing corpus includes every checklist item and the publisher's field-name cases. */
export function routingSignatures(): Record<string, string> {
  const rows: Record<string, unknown[]> = {};
  const fields = [...Object.keys(CHECKLIST_ITEMS), "officeholder.name", "officeholder.title", "officeholder.term", "officeholder.term_start",
    "officeholder.term_end", "officeholder.phone", "officeholder.email", "candidate.bio", "candidate.campaignSite", "candidate.position.education",
    "district.phone", "district.address", "body.name", "body.website", "recorder.phone", "publicComment.page", "publicComment.signup",
    "publicComment.timeLimit", "meeting.schedule", "meeting.location", "subordinateBody.name", "population", "unknown"];
  const values = ["x", "https://example.gov/agendas", "mayor@example.gov", "(520) 555-0100", "101 Main Street", "Dana Example", "Board of Adjustment", "2026", "Yes", "first Tuesday"];
  for (const field of fields) for (const value of values) for (const recordClass of [null, "candidate-enrichment"]) {
    const quote = `Mayor Dana Example, appointed in 2026. Register to vote. ${value}`;
    const slot = slotFor(field, value, recordClass, quote, "https://example.gov/board", "example#governing");
    (rows[slot.class] ??= []).push([field, value, recordClass, slot]);
  }
  return Object.fromEntries(Object.entries(rows).map(([kind, routes]) => [kind,
    createHash("sha256").update(JSON.stringify(routes)).digest("hex")]));
}

test("a class's routing cannot change under its existing version", () => {
  const expected = JSON.parse(readFileSync(new URL("./fixtures/finding-slot-versions.json", import.meta.url), "utf8"));
  for (const [kind, signature] of Object.entries(routingSignatures())) {
    const version = FINDING_SLOT_VERSIONS[kind];
    assert.ok(version && Number.isSafeInteger(version), `Give ${kind} its own version`);
    assert.equal(expected[kind]?.[version], signature, `Routing for ${kind} changed: bump that class and record its new routing signature`);
  }
});
