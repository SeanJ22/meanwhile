import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FederalMoneySection } from "../components/funding/federal-money-section.tsx";
import { readFederalMoneyPartition } from "../lib/federal-money/verify.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import { joinFederalMoneyFacts } from "../lib/federal-money/join.ts";
import { federalMoneyCounts } from "../lib/federal-money/candidate.ts";
import { readFederalMoneyForPlace } from "../lib/federal-money/reader.ts";
import { federalMoneyRows, federalMoneySources } from "../lib/federal-money/view.ts";
import { composeFederalMoneyAnswer, federalMoneyEvidence, federalMoneyPlaceQuestion, federalMoneyPlaceDivisions } from "../lib/ask/federal-money.ts";
import { lexicalReading } from "../lib/ask/lexical-reading.ts";
import { gateRecordsToSubject } from "../lib/ask/relevance.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
import { publishFederalMoneyPartition, publishFederalMoneyProgress } from "../lib/federal-money/edge-publication.ts";
import { publishReaderEdgeArtifacts } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { GET } from "../app/api/federal-money/route.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { registryTransferImport, syntheticFederalDirectory } from "./helpers/promoted-fixtures.ts";
import { federalMoneyProjectionIssue, federalMoneyLookupKeys, type FederalMoneyProjection } from "../lib/federal-money/model.ts";
import type { FederalMoneyFact } from "../lib/federal-money/model.ts";

const NOW = "2026-10-12T23:01:00.000Z";
const COUNTY = "ocd-division/country:us/state:ar/county:ouachita";
const BODY = `${COUNTY}#governing`;
const BODY_BYTES = readFileSync(new URL("./fixtures/federal-money/openfema-live.json", import.meta.url), "utf8");
const CAPTURE = { url: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=1",
  rawHash: createHash("sha256").update(BODY_BYTES).digest("hex"), vaultKey: "fixture", byteLength: Buffer.byteLength(BODY_BYTES), format: "json" as const,
  retrievedAt: NOW, publicationDate: null };
const records = joinFederalMoneyFacts(parseFederalMoney("openfema", CAPTURE, "AR", BODY_BYTES), {
  divisions: [{ ocdId: COUNTY, geoid: "05103", divisionType: "county" }], governments: [], bodies: [],
});
const value: FederalMoneyProjection = { formatVersion: 2, source: "openfema", state: "AR", partition: { year: "2026", place: COUNTY, shard: "" }, records, lookupKeys: federalMoneyLookupKeys(records), counts: federalMoneyCounts(records) };
async function publish(store: LocalFileArtifactStore) {
  await publishFederalMoneyPartition({ store, projection: value, previous: null, versionId: "fema:reader-test", checkedAt: NOW });
  await publishFederalMoneyProgress({ store, state: "AR", source: "openfema", checkedAt: NOW, complete: true, reason: null });
}

test("real OpenFEMA declaration reaches the county card and Ask with the same date and official source", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-money-card-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactStore = new LocalFileArtifactStore(directory);
  await publish(artifactStore);
  {
    const read = await readFederalMoneyForPlace({ divisionId: COUNTY, bodyId: BODY }, { artifactStore });
    const held = read.sources.find(source => source.source === "openfema")!;
    assert.equal(held.status, "HELD");
    assert.equal(held.records.length, 1);
    const rows = federalMoneyRows(held.records, { divisionId: COUNTY, bodyId: BODY });
    assert.equal(rows[0].relationship, "GEOGRAPHY");
    assert.equal(federalMoneySources(rows)[0].provenance.kind, "OFFICIAL");
    assert.match(federalMoneySources(rows)[0].what, /published 2026-09-15/);
    const markup = renderToStaticMarkup(createElement(FederalMoneySection, { divisionId: COUNTY, bodyId: BODY, data: read }));
    assert.match(markup, /BUNKER FIRE/);
    assert.match(markup, /Public assistance: Yes/i);
    assert.match(markup, /Period: 2026-09-15/);
    assert.equal(read.sources.filter(source => source.status === "NOT_HELD").length, 3);
    const evidence = await federalMoneyEvidence([{ divisionId: COUNTY, bodyId: BODY }], BODY, { artifactStore });
    const subject = { kind: "BODY" as const, id: BODY, name: "Ouachita County" };
    assert.equal(evidence.records.length, 1);
    assert.equal(evidence.records[0].official, true);
    assert.equal(evidence.records[0].publicationDate, "2026-09-15T00:00:00.000Z");
    assert.equal(evidence.records[0].bodyId, undefined, "a county declaration does not claim a payment to its government");
    const relevant = gateRecordsToSubject(subject, evidence.records).records;
    const question = "What disaster declarations cover this county?";
    const composed = composeFederalMoneyAnswer({ subject, question, records: relevant });
    assert.ok(composed);
    assert.match(composed.answer, /BUNKER FIRE/);
    assert.deepEqual(composed.citedUrls, [CAPTURE.url]);
    assert.equal(validateAnswer(composed.answer, composed.citedUrls, { question, subject, records: relevant, gaps: evidence.gaps, denominators: evidence.denominators, intent: "CIVICS", temporal: { kind: "NONE" }, today: NOW.slice(0, 10) }).kind, "PASSED");
  }
});

