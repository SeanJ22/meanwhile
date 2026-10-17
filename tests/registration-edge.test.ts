import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { authorityPointerKey, ensureReaderAuthorityEdge, readServedPointer } from "../lib/meetings/edge-serving.ts";
import { publishPointers } from "./helpers/edge-pointers.ts";
import type { RegistrationSourceReceipt } from "../lib/registration/acquire.ts";
import { registrationCandidate, type RegistrationReadModel, type ReviewedRegistryIds } from "../lib/registration/candidate.ts";
import { REGISTRATION_SCOPES } from "../lib/registration/edge.ts";
import { REGISTRATION_SOURCE_BYTES, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL, registrationTarget } from "../lib/registration/publication.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { enterReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import type { ReaderAuthorityEdgeBundle } from "../lib/registry/runtime-edge.ts";
import { currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";









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

test("each state's registration is its own compressed artifact at its own pointer, read back losslessly and only when named", async () => {
  assert.equal(REGISTRATION_SCOPES.length, 56);
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reg-edge-")));
  const oh = model("OH");
  const nh = model("NH");
  assert.deepEqual(await publishPointers(store, { registrations: { oh: { value: oh, versionId: "reg-oh-1" }, nh: { value: nh, versionId: "reg-nh-1" } } }),
    ["registrations/oh", "registrations/nh"]);
  assert.equal(await store.readManifest(), null, "registrations write no manifest");
  assert.match((await readServedPointer(store, authorityPointerKey("registrations", "oh")))!.ref.key, /^reader\/artifacts\/[a-f0-9]{64}\.json\.gz$/);

  const edge = (await ensureReaderAuthorityEdge(null, store))!;
  const loaded = await edge.registrations!.load("oh");
  assert.equal(loaded?.versionId, "reg-oh-1");
  assert.deepEqual(loaded?.value, oh, "the reader gets exactly what the runner published");
  assert.equal(await edge.registrations!.load("wy"), null, "a state with no pointer loads nothing");
});

test("an unchanged state writes nothing and a moved state rewrites only its own pointer", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reg-edge-")));
  const oh = model("OH");
  const nh = model("NH");
  await publishPointers(store, { registrations: { oh: { value: oh, versionId: "reg-oh-1" }, nh: { value: nh, versionId: "reg-nh-1" } } });
  const first = await store.readJsonPointer(authorityPointerKey("registrations", "nh"));
  assert.deepEqual(await publishPointers(store, { registrations: { oh: { value: oh, versionId: "reg-oh-1" }, nh: { value: nh, versionId: "reg-nh-1" } } }), [],
    "nothing moved: nothing is written");
  assert.deepEqual(await publishPointers(store, { registrations: { oh: { value: oh, versionId: "reg-oh-2" }, nh: { value: nh, versionId: "reg-nh-1" } } }), ["registrations/oh"]);
  assert.deepEqual(await store.readJsonPointer(authorityPointerKey("registrations", "nh")), first, "the unchanged state keeps its pointer");
  assert.equal((await readServedPointer(store, authorityPointerKey("registrations", "oh")))!.ref.version, "reg-oh-2");
});

test("a state published with nothing promoted answers absent from the edge", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reg-edge-")));
  await publishPointers(store, { registrations: { wy: { value: null, versionId: "none" } } });
  const edge = (await ensureReaderAuthorityEdge(null, store))!;
  assert.deepEqual(await edge.registrations!.load("wy"), { value: null, versionId: "none" });
});

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
  const government = oh.governments!.find(row => row.governmentClass === "COUNTY" && row.associations.length)!;
  enterReaderAuthorityEdge(promotedFixtureBundle({ registrations: { load: async state => state === "oh" ? { value: oh, versionId: "reg-oh-1" } : null } }));
  const resolved = await divisionsByOcdIds([government.associations[0].divisionId]);
  const coverage = await coverageAt(39.96, -83.0, 0, resolved);
  assert.equal(coverage.governments?.find(row => row.id === government.id)?.name, government.name);
  assert.equal(oh.bodies.length, 0);
});
