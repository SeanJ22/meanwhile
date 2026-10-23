import assert from "node:assert/strict";

import { join } from "node:path";
import { test } from "node:test";

import type { RegistrationSourceReceipt } from "../lib/registration/acquire.ts";
import { registrationCandidate, type RegistrationReadModel, type ReviewedRegistryIds } from "../lib/registration/candidate.ts";

import { REGISTRATION_SOURCE_BYTES, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL, registrationTarget } from "../lib/registration/publication.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { enterReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import type { ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";
import { currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { installCanonicalEntries, activateCanonicalFixture } from "./helpers/canonical-reader-fixtures.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";

function promotedFixtureBundle(extra: ReaderAuthorityEdgeBundle = {}): ReaderAuthorityEdgeBundle {
  const current: ReaderAuthorityEdgeBundle = currentReaderAuthorityEdge() ?? {};
  return { stateAuthorities: current.stateAuthorities,
    ...(current.stateLegislators ? { stateLegislators: current.stateLegislators } : {}),
    ...extra, promoted: new Map([...(current.promoted ?? []), ...(extra.promoted ?? [])]) };
}

const ROOT = join(import.meta.dirname, "..");
const RECEIPT: RegistrationSourceReceipt = {
  requestedUrl: REGISTRATION_SOURCE_URL,
  finalUrl: REGISTRATION_SOURCE_URL,
  httpStatus: 200,
  retrievedAt: "2026-09-23T12:00:00.000Z",
  sha256: REGISTRATION_SOURCE_SHA256,
  bytes: REGISTRATION_SOURCE_BYTES,
  confirmedBy: "HELD_RELEASE",
};
const REVIEWED: ReviewedRegistryIds = { versionId: "cv-reviewed", divisionIds: new Set(), bodyIds: new Set(), bodyDivisionIds: new Set() };

function model(state: string): RegistrationReadModel {
  return registrationCandidate({ target: registrationTarget(state), reference: loadRegistrationReference(ROOT, state), receipt: RECEIPT, reviewed: REVIEWED }).readModel as RegistrationReadModel;
}

function installRegistration(state: string, value: RegistrationReadModel): void {
  const target = registrationTarget(state), source = requiredRoutineContract(target.contractId);
  installCanonicalEntries([provenEdgeEntry({ recordClass: "REGISTRATION", scope: target.scope, sourceId: source.sourceId,
    versionId: `registration-fixture:${state}`, value })]);
  activateCanonicalFixture("default");
}

test("the reader composes a state's registration from the edge, and a state published absent opens no database read", async () => {
  await installRegistryAuthority();
  const { divisionsByOcdIds } = await import("../lib/registry/server.ts");
  const oh = model("OH");
  const county = oh.divisions.find((d) => d.divisionType === "county")!;
  const loads: string[] = [];
  enterReaderAuthorityEdge(promotedFixtureBundle({
    registrations: {
      load: async (state) => {
        loads.push(state);
        return state === "oh" ? { value: oh, versionId: "reg-oh-1" } : { value: null, versionId: "none" };
      },
    },
  }));
  const found = await divisionsByOcdIds([county.ocdId, "ocd-division/country:us/state:wy/county:laramie"]);
  assert.deepEqual(found.map((d) => d.ocdId), [county.ocdId], "Ohio's county composes; Wyoming, published with no registration, is dropped");
  assert.deepEqual(loads.sort(), ["oh", "wy"], "only the named states' pointers are read");
  assert.equal(found[0]!.label, county.label);
});

test("a DC division and a Puerto Rico division reach their registrations on the reader", async () => {
  await installRegistryAuthority();
  const { coverageAt, divisionsByOcdIds } = await import("../lib/registry/server.ts");
  const dc = model("DC");
  const pr = model("PR");
  installRegistration("DC", dc);
  installRegistration("PR", pr);
  const loads: string[] = [];
  const edge = promotedFixtureBundle({
    registrations: {
      load: async (state: string) => {
        loads.push(state);
        return state === "dc" ? { value: dc, versionId: "reg-dc-1" } : state === "pr" ? { value: pr, versionId: "reg-pr-1" } : null;
      },
    },
  });
  enterReaderAuthorityEdge(edge);
  // DC's ids root at `district:dc`, Puerto Rico's at `territory:pr`: until both were read as jurisdictions, neither was ever asked for.
  const washington = "ocd-division/country:us/district:dc/place:washington";
  const adjuntas = "ocd-division/country:us/territory:pr/county:adjuntas";
  const found = await divisionsByOcdIds([washington, adjuntas]);
  assert.deepEqual(found.map((d) => d.ocdId), [washington, adjuntas]);
  assert.deepEqual(loads.sort(), ["dc", "pr"]);

  // Adjuntas's municipal government reaches the coverage card, titled by its municipio.
  enterReaderAuthorityEdge(edge);
  const coverage = await coverageAt(18.16, -66.72, 0, await divisionsByOcdIds([adjuntas]));
  const row = coverage.governments?.find((government) => government.associations.some(association => association.divisionId === adjuntas));
  assert.ok(row, "the municipio's government is in the card");
  assert.equal(row!.name, "Adjuntas Municipio");
});

test("a native county listing reaches the normal coverage card without a fabricated board", async () => {
  await installRegistryAuthority();
  const { coverageAt, divisionsByOcdIds } = await import("../lib/registry/server.ts");
  const oh = model("OH");
  installRegistration("OH", oh);
  const government = oh.governments!.find(row => row.governmentClass === "COUNTY" && row.associations.length)!;
  enterReaderAuthorityEdge(promotedFixtureBundle({ registrations: { load: async state => state === "oh" ? { value: oh, versionId: "reg-oh-1" } : null } }));
  const resolved = await divisionsByOcdIds([government.associations[0].divisionId]);
  const coverage = await coverageAt(39.96, -83.0, 0, resolved);
  assert.equal(coverage.governments?.find(row => row.id === government.id)?.name, government.name);
  assert.equal(oh.bodies.length, 0);
});
