/**
 * A state's registry read from its registration: every government the committed reference names, with the
 * body the promoted registration minted and, only where the Census of Governments records one, the
 * government's own web address. Every refusal is named.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  clearRegistrationJurisdictionRegistries,
  installRegistrationJurisdictionRegistries,
  requiredJurisdictionRegistry,
} from "../lib/civic-data/operational-references.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { buildTerritoryIndex } from "../lib/control-plane/expansion/membership.ts";
import { readTerritoryIndex } from "../lib/control-plane/expansion/runner-load.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { OWNER_DISPATCH, type FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { jurisdictionRequirements } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { dispatchedAddressSource, meetingsDiscoveryNeedFor } from "../lib/control-plane/scheduler/providers/meetings-discovery.ts";
import { registrySourceOf, type JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import { registrationCandidate, type RegistrationReadModel } from "../lib/registration/candidate.ts";
import {
  loadRegistrationJurisdictions,
  preloadRegistrationJurisdictions,
  readCensusGovernmentFacts,
  registrationJurisdictionRegistry,
  stateOfJurisdictionId,
} from "../lib/registration/jurisdictions.ts";
import { REGISTRATION_SOURCE_BYTES, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL, registrationTarget } from "../lib/registration/publication.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { reviewedIds } from "./helpers/expansion-fixtures.ts";

const ROOT = join(import.meta.dirname, "..");
const T = "2026-09-23T12:00:00.000Z";

const NOT_RECORDED = async () => ({ kind: "NOT_RECORDED" as const, value: null, metadata: {} as never, detail: "no pointer" });

/** One state's registration, promoted through its own routine door into a memory store. */
async function promoted(state: string, store = new MemoryRoutineDataStore()): Promise<{ versionId: string; model: RegistrationReadModel; store: MemoryRoutineDataStore }> {
  const candidate = registrationCandidate({
    target: registrationTarget(state),
    reference: loadRegistrationReference(ROOT, state),
    receipt: { requestedUrl: REGISTRATION_SOURCE_URL, finalUrl: REGISTRATION_SOURCE_URL, httpStatus: 200, retrievedAt: T, sha256: REGISTRATION_SOURCE_SHA256, bytes: REGISTRATION_SOURCE_BYTES, confirmedBy: "BYTES_HASHED" },
    reviewed: reviewedIds(ROOT),
  });
  assert.equal((await processRegisteredRoutineCandidate(store, `registration-${state.toLowerCase()}`, candidate, T)).candidate.state, "PROMOTED");
  const read = await readRegistrationProjection(state, { store, bypassCache: true, now: T });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("unreachable");
  return { versionId: read.metadata.versionId!, model: read.value, store };
}
const promotedOhio = () => promoted("OH");

