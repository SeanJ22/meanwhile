import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticRoleFor } from "../scripts/rh01-model-scope.mts";
import type { ModelRequest } from "../lib/control-plane/scheduler/scout-executor.ts";

const subject = "ocd-division/country:us/state:az/county:pima";
const context = () => ({ subjectId: subject, contract: { subjectId: subject, schemaVersion: 2, recordClass: "OFFICIAL_BOARD_DIRECTORY",
  jurisdiction: { country: "US", state: "AZ", canonicalId: subject }, requiredFields: ["bodyName"],
  sourceScope: { sourceId: "www.pima.gov", canonicalUrls: ["https://www.pima.gov/board-of-supervisors"] },
  extraction: { format: "TEXT_BLOCKS", recordStart: "<title>", recordEnd: " | Pima County, AZ</title>", fields: { bodyName: { source: "<title>", type: "STRING" } } } } });
const request = (value: unknown): ModelRequest => ({ model: "haiku", max_tokens: 2048, system: [],
  tools: [{ name: "record_audit", description: "native audit", input_schema: { type: "object" } }], messages: [{ role: "user", content: JSON.stringify(value) }] });

test("the diagnostic audit allows only the prepared county-subject official body-title input", () => {
  assert.equal(diagnosticRoleFor(request(context())), "ADVERSARIAL_AUDITOR");
  const original = context();
  const invalid = [
    { ...original, subjectId: `${subject}#governing` },
    { ...original, contract: { ...original.contract, recordClass: "LEGISTAR_EVENTS" } },
    { ...original, contract: { ...original.contract, schemaVersion: 1 } },
    { ...original, contract: { ...original.contract, requiredFields: ["bodyName", "office"] } },
    { ...original, contract: { ...original.contract, jurisdiction: { ...original.contract.jurisdiction, state: "WI" } } },
    { ...original, contract: { ...original.contract, sourceScope: { ...original.contract.sourceScope, canonicalUrls: ["https://webapi.legistar.com/v1/pima/events"] } } },
    { ...original, contract: { ...original.contract, extraction: { ...original.contract.extraction, fields: { bodyName: { source: "made-up", type: "STRING" } } } } },
  ];
  for (const value of invalid) assert.throws(() => diagnosticRoleFor(request(value)), /escaped/);
});

test("the county Scout guard remains exact and does not grant another place a model exception", () => {
  const scout: ModelRequest = { ...request(null), tools: [{ name: "finish", description: "native finish", input_schema: { type: "object" } }],
    batchContext: { job: "BLANK", priority: { subjectId: subject, now: "2026-10-20T12:00:00.000Z" } } };
  assert.equal(diagnosticRoleFor(scout), "SCOUT");
  assert.throws(() => diagnosticRoleFor({ ...scout, batchContext: { ...scout.batchContext!, priority: { ...scout.batchContext!.priority!, subjectId: "another-place" } } }), /outside/);
});