test("source identity tampering fails the typed reader; unmatched rows remain recorded and counted", async () => {
  const unjoined = { ...value, records: parseFederalMoney("openfema", CAPTURE, "AR", BODY_BYTES), counts: { loaded: 1, joined: 0, unjoined: 1 } };
  assert.equal(federalMoneyProjectionIssue(unjoined, "openfema", "AR"), null);
  assert.ok(federalMoneyProjectionIssue({ ...unjoined, counts: { loaded: 1, joined: 1, unjoined: 0 } }, "openfema", "AR"));
  await assert.rejects(readFederalMoneyPartition("openfema", "openfema:AR:2026:county:root", { edge: provenEdgeEntry({ recordClass: "FEDERAL_MONEY", scope: "openfema:AR:2026:county:root", sourceId: "openfema", versionId: "tampered-state", value: { ...value, state: "AZ" } }) }), /source, state or format/);
  assert.equal(federalMoneyRows(records, { divisionId: "ocd-division/country:us/state:ar/county:pulaski" }).length, 0);
  assert.equal(federalMoneyRows(records, { divisionId: "ocd-division/country:us/state:ar/cd:4" }).length, 0);
  assert.equal(federalMoneyRows(records, { divisionId: `${COUNTY}/place:camden` }).length, 1, "a source-identified county ancestor can carry its county declaration to a nested place");
  assert.equal(federalMoneyRows(records, { divisionId: "ocd-division/country:us/state:ar/place:camden" }).length, 0, "a city name alone supplies no county association");
});

