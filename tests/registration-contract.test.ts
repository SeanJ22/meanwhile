import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { isSourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { SOURCE_AUTHORITIES } from "../lib/civic-data/source-authority.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { acquireRegistrationSource, type RegistrationSourceReceipt } from "../lib/registration/acquire.ts";
import { escapedJsonBytes, registrationCandidate, type RegistrationReadModel, type ReviewedRegistryIds } from "../lib/registration/candidate.ts";
import {
  REGISTRATION_MAX_CANDIDATE_BYTES,
  REGISTRATION_SOURCE_BYTES,
  REGISTRATION_SOURCE_SHA256,
  REGISTRATION_SOURCE_URL,
  REGISTRATION_TARGETS,
  registrationTarget,
} from "../lib/registration/publication.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";

/**
 * **EVERY STATE REGISTERS FROM DATA, THROUGH THE ONE DOOR, AND NEVER OVER THE
 * REVIEWED REGISTRY.** (2026-09-23; `lib/registration/`.)
 *
 * Sean's direction: every state trackable without a code change, kept current
 * by the runner. These pin that there is one registration contract per state
 * in the FIPS table; that a state's candidate promotes through the ordinary
 * engine and reads back through its typed reader; that an unchanged month
 * promotes UNCHANGED; that no id the reviewed registry writes is ever written
 * here; and that anything but the pinned Census bytes is refused by name.
 */

const ROOT = join(import.meta.dirname, "..");
const RECEIPT: RegistrationSourceReceipt = {
  requestedUrl: REGISTRATION_SOURCE_URL,
  finalUrl: REGISTRATION_SOURCE_URL,
  httpStatus: 200,
  // Anchored to the real clock: the engine refuses an event dated in the future.
  retrievedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  sha256: REGISTRATION_SOURCE_SHA256,
  bytes: REGISTRATION_SOURCE_BYTES,
};

/** The reviewed registry's ids, from its committed first seed (the promoted projection's shape). */
function reviewedFromFirstSeed(): ReviewedRegistryIds {
  const registry = JSON.parse(readFileSync(join(ROOT, "lib", "registry", "registry.json"), "utf8")) as {
    divisions: { ocdId: string }[];
    bodies: { id: string; ocdId: string | null }[];
  };
  return {
    versionId: "cv-reviewed-first-seed",
    divisionIds: new Set(registry.divisions.map((d) => d.ocdId)),
    bodyIds: new Set(registry.bodies.map((b) => b.id)),
    bodyDivisionIds: new Set(registry.bodies.map((b) => b.ocdId).filter((id): id is string => typeof id === "string")),
  };
}

test("one registration contract per state, DC and territory in the FIPS table, each its own scope, command and state", () => {
  const contracts = ROUTINE_SOURCE_CONTRACTS.filter((c) => c.recordClass === "REGISTRATION");
  assert.equal(contracts.length, 56);
  assert.deepEqual(contracts.map((c) => c.id), REGISTRATION_TARGETS.map((t) => t.contractId));
  assert.equal(new Set(contracts.map((c) => c.scope)).size, 56);
  assert.equal(new Set(contracts.map((c) => c.acquisitionAdapter.command.join(" "))).size, 56, "the firewall's full command lines are unique");
  assert.equal(new Set(contracts.map((c) => c.acquisitionFailureDomain)).size, 1, "one Census download at a time: the runner takes one state per pass");
  for (const c of contracts) {
    assert.equal(c.acquisitionAdapter.authorityMode, "SINGLE_ROUTE");
    assert.equal(c.acquisitionAdapter.requestedUrl, REGISTRATION_SOURCE_URL);
    assert.equal(c.cadence.defaultEveryMs, 30 * 24 * 60 * 60 * 1000);
    assert.ok(c.readerProjection?.consumers.includes("lib/registration/reader.ts"));
  }
  assert.ok(existsSync(join(ROOT, "scripts", "registration-refresh.mts")));
  const authority = SOURCE_AUTHORITIES["census-governments-registration"];
  assert.deepEqual([...authority.jurisdictions].sort(), REGISTRATION_TARGETS.map((t) => t.jurisdiction).sort(), "every state's jurisdiction is inside the authority");
  assert.equal(authority.routineAutoPromotion, true);
  assert.deepEqual([...authority.allowedFinalHosts], ["www2.census.gov"]);
  const index = JSON.parse(readFileSync(join(ROOT, "data", "derived", "registration", "index.json"), "utf8")) as { states: Record<string, unknown> };
  assert.deepEqual(Object.keys(index.states).sort(), REGISTRATION_TARGETS.map((t) => t.state.toLowerCase()).sort(), "the reference carries exactly the FIPS table's states");
});

test("a state's registration promotes through the engine, reads back through its typed reader, and an unchanged month promotes UNCHANGED", async () => {
  const target = registrationTarget("NH");
  const reviewed = reviewedFromFirstSeed();
  const reference = loadRegistrationReference(ROOT, "NH");
  const store = new MemoryRoutineDataStore();

  const first = registrationCandidate({ target, reference, receipt: RECEIPT, reviewed });
  assert.deepEqual(first.semantics.violations, []);
  const promoted = await processRegisteredRoutineCandidate(store, target.contractId, first, RECEIPT.retrievedAt);
  assert.equal(promoted.promoted?.versionId, first.id, `NH promoted: ${promoted.candidate.failureCode ?? ""} ${promoted.candidate.failureDetail ?? ""}`);
  const read = await readRegistrationProjection("NH", { store, now: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.versionId, first.id);
  const model = read.value as RegistrationReadModel;
  assert.ok(model.bodies.length > 0 && model.divisions.length > 0);

  const later = { ...RECEIPT, retrievedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
  const second = registrationCandidate({ target, reference, receipt: later, reviewed });
  const again = await processRegisteredRoutineCandidate(store, target.contractId, second, later.retrievedAt);
  assert.equal(again.promoted?.versionId, second.id);
  assert.equal(again.candidate.candidate.changeSet?.outcome, "UNCHANGED", "the same Census bytes, reference and reviewed registry change nothing");
});

test("reviewed wins: no id the reviewed registry writes is written, and a government it keys on its other division gets no second body", () => {
  const reviewed = reviewedFromFirstSeed();
  for (const state of ["NH", "NJ", "AZ"]) {
    const candidate = registrationCandidate({ target: registrationTarget(state), reference: loadRegistrationReference(ROOT, state), receipt: RECEIPT, reviewed });
    const model = candidate.readModel as RegistrationReadModel;
    assert.ok(model.bodies.every((b) => !reviewed.bodyIds.has(b.id)), `${state}: no reviewed body id`);
    assert.ok(model.divisions.every((d) => !reviewed.divisionIds.has(d.ocdId)), `${state}: no reviewed division id`);
    assert.ok(model.bodies.every((b) => !reviewed.bodyDivisionIds.has(b.ocdId)), `${state}: no second body on a division the reviewed registry already keys`);
    assert.equal(model.reviewedRegistryVersionId, "cv-reviewed-first-seed");
  }
  // Concord's council is reviewed on its place; its county subdivision gets no second council.
  const nh = registrationCandidate({ target: registrationTarget("NH"), reference: loadRegistrationReference(ROOT, "NH"), receipt: RECEIPT, reviewed }).readModel as RegistrationReadModel;
  assert.equal(nh.bodies.some((b) => b.id === "ocd-division/country:us/state:nh/county:merrimack/place:concord_city#governing"), false);
  // Outside the reviewed states, the Census government gets its body with its Census and jurisdiction ids.
  const oh = registrationCandidate({ target: registrationTarget("OH"), reference: loadRegistrationReference(ROOT, "OH"), receipt: RECEIPT, reviewed }).readModel as RegistrationReadModel;
  const columbus = oh.bodies.find((b) => b.id === "ocd-division/country:us/state:oh/place:columbus#governing");
  assert.equal(columbus?.censusId, "209050");
  assert.equal(columbus?.jurisdictionId, "oh:city:city-of-columbus");
  assert.equal(oh.bodies.find((b) => b.id === "ocd-division/country:us/state:oh/school_district:columbus_city_school_district#board")?.censusUnitType, "SCHOOL DISTRICT");
  assert.ok(oh.bodies.every((b) => b.provenance.collectedAt === oh.bodies[0].provenance.collectedAt), "records carry the reference's build date, never the run's clock");
});

test("the largest state stays well inside the response bound, and a state with no government is a named violation", () => {
  const reviewed = reviewedFromFirstSeed();
  const il = registrationCandidate({ target: registrationTarget("IL"), reference: loadRegistrationReference(ROOT, "IL"), receipt: RECEIPT, reviewed });
  const bytes = escapedJsonBytes(il) + escapedJsonBytes({ divisions: (il.readModel as RegistrationReadModel).divisions, bodies: (il.readModel as RegistrationReadModel).bodies });
  assert.ok(bytes < REGISTRATION_MAX_CANDIDATE_BYTES / 2, `Illinois measures ${bytes} escaped bytes`);
  assert.deepEqual(il.semantics.violations, []);

  const empty = loadRegistrationReference(ROOT, "NH");
  const hollow = registrationCandidate({
    target: registrationTarget("NH"),
    reference: { ...empty, reference: { ...empty.reference, governments: empty.reference.governments.filter((g) => g[3] === "STATE") } },
    receipt: RECEIPT,
    reviewed,
  });
  assert.match(hollow.semantics.violations.join(" "), /lists no government in NH: a failed extraction/);
});

test("only the pinned Census bytes from census.gov over HTTPS are accepted; anything else is refused by name", async () => {
  const signal = new AbortController().signal;
  const serve = (body: Uint8Array, init: { status?: number; url?: string } = {}): typeof fetch =>
    (async () => {
      const response = new Response(body, { status: init.status ?? 200, headers: { "content-length": String(body.byteLength) } });
      Object.defineProperty(response, "url", { value: init.url ?? REGISTRATION_SOURCE_URL });
      return response;
    }) as typeof fetch;
  const refusal = async (fetchImpl: typeof fetch) => {
    try {
      await acquireRegistrationSource({ signal, fetchImpl });
    } catch (error) {
      assert.ok(isSourceAcquisitionFailure(error), String(error));
      return (error as { code: string }).code;
    }
    return "ACCEPTED";
  };
  assert.equal(await refusal(serve(new Uint8Array(REGISTRATION_SOURCE_BYTES))), "PUBLISHER_DOCUMENT_INVALID", "the right size with the wrong bytes is a different file");
  assert.equal(await refusal(serve(new Uint8Array(1024))), "PUBLISHER_DOCUMENT_INVALID");
  assert.equal(await refusal(serve(new Uint8Array(1024), { url: "https://example.org/govt_units_2022.ZIP" })), "PUBLISHER_RESPONSE_REFUSED");
  assert.equal(await refusal(serve(new Uint8Array(1024), { status: 503 })), "PUBLISHER_RESPONSE_REFUSED");
});
