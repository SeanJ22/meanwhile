import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { heldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-enrichment.ts";
import { governmentBodyAnchors, governmentBodyFacts, HELD_GOVERNMENT_BODIES_SQL, readHeldGovernmentBodies } from "../lib/control-plane/scheduler/providers/held-government-bodies.ts";
import { publishHeldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-publication.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { heldSubjectDb } from "./helpers/held-subject-db.ts";

const AT = "2026-10-20T07:00:00.000Z", NOW = new Date(AT), DIVISION = "ocd-division/country:us/state:az/place:sample";
const OTHER = "ocd-division/country:us/state:az/place:other", GOV = "government:US-AZ:cog:010001", SOURCE = "https://sample.example.gov/";
const body = (id: string, name: string, path: string, division = DIVISION) => ({ id, name, bodyClass: "GOVERNING", ocdId: division,
  homepageUrl: `${SOURCE}${path}`, provenance: { sourceUrl: `${SOURCE}${path}/source`, sourceOrg: "Sample", collectedAt: AT } });
const heldBodies = [body("held:council", "City Council", "council"), body("held:foreign", "Foreign Council", "foreign", OTHER),
  body("held:shared-one", "Budget Board", "shared"), body("held:shared-two", "Audit Board", "shared"),
  body("held:ambiguous-one", "Planning Commission", "planning-one"), body("held:ambiguous-two", "Planning Commission", "planning-two"),
  body("held:duplicate-id", "Water Board", "water"), body("held:duplicate-id", "Unrelated Board", "unrelated"),
  body("held:fragment", "Appeals Board", "government#appeals")];
const runtime = { registry: { generatedAt: AT, divisions: [{ ocdId: DIVISION, label: "Sample" }], bodies: heldBodies },
  bodyRosters: [], statewideExecutives: [], officialCandidacies: { rows: [] } } as unknown as RegistryRuntimeReadModel;
const heldGovernment = { id: GOV, name: "City of Sample", stateCode: "AZ", ownWebAddress: SOURCE, ocdId: DIVISION,
  govClass: "CITY_OR_TOWN" as const, checkedAt: AT };
const subject = heldSubjectDetails(runtime, "AZ", AT, [heldGovernment]).find(row => row.subjectId === GOV)!;
const capture = (html: string): WorkerPublicationCapture => ({ httpStatus: 200, transport: "REACHABLE", partial: false, observedAt: AT,
  evidence: { artifactId: `fixture:${createHash("sha256").update(html).digest("hex")}`, contentHash: `sha256-${createHash("sha256").update(html).digest("hex")}`,
    text: html, canonicalUrl: SOURCE, retrievedAt: AT, sourceId: "sample.example.gov", methodRouteId: "held-subject-details", acquiredByAttemptId: "fixture-read" } });
const page = `<main><h1>City of Sample</h1><p>Office phone: 520-555-0100</p><h2>Boards and commissions</h2>
  <a href="/council">City <span>Council</span></a><a href="/foreign">Foreign Council</a><a href="/shared">Budget Board</a>
  <a href="/planning-one">Planning Commission</a><a href="/not-held">New Board</a></main>`;

test("one held government's own saved body link publishes an exact association and keeps its absent reader edge explicit", async () => {
  const db = await heldSubjectDb();
  try {
    await db.saveRegistry("AZ", runtime);
    assert.deepEqual(subject.governmentDivisionIds, [DIVISION]);
    assert.ok(subject.divisionIds.includes("ocd-division/country:us/state:az"), "the ordinary state queue scope still exists separately");
    const anchors = governmentBodyAnchors(subject, capture(page));
    const requests: unknown[][] = [];
    const identities = await readHeldGovernmentBodies(async (sql, params = []) => {
      assert.equal(sql, HELD_GOVERNMENT_BODIES_SQL); requests.push([...params]); return db.query(sql, params);
    }, subject, anchors);
    assert.deepEqual(identities, [{ bodyId: "held:council", name: "City Council", url: `${SOURCE}council`, divisionId: DIVISION }]);
    assert.deepEqual(Object.keys(identities[0]!).sort(), ["bodyId", "divisionId", "name", "url"]);
    assert.equal(requests[0]![0], "AZ"); assert.equal(requests[0]![1], DIVISION);
    assert.deepEqual(Object.keys(JSON.parse(String(requests[0]![2]))[0]).sort(), ["name", "url"], "no raw page or whole registry goes to the lookup");
    const report = await publishHeldSubjectDetails({ subject, capture: capture(page), db, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
    assert.equal(report.refused, null);
    assert.deepEqual(report.facts.filter(fact => fact.field.startsWith("body:")).map(fact => fact.field), ["body:held:council"]);
    assert.equal((await db.query("SELECT count(*)::int n FROM entity WHERE kind='body'"))[0]!.n, 0, "no body is invented or registered");
    const rows = await db.query(`SELECT f.entity_id,f.field,f.value,f.quote,s.url FROM fact f
      JOIN source_copy s ON s.id=f.source_copy_id WHERE f.field LIKE 'body:%' AND f.status='live'`);
    assert.equal(rows.length, 1); assert.equal(rows[0]!.quote, "City Council");
    assert.equal(rows[0]!.entity_id, GOV); assert.equal(rows[0]!.url, SOURCE);
    assert.equal(report.readerSupportedNewFacts, 0);
    assert.ok(report.readerDependencies.some(row => row.field === "body:held:council" && row.ownerChange.includes("lib/registry/server.ts")));
    assert.ok(subject.checklistIds.includes("GOV-11"), "one source-bound body edge does not claim a complete government inventory");
  } finally { await db.pg.close(); }
});

test("wrong names, shared URLs, foreign scope and ambiguous government jurisdiction stay open without withholding contacts", async () => {
  const db = await heldSubjectDb();
  try {
    await db.saveRegistry("AZ", runtime);
    const wrong = page.replace('City <span>Council</span>', 'Parks Commission');
    const report = await publishHeldSubjectDetails({ subject, capture: capture(wrong), db, clocks: factClocks(null), now: NOW, purge: async () => ({ purged: true }) });
    assert.equal(report.facts.some(fact => fact.field.startsWith("body:")), false);
    assert.ok(report.facts.some(fact => fact.field === "office_phone" && "decision" in fact.outcome && fact.outcome.decision === "PUBLISH"));
    const cannotQuery = async () => { throw Error("SCOPE_MUST_REFUSE_BEFORE_QUERY"); };
    for (const held of [{ ...subject, governmentDivisionIds: undefined }, { ...subject, governmentDivisionIds: [DIVISION, OTHER] },
      { ...subject, governmentDivisionIds: ["ocd-division/country:us/state:az"] }]) {
      assert.deepEqual(await readHeldGovernmentBodies(cannotQuery, held, [{ name: "City Council", url: `${SOURCE}council`, quote: "City Council" }]), []);
      assert.deepEqual(governmentBodyAnchors(held, capture(page)), []);
    }
    assert.deepEqual(governmentBodyAnchors(subject, capture(page.replace("City of Sample", "City of Other"))), []);
    const altered = { ...capture(page), evidence: { ...capture(page).evidence, canonicalUrl: "https://other.example.gov/" } };
    assert.deepEqual(governmentBodyFacts(subject, altered, [{ bodyId: "held:council", name: "City Council", url: `${SOURCE}council`, divisionId: DIVISION }]), []);
    assert.deepEqual(await readHeldGovernmentBodies(db.query, subject, [{ name: "Water Board", url: `${SOURCE}water`, quote: "Water Board" }]), [],
      "a duplicate held ID remains ambiguous even when its other row has a different URL and name");
    assert.equal((await readHeldGovernmentBodies(db.query, subject, governmentBodyAnchors(subject,
      capture('<main><h1>City of Sample</h1><a href="/government#appeals">Appeals Board</a></main>'))))[0]!.bodyId, "held:fragment",
      "an exact registered section URL is an independently checkable body identity");
  } finally { await db.pg.close(); }
});
