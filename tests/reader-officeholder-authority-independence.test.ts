import assert from "node:assert/strict";
import test from "node:test";
import { incumbentHolderFor } from "../lib/ballot/incumbent-record.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { seatHolderById, seatHoldersForDivision } from "../lib/registry/server.ts";
import { registryTransferImport, syntheticFederalDirectory, syntheticStateLegislators } from "./helpers/promoted-fixtures.ts";
import { GET as representation } from "../app/api/representation/[...division]/route.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

function stateRegistryArtifacts(versionId: string, states: readonly string[], value: RegistryRuntimeReadModel = registryTransferImport().projection.payload) {
  return Object.fromEntries(states.map(state => [state, { versionId: `${versionId}:${state}`, value: { kind: "PROMOTED_POINTERS" as const,
    entries: [provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state), sourceId: "registry-reviewed-bindings",
      versionId: `${versionId}:${state}`, value: registryFixtureForState(state, value) })] } }]));
}


test("a federal person and division remain readable without a registry or candidacy bridge", async () => {
  const value = syntheticFederalDirectory();
  const person = value.roster.officeholders[0];
  const division = value.roster.divisions.find(row => row.officeholderId === person.id)!.ocdId;
  await withReaderAuthorityEdge({ edgeOnly: true, federalDirectory: { value, versionId: "test:federal-only" } }, async () => {
    assert.equal((await seatHolderById(person.id))?.name, person.name);
    assert.equal((await incumbentHolderFor(person.id))?.id, person.id);
    assert.ok((await seatHoldersForDivision(division)).some(holder => holder.id === person.id));
    assert.equal(await incumbentHolderFor("congress:Z999999"), null);
    const response = await representation(new Request(`https://example.test/api/representation/${division}`), {
      params: Promise.resolve({ division: division.split("/") }),
    });
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.holderStatus, "HELD");
    assert.equal(answer.metadataStatus, "HOLDING_UNAVAILABLE");
    assert.equal(answer.label, null);
    assert.ok(answer.holders.some((holder: { id: string }) => holder.id === person.id));
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });
});

test("a state executive remains readable when the federal directory is unavailable", async () => {
  const { projection } = registryTransferImport();
  const executive = projection.payload.statewideExecutives[0];
  const state = executive.stateOcdId.split(":").at(-1)!.toUpperCase();
  const artifacts = stateRegistryArtifacts(projection.versionId, [state]);
  await withReaderAuthorityEdge({ edgeOnly: true, selection: { states: [state], keys: new Set([executive.stateOcdId, executive.holder.id]) }, stateAuthorities: {
    families: new Set(["registry-runtime"] as const),
    load: async (family, selectedState) => family === "registry-runtime" && selectedState === state ? artifacts[state].value : null,
  } }, async () => {
    assert.equal((await seatHolderById(executive.holder.id))?.name, executive.holder.name);
    const holders = await seatHoldersForDivision(executive.stateOcdId);
    assert.ok(holders.some(holder => holder.id === executive.holder.id));
    assert.ok(holders.every(holder => holder.id.startsWith("statewide:")));
    await assert.rejects(() => seatHoldersForDivision("ocd-division/country:us"));
  });
});

test("a direct state person reaches a ballot card without opening the registry bridge", async () => {
  const value = syntheticStateLegislators("US-NJ");
  const person = value.roster.officeholders[0];
  await withReaderAuthorityEdge({ edgeOnly: true, stateLegislators: { load: async jurisdiction => {
    assert.equal(jurisdiction, "US-NJ");
    return { value, versionId: "test:state-only" };
  } } }, async () => {
    assert.equal((await incumbentHolderFor(person.id))?.name, person.name);
    const division = value.roster.divisions.find(row => row.officeholderId === person.id)!.ocdId;
    const response = await representation(new Request(`https://example.test/api/representation/${division}`), {
      params: Promise.resolve({ division: division.split("/") }),
    });
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.holderStatus, "HELD");
    assert.equal(answer.metadataStatus, "HOLDING_UNAVAILABLE");
    assert.deepEqual(answer.rosterGaps, []);
    assert.ok(answer.holders.some((holder: { id: string }) => holder.id === person.id));
  });
});

test("an unavailable division authority remains a failure rather than an empty roster", async () => {
  await withReaderAuthorityEdge({ edgeOnly: true }, async () => {
    await assert.rejects(() => seatHolderById("congress:Z999999"));
    await assert.rejects(() => seatHoldersForDivision("ocd-division/country:us/state:az"));
  });
});