test("Ohio's registration, read as a registry: every government under the reviewed ids, its body, and only the Census's own web address", async () => {
  const { versionId, model } = await promotedOhio();
  const reference = loadRegistrationReference(ROOT, "OH");
  const census = readCensusGovernmentFacts(ROOT, ["OH"]);
  assert.ok(census.byPid.size > 0);
  const azCensus = readCensusGovernmentFacts(ROOT, ["AZ"]);
  assert.ok([...census.byPid.keys()].every(id => !azCensus.byPid.has(id)), "state facts never carry another state's governments");
  const oh = registrationJurisdictionRegistry({ reference, promoted: { versionId, model }, census });
  assert.equal(registrySourceOf(oh), "REGISTRATION");
  assert.deepEqual(oh.registration, { kind: "REGISTRATION", versionId, referenceSha256: reference.sha256, webAddresses: oh.registration!.webAddresses });
  assert.equal(oh.jurisdictions.length, reference.reference.governments.length, "every government the reference names, the state itself included");
  assert.equal(Object.values(oh.counts).reduce((a, b) => a + b, 0), oh.jurisdictions.length);

  const columbus = oh.jurisdictions.find((j) => j.id === "oh:city:city-of-columbus")!;
  assert.deepEqual(
    { name: columbus.name, govClass: columbus.govClass, site: columbus.ownWebAddress, ocdId: columbus.ocdId, bodyId: columbus.bodyId, division: columbus.censusDivision, county: columbus.countyName },
    {
      name: "CITY OF COLUMBUS", govClass: "CITY_OR_TOWN", site: "http://www.columbus.gov/",
      ocdId: "ocd-division/country:us/state:oh/place:columbus", bodyId: "ocd-division/country:us/state:oh/place:columbus#governing",
      division: "place:3918000", county: "FRANKLIN",
    },
  );
  assert.equal(columbus.bodyId, model.bodies.find((b) => b.jurisdictionId === columbus.id)?.id, "the body is the promoted version's own");

  const columbusBody = model.bodies.find(b => b.jurisdictionId === columbus.id)!;
  const readBodies = (bodies: RegistrationReadModel["bodies"]) => registrationJurisdictionRegistry({
    reference, promoted: { versionId, model: { ...model, bodies } }, census: readCensusGovernmentFacts(ROOT, ["OH"]),
  }).jurisdictions.find(j => j.id === columbus.id)!;
  assert.equal(readBodies(model.bodies.filter(b => b.id !== columbusBody.id)).bodyId, null,
    "an exact reference pairing alone never invents a body absent from the promoted holding");
  assert.equal(readBodies(model.bodies.map(b => b.id === columbusBody.id ? { ...b, jurisdictionId: null } : b)).bodyId, columbusBody.id,
    "the exact sourced division joins a held body even when another government claimed its jurisdiction key");
  const government = reference.reference.governments.find(row => row[1] === columbus.id)!;
  const alternateDivision = reference.reference.divisions[government[6]][0];
  const alternateBody = { ...columbusBody, id: alternateDivision + "#governing", ocdId: alternateDivision, jurisdictionId: null };
  assert.equal(readBodies([...model.bodies.filter(b => b.id !== columbusBody.id), alternateBody]).bodyId, alternateBody.id,
    "the reference's exact alternate resolves the promoted body's own identity");
  assert.equal(readBodies([...model.bodies, alternateBody]).bodyId, null,
    "two distinct promoted primary/alternate bodies remain ambiguous");

  /* What each government owes: its meetings, and nothing invented. */
  assert.deepEqual(jurisdictionRequirements(oh, columbus), [], "no statute routing is read for Ohio, so no campaign-finance, ballot or roster route exists");
  assert.equal(meetingsDiscoveryNeedFor(oh, columbus.id)?.basis, "SOURCE_DISCOVERY_OWED");
  const siteless = oh.jurisdictions.find((j) => j.govClass !== "STATE" && j.ownWebAddress === null)!;
  assert.deepEqual(siteless.sourceIds, []);
  assert.equal(meetingsDiscoveryNeedFor(oh, siteless.id)?.basis, "NO_MEETINGS_SOURCE_RECORDED", "no address recorded: finding the site is the first step");
  const withSite = oh.jurisdictions.filter((j) => j.ownWebAddress !== null).length;
  assert.ok(withSite > 1000 && withSite < oh.jurisdictions.length, `${withSite} rows carry the Census's recorded address`);
  assert.deepEqual(dispatchedAddressSource(oh, "cv-reviewed-ref"), { source: "REGISTRATION", versionId });

  /* A special district registration pairs with no division carries no body, and is unplaced by that name. */
  const special = oh.jurisdictions.find((j) => j.govClass === "SPECIAL_DISTRICT")!;
  assert.equal(special.ocdId, null);
  assert.equal(special.bodyId, null);
  const index = buildTerritoryIndex([oh], [], () => undefined, () => undefined);
  assert.match(index.unplaced.get(special.id) ?? "", /registration pairs it with no Census division/);
});

test("only the promoted version is read: one built from another reference, none at all, or an outage refuses the state by name", async () => {
  const { versionId, model } = await promotedOhio();
  const reference = loadRegistrationReference(ROOT, "OH");
  const census = readCensusGovernmentFacts(ROOT, ["OH"]);
  assert.throws(
    () => registrationJurisdictionRegistry({ reference, promoted: { versionId, model: { ...model, vintage: { ...model.vintage, referenceSha256: "0".repeat(64) } } }, census }),
    /REGISTRATION_REFERENCE_MISMATCH:OH/,
  );
  const load = await loadRegistrationJurisdictions({ root: ROOT, states: ["OH", "zz"], read: NOT_RECORDED });
  assert.match(load.refused.get("zz") ?? "", /REGISTRATION_STATE_UNKNOWN/);
  assert.equal(load.registries.size, 0, "the committed reference is never read in a promoted version's place");
  assert.match(load.refused.get("oh") ?? "", /REGISTRATION_NOT_PROMOTED:OH: its registration has no promoted version yet/);
  const unreachable = await loadRegistrationJurisdictions({
    root: ROOT, states: ["oh"], read: async () => ({ kind: "STORE_UNREACHABLE", value: null, metadata: {} as never, code: "STORE_READ_FAILED", detail: "timeout" }),
  });
  assert.match(unreachable.refused.get("oh") ?? "", /REGISTRATION_NOT_READ:OH: STORE_UNREACHABLE: timeout/, "an outage is refused, never read around");
});

