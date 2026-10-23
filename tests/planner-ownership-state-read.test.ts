import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { plannerMeetingOwnership } from "../lib/civic-data/planner-ownership-state-read.ts";
import { plannerStateReads } from "../lib/civic-data/planner-state-read.ts";
import { clearOperationalReferenceBundle, clearRegistrationJurisdictionRegistries,
  installRegistrationJurisdictionRegistries, planningJurisdictionRegistries,
  preloadOperationalReferenceState } from "../lib/civic-data/operational-references.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { VALIDATION_CHECKS } from "../lib/civic-data/types.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";

test("planner ownership reuses exact state reads and refuses unproved reviewed pairings", async t => {
  clearOperationalReferenceBundle();
  clearRegistrationJurisdictionRegistries();
  const pg = new PGlite();
  t.after(async () => {
    clearOperationalReferenceBundle();
    clearRegistrationJurisdictionRegistries();
    await pg.close();
  });
  for (const name of ["0025_typical_fixer", "0030_database_transfer_daily", "0031_civic_payload_parts", "0036_ne01"])
    await pg.exec(readFileSync(`lib/db/migrations/${name}.sql`, "utf8"));
  const put = async (recordClass: string, scope: string, version: string, payload: unknown) => {
    const encoded = partitionCivicPayload(payload);
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
    const receipt = { contractVersion: 2, decision: "GOOD", candidateId: version, sourceId: "test", recordClass, scope,
      validatedAt: "2026-10-21T00:00:00Z", excludedFacts: [], checks: VALIDATION_CHECKS.map(check => ({ check, verdict: "PASS", code: "OK", detail: "verified" })) };
    await pg.query(`INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,acquisition_succeeded,retrieved_at,source_through,parser_version,identity,candidate,promoted_version_id,last_known_good_version_id)
      VALUES($1,'test',$2,$3,'PROMOTED',true,now(),'2026','v1','{}','{}',$1,$1)
      ON CONFLICT(id) DO UPDATE SET acquisition_succeeded=true`, [version, recordClass, scope]);
    await pg.query(`INSERT INTO civic_data_promotions VALUES($1,'test',$2,$3,$4,$4,now(),$5,$6)
      ON CONFLICT(key) DO UPDATE SET current_version_id=EXCLUDED.current_version_id,
      last_known_good_version_id=EXCLUDED.last_known_good_version_id,payload=EXCLUDED.payload,validation_receipt=EXCLUDED.validation_receipt`,
      [`${recordClass}:${scope}`, recordClass, scope, version, JSON.stringify(encoded.value), JSON.stringify(receipt)]);
  };
  const registries = JSON.parse(readFileSync("tests/fixtures/jurisdiction-registries.json", "utf8"));
  await put("OPERATIONAL_REFERENCE", "US:covered-jurisdiction-routing:v1", "reviewed", {
    formatVersion: 1, sourceVersion: "census-2022+reviewed-routing-v1", registries,
  });
  const belknap = "nh:county:county-of-belknap";
  const belknapBody = "ocd-division/country:us/state:nh/county:belknap#governing";
  const registered = "nh:city:registered";
  const unpartitioned = "nh:city:unpartitioned";
  const registeredBody = "ocd-division/country:us/state:nh/place:registered#governing";
  const unpartitionedBody = "ocd-division/country:us/state:nh/place:unpartitioned#governing";
  const reference = loadRegistrationReference(process.cwd(), "nh");
  const registration = { formatVersion: 1, state: "NH", scope: "US-NH:registration:v1",
    vintage: { referenceSha256: reference.sha256 }, reviewedRegistryVersionId: "reviewed", divisions: [],
    bodies: [{ id: registeredBody, jurisdictionId: registered, censusId: "1", ocdId: "registered" },
      { id: unpartitionedBody, jurisdictionId: unpartitioned, censusId: "2", ocdId: "unpartitioned" }],
    counts: { governments: 2 } };
  await put("REGISTRATION", registration.scope, "registration", registration);
  await put("REGISTRATION", "US-AZ:registration:v1", "other-registration", {
    ...registration, state: "AZ", scope: "US-AZ:registration:v1",
    bodies: [{ id: "outside#governing", jurisdictionId: "az:city:outside" }],
  });
  const runtime = { registry: { bodies: [{ id: belknapBody }, { id: belknapBody.replace("#governing", "#committee") }] } };
  await put("REGISTRY_RUNTIME_BINDING", "US-NH:reader-registry-runtime", "runtime", runtime);
  await put("REGISTRY_RUNTIME_BINDING", "US-AZ:reader-registry-runtime", "other-runtime", {
    registry: { bodies: [{ id: "outside#governing" }] },
  });
  const wiring = { kind: "meeting-source-wiring", formatVersion: 1, records: [
    { id: "nh-committee", status: "ACTIVE", row: { state: "US-NH", jurisdictionId: belknap, bodyId: belknapBody.replace("#governing", "#committee") } },
    { id: "nh-held", status: "SUSPENDED", row: { state: "US-NH", jurisdictionId: registered, bodyId: registeredBody } },
    { id: "outside", status: "ACTIVE", row: { state: "US-AZ", jurisdictionId: belknap, bodyId: belknapBody } },
  ] };
  await put("CURATED_READER_RECORD", "US:meeting-source-wiring", "wiring", wiring);
  const calls: unknown[][] = [];
  const query: ReadOnlyQuery = async statements => {
    for (const statement of statements) calls.push([...statement.params]);
    return Promise.all(statements.map(async statement => (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows));
  };
  const held = await preloadOperationalReferenceState("nh", query);
  assert.ok(held.registry);
  const registryBodies = () => [...planningJurisdictionRegistries("nh").registries.values()].flatMap(registry => registry.jurisdictions);
  assert.equal(planningJurisdictionRegistries("nh").registries.get("nh"), held.registry,
    "ownership borrows the already installed state registry");
  const makeOwner = (readQuery: ReadOnlyQuery = query) => {
    const reads = plannerStateReads("nh", readQuery);
    return { reads, owner: plannerMeetingOwnership({ root: process.cwd(), reads, registryBodies }) };
  };

  await t.test("registration, reviewed IDs and wiring are read once for the same state", async () => {
    const { reads, owner } = makeOwner();
    const alreadyHeld = await reads.registration("NH");
    await owner.readStates(["NH", "nh"]);
    await owner.readStates(["nh"]);
    assert.equal(await reads.registration("nh"), alreadyHeld);
    assert.equal(calls.filter(params => params[0] === "nh").length, 1, "one RN-01 state read");
    assert.equal(calls.filter(params => params[0] === "REGISTRATION:US-NH:registration:v1").length, 2,
      "one registration header and one identity page, shared with ownership");
    assert.equal(calls.filter(params => params[0] === "REGISTRY_RUNTIME_BINDING:US-NH:reader-registry-runtime").length, 1);
    assert.equal(calls.filter(params => params[0] === "CURATED_READER_RECORD:US:meeting-source-wiring").length, 1);
    assert.equal(owner.bodyIdFor!(belknap), belknapBody, "the omitted reviewed government gets its exact Census body");
    assert.equal(owner.ownerOf(belknap), "NONE", "a committee and an out-of-state route cannot claim its government's clock");
    assert.equal(owner.ownerOf(registered), "PARTITION", "a suspended production partition still owns its exact government");
    assert.equal(owner.ownerOf(unpartitioned), "NONE");
    assert.equal(owner.ownerOf("nh:city:county-of-belknap"), "UNKNOWN", "a matching display-name suffix is not an identity join");
    await owner.readStates(["az"]);
    assert.equal(owner.ownerOf("az:city:outside"), "UNKNOWN");
    assert.equal(owner.bodyIdFor!("az:city:outside"), null);
    assert.match(owner.source, /PLANNER_STATE_BOUNDARY/);
    assert.ok(!calls.some(params => String(params[0]).includes("US-AZ")), "another state's packages never enter this planner");
    const missingReviewed = planningJurisdictionRegistries("az");
    assert.equal(missingReviewed.registries.size, 0);
    assert.match(missingReviewed.refused.get("az")!, /JURISDICTION_REGISTRY_NOT_READ:az/);
    installRegistrationJurisdictionRegistries(new Map(), new Map([["il", "registration refused"]]));
    const refusedRegistration = planningJurisdictionRegistries("il");
    assert.equal(refusedRegistration.registries.size, 0);
    assert.equal(refusedRegistration.refused.get("il"), "registration refused");
    assert.equal(planningJurisdictionRegistries("nh").registries.get("nh"), held.registry);
  });

  await t.test("missing or refused reviewed IDs cannot fabricate a reviewed government pairing", async () => {
    await pg.query("DELETE FROM civic_data_promotions WHERE key=$1", ["REGISTRY_RUNTIME_BINDING:US-NH:reader-registry-runtime"]);
    const absent = makeOwner().owner;
    await absent.readStates(["nh"]);
    assert.equal(absent.ownerOf(belknap), "UNKNOWN");
    assert.equal(absent.bodyIdFor!(belknap), null);
    assert.equal(absent.ownerOf(unpartitioned), "NONE", "direct registered identities remain usable");
    await put("REGISTRY_RUNTIME_BINDING", "US-NH:reader-registry-runtime", "runtime", runtime);
    await pg.exec("UPDATE civic_data_candidates SET acquisition_succeeded=false WHERE id='runtime'");
    const refused = makeOwner().owner;
    await refused.readStates(["nh"]);
    assert.equal(refused.ownerOf(belknap), "UNKNOWN");
    assert.equal(refused.bodyIdFor!(belknap), null);
    await put("REGISTRY_RUNTIME_BINDING", "US-NH:reader-registry-runtime", "runtime", runtime);
  });

  await t.test("a changed Census reference vintage cannot join a reviewed body", async () => {
    await put("REGISTRATION", registration.scope, "registration", { ...registration, vintage: { referenceSha256: "different-vintage" } });
    const owner = makeOwner().owner;
    await owner.readStates(["nh"]);
    assert.equal(owner.ownerOf(belknap), "UNKNOWN");
    assert.equal(owner.bodyIdFor!(belknap), null);
    assert.equal(owner.ownerOf(unpartitioned), "NONE");
    await put("REGISTRATION", registration.scope, "registration", registration);
  });

  await t.test("failed source readings preserve uncertainty instead of inventing an owner", async () => {
    const brokenWiring: ReadOnlyQuery = statements => statements.some(statement => statement.params[0] === "CURATED_READER_RECORD:US:meeting-source-wiring")
      ? Promise.reject(new Error("wiring transport failed")) : query(statements);
    const owner = makeOwner(brokenWiring).owner;
    await owner.readStates(["nh"]);
    assert.equal(owner.bodyIdFor!(belknap), belknapBody);
    assert.equal(owner.ownerOf(belknap), "UNKNOWN");
    assert.equal(owner.ownerOf(unpartitioned), "UNKNOWN");
    assert.match(owner.reasonFor!(belknap), /wiring transport failed/);
    await pg.exec("UPDATE civic_data_candidates SET acquisition_succeeded=false WHERE id='registration'");
    const refused = makeOwner().owner;
    await refused.readStates(["nh"]);
    assert.equal(refused.ownerOf(belknap), "UNKNOWN");
    assert.equal(refused.bodyIdFor!(belknap), null);
    assert.equal(refused.ownerOf(unpartitioned), "UNKNOWN");
    assert.match(refused.source, /PLANNER_PUBLICATION_INVALID/);
  });
});
