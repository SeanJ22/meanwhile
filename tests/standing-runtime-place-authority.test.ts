import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { beginAttemptFor, claimRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import { writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { methodVersionEntry } from "./method-store-fixture.ts";
import type { GeneralizedCivicExtractionContract } from "../lib/control-plane/workers/types.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import { clearOperationalReferenceBundle, installedOperationalReferenceStateCodes, JURISDICTION_REFERENCE_SCOPE,
  JURISDICTION_REFERENCE_VERSION, requiredOperationalJurisdictionRegistry } from "../lib/civic-data/operational-references.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { installPromotedValue } from "./helpers/promoted-fixtures.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";
import { PUBLISHED_ARRAY_SLICE_SQL } from "../lib/civic-data/published-array-slice.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { venueResolutionScope } from "../lib/meetings/venue-projection.ts";

const AT = "2026-10-20T10:00:00.000Z";
function registry(state: string): JurisdictionRegistry {
  return { formatVersion: 1, stateCode: state.toUpperCase(), generatedBy: "recorded-test", generatedOn: "2026-10-20", _note: [], disagreements: [],
    counts: { COUNTY: 2 }, enumerationSources: [{ id: "enumeration", describe: "Recorded counties", path: "https://census.gov/units", rowsRead: 2 }],
    sourceCatalog: Object.fromEntries(["own", "unrelated"].map(name => [name, { recordClass: "OFFICEHOLDERS", authority: name, authorityBasis: "Government publisher", scope: "THIS_JURISDICTION",
      routeId: "held-source", url: `https://${name}-${state}.example.gov/records`, state: "ADAPTED", owed: null, citation: "Recorded source" }])),
    jurisdictions: ["own", "unrelated"].map(name => ({ id: state === "az" && name === "own" ? "az:county:county-of-pima" : `${state}:county:${name}`, stateCode: state.toUpperCase(), name, govClass: "COUNTY", countyName: state === "az" && name === "own" ? "PIMA" : name,
      enumeratedFrom: "enumeration", ownWebAddress: `https://${name}-${state}.example.gov/`, sourceIds: [name] })) };
}

test("native tasks hydrate exact place authority and release it within and across states", async t => {
  const root = await mkdtemp(join(tmpdir(), "standing-place-authority-")), pg = new PGlite();
  const priorEnv = process.env.NODE_ENV;
  t.after(async () => { installReaderDatabaseQuery(undefined); clearOperationalReferenceBundle(); if (priorEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: priorEnv });
    await pg.close(); await rm(root, { recursive: true, force: true }); });
  await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
  await insertPublishedSliceFixture(pg, { id: "reviewed-national", recordClass: "OPERATIONAL_REFERENCE", scope: JURISDICTION_REFERENCE_SCOPE, sourceId: "jurisdiction-operational-reference",
    at: AT, sourceVersion: JURISDICTION_REFERENCE_VERSION, readModel: { formatVersion: 1, sourceVersion: JURISDICTION_REFERENCE_VERSION, registries: { az: registry("az"), nh: registry("nh") } } });
  for (const state of ["AZ", "NH"]) installPromotedValue({ recordClass: "CURATED_READER_RECORD", scope: venueResolutionScope(state), sourceId: "reviewed-venue-resolutions",
    versionId: `venues-${state}`, value: { kind: "venue-resolutions", records: [] }, retrievedAt: AT });
  const bodyId = "curated:az/own-board#governing";
  await insertPublishedSliceFixture(pg, { id: "registry-az", recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope("AZ"), sourceId: "registry-runtime",
    at: AT, readModel: { registry: { bodies: [
      { id: bodyId, ocdId: null, bodyClass: "COUNTY_BOARD", homepageUrl: "https://own-az.example.gov/", agendaSourceRef: null, provenance: { sourceUrl: "https://own-az.example.gov/" } },
      { id: "curated:az/unrelated-board#governing", homepageUrl: "https://unrelated-az.example.gov/" },
    ] } } });
  let subjectQueries = 0, bodyQueries = 0;
  installReaderDatabaseQuery(async statements => {
    const results: Record<string, unknown>[][] = [];
    for (const statement of statements) {
      assert.equal(statement.text, PUBLISHED_ARRAY_SLICE_SQL, "native authority reads require the original GOOD publication");
      const path = statement.params[2] as readonly string[];
      if (statement.params[0] === "OPERATIONAL_REFERENCE") {
        if (path.length === 2) {
          assert.deepEqual(installedOperationalReferenceStateCodes(), [], "release the prior place before requesting the next place's header");
          assert.deepEqual(statement.params[10], ["formatVersion", "stateCode", "generatedBy", "generatedOn"], "strip state collections before transfer");
        }
        if (path.at(-1) === "jurisdictions") { subjectQueries++; assert.doesNotMatch(String(statement.params[4]), /unrelated/); }
      } else if (statement.params[0] === "REGISTRY_RUNTIME_BINDING") { bodyQueries++; assert.deepEqual(path, ["registry", "bodies"]); assert.equal(statement.params[4], "^(?:curated:az/own-board#governing)$"); }
      const result = (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows;
      assert.doesNotMatch(JSON.stringify(result), /unrelated/, "neighboring jurisdictions, URLs and bodies never cross the connection");
      results.push(result);
    }
    return results;
  });
  clearOperationalReferenceBundle(); Object.assign(process.env, { NODE_ENV: "production" });
  const repos = createMemoryRepositories(), store = new DurableEvidenceStore(root);
  await writeFieldManual(repos, [methodVersionEntry({ version: 56, updatedOn: "2026-10-20", routes: [] })], AT);
  let ordinal = 0;
  const now = () => new Date(Date.parse(AT) + ++ordinal * 1000).toISOString();
  const runtime = await autonomousStandingRuntime({ root, vaultRoot: root, repos, now });
  t.after(() => runtime.close?.());
  async function held(state: string, subjectId = `${state}:county:own`, canonicalUrl = `https://own-${state}.example.gov/records`) {
    const item = createWorkItem({ project: "freshness", subject: subjectId, obligation: `Own-place records ${canonicalUrl}`, why: "Recorded acquisition", now: now() });
    const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "DOCUMENT_INDEX", subjectId,
      jurisdiction: { country: "us", state, canonicalId: subjectId }, identity: { namespace: "publisher-page", keyFields: ["url"] },
      sourceScope: { sourceId: new URL(canonicalUrl).hostname, publisher: "Own-place government", canonicalUrls: [canonicalUrl], observationArtifactIds: [], routeIds: ["held-source"] },
      methodVersion: 56, requiredFields: ["url"], completenessScope: "Captured government response", expectedSourceDate: null,
      extraction: { format: "JSON_RECORDS", rowsPointer: "", fields: { url: { source: "/url", type: "STRING" } } }, verification: { required: false, authorities: [] } };
    await registerWorkItem(repos, { ...item, autonomousPlan: { version: 1, contract, capability: "meetings", jurisdiction: state.toUpperCase(), sourceRegistryReferences: [], seedUrls: [], sources: [], acquisition: [], auditScope: "CAPTURED_ARTIFACT" } }, now());
    const at = now(), task = createRouteTask({ workItemId: item.id, routeId: "held-source", routeLabel: "Captured response", target: canonicalUrl, inherited: false, now: at });
    await registerRouteTask(repos, task, at);
    const lease = await claimRouteTask(repos, { routeTaskId: task.id, holder: "recorded-worker", now: at, ttlMs: 60000 });
    const attempt = await beginAttemptFor(repos, { routeTaskId: task.id, workItemId: item.id, worker: { role: "ACQUIRER", provider: "fixture", version: "1", instance: "recorded-worker" },
      lease: lease.lease.value, now: at, methodVersion: 56, policyVersion: "fixture/1" });
    const text = JSON.stringify([{ url: canonicalUrl, subjectId }]), { artifact } = recordAcquisition({ canonicalUrl, retrievedAt: at, httpStatus: 200, contentType: "application/json", sourceId: new URL(canonicalUrl).hostname,
      methodRouteId: "held-source", workItemId: item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, text);
    await putArtifact(store, "freshness", artifact, Buffer.from(text));
    await recordArtifactMetadata(repos, { artifactId: artifact.id, workItemId: item.id, routeTaskId: task.id, attemptId: attempt.id, tier: artifact.tier, contentHash: artifact.contentHash,
      byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl, partial: false, recordedAt: at }, at);
    return { task, context: () => runtime.independentContext({ workItemId: item.id, artifactId: artifact.id, contract, auditScope: "CAPTURED_ARTIFACT", methodVersion: 56 }), artifact, text };
  }
  const az = await held("az", "az:county:county-of-pima");
  await assert.rejects(az.context(), /OPERATIONAL_REFERENCE_STATE_NOT_PROMOTED:az/);
  await runtime.beginTask!(az.task);
  assert.deepEqual(installedOperationalReferenceStateCodes(), ["az"]);
  assert.deepEqual(requiredOperationalJurisdictionRegistry("az").jurisdictions.map(row => row.id), ["az:county:county-of-pima"]);
  assert.deepEqual(Object.keys(requiredOperationalJurisdictionRegistry("az").sourceCatalog), ["own"]);
  assert.deepEqual((await az.context()).evidence.map(row => row.text), [az.text]);
  const pimaOcd = "ocd-division/country:us/state:az/county:pima", ocd = await held("az", pimaOcd);
  await runtime.beginTask!(ocd.task);
  assert.deepEqual(requiredOperationalJurisdictionRegistry("az").jurisdictions.map(row => row.id), ["az:county:county-of-pima"], "the county's original reviewed ID and evidence survive its canonical OCD task identity");
  assert.equal((await ocd.context()).subjectId, pimaOcd, "audit ownership remains the original task's OCD subject");
  assert.deepEqual((await ocd.context()).evidence.map(row => row.text), [ocd.text]);
  const foreignPublisher = await held("az", pimaOcd, "https://foreign.example.gov/records");
  await assert.rejects(foreignPublisher.context(), /AUDIT_FIRST_PARTY_PUBLISHER_BINDING_MISSING/, "a valid county alias never admits a different publisher");
  const curated = await held("az", bodyId);
  await runtime.beginTask!(curated.task);
  assert.equal(requiredOperationalJurisdictionRegistry("az").jurisdictions.length, 0, "same-state task change releases the prior county");
  assert.deepEqual((await curated.context()).evidence.map(row => row.artifactId), [curated.artifact.id]);
  const nh = await held("nh");
  await runtime.beginTask!(nh.task);
  assert.deepEqual(installedOperationalReferenceStateCodes(), ["nh"]);
  assert.throws(() => requiredOperationalJurisdictionRegistry("az"), /OPERATIONAL_REFERENCE_STATE_NOT_PROMOTED:az/);
  assert.deepEqual((await nh.context()).evidence.map(row => row.text), [nh.text]);
  assert.equal(subjectQueries, 5); assert.equal(bodyQueries, 2);
  await pg.query("UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{scope}',to_jsonb('another-scope'::text)) WHERE id='reviewed-national'");
  await assert.rejects(runtime.beginTask!(az.task), /OPERATIONAL_REFERENCE_STATE_NOT_PROMOTED:az/, "an invalid canonical publication cannot become an empty task registry");
  assert.deepEqual(installedOperationalReferenceStateCodes(), [], "a failed refresh leaves no prior-place authority installed");
  await runtime.close?.();
  assert.deepEqual(installedOperationalReferenceStateCodes(), []);
});
