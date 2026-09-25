/**
 * MW-063 — the readiness standard is versioned data. The manifest's current
 * version is the contract the code stamps and trusts; the gates and taxonomy
 * the code runs are the manifest's; every version has an adoption date and
 * the history chains; a snapshot measured under a superseded version stays
 * readable and names the version it was measured under.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { CAPABILITY_TAXONOMY } from "../lib/control-plane/readiness/catalog.ts";
import { GATE_DEFINITION, GATE_LABEL, GATE_ORDER } from "../lib/control-plane/readiness/gates.ts";
import { CAPABILITY_DOMAINS, JURISDICTION_LEVELS, READINESS_DERIVATION_CONTRACT, type ReadinessStateSnapshot } from "../lib/control-plane/readiness/model.ts";
import { readinessRowOutcome } from "../lib/control-plane/readiness/read.ts";
import { READINESS_STANDARD, currentStandard, standardHistory, standardVersion } from "../lib/control-plane/readiness/standard.ts";

test("MW-063: the manifest's current version is the contract the code stamps and trusts", () => {
  assert.equal(READINESS_STANDARD.current, READINESS_DERIVATION_CONTRACT);
  assert.equal(currentStandard().id, READINESS_DERIVATION_CONTRACT);
  assert.equal(currentStandard().supersededOn, null, "the version in force is not superseded");
});

test("MW-063: the gates and taxonomy the code runs are exactly the manifest's current version", () => {
  const v = currentStandard();
  assert.deepEqual(v.gates.map((g) => g.id), [...GATE_ORDER]);
  for (const g of v.gates) {
    assert.equal(GATE_LABEL[g.id as (typeof GATE_ORDER)[number]], g.label);
    assert.equal(GATE_DEFINITION[g.id as (typeof GATE_ORDER)[number]], g.definition);
  }
  assert.deepEqual(CAPABILITY_TAXONOMY, v.capabilities);
  assert.equal(new Set(CAPABILITY_TAXONOMY.map((c) => c.capabilityId)).size, CAPABILITY_TAXONOMY.length, "capability ids are unique");
  for (const c of CAPABILITY_TAXONOMY) {
    assert.ok((CAPABILITY_DOMAINS as readonly string[]).includes(c.domain), c.capabilityId);
    assert.ok((JURISDICTION_LEVELS as readonly string[]).includes(c.level), c.capabilityId);
  }
});

test("MW-063: every version is dated, exactly one is in force, and each superseded one hands over to the next", () => {
  const history = [...standardHistory()].reverse();
  assert.ok(history.length >= 2);
  for (const v of history) assert.match(v.adoptedOn, /^\d{4}-\d{2}-\d{2}$/, v.id);
  assert.deepEqual(history.filter((v) => v.supersededOn === null).map((v) => v.id), [READINESS_DERIVATION_CONTRACT]);
  for (let i = 0; i < history.length - 1; i += 1) assert.equal(history[i]!.supersededOn, history[i + 1]!.adoptedOn, `${history[i]!.id} hands over to ${history[i + 1]!.id}`);
  for (const v of history) if (v.gates === null) assert.ok((v.notRecorded ?? "").length > 0, `${v.id} says why its gates are not in the list`);
});

test("MW-063: a snapshot measured under a superseded version stays readable and names that version", () => {
  const legacy = { state: "nh", derivationContract: "readiness/instrument-derived@1", publishedAt: "2026-09-05T00:00:00.000Z" } as unknown as ReadinessStateSnapshot;
  const out = readinessRowOutcome(legacy, "fixture", "New Hampshire");
  assert.equal(out.kind, "REQUIRES_REPUBLISH");
  if (out.kind !== "REQUIRES_REPUBLISH") return;
  assert.equal(out.snapshotContract, "readiness/instrument-derived@1");
  const v = standardVersion(out.snapshotContract);
  assert.ok(v !== null, "the version it was measured under is on the list");
  assert.equal(v!.supersededOn, standardVersion(READINESS_DERIVATION_CONTRACT)!.adoptedOn);
  assert.equal(standardVersion("no-such-version"), null, "an unknown marker is not given a version");
});
