import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { SOURCE_AUTHORITIES } from "../lib/civic-data/source-authority.ts";
import { REGISTRATION_TARGETS } from "../lib/registration/publication.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import { installOperationalReferenceBundle, operationalReferenceBundle } from "../lib/civic-data/operational-references.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { meetingsDiscoveryObligationId, meetingsDiscoveryProvider, standingDiscoveryNeeds } from "../lib/control-plane/scheduler/providers/meetings-discovery.ts";

const ROOT = join(import.meta.dirname, "..");
const NOW = "2026-10-12T12:00:00.000Z";
const REGISTRIES = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/jurisdiction-registries.json"), "utf8")) as Record<"az" | "nh" | "nj", JurisdictionRegistry>;
installOperationalReferenceBundle(operationalReferenceBundle(REGISTRIES));

test("registered governments with websites have standing free discovery with no Send and no model", () => {
  const pass = buildRegistry([meetingsDiscoveryProvider()], { root: ROOT, nowIso: NOW });
  assert.equal(pass.byProvider[0].readFailure, null);
  const expected = Object.values(REGISTRIES).flatMap(reg => standingDiscoveryNeeds(reg).map(meetingsDiscoveryObligationId));
  assert.ok(expected.length > 0);
  assert.deepEqual(pass.units.map(unit => unit.obligation.id).sort(), expected.sort());
  assert.ok(pass.units.every(unit => unit.route.executorClass === "DETERMINISTIC" && unit.route.open.kind === "ROUTINE_READ"));
  assert.ok(pass.units.every(unit => unit.obligation.materializedBy === undefined));
});

test("standing discovery covers already wired sites and leaves finding unknown sites to an explicit dispatch", () => {
  const base = REGISTRIES.az;
  const source = "MEETINGS:THIS_JURISDICTION:already-wired";
  const reg: JurisdictionRegistry = {
    ...base,
    sourceCatalog: { ...base.sourceCatalog, [source]: { ...base.sourceCatalog["MEETINGS:THIS_JURISDICTION:this-government-itself"], state: "ADAPTED", url: "https://public.example.gov/events" } },
    jurisdictions: [
      { ...base.jurisdictions[0], id: "az:city:wired", ownWebAddress: "https://public.example.gov/", sourceIds: [source] },
      { ...base.jurisdictions[0], id: "az:city:unknown", ownWebAddress: null, sourceIds: [] },
    ],
  };
  const needs = standingDiscoveryNeeds(reg);
  assert.deepEqual(needs.map(need => need.jurisdictionId), ["az:city:wired"]);
  const pass = buildRegistry([meetingsDiscoveryProvider({ registered: () => ({ registries: new Map([["az", reg]]), refused: new Map() }), materialized: () => ({ unreadable: "paid-work read unavailable" }) })], { root: ROOT, nowIso: NOW });
  assert.equal(pass.units.length, 1, "unread paid work cannot stop a free website walk");
  assert.match(pass.byProvider[0].readFailure ?? "", /paid-work read unavailable/);
});

test("national-shaped source authorities accept every registration target", () => {
  for (const id of ["registry-reviewed-bindings", "jurisdiction-operational-reference", "meetings-public-bodies", "candidate-campaign-site-chain", "candidate-primary-publications"] as const) {
    for (const target of REGISTRATION_TARGETS) assert.ok(SOURCE_AUTHORITIES[id].jurisdictions.includes(target.jurisdiction), `${id}: ${target.jurisdiction}`);
  }
  assert.ok(SOURCE_AUTHORITIES["meetings-public-bodies"].jurisdictions.includes("SUPPORTED-BODY-WITHOUT-CENSUS-DIVISION"));
  assert.deepEqual(SOURCE_AUTHORITIES["az-election-authorities"].jurisdictions, ["US-AZ"], "state-specific authorities keep their sourced scope");
});