test("Puerto Rico: every municipio is registered from TIGER functional status, with no web address recorded and none invented", async () => {
  const { store } = await promoted("PR");
  const load = await loadRegistrationJurisdictions({ root: ROOT, states: ["pr"], read: (state) => readRegistrationProjection(state, { store, bypassCache: true, now: T }) });
  assert.deepEqual([...load.refused], []);
  const pr = load.registries.get("pr")!;
  const municipios = pr.jurisdictions.filter((j) => j.govClass === "COUNTY");
  assert.equal(municipios.length, 78);
  assert.ok(pr.jurisdictions.every((j) => j.ownWebAddress === null && j.sourceIds.length === 0));
  const adjuntas = pr.jurisdictions.find((j) => j.id === "pr:county:adjuntas-municipio")!;
  assert.deepEqual([adjuntas.censusId, adjuntas.censusDivision, adjuntas.enumeratedFrom], ["county:72001", "county:72001", "tiger-line-2023-functional-status"]);
  assert.equal(meetingsDiscoveryNeedFor(pr, adjuntas.id)?.basis, "NO_MEETINGS_SOURCE_RECORDED");
  assert.deepEqual(pr.sourceCatalog, {});
  /* The Census of Governments has no territory units: each municipio is placed by its own division's sampled share. */
  const index = readTerritoryIndex(ROOT, [pr]);
  assert.ok((index.bySubject.get(adjuntas.id)?.zctas.size ?? 0) > 0, "Adjuntas has ZCTA territory");
  assert.equal(index.unjoinedUnitsByState?.get("PR"), undefined);
});

test("a state is readable through the one accessor only once its registration is installed", async () => {
  clearRegistrationJurisdictionRegistries();
  assert.throws(() => requiredJurisdictionRegistry("oh"), /JURISDICTION_REGISTRY_NOT_READ:oh/);

  const { store } = await promotedOhio();
  const first = await preloadRegistrationJurisdictions({ root: ROOT, states: ["OH", "oh"], options: { store, bypassCache: true, now: T } });
  assert.deepEqual([...first.registries.keys()], ["oh"]);
  assert.equal(requiredJurisdictionRegistry("OH").stateCode, "OH");
  assert.equal((await preloadRegistrationJurisdictions({ root: ROOT, states: ["oh"], options: { store } })).registries.size, 0, "a state already read is not read again");

  installRegistrationJurisdictionRegistries(new Map(), new Map([["tx", "REGISTRATION_NOT_READ:TX: STORE_UNREACHABLE"]]));
  assert.throws(() => requiredJurisdictionRegistry("tx"), /REGISTRATION_NOT_READ:tx: REGISTRATION_NOT_READ:TX/);
  clearRegistrationJurisdictionRegistries();

  assert.equal(stateOfJurisdictionId("freshness:meetings-discovery:oh:city:city-of-columbus#own-site-meetings"), "oh");
  assert.equal(stateOfJurisdictionId("freshness:jurisdiction:pr:county:adjuntas-municipio#x"), "pr");
  assert.equal(stateOfJurisdictionId("freshness:campaign-finance:az-sos"), null);
});

test("a registration pass keeps which registry the owner's dispatch materialized a row from", async () => {
  const repos = createMemoryRepositories();
  const row: FreshnessObligation = {
    id: "freshness:meetings-discovery:oh:city:city-of-columbus#own-site-meetings", recordClass: "meetings-discovery", subjectId: "oh:city:city-of-columbus",
    routeId: "own-site-meetings", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null,
    materializedBy: OWNER_DISPATCH, materializedFrom: "REGISTRATION",
  };
  await syncObligations(repos, [row], T);
  /* The provider re-emits the row without the marks; a changed signal rewrites it. */
  const { materializedBy: _by, materializedFrom: _from, ...plain } = row;
  await syncObligations(repos, [{ ...plain, observedChangeRateHours: 48 }], "2026-09-23T13:00:00.000Z");
  const held = await repos.obligations.read(row.id);
  assert.equal(held?.value.observedChangeRateHours, 48, "the signal moved");
  assert.equal(held?.value.materializedBy, OWNER_DISPATCH);
  assert.equal(held?.value.materializedFrom, "REGISTRATION", "and the label stayed");
});
