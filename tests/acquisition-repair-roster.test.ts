import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseGeneralizedRecords } from "../lib/control-plane/workers/generalized-parser.ts";
import type { GeneralizedCivicExtractionContract, WorkerEvidence } from "../lib/control-plane/workers/types.ts";

const sourceUrl = "https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council";
const subjectId = "az:city:city-of-sierra-vista";
function replay(text: string) {
  const evidence: WorkerEvidence = {
    artifactId: "ar-test-roster", contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`,
    text, acquiredByAttemptId: "at-test-acquisition", canonicalUrl: sourceUrl,
    retrievedAt: "2026-09-28T06:27:49.882Z", sourceId: "www.sierravistaaz.gov", methodRouteId: "scout:fetch_public",
  };
  const contract: GeneralizedCivicExtractionContract = {
    schemaVersion: 2, recordClass: "OFFICIAL_ROSTER", subjectId,
    jurisdiction: { country: "US", state: "AZ", canonicalId: subjectId },
    identity: { namespace: `${subjectId}:roster`, keyFields: ["name", "office"] },
    sourceScope: { publisher: "City of Sierra Vista", sourceId: evidence.sourceId,
      canonicalUrls: [sourceUrl], routeIds: [evidence.methodRouteId], observationArtifactIds: [evidence.artifactId] },
    methodVersion: 1, requiredFields: ["name", "office"], expectedSourceDate: null,
    completenessScope: "Visible rows in the captured official council contact table; other bodies remain owed.",
    extraction: { format: "HTML_TABLE", tableIndex: 0, headerRows: 1,
      fields: { name: { source: 0, type: "STRING" }, office: { source: 1, type: "STRING" },
        phone: { source: 2, type: "STRING" }, websiteUrl: { source: 0, type: "STRING", attribute: "href" } } },
    verification: { required: true, authorities: [] },
  };
  return parseGeneralizedRecords({ attemptId: "at-test-parser", worker: {
    role: "PARSER", instance: "test-parser", provider: "deterministic", version: "2" }, evidence, contract }, contract);
}

test("ordinary official roster table retains contact and profile link with source spans", () => {
  const text = `<table><thead><tr><th>Staff</th><th>Title</th><th>Phone</th><th>Email</th></tr></thead><tbody>
    <tr><td><a href="/Home/Components/StaffDirectory/StaffDirectory/768/128">McCaa II, Clea</a></td><td>Mayor</td><td><a href="tel:5204392140">(520) 439-2140</a></td><td><a data-mailto-id="768" href="javascript:void(0);">Email</a></td></tr>
    <tr><td><a href="/Home/Components/StaffDirectory/StaffDirectory/50/128">Flowers, Carolyn</a></td><td>Vice Mayor</td><td><a href="tel:5204392140">(520) 439-2140</a></td><td><a data-mailto-id="50" href="javascript:void(0);">Email</a></td></tr>
  </tbody></table>`;
  const result = replay(text);
  assert.equal(result.verdict, "EXTRACTED", JSON.stringify(result.warnings));
  assert.equal(result.actualRowCount, 2);
  assert.deepEqual(result.records.map(row => [row.fields.name, row.fields.office, row.fields.phone]), [
    ["McCaa II, Clea", "Mayor", "(520) 439-2140"], ["Flowers, Carolyn", "Vice Mayor", "(520) 439-2140"],
  ]);
  assert.equal(result.records[0].fields.websiteUrl, "https://www.sierravistaaz.gov/Home/Components/StaffDirectory/StaffDirectory/768/128");
  assert.equal(result.records[0].fields.email, undefined, "a JS contact button supplies no email address");
  for (const span of result.spans) assert.equal(text.slice(span.start, span.end), span.quote);
});

test("saved Sierra Vista roster replays from the original hash-verified bytes when supplied", { skip: !process.env.HELD_ROSTER_PATH }, () => {
  const text = readFileSync(process.env.HELD_ROSTER_PATH!, "utf8");
  assert.equal(createHash("sha256").update(text).digest("hex"), "9d3dab04619750561045a1558cff247e22f88099e22730c79cf647408569271a");
  const result = replay(text);
  assert.equal(result.verdict, "EXTRACTED", JSON.stringify(result.warnings));
  assert.equal(result.actualRowCount, 7);
  assert.equal(result.records.every(row => row.fields.phone === "(520) 439-2140"), true);
  assert.equal(result.records.every(row => typeof row.fields.websiteUrl === "string"), true);
  assert.equal(result.records.every(row => row.fields.email === undefined), true);
});

test("href extraction cannot be silently requested from non-HTML source shapes", () => {
  const text = JSON.stringify({ records: [{ name: "Ada", office: "Mayor" }] });
  const evidence: WorkerEvidence = { artifactId: "ar-json", contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`,
    text, acquiredByAttemptId: "at-json", canonicalUrl: sourceUrl, retrievedAt: "2026-09-28T06:27:49.882Z",
    sourceId: "www.sierravistaaz.gov", methodRouteId: "scout:fetch_public" };
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "OFFICIAL_ROSTER", subjectId,
    jurisdiction: { country: "US", state: "AZ", canonicalId: subjectId }, identity: { namespace: subjectId, keyFields: ["name"] },
    sourceScope: { publisher: "City of Sierra Vista", sourceId: evidence.sourceId, canonicalUrls: [sourceUrl], routeIds: [evidence.methodRouteId], observationArtifactIds: [evidence.artifactId] },
    methodVersion: 1, requiredFields: ["name", "office"], completenessScope: "Captured rows", expectedSourceDate: null,
    extraction: { format: "JSON_RECORDS", rowsPointer: "/records", fields: { name: { source: "/name", type: "STRING", attribute: "href" }, office: { source: "/office", type: "STRING" } } },
    verification: { required: true, authorities: [] } };
  const parsed = parseGeneralizedRecords({ attemptId: "at-json-parser", worker: { role: "PARSER", instance: "test", provider: "deterministic", version: "2" }, evidence, contract }, contract);
  assert.equal(parsed.verdict, "FAILED");
  assert.equal(parsed.warnings[0]?.code, "FIELD_MAPPING_INVALID");
});

test("missing optional roster columns preserve the required person and exact source spans", () => {
  const text = `<table><tr><th>Name</th><th>Office</th></tr><tr><td>Ada</td><td>Mayor</td></tr></table>`;
  const result = replay(text);
  assert.equal(result.verdict, "EXTRACTED");
  assert.deepEqual(result.records.map(row => ({ ...row.fields })), [{ name: "Ada", office: "Mayor" }]);
  assert.deepEqual(result.warnings.map(row => [row.field, row.severity]).sort(), [["phone", "INFO"], ["websiteUrl", "INFO"]]);
  for (const span of result.spans) assert.equal(text.slice(span.start, span.end), span.quote);
  assert.equal(replay(`<table><tr><th>Name</th></tr><tr><td>Ada</td></tr></table>`).verdict, "FAILED");
});
