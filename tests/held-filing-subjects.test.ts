import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { azHeldFilingSubjects, requestedHeldFilings } from "../lib/ask/held-filing-subjects.ts";
import { installCandidateCorpusFirstSeed, installNjMorrisFilingFirstSeed, installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

test("published source-filing profiles retain exact identities outside the mapped ballot without duplicating joined people", () => {
  const rows = azHeldFilingSubjects(JSON.parse(readFileSync("data/states/az/candidates/az-2026-sos-candidate-filings.json", "utf8")));
  const crane = rows.find(row => row.entity.id === "az-sos-2026:us-house-2:crane-eli")!;
  assert.equal(crane.entity.name, "Eli Crane");
  assert.equal(crane.ocdId, "ocd-division/country:us/state:az/cd:2");
  assert.match(crane.record.sourceUrl!, /azsos.gov/);
  assert.match(crane.record.text, /does not establish a current general-election ballot position/);
  assert.deepEqual(requestedHeldFilings(rows, "What biography is held?", [crane.entity.id], new Set()), [crane]);
  const david = rows.find(row => row.entity.id === "az-sos-2026:governor:schweikert-david")!;
  assert.deepEqual(requestedHeldFilings(rows, "David Schweikert", [], new Set([david.heldCandidacyId!])), []);
  assert.deepEqual(requestedHeldFilings(rows, "David Schweikert", [david.entity.id], new Set([david.heldCandidacyId!])), [david]);
  assert.deepEqual(requestedHeldFilings(rows, "What biography is held?", ["invented-person"], new Set()), []);
  assert.throws(() => azHeldFilingSubjects({}), /unreadable/);
});

test("the real Ask route binds published source IDs even when the mapped ballot does not carry them", async () => {
  await Promise.all([installCandidateCorpusFirstSeed(), installNjMorrisFilingFirstSeed(), installRegistryRuntimeFirstSeeds()]);
  delete process.env.ANTHROPIC_API_KEY;
  const { POST } = await import("../app/api/ask/grounded/route.ts");
  const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");
  for (const [id, name, ocdId] of [
    ["az-sos-2026:us-house-2:crane-eli", "Eli Crane", "ocd-division/country:us/state:az/cd:2"],
    ["az-sos-2026:governor:schweikert-david", "David Schweikert", "ocd-division/country:us/state:az"],
  ]) {
    resetGroundedState();
    const response = await POST(new Request(`${PUBLIC_SITE_ORIGIN}/api/ask/grounded`, { method: "POST", headers: { "content-type": "application/json", origin: PUBLIC_SITE_ORIGIN, "x-wtp-synthetic-run": "held-filing-identity-test" }, body: JSON.stringify({ question: "What biography and verified campaign pages do we hold for this person?", surface: "BALLOT", ocdIds: [ocdId], today: "2026-09-26", activeSubjects: [{ id, name, kind: "PERSON", focused: true }] }) }));
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.subject?.id, id, JSON.stringify(payload.resolution));
    assert.ok(payload.records.some((r: { id: string }) => r.id === `held-filing:${id}`));
  }
});