test("federal money readers never open a database when the edge is unavailable", async () => {
  const old = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://do-not-open.invalid/federal-money-test";
  try {
    const read = await readFederalMoneyForPlace({ divisionId: COUNTY }, { artifactStore: null });
    assert.ok(read.sources.every(source => source.status === "UNAVAILABLE"));
  } finally { if (old === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = old; }
});

test("geographic awards never become government receipts; audit and registration recipients stay exact", () => {
  // Synthetic identity rows exercise the selection rule independently of the real source parser above.
  const native = records[0];
  const grant: FederalMoneyFact = { ...native, id: "synthetic:grant", source: "usaspending", kind: "GRANT", title: "Synthetic federal grant", recipient: "Synthetic recipient", amount: 125, amountLabel: "Federal obligation" };
  const countyGrant: FederalMoneyFact = { ...grant, id: "synthetic:recipient-grant", divisionIds: [], bodyIds: [BODY] };
  const otherAudit: FederalMoneyFact = { ...native, id: "synthetic:other-audit", source: "federal-audit-clearinghouse", kind: "AUDIT", title: "Synthetic foreign audit", bodyIds: ["synthetic:other-body"] };
  const ownEntity: FederalMoneyFact = { ...native, id: "synthetic:entity", source: "sam-gov-entities", kind: "ENTITY", title: "Synthetic government registration", bodyIds: [BODY], uei: "TESTUEI12345" };
  const rows = federalMoneyRows([grant, countyGrant, otherAudit, ownEntity], { divisionId: COUNTY, bodyId: BODY });
  assert.equal(rows.length, 3);
  assert.match(rows.find(row => row.fact.id === grant.id)!.text, /Reaching this place/);
  assert.doesNotMatch(rows.find(row => row.fact.id === grant.id)!.text, /Received by this government/);
  assert.match(rows.find(row => row.fact.id === countyGrant.id)!.text, /Received by this government/);
  assert.match(rows.find(row => row.fact.id === ownEntity.id)!.text, /UEI: TESTUEI12345/);
  assert.ok(!rows.some(row => row.fact.id === otherAudit.id));
});

test("named and referential federal questions read directly, and a reader's county question selects only counties", () => {
  const inventory = [{ id: BODY, name: "Ouachita County", nameClass: "body" as const, level: "BODY" as const, ocdId: COUNTY, divisionType: "county" }];
  for (const question of ["What disaster declarations cover Ouachita County?", "What federal grants reach Ouachita County?", "What is the UEI for Ouachita County?"]) {
    const read = lexicalReading({ question, inventory, namedBodies: inventory });
    assert.equal(read?.shape, "GOVERNMENT_MONEY", question);
    assert.equal(read?.subjectId, BODY, question);
  }
  assert.equal(federalMoneyPlaceQuestion("What disaster declarations cover my county?"), true);
  assert.equal(federalMoneyPlaceQuestion("What federal grants are in my city?"), true);
  assert.equal(federalMoneyPlaceQuestion("What federal grants reach an unrelated county?"), false);
  assert.deepEqual(federalMoneyPlaceDivisions("What disaster declarations cover my county?", [COUNTY, "ocd-division/country:us/state:ar/place:camden"]), [COUNTY]);
});

test("the public federal-money route serves the real place artifact on its first request without database access", async () => {
  const directory = mkdtempSync(join(tmpdir(), "federal-money-reader-api-"));
  const previous = process.env.WTP_READER_EDGE_DIR;
  const previousDb = process.env.DATABASE_URL;
  try {
    const store = new LocalFileArtifactStore(directory);
    await publish(store);
    const published = await publishReaderEdgeArtifacts(null, { sourceThrough: NOW, retrievedAt: NOW, promotedThrough: NOW }, {
      store, now: NOW,
      authority: { "registry-runtime": { value: registryTransferImport().projection.payload, versionId: "reader-api:registry" }, "federal-directory": { value: syntheticFederalDirectory(), versionId: "reader-api:federal-directory" } },
    });
    assert.equal(published.status, "PUBLISHED");
    process.env.WTP_READER_EDGE_DIR = directory;
    process.env.DATABASE_URL = "postgresql://do-not-open.invalid/federal-money-test";
    const started = performance.now();
    const response = await GET(new Request(`https://wtp.test/api/federal-money?division=${encodeURIComponent(COUNTY)}&body=${encodeURIComponent(BODY)}`));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.sources[3].records[0].title, records[0].title);
    assert.equal(result.sources[0].status, "NOT_HELD");
    assert.ok(performance.now() - started < 3000, "the first source-backed response is usable within three seconds");
    assert.equal((await GET(new Request("https://wtp.test/api/federal-money?division=elsewhere"))).status, 400);
    delete process.env.DATABASE_URL;
    const { POST } = await import("../app/api/ask/grounded/route.ts");
    const askStarted = performance.now();
    const ask = await POST(new Request("https://wtp.test/api/ask/grounded", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "federal-money-reader-test" },
      body: JSON.stringify({ question: "What disaster declarations cover my county?", ocdIds: [COUNTY], surface: "MAP", today: NOW.slice(0, 10) }),
    }));
    assert.equal(ask.status, 200);
    const answer = await ask.json();
    assert.match(answer.answer, /BUNKER FIRE/);
    assert.equal(answer.records.find((record: { kind: string }) => record.kind === "FEDERAL_MONEY").sourceUrl, CAPTURE.url);
    assert.equal(answer.trace.interpretation.ran, false, "a direct place question needs no model reader");
    assert.ok(performance.now() - askStarted < 3000, "the first sourced Ask answer is usable within three seconds");
  } finally {
    if (previous === undefined) delete process.env.WTP_READER_EDGE_DIR; else process.env.WTP_READER_EDGE_DIR = previous;
    if (previousDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDb;
    rmSync(directory, { recursive: true, force: true });
  }
});
