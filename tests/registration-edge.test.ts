import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { ensureReaderAuthorityEdge, publishReaderEdgeArtifacts } from "../lib/meetings/edge-serving.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { RegistrationSourceReceipt } from "../lib/registration/acquire.ts";
import { registrationCandidate, type RegistrationReadModel, type ReviewedRegistryIds } from "../lib/registration/candidate.ts";
import { REGISTRATION_SCOPES, registrationEdgePlan } from "../lib/registration/edge.ts";
import { REGISTRATION_SOURCE_BYTES, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL, registrationTarget } from "../lib/registration/publication.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { enterReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { installRegistryAuthority, promotedFixtureBundle } from "./helpers/promoted-fixtures.ts";



const ROOT = join(import.meta.dirname, "..");
const META = { sourceThrough: null, retrievedAt: null, promotedThrough: null };
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

function emptySnapshot(): MeetingsSnapshot {
  return {
    formatVersion: 1,
    generatedAt: "2026-09-24T12:00:00.000Z",
    counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 },
    sources: [],
    meetings: [],
    agendaDocuments: [],
  };
}

function model(state: string): RegistrationReadModel {
  return registrationCandidate({ target: registrationTarget(state), reference: loadRegistrationReference(ROOT, state), receipt: RECEIPT, reviewed: REVIEWED }).readModel as RegistrationReadModel;
}

test("the runner reads a state only when its pointer moved; every other promoted state carries by reference", () => {
  const scopeOf = (state: string) => registrationTarget(state).scope;
  const plan = registrationEdgePlan(
    [
      { scope: scopeOf("OH"), versionId: "reg-oh-2" },
      { scope: scopeOf("NH"), versionId: "reg-nh-1" },
      { scope: scopeOf("WY"), versionId: "reg-wy-1" },
      { scope: "US-AZ:not-registration", versionId: "x" },
    ],
    {
      oh: { key: "reader/v1/registration-oh.json.gz", version: "reg-oh-1", sha: "a" },
      nh: { key: "reader/v1/registration-nh.json.gz", version: "reg-nh-1", sha: "b", layout: "records" },
    },
  );
  assert.deepEqual(plan.carried, { nh: "reg-nh-1" });
  assert.deepEqual(plan.publish, { oh: "reg-oh-2", wy: "reg-wy-1" }, "a moved version and a never-served state are read; another class's scope is ignored");
  assert.equal(REGISTRATION_SCOPES.length, 56);
});

test("each state's registration is its own compressed artifact, read back losslessly and only when named", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reg-edge-")));
  const oh = model("OH");
  const nh = model("NH");
  const published = await publishReaderEdgeArtifacts(emptySnapshot(), META, {
    store,
    registrations: { oh: { value: oh, versionId: "reg-oh-1" }, nh: { value: nh, versionId: "reg-nh-1" } },
  });
  assert.equal(published.status, "PUBLISHED");
  const manifest = (await store.readManifest())!.manifest;
  assert.deepEqual(Object.keys(manifest.registrations ?? {}).sort(), ["nh", "oh"]);
  assert.match(manifest.registrations!.oh.key, /^reader\/artifacts\/[a-f0-9]{64}\.json\.gz$/);

  const edge = await ensureReaderAuthorityEdge(manifest, store);
  assert.deepEqual([...edge.registrations!.states].sort(), ["nh", "oh"]);
  const loaded = await edge.registrations!.load("oh");
  assert.equal(loaded?.versionId, "reg-oh-1");
  assert.deepEqual(loaded?.value, oh, "the reader gets exactly what the runner published");
  assert.equal(await edge.registrations!.load("wy"), null, "a state with no artifact loads nothing");
});

test("unchanged states carry forward, a moved state re-publishes alone, and a stale carry keeps the winning manifest", async () => {
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "reg-edge-")));
  const oh = model("OH");
  const nh = model("NH");
  await publishReaderEdgeArtifacts(emptySnapshot(), META, { store, registrations: { oh: { value: oh, versionId: "reg-oh-1" }, nh: { value: nh, versionId: "reg-nh-1" } } });
  const first = (await store.readManifest())!.manifest;

  const same = await publishReaderEdgeArtifacts(emptySnapshot(), META, {
    store,
    registrations: { oh: { versionId: "reg-oh-1", carried: true }, nh: { versionId: "reg-nh-1", carried: true } },
  });
  assert.equal(same.status, "CURRENT", "nothing moved: nothing is written");

  const moved = await publishReaderEdgeArtifacts(emptySnapshot(), META, {
    store,
    registrations: { oh: { value: oh, versionId: "reg-oh-2" }, nh: { versionId: "reg-nh-1", carried: true } },
  });
  assert.equal(moved.status, "PUBLISHED");
  const second = (await store.readManifest())!.manifest;
  assert.equal(second.registrations!.nh.key, first.registrations!.nh.key, "the unchanged state keeps its artifact");
  assert.notEqual(second.registrations!.oh.key, first.registrations!.oh.key);
  assert.equal(second.registrations!.oh.version, "reg-oh-2");

  const stale = await publishReaderEdgeArtifacts(emptySnapshot(), META, {
    store,
    registrations: { oh: { versionId: "reg-oh-2", carried: true }, nh: { versionId: "reg-nh-9", carried: true } },
  });
  assert.equal(stale.status, "RACED");
  assert.deepEqual((await store.readManifest())!.manifest, second, "a failed carry never removes valid state references");
});

test("the reader composes a state's registration from the edge, and a state the complete section omits costs no read at all", async () => {
  await installRegistryAuthority();
  const { divisionsByOcdIds } = await import("../lib/registry/server.ts");
  const oh = model("OH");
  const county = oh.divisions.find((d) => d.divisionType === "county")!;
  const loads: string[] = [];
  enterReaderAuthorityEdge(promotedFixtureBundle({
    registrations: {
      states: new Set(["oh"]),
      load: async (state) => {
        loads.push(state);
        return state === "oh" ? { value: oh, versionId: "reg-oh-1" } : null;
      },
    },
  }));
  const found = await divisionsByOcdIds([county.ocdId, "ocd-division/country:us/state:wy/county:laramie"]);
  assert.deepEqual(found.map((d) => d.ocdId), [county.ocdId], "Ohio's county composes; Wyoming, absent from the complete section, is dropped");
  assert.deepEqual(loads, ["oh"], "only the named, registered state is fetched");
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
      states: new Set(["dc", "pr"]),
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
  enterReaderAuthorityEdge(promotedFixtureBundle({ registrations: { states: new Set(["oh"]), load: async state => state === "oh" ? { value: oh, versionId: "reg-oh-1" } : null } }));
  const resolved = await divisionsByOcdIds([government.associations[0].divisionId]);
  const coverage = await coverageAt(39.96, -83.0, 0, resolved);
  assert.equal(coverage.governments?.find(row => row.id === government.id)?.name, government.name);
  assert.equal(oh.bodies.length, 0);
});
