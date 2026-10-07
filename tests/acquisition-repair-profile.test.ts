import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseGeneralizedRecords } from "../lib/control-plane/workers/generalized-parser.ts";
import { verifyExternalAuthorities } from "../lib/control-plane/workers/record-verification.ts";
import type { GeneralizedCivicExtractionContract, VerificationAuthority, WorkerEvidence } from "../lib/control-plane/workers/types.ts";

const subjectId = "az:city:city-of-sierra-vista";
const sourceId = "www.sierravistaaz.gov";
const base = "https://www.sierravistaaz.gov/Home/Components/StaffDirectory/StaffDirectory/";
const fields = { name: { source: "heading:detail-title", type: "STRING" as const },
  office: { source: "detail:Title", type: "STRING" as const },
  phone: { source: "detail:Phone", type: "STRING" as const } };
function parse(text: string, url = `${base}47/`, mapped: GeneralizedCivicExtractionContract["extraction"] = { format: "HTML_PROFILE", fields }, artifactId = "ar-profile-fixture") {
  const evidence: WorkerEvidence = { artifactId, contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`,
    text, acquiredByAttemptId: "at-profile-fixture", canonicalUrl: url, retrievedAt: "2026-09-28T01:43:24.987Z",
    sourceId, methodRouteId: "scout:fetch_public" };
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "OFFICIAL_ROSTER", subjectId,
    jurisdiction: { country: "US", state: "AZ", canonicalId: subjectId },
    identity: { namespace: `${subjectId}:OFFICEHOLDERS`, keyFields: ["name", "office"] },
    sourceScope: { publisher: "City of Sierra Vista", sourceId, canonicalUrls: [url],
      routeIds: [evidence.methodRouteId], observationArtifactIds: [evidence.artifactId] },
    methodVersion: 1, requiredFields: ["name", "office"], expectedSourceDate: null,
    completenessScope: "One captured individual official profile only", extraction: mapped,
    verification: { required: true, authorities: [] } };
  return { evidence, result: parseGeneralizedRecords({ attemptId: "at-profile-parser", worker: {
    role: "PARSER", instance: "profile-parser", provider: "deterministic", version: "2" }, evidence, contract }, contract) };
}

const sample = `<script>document.title = 'Wrong Person';</script>
  <h2 class="detail-title">Landry, Angelica</h2><img alt="Another Person" src="/image"/>
  <ul class="detail-list"><li><span class="detail-list-label">Title:</span><span class="detail-list-value">Council Member</span></li>
  <li><span class="detail-list-label">Phone:</span><span class="detail-list-value">(520) 439-2140</span></li>
  <li><span class="detail-list-label">Email:</span><span class="detail-list-value"><a href="javascript:void(0);">Email</a></span></li></ul>`;

test("one visible official profile supplies exact heading, office and phone spans, never image alt or script text", () => {
  const { evidence, result } = parse(sample);
  assert.equal(result.verdict, "EXTRACTED", JSON.stringify(result.warnings));
  assert.equal(result.actualRowCount, 1);
  assert.deepEqual([result.records[0].fields.name, result.records[0].fields.office, result.records[0].fields.phone],
    ["Landry, Angelica", "Council Member", "(520) 439-2140"]);
  assert.equal(result.records[0].fields.email, undefined);
  assert.equal(result.records[0].fields.portraitUrl, undefined);
  for (const span of result.spans) assert.equal(evidence.text.slice(span.start, span.end), span.quote);
});

test("profile mapping refuses duplicate identity, ambiguous title and JavaScript Email buttons", () => {
  assert.equal(parse(sample + '<h2 class="detail-title">Different Person</h2>').result.warnings[0]?.code, "HTML_PROFILE_AMBIGUOUS");
  assert.equal(parse(sample.replace("</ul>", '<li><span class="detail-list-label">Title:</span><span class="detail-list-value">Mayor</span></li></ul>')).result.warnings[0]?.code,
    "HTML_PROFILE_AMBIGUOUS");
  assert.equal(parse(sample, `${base}47/`, { format: "HTML_PROFILE", fields: { ...fields,
    email: { source: "detail:Email", type: "STRING" } } }).result.warnings[0]?.code, "OFFICIAL_EMAIL_NOT_VISIBLE_ADDRESS");
  assert.equal(parse(sample.replace("</li></ul>", "</ul>")).result.warnings[0]?.code, "HTML_PROFILE_INCOMPLETE");
});

test("two already-held official profile captures have source-local name and office only", { skip: !process.env.HELD_SIERRA_PROFILE_DIR }, () => {
  const cases = [
    { id: "ar-a6374fb8f0cbe382e9202386", hash: "1202e9fe3cf0975fddca2c426c9ff132b2c960787be05ac4076ae81a2e1dd437", leaf: "47/", name: "Landry, Angelica" },
    { id: "ar-aae2cabd1504c16ba915703f", hash: "11dc41520ba8f6db3b05c3a1c7cb4b855cf79d3e44239639187a066e97d61499", leaf: "49/", name: "Rodriguez, Mark" },
  ];
  const profiles: WorkerEvidence[] = [];
  for (const row of cases) {
    const text = readFileSync(join(process.env.HELD_SIERRA_PROFILE_DIR!, `sha256-${row.hash}.html`), "utf8");
    assert.equal(createHash("sha256").update(text).digest("hex"), row.hash);
    const { evidence, result } = parse(text, `${base}${row.leaf}`, { format: "HTML_PROFILE", fields }, row.id);
    profiles.push(evidence);
    assert.equal(result.verdict, "EXTRACTED", JSON.stringify(result.warnings));
    assert.deepEqual([result.records[0].fields.name, result.records[0].fields.office, result.records[0].fields.phone],
      [row.name, "Council Member", "(520) 439-2140"]);
    assert.equal(result.records[0].fields.email, undefined, "the profile's Email action contains no address");
    for (const span of result.spans) assert.equal(evidence.text.slice(span.start, span.end), span.quote);
    if (row.name === "Rodriguez, Mark") {
      assert.match(text, /alt="City Council Member Robert Rodriguez"/,
        "the captured image alt conflicts with the visible Mark heading and is not a verified portrait identity");
      assert.equal(result.records[0].fields.portraitUrl, undefined);
    }
  }
  if (!process.env.HELD_ROSTER_PATH) return;
  const rosterText = readFileSync(process.env.HELD_ROSTER_PATH, "utf8");
  assert.equal(createHash("sha256").update(rosterText).digest("hex"), "9d3dab04619750561045a1558cff247e22f88099e22730c79cf647408569271a");
  const rosterUrl = "https://www.sierravistaaz.gov/government/city-council/contact-the-mayor-council";
  const roster: WorkerEvidence = { artifactId: "ar-be10df3d3aa3c72f6076ae6b", contentHash: `sha256-${createHash("sha256").update(rosterText).digest("hex")}`,
    text: rosterText, acquiredByAttemptId: "at-fdaa3625d1b2bb95157bdf44", canonicalUrl: rosterUrl,
    retrievedAt: "2026-09-28T06:27:49.882Z", sourceId, methodRouteId: "scout:fetch_public" };
  const authorities: VerificationAuthority[] = profiles.map((profile, index) => ({ id: `separate-profile-${index}`, type: "GOVERNMENT_REGISTER",
    publisher: "City of Sierra Vista", sourceId, canonicalUrls: [profile.canonicalUrl], artifactIds: [profile.artifactId],
    authorityEvidenceArtifactIds: [profile.artifactId], independenceBasis: "INDEPENDENT_OFFICIAL_RECORD",
    independenceExplanation: "An individual official profile separately states this member's name and council title.",
    extraction: { format: "HTML_PROFILE", fields: { name: fields.name, office: fields.office } },
    comparison: { kind: "RECORD_VALUES_SUBSET", keyFields: ["name"], fields: ["name", "office"] } }));
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "OFFICIAL_ROSTER", subjectId,
    jurisdiction: { country: "US", state: "AZ", canonicalId: subjectId },
    identity: { namespace: `${subjectId}:OFFICEHOLDERS`, keyFields: ["name", "office"] },
    sourceScope: { publisher: "City of Sierra Vista", sourceId, canonicalUrls: [rosterUrl],
      routeIds: [roster.methodRouteId], observationArtifactIds: [roster.artifactId] },
    methodVersion: 1, requiredFields: ["name", "office"], expectedSourceDate: null,
    completenessScope: "Captured council contact rows only", extraction: { format: "HTML_TABLE", tableIndex: 0, headerRows: 1,
      fields: { name: { source: 0, type: "STRING" }, office: { source: 1, type: "STRING" },
        phone: { source: 2, type: "STRING" }, websiteUrl: { source: 0, type: "STRING", attribute: "href" } } },
    verification: { required: true, authorities } };
  const candidate = parseGeneralizedRecords({ attemptId: "at-local-roster-parser", worker: {
    role: "PARSER", instance: "local-roster-parser", provider: "deterministic", version: "2" }, evidence: roster, contract }, contract);
  assert.equal(candidate.verdict, "EXTRACTED");
  const comparisons = verifyExternalAuthorities({ attemptId: "at-local-validator", producerAttemptId: candidate.attemptId,
    candidate, evidence: roster, authorityEvidence: profiles, verifiedAt: "2026-09-28T08:00:00.000Z" }, contract);
  assert.ok(comparisons.every(check => check.verdict === "PASS"), JSON.stringify(comparisons.map(check => check.discrepancies)));
  const matched = new Set(comparisons.flatMap(check => check.verifiedRecordIds ?? []));
  assert.equal(matched.size, 2, "offline source comparison covers two held profile rows, never all seven roster members");
  assert.equal(candidate.records.filter(record => !matched.has(record.id)).length, 5);
});
