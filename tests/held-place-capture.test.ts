import assert from "node:assert/strict";
import test from "node:test";
import { projectHeldPlaceCapture } from "../lib/civic-data/held-place-capture.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { HeldPlaceFamilies } from "../lib/civic-data/held-place-families.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";
import { buildPlaceOwedList } from "../lib/coverage/place-owed.ts";
import { readPlaceVersionSlice } from "../lib/civic-data/held-place-slices.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { projectHeldGeography, type HeldGeographyRow } from "../lib/civic-data/held-place-geography.ts";
import type { Division } from "../lib/registry/types.ts";
import { createHash } from "node:crypto";
import { projectHeldPlaceFamilies } from "../lib/civic-data/held-place-families.ts";
import { canonicalContestId, canonicalCandidacyId } from "../lib/hunt/candidate-universe.ts";
import { derivedCampaignSitesProjectionIssue, derivedCandidateRevisionId, derivedCandidateDocumentId,
  type DerivedCampaignSiteRecord } from "../lib/civic-data/derived-campaign-sites.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-parts.ts";
import { readPlacePayloadParts } from "../lib/civic-data/place-payload-slices.ts";
import { candidateDescriptionQualityIssue } from "../lib/candidates/blurbs.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const neighbour = "ocd-division/country:us/state:az/county:pima";
const at = "2026-09-30T06:00:00.000Z";
const provenance = { sourceUrl: "https://cochise.az.gov/calendar", collectedAt: at };
const published = <T>(value: T) => ({ kind: "PROMOTED", value } as CivicDataReadResult<T>);
const registry = published({ registry: { bodies: [{ id: "shared-body", ocdId: county,
  alsoServesOcdIds: [neighbour], name: "Shared district board", bodyClass: "BOARD", provenance }] },
  bodyRosters: [{ bodyId: "shared-body", ...provenance, members: [{ id: "member", name: "Published Member",
    officeTitle: "Chair", websiteUrl: null }] }] } as unknown as RegistryRuntimeReadModel);
const meeting = { id: "meeting:one", bodyId: "shared-body", ocdId: county, title: "Board meeting",
  startsAt: "2026-10-01T02:00:00.000Z", timeZone: "America/Phoenix", startPrecision: "DAY",
  location: null, online: null, status: "SCHEDULED", provenance };
const meetings = published({ meetings: [meeting] } as unknown as MeetingsSnapshot);

function candidateFamilies(): HeldPlaceFamilies {
  const contestId = "ballot-az-pima:supervisor", key = `${contestId}:one-candidate`;
  return { ballots: [{ election: { id: "az-general", state: "AZ", date: "2026-11-03", name: "General" },
    contests: [{ id: contestId, title: "Supervisor", ocdId: county, provenance },
      { id: "ballot-az-pima:other", title: "Supervisor", ocdId: neighbour, provenance }],
    candidacies: [{ id: key, contestId, givenName: "Candidate", familyName: "One", incumbent: null, provenance },
      { id: "same-name-outside", contestId: "ballot-az-pima:other", givenName: "Candidate", familyName: "One", provenance }], measures: [] }],
    candidateLineups: [{ contestId, nominees: [{ name: "Candidate One" }, { name: "Candidate Ones" }] }],
    candidateProfiles: { cards: { curatedAt: "2026-09-30", cards: {
      [`${contestId}|Candidate One`]: { bio: "The campaign's biography.", bioSourceUrl: "https://campaign.example/about",
        bioSourceLabel: "Campaign words, read 2026-09-29", phone: "520-555-0100", phoneLabel: null,
        phoneSource: "Campaign page https://campaign.example/ read 2026-09-29" },
      [`${contestId}|Candidate Ones`]: { bio: "Wrong person", bioSourceUrl: "https://other.example", bioSourceLabel: "read 2026-09-30" },
      "same-name-outside": { bio: "Another district", bioSourceUrl: "https://outside.example", bioSourceLabel: "read 2026-09-30" },
    } }, links: { curatedAt: "2026-09-30", links: { [`${contestId}|Candidate One`]: {
      official: { url: "https://county.az.gov/member", verification: "Fetched official office page.", attemptedAt: "2026-09-29" },
      campaign: { url: "https://campaign.example/", verification: "Fetched candidate, Supervisor, 2026 election; phone 520-555-0100.", attemptedAt: "2026-09-29" },
    } } } } } as unknown as HeldPlaceFamilies;
}

test("Admin candidate capture uses the canonical ballot plan and each field's actual source date", () => {
  const families = candidateFamilies(), id = "ballot-az-pima:supervisor:one-candidate";
  const capture = projectHeldPlaceFamilies([county], null, families);
  const added = capture.held.filter(row => ["CAN-04", "CAN-05", "CAN-06", "CAN-16", "CAN-18"].includes(row.checklistId));
  assert.ok(added.length > 0);
  assert.ok(added.every(row => row.subjectId === id && row.checkedAt === "2026-09-29"));
  assert.equal(added.find(row => row.checklistId === "CAN-16")?.sourceUrl, "https://campaign.example/about");
  assert.ok(!capture.held.some(row => row.checklistId === "CAN-17" || row.checklistId === "CAN-07"));
  const owed = buildPlaceOwedList({ divisions: [{ id: county, label: "County" }], ...capture, now: at });
  assert.equal(owed.find(row => row.subject.id === id && row.checklistId === "CAN-16")?.state, "published");
  const stale = structuredClone(families) as unknown as { candidateProfiles: { cards: { cards: Record<string, { bioSourceLabel: string; phoneSource: string }> }; links: { links: Record<string, { official: { attemptedAt: string }; campaign: { attemptedAt: string } }> } } };
  stale.candidateProfiles.cards.cards["ballot-az-pima:supervisor|Candidate One"].bioSourceLabel = "Campaign words, read 2026-08-01";
  const staleCapture = projectHeldPlaceFamilies([county], null, stale as unknown as HeldPlaceFamilies);
  const staleOwed = buildPlaceOwedList({ divisions: [{ id: county, label: "County" }], ...staleCapture, now: at });
  assert.equal(staleOwed.find(row => row.subject.id === id && row.checklistId === "CAN-16")?.state, "stale");
  assert.equal(staleCapture.held.find(row => row.checklistId === "CAN-16")?.checkedAt, "2026-08-01", "curatedAt never refreshes a biography");
  const missing = structuredClone(families) as unknown as typeof stale;
  missing.candidateProfiles.cards.cards["ballot-az-pima:supervisor|Candidate One"].bioSourceLabel = "Campaign words, no recorded read date";
  assert.ok(!projectHeldPlaceFamilies([county], null, missing as unknown as HeldPlaceFamilies).held.some(row => row.checklistId === "CAN-16"));
  const elsewhere = projectHeldPlaceFamilies([neighbour], null, families);
  assert.ok(!elsewhere.held.some(row => row.subjectId === id), "shared person names do not carry district facts across ZIPs");
});

test("current verified publications fill biography and readable corpus without asserting a position or a portrait", () => {
  const families = candidateFamilies(), id = "ballot-az-pima:supervisor:one-candidate";
  const candidacyId = canonicalCandidacyId(canonicalContestId("AZ", 2026, { ocdId: county, title: "Supervisor" }), "One", "Candidate");
  const text = "The candidate's own published words.", contentHash = createHash("sha256").update(text).digest("hex");
  const campaignUrl = "https://campaign.example/";
  const evidence = { verifierId: "campaign-site-verifier/1", artifactId: "saved-source", attemptId: "saved-attempt", sha256: "d".repeat(64),
    requestedUrl: campaignUrl, finalUrl: campaignUrl, httpStatus: 200, readAt: at, approvalItemId: "approved-item",
    approvalRecordId: "approved-record", approvedAt: at, secondSignal: "Official filing campaign domain" };
  const revisionId = derivedCandidateRevisionId({ candidateKey: id, documentUrl: campaignUrl,
    rawContentHash: evidence.sha256, contentHash, extractorVersion: 1 });
  const document = { id: derivedCandidateDocumentId(id, contentHash, revisionId), candidateKey: id, sourceClass: "CAMPAIGN_SITE" as const, basis: "HUNTED_AND_VERIFIED" as const,
    metaDescription: "The campaign's own description.", documentUrl: campaignUrl, contentHash, sourceContentHash: evidence.sha256,
    retrievedAt: at, contentType: "text/html", text, extraction: "html" as const, extractionNote: null, extractorVersion: 1,
    sourceRevision: { revisionId, artifactId: evidence.artifactId, canonicalUrl: campaignUrl, rawContentHash: evidence.sha256,
      capturedAt: at, extractionVersion: 1, supersedesRevisionId: null } };
  const record: DerivedCampaignSiteRecord = { id, candidacyId, candidateName: "Candidate One",
    campaign: { url: campaignUrl, attemptedAt: at.slice(0, 10),
      verification: `Fetched ${at.slice(0, 10)} (campaign-site-verifier/1): 'Campaign' — names Candidate One, the office ("Supervisor"), and the 2026 election.`, evidence },
    publications: [{ document, evidence }] };
  assert.equal(derivedCampaignSitesProjectionIssue({ kind: "candidate-campaign-sites-derived", formatVersion: 1, records: [record] }), null);
  const olderText = "Earlier campaign words.", olderHash = createHash("sha256").update(olderText).digest("hex");
  const capture = projectHeldPlaceFamilies([county], null, { ...families, candidateProfiles: null, derivedCampaignSites: [record],
    candidatePublications: [{ ...document, id: `${id}@${olderHash}`, contentHash: olderHash, text: olderText,
      sourceRevision: undefined, metaDescription: "Superseded description.", retrievedAt: "2026-08-01" }] });
  assert.equal(capture.held.find(row => row.checklistId === "CAN-16")?.checkedAt, at);
  assert.equal((capture.held.find(row => row.checklistId === "CAN-16")?.value as { quote: string }).quote, document.metaDescription);
  assert.ok(capture.held.some(row => row.checklistId === "CAN-12" && row.checkedAt === at));
  assert.deepEqual((capture.held.find(row => row.checklistId === "CAN-21")?.value as { sourceRevision: unknown }).sourceRevision, document.sourceRevision);
  assert.deepEqual((capture.held.find(row => row.checklistId === "CAN-05")?.value as { evidence: unknown }).evidence, evidence);
  assert.ok(!capture.held.some(row => row.checklistId === "CAN-07" || row.checklistId === "CAN-17"));
  const unusable = { ...document, sourceRevision: undefined, metaDescription: "Sign up for our newsletter.",
    contentHash: "7f80a1f73dcee52336c83d7bbde410449d3458a2d209d2f4fca4f518420cf768" };
  assert.ok(candidateDescriptionQualityIssue(unusable), "a source description the Reader rejects");
  const rejected = projectHeldPlaceFamilies([county], null, { ...families, candidateProfiles: null,
    candidatePublications: [{ ...unusable, candidateKey: id, id: `${id}@${unusable.contentHash}`, retrievedAt: at }] });
  assert.ok(!rejected.held.some(row => row.checklistId === "CAN-16"), "a Reader-rejected description cannot inflate Admin biography capture");
  assert.ok(rejected.held.some(row => row.checklistId === "CAN-12"), "the source text remains readable");
  assert.ok(!projectHeldPlaceFamilies([county], null, { ...families, candidateProfiles: null,
    derivedCampaignSites: [{ ...record, candidacyId: "different-candidacy" }] }).held.some(row => row.checklistId === "CAN-16"));
  const conflict = structuredClone(families) as unknown as { candidateProfiles: { links: { links: Record<string, { campaign: { url: string } }> } } };
  conflict.candidateProfiles.links.links["ballot-az-pima:supervisor|Candidate One"].campaign.url = "https://reviewed-other.example/";
  assert.ok(!projectHeldPlaceFamilies([county], null, { ...conflict as unknown as HeldPlaceFamilies, candidateProfiles: (conflict as unknown as HeldPlaceFamilies).candidateProfiles,
    derivedCampaignSites: [record, { ...record, id: "ballot-az-pima:supervisor|Candidate One", publications: [] }] }).held.some(row => row.checkedAt === at && row.checklistId === "CAN-16"), "conflicting derived site cannot bypass the Reader composition");
});

test("encoded candidate object maps decode only selected facts and refuse a racing pointer", async () => {
  const key = "candidate-exact", other = "unrelated-exact", scope = "profiles-test";
  const profile = { cards: { cards: { [key]: { bio: "selected biography ".repeat(7000), bioSourceLabel: "read 2026-09-29" },
    [other]: { bio: "unselected biography ".repeat(7000) } } }, links: { links: {
    [key]: { campaign: { url: "https://campaign.example/", attemptedAt: "2026-09-29", verification: "Verified candidate." }, official: null },
    [other]: { campaign: { url: "https://outside.example/" }, official: null },
  } } };
  const plan = partitionCivicPayload(profile), saved = new Map(plan.parts.map(part => [part.hash, part.payload]));
  const raw = (node: unknown): unknown => {
    const ref = (node as { $civicPayloadPart?: string })?.$civicPayloadPart;
    if (!ref) return node;
    const part = saved.get(ref) as { kind?: string; value?: unknown };
    return part.kind === "object" ? part.value : part;
  };
  const root = raw(plan.value) as { cards: unknown; links: unknown };
  const cards = raw((raw(root.cards) as { cards: unknown }).cards) as Record<string, unknown>;
  const links = raw((raw(root.links) as { links: unknown }).links) as Record<string, unknown>;
  const fetched: string[] = [];
  const query: Parameters<typeof readPlacePayloadParts>[0] = async statements => statements.map(statement => {
    if (statement.text.startsWith("SELECT hash,payload")) {
      const hashes = statement.params[0] as string[];
      assert.ok(hashes.length <= 8);
      fetched.push(...hashes);
      return hashes.map(hash => ({ hash, payload: saved.get(hash) }));
    }
    assert.deepEqual(statement.params[4], [key]);
    assert.deepEqual(statement.params[6], ["cards.cards", "links.links"]);
    assert.ok(statement.text.includes("e.key=ANY($5::text[])") && statement.text.includes("member_key=ANY($5::text[])"), "filter object map keys before decoding selected records");
    return [{ scope, field: "cards.cards", rows: [{ key, value: cards[key] }] },
      { scope, field: "links.links", rows: [{ key, value: links[key] }] }, { scope, field: "$version", rows: "good-v1" }];
  });
  const result = (await readPlacePayloadParts(query, "CANDIDATE_PROFILE", [scope], [county], [], [key], new Map([[scope, "good-v1"]]))).get(scope);
  assert.deepEqual(result, { cards: { cards: { [key]: profile.cards.cards[key] } }, links: { links: { [key]: profile.links.links[key] } } });
  assert.ok(fetched.length > 0, "selected long biography was decoded through actual immutable parts");
  assert.ok(!fetched.includes((cards[other] as { $civicPayloadPart: string }).$civicPayloadPart), "unselected biography never crosses the read boundary");
  await assert.rejects(readPlacePayloadParts(query, "CANDIDATE_PROFILE", [scope], [county], [], [key], new Map([[scope, "other-version"]])), /CIVIC_POINTER_CHANGED_DURING_READ/);
});

test("accepted registry slices keep the manifest's immutable version through both payload reads after the live pointer advances", async () => {
  const scope = "US:reader-registry-runtime-bindings", acceptedVersion = "registry-held-v1";
  const body = { id: `${county}#governing`, ocdId: county, alsoServesOcdIds: [neighbour], name: "Held county board" };
  let missing = false, calls = 0;
  const query: ReadOnlyQuery = async statements => statements.map(statement => {
    if (/\bFROM fact\b/.test(statement.text)) return [];
    calls++;
    assert.match(statement.text, /JOIN civic_data_candidates c ON c\.id=accepted\.version_id AND c\.scope=accepted\.scope/);
    assert.match(statement.text, /c\.state='PROMOTED' AND c\.promoted_version_id=c\.id/);
    assert.doesNotMatch(statement.text, /FROM civic_data_promotions/, "the newer mutable pointer cannot supply any part of this accepted version");
    assert.deepEqual(statement.params[2], [county]);
    assert.deepEqual(statement.params[3], [body.id]);
    const recursive = statement.text.includes("WITH RECURSIVE");
    assert.deepEqual(JSON.parse(statement.params[recursive ? 7 : 6] as string), { [scope]: acceptedVersion });
    if (missing) return [];
    if (recursive) return [{ scope, field: "registry.bodies", rows: [body] }, { scope, field: "$version", rows: acceptedVersion }];
    const carried = JSON.parse(statement.params[5] as string)[scope] === acceptedVersion;
    return [{ scope, current_version_id: acceptedVersion, value: null, encoded: !carried }];
  });
  const read = () => readPlaceVersionSlice<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", scope, acceptedVersion, [county], [body.id], [], query);
  const held = await read();
  assert.equal(held.kind, "PROMOTED");
  assert.equal(held.metadata.versionId, acceptedVersion);
  assert.deepEqual(held.value?.registry.bodies, [body]);
  assert.equal(calls, 2, "the scoped shell and its selected encoded fields are read separately");
  assert.deepEqual((await read()).value, held.value);
  assert.equal(calls, 3, "the exact immutable value is reused after its identity read");
  missing = true;
  assert.equal((await read()).kind, "NOT_RECORDED", "an absent accepted candidate cannot fall back to a different current registry");
});

test("held boundary provenance maps source, semantic version and effective use without URL-only credit", () => {
  const cd = "ocd-division/country:us/state:az/cd:6";
  const sl = "ocd-division/country:us/state:az/sldu:6";
  const meta = { type: "congressional_district", version: "cd:119", versionMeta: {
    key: "cd:119", type: "congressional_district", plan: "119th Congress", effectiveFor: "current representation",
    zctaTabulation: "2020", provenance: { sourceUrls: ["https://www2.census.gov/held.txt"],
      sourceDataset: "CENSUS_TAB20_REL2020", computedAt: at, sourceFiles: ["held.txt"], sourceChecksums: ["saved-hash"], method: "published relationship" },
  } };
  const row = { meta, grouping: { geoid: "0406", ocdId: null, label: "AZ Congressional District 6" } } as unknown as HeldGeographyRow;
  const held = projectHeldGeography([cd, sl, county], [], [row]);
  assert.deepEqual(held.held.map(f => [f.subjectId, f.checklistId]), [[cd, "GEO-03"]]);
  assert.equal(held.held[0].checkedAt, at, "projection does not advance the saved source clock");
  assert.deepEqual(held.held[0].value, { divisionId: cd, geoid: "0406", sourceDataset: "CENSUS_TAB20_REL2020",
    version: "cd:119", plan: "119th Congress", effectiveFor: "current representation" });
  const items = buildPlaceOwedList({ divisions: [{ id: cd, label: cd }], ...held, now: at });
  assert.equal(items.find(item => item.checklistId === "GEO-03" && item.subject.id === cd)?.state, "published");
  for (const field of ["key", "effectiveFor"] as const) {
    const missing = structuredClone(row);
    (missing.meta.versionMeta as unknown as Record<string, unknown>)[field] = "";
    assert.equal(projectHeldGeography([cd], [], [missing]).held.length, 0);
  }
  const countyRow = { ...row, meta: { ...row.meta, type: "county" }, grouping: { ...row.grouping, geoid: "04003" } } as HeldGeographyRow;
  const divisions = [{ ocdId: county, divisionType: "county", geoid: "04003" }] as Division[];
  assert.equal(projectHeldGeography([county], divisions, [countyRow]).held[0].subjectId, county);
  assert.equal(projectHeldGeography(["unrelated"], divisions, [countyRow]).held.length, 0);
});

test("held Census status survives complementary projections without inventing governments for statistical areas", () => {
  const statuses = ["S", "F", "N", "I", "A", "E", null];
  const divisions = statuses.map((funcstat, i) => ({ ocdId: `${county}/place:area_${i}`,
    label: "Same label", divisionType: "place", funcstat }));
  assert.ok(registry.value);
  const model = { ...registry.value, registry: { ...registry.value.registry, divisions,
    bodies: [{ ...registry.value.registry.bodies[0], ocdId: divisions[0].ocdId, alsoServesOcdIds: [] }] } } as unknown as RegistryRuntimeReadModel;
  const capture = projectHeldPlaceCapture(divisions.map(d => d.ocdId), published(model), [], at);
  // A second projection contributes a field for the same division without
  // repeating its optional Census metadata (as the geography reader does).
  const geography = { id: divisions[0].ocdId, kind: "division" as const,
    divisionIds: [divisions[0].ocdId], label: "Boundary" };
  const input = { divisions: divisions.map(d => ({ id: d.ocdId, label: d.label })),
    subjects: [...capture.subjects, geography], held: capture.held, now: at };
  const rows = buildPlaceOwedList(input);
  for (const [i, status] of statuses.entries()) {
    const inventories = rows.filter(row => row.subject.id.startsWith(`${divisions[i].ocdId}#inventory:`));
    assert.equal(inventories.length, i < 4 ? 0 : 6, `status ${status} uses only the held classification`);
    assert.equal(rows.filter(row => row.subject.id === divisions[i].ocdId).length, 9, "geography owed per division (5, the school, special and tribal items gated away) and the division reference items (4) remain owed");
  }
  assert.deepEqual(rows.find(row => row.subject.id === "shared-body" && row.checklistId === "GOV-01")?.held,
    capture.held.filter(field => field.subjectId === "shared-body"), "actual records remain even within statistical geography");
  assert.equal(capture.subjects.find(subject => subject.id === divisions[0].ocdId)?.funcstat, "S");
  const explicit = buildPlaceOwedList({ ...input,
    divisions: [{ id: divisions[0].ocdId, label: "Current input", funcstat: "A" }] });
  assert.equal(explicit.filter(row => row.subject.id.includes("#inventory:")).length, 6, "explicit input status takes precedence");
  const reversed = buildPlaceOwedList({ ...input, subjects: [geography, ...capture.subjects] });
  assert.deepEqual(reversed.map(row => [row.id, row.state, row.held]), rows.map(row => [row.id, row.state, row.held]));
});

test("held fields reach every served division without filling inventory or missing meeting fields", () => {
  const primary = projectHeldPlaceCapture([county], registry, [meetings], at);
  const secondary = projectHeldPlaceCapture([neighbour], registry, [meetings], at);
  assert.deepEqual(secondary, primary, "a shared body serves either place regardless of the original ZIP/job");
  const ids = primary.held.map(field => field.checklistId);
  assert.deepEqual(ids, ["GOV-01", "OFF-04", "OFF-08", "MTG-05", "MTG-06", "MTG-10", "MTG-12"]);
  assert.ok(!ids.includes("OFF-01") && !ids.includes("OFF-05"));
  assert.ok(!ids.includes("MTG-03") && !ids.includes("MTG-16") && !ids.includes("MTG-07") && !ids.includes("MTG-08"));
  assert.equal(primary.held.find(field => field.checklistId === "MTG-06")?.freshUntil, "2026-09-30T07:00:00.000Z");
  assert.equal(projectHeldPlaceCapture(["unrelated-division"], registry, [meetings], at).held.length, 0);
});

test("registry bodies owe civic facts without duplicating product feature work, and retain held observations", () => {
  const capture = projectHeldPlaceCapture([county, neighbour], registry, [], at);
  const existing = { subjectId: "shared-body", checklistId: "ENG-07", state: "held" as const,
    sourceUrl: provenance.sourceUrl, checkedAt: at, freshUntil: "2026-10-01T06:00:00.000Z", value: "Existing observation" };
  const input = { divisions: [county, neighbour].map(id => ({ id, label: id })), ...capture, now: at };
  const rows = buildPlaceOwedList(input);
  const bodyRows = rows.filter(row => row.subject.id === "shared-body");
  assert.equal(capture.subjects.find(subject => subject.id === "shared-body")?.captureKind, "registry-body");
  assert.equal(bodyRows.length, 26, "all 14 government, 8 participation and 4 body reference requirements stay open or captured");
  assert.ok(!bodyRows.some(row => row.checklistId.startsWith("ENG-")));
  assert.ok(bodyRows.some(row => row.checklistId === "GOV-08" && row.state === "missing"));
  assert.ok(bodyRows.some(row => row.checklistId === "PAR-02" && row.state === "missing"));
  assert.deepEqual(bodyRows.find(row => row.checklistId === "GOV-01")?.held,
    capture.held.filter(field => field.subjectId === "shared-body"));
  assert.deepEqual(bodyRows[0].subject.divisionIds, [county, neighbour]);
  const retained = buildPlaceOwedList({ ...input, held: [...capture.held, existing] });
  assert.deepEqual(retained.find(row => row.subject.id === "shared-body" && row.checklistId === "ENG-07")?.held, [existing], "held evidence keeps its row");
  assert.equal(retained.filter(row => row.subject.id === "shared-body" && row.checklistId.startsWith("ENG-")).length, 1, "reader participation is not owed per body; only the held observation shows");
  const unresolved = buildPlaceOwedList({ ...input,
    subjects: [{ id: "unknown-body", kind: "body", divisionIds: [county], label: "Unknown body" }] });
  assert.equal(unresolved.filter(row => row.subject.id === "unknown-body" && row.checklistId.startsWith("ENG-")).length, 0);
  assert.ok(unresolved.some(row => row.subject.id === "unknown-body" && row.checklistId.startsWith("GOV-")));
  assert.equal(rows.filter(row => row.subject.id.includes("#inventory:")).length, 12);
});

test("sittings share calendar discovery work by body while every meeting keeps its own dates and documents", () => {
  const capture = projectHeldPlaceCapture([county, neighbour], registry, [published({ meetings: [
    meeting, { ...meeting, id: "meeting:two" }, { ...meeting, id: "meeting:other", bodyId: "another-body" },
    { ...meeting, id: "meeting:unresolved", bodyId: null },
  ] } as unknown as MeetingsSnapshot)], at);
  const owed = buildPlaceOwedList({ divisions: [county, neighbour].map(id => ({ id, label: id })), ...capture, now: at });
  for (const id of ["meeting:one", "meeting:two", "meeting:other"]) {
    assert.ok(!owed.some(row => row.subject.id === id && row.checklistId === "MTG-03"));
    assert.equal(owed.find(row => row.subject.id === id && row.checklistId === "MTG-06")?.state, "published");
    assert.equal(owed.find(row => row.subject.id === id && row.checklistId === "DOC-01")?.state, "missing");
  }
  const routes = owed.filter(row => row.checklistId === "MTG-03" && row.subject.captureKind === "body-calendar");
  assert.deepEqual(routes.map(row => row.subject.id).sort(), ["another-body#calendar", "shared-body#calendar"]);
  assert.deepEqual(routes.find(row => row.subject.id === "shared-body#calendar")?.subject.divisionIds, [county, neighbour]);
  assert.ok(routes.every(row => row.state === "missing"), "having a meeting never certifies calendar completeness");
  assert.ok(owed.some(row => row.subject.id === "meeting:unresolved" && row.checklistId === "MTG-03"), "an unknown body keeps its route work");
});

test("a known body starts calendar discovery before its first meeting is captured", () => {
  const capture = projectHeldPlaceCapture([county, neighbour], registry, [], at);
  const divisions = [county, neighbour].map(id => ({ id, label: id }));
  const rows = buildPlaceOwedList({ divisions, ...capture, now: at });
  const calendar = rows.filter(row => row.subject.id === "shared-body#calendar");
  assert.equal(calendar.length, 8, "nine calendar items, with the shared MTG-20 counted once under MTG-17");
  assert.ok(calendar.every(row => row.state === "missing" && row.held.length === 0));
  assert.deepEqual(calendar[0].subject.divisionIds, [county, neighbour]);
  assert.ok(!calendar.some(row => row.checklistId === "MTG-06" || row.checklistId.startsWith("DOC-")), "no invented sitting");
  const later = projectHeldPlaceCapture([county, neighbour], registry, [meetings], at);
  const after = buildPlaceOwedList({ divisions, ...later, now: at });
  assert.deepEqual(after.filter(row => row.subject.id === "shared-body#calendar"), calendar, "a first sitting does not complete calendar discovery");
  assert.equal(after.find(row => row.subject.id === meeting.id && row.checklistId === "MTG-06")?.state, "published");
  const secondPlace = buildPlaceOwedList({ divisions: [{ id: neighbour, label: neighbour }], ...capture, now: at });
  assert.deepEqual(secondPlace.filter(row => row.subject.id === "shared-body#calendar"), calendar);
  const empty = buildPlaceOwedList({ divisions, subjects: [], held: [], now: at });
  assert.ok(empty.some(row => row.subject.id === `${county}#inventory:calendar`));
  assert.ok(!empty.some(row => row.subject.captureKind === "body-calendar"), "unknown bodies stay inventory work");
});

test("body rosters retain canonical legislative and local scope without borrowing meaning from titles", () => {
  const state = "ocd-division/country:us/state:oh";
  const territories = [
    `${state}/sldu:7`, `${state}/sldl:7`, `${state}/county:franklin`,
    `${state}/school_district:columbus`, "ocd-division/country:us/district:dc/place:ward_1",
    "ocd-division/country:us/territory:pr/place:ponce", state,
  ];
  const model = { registry: { bodies: territories.map((ocdId, i) => ({ id: `body:${i}`, ocdId,
    name: "Government body", bodyClass: "GOVERNING", provenance })) },
    bodyRosters: territories.map((_, i) => ({ bodyId: `body:${i}`, ...provenance,
      members: [{ id: `member:${i}`, name: "Published member", officeTitle: "President" }] })) } as unknown as RegistryRuntimeReadModel;
  const capture = projectHeldPlaceCapture(territories, published(model), [], at);
  const extra = { subjectId: "member:2", checklistId: "LEG-09", state: "published" as const,
    sourceUrl: provenance.sourceUrl, checkedAt: at, freshUntil: "2026-10-01T06:00:00.000Z", value: "Existing supported field" };
  const owed = buildPlaceOwedList({ divisions: territories.map(id => ({ id, label: id })), ...capture,
    held: [...capture.held, extra], now: at });
  const rows = (i: number) => owed.filter(row => row.subject.id === `member:${i}`);
  for (const i of [0, 1]) {
    assert.ok(rows(i).some(row => row.checklistId === "LEG-02") && !rows(i).some(row => row.checklistId === "LEG-22"));
    assert.ok(!rows(i).some(row => /^(?:EXE|PRL)-/.test(row.checklistId)));
  }
  for (const i of [2, 3, 4, 5]) {
    assert.ok(rows(i).some(row => row.checklistId === "OFF-04" && row.state === "published"));
    assert.ok(rows(i).some(row => row.checklistId === "EXE-01"), "local executives remain possible");
    assert.ok(!rows(i).some(row => /^(?:LEG|PRL)-/.test(row.checklistId) && row.state === "missing"));
  }
  assert.equal(rows(2).find(row => row.checklistId === "LEG-09")?.state, "published", "retain actual held evidence");
  assert.ok(rows(6).some(row => row.checklistId === "PRL-01"), "an unresolved statewide role keeps its work");
  assert.equal(owed.filter(row => row.subject.id.includes("#inventory:")).length, territories.length * 6);
  assert.ok(capture.held.every(field => field.checkedAt === at), "classification does not refresh source clocks");
});

test("only published present fields count, and failed reads cannot look like empty holdings", () => {
  const timed = published({ meetings: [{ ...meeting, startPrecision: "MINUTE", online: { url: "https://cochise.az.gov/meeting" } }] } as unknown as MeetingsSnapshot);
  const result = projectHeldPlaceCapture([county], registry, [timed], at);
  assert.ok(result.held.some(field => field.checklistId === "MTG-07"));
  assert.ok(result.held.some(field => field.checklistId === "MTG-08"));
  const failure = { kind: "STORE_UNREACHABLE", metadata: { recordClass: "MEETING", scope: "held" } } as unknown as CivicDataReadResult<MeetingsSnapshot>;
  assert.throws(() => projectHeldPlaceCapture([county], registry, [failure], at), /HELD_PLACE_READ_FAILED/);
  const sitting = { meetingId: meeting.id, bodyId: meeting.bodyId, ocdId: county, bodyName: "Shared district board",
    startsAt: meeting.startsAt, sourceUrl: provenance.sourceUrl, extraction: "NOT_YET_PUBLISHED",
    extractionNote: "The official minutes cell reads Not available.",
    publication: { observedAt: at, agendaFile: null, minutesFile: null },
    publicationObservations: [{ meetingId: meeting.id, provenance: "FIRST_PARTY_PUBLISHER", report: "NOT_AVAILABLE",
      observedAt: at, observedUrl: provenance.sourceUrl, sourceOrg: "County", evidenceQuote: "Not available", routeId: "INSITE_CALENDAR" }] };
  const outcomes = published({ sittings: [sitting] } as unknown as OutcomeSnapshot);
  const absent = projectHeldPlaceCapture([county], registry, [meetings], at, {}, [outcomes]);
  assert.deepEqual(absent.held.filter(field => field.state === "unpublished").map(field => field.checklistId),
    ["DOC-01", "DOC-02", "DOC-03", "DOC-06"]);
  assert.ok(absent.held.filter(field => field.state === "unpublished").every(field => field.checkedAt === at),
    "reading an official absence retains its actual source clock");
  const later = projectHeldPlaceCapture([county], registry, [meetings], "2026-10-02T06:00:00.000Z", {}, [outcomes]);
  assert.equal(later.held.filter(field => field.state === "unpublished").length, 0, "expired findings reopen the blanks");
  const failed = published({ sittings: [{ ...sitting, extraction: "REQUEST_FAILED", publicationObservations: [] }] } as unknown as OutcomeSnapshot);
  assert.equal(projectHeldPlaceCapture([county], registry, [meetings], at, {}, [failed]).held.filter(field => field.state === "unpublished").length, 0,
    "an empty or failed read is not an official absence");
  const available = published({ sittings: [{ ...sitting, extraction: "RETRIEVED", publicationObservations: [
    ...sitting.publicationObservations, { ...sitting.publicationObservations[0], routeId: "WEB_API", report: "AVAILABLE", observedAt: "2026-09-30T05:59:59.000Z" },
  ] }] } as unknown as OutcomeSnapshot);
  assert.equal(projectHeldPlaceCapture([county], registry, [meetings], at, {}, [available]).held.filter(field => field.state === "unpublished").length, 0,
    "conflicting official surfaces stay open");
});

test("published outcomes retain document status and every linked action and roll without renewing source dates", () => {
  const source = { endpoint: "https://webapi.legistar.com/v1/example/events/7/eventitems", readOn: "2026-08-29", sourceOrg: "Clerk" };
  const actions = [71, 72].map(eventItemId => ({ recordClass: "ACTION_SUMMARY", eventId: 7, eventItemId,
    action: "approve", disposition: "PASSED", tallyText: "Approved", provenance: source }));
  const rolls = [71, 72, 99].map(eventItemId => ({ recordClass: "ROLL_CALL", eventItemId,
    votes: [{ personId: 3, personName: "Member", value: "Abstain", sort: 1 }],
    provenance: { ...source, endpoint: `https://webapi.legistar.com/v1/example/eventitems/${eventItemId}/votes` } }));
  const sitting = { meetingId: meeting.id, eventId: 7, bodyId: meeting.bodyId, ocdId: county, bodyName: "Shared district board",
    startsAt: meeting.startsAt, sourceUrl: provenance.sourceUrl, extraction: "RETRIEVED", publicationObservations: [],
    publication: { observedAt: at, inSiteUrl: provenance.sourceUrl, agendaFile: "https://example.gov/agenda.pdf",
      minutesFile: "https://example.gov/minutes.pdf", minutesStatusName: "Draft", minutesStatusId: 9 },
    agenda: [], outcomes: [...actions, { ...actions[0], eventId: 8, eventItemId: 80 }], rollCalls: rolls };
  const capture = projectHeldPlaceCapture([county], registry, [], at, {},
    [published({ sittings: [sitting] } as unknown as OutcomeSnapshot)]);
  const fields = (id: string) => capture.held.filter(field => field.checklistId === id);
  assert.equal(fields("DOC-08").length, 2, "same-shaped records for distinct items both survive");
  assert.equal(fields("DOC-09").length, 2, "unlinked rolls cannot count as captured meeting votes");
  assert.deepEqual(fields("DOC-08").map(field => field.value), actions.map(action => ({ meetingId: meeting.id, ...action })));
  assert.deepEqual(fields("DOC-09").map(field => field.value), rolls.slice(0, 2).map(roll => ({ meetingId: meeting.id, ...roll })));
  assert.ok([...fields("DOC-08"), ...fields("DOC-09")].every(field => field.checkedAt === source.readOn));
  assert.deepEqual(fields("DOC-06")[0].value, { url: sitting.publication.minutesFile, publisherStatus: "Draft", publisherStatusId: 9 });
  assert.equal(fields("DOC-06")[0].checkedAt, at);
  const owed = buildPlaceOwedList({ divisions: [{ id: county, label: "County" }], ...capture, now: at });
  for (const id of ["DOC-08", "DOC-09"]) assert.equal(owed.find(row => row.subject.id === meeting.id && row.checklistId === id)?.state, "stale");
  for (const id of ["DOC-02", "DOC-03"]) assert.equal(owed.find(row => row.subject.id === meeting.id && row.checklistId === id)?.state, "missing", "pointers are not readable documents");
  const empty = { ...sitting, publication: { ...sitting.publication, minutesStatusName: null }, outcomes: [], rollCalls: [] };
  const unknown = projectHeldPlaceCapture([county], registry, [], at, {},
    [published({ sittings: [empty] } as unknown as OutcomeSnapshot)]);
  assert.ok(!unknown.held.some(field => ["DOC-06", "DOC-08", "DOC-09"].includes(field.checklistId)), "an unclassified pointer or empty extraction cannot fill these facts");
});

test("each roster contact keeps its own source and date", () => {
  const older = "2026-08-01T00:00:00.000Z";
  const sourceUrl = "https://cochise.az.gov/old-roster";
  const contacts = published({ ...registry.value!, bodyRosters: [{ ...registry.value!.bodyRosters[0], members: [{
    ...registry.value!.bodyRosters[0].members[0], email: "office@cochise.az.gov", phone: "520-555-0100",
    websiteUrl: "https://cochise.az.gov/member", termNote: "Term ends in 2028",
    fieldSources: { email: { sourceUrl, sourceOrg: "County", collectedAt: older, verifiedAt: older },
      websiteUrl: { sourceUrl, sourceOrg: "County", collectedAt: older, verifiedAt: older } },
  }] }] });
  const result = projectHeldPlaceCapture([county], contacts, [], at);
  const email = result.held.find(field => field.checklistId === "OFF-09" && (field.value as { email?: string }).email);
  const phone = result.held.find(field => field.checklistId === "OFF-09" && (field.value as { phone?: string }).phone);
  const profile = result.held.find(field => (field.value as { websiteUrl?: string }).websiteUrl);
  assert.equal(email?.checkedAt, older);
  assert.equal(email?.sourceUrl, sourceUrl);
  assert.equal(phone?.checkedAt, at);
  assert.equal(profile?.checkedAt, older);
  assert.ok(result.held.some(field => field.checklistId === "OFF-06"));
});

test("national seats and campaign totals reuse exact division and target joins across ZIPs", () => {
  const families = { rosters: [{ officeholders: [{ id: "official:1", name: "Official One", officeTitle: "Representative",
    provenance, termStart: "2025-01-03", termEnd: "2027-01-03", email: null, phone: null, contactFormUrl: null, partyLabel: null }],
    divisions: [{ officeholderId: "official:1", ocdId: county }, { officeholderId: "official:1", ocdId: neighbour }] }],
    funding: { candidates: [{ fecCandidateId: "H000001", principalCommitteeId: "C000001", cycle: 2026,
      name: "Official One", targetKeys: ["official:1"], provenance,
      totals: { receipts: 0, disbursements: 15, cashOnHand: 20, coverageEndDate: "2026-06-30" } },
      { fecCandidateId: "H000002", principalCommitteeId: "C000002", cycle: 2026, name: "Official One",
        targetKeys: ["unmatched-same-name"], provenance, totals: { receipts: 100 } }] } } as unknown as HeldPlaceFamilies;
  const primary = projectHeldPlaceCapture([county], registry, [], at, families);
  const secondary = projectHeldPlaceCapture([neighbour], registry, [], at, families);
  assert.deepEqual(primary, secondary);
  assert.ok(primary.held.some(field => field.subjectId === "official:1" && field.checklistId === "OFF-06"));
  const totals = primary.held.find(field => field.checklistId === "CAM-05");
  assert.equal((totals?.value as { amount: number }).amount, 0, "published zero remains a zero");
  assert.equal(primary.subjects.find(subject => subject.id.startsWith("fec:"))?.captureKind, "federal-campaign-finance");
  const owed = buildPlaceOwedList({ divisions: [{ id: county, label: "County" }], ...primary, now: at });
  assert.ok(!owed.some(row => row.subject.id.startsWith("fec:") && ["CAM-14", "CAM-15"].includes(row.checklistId)));
  assert.ok(owed.some(row => row.subject.id.startsWith("fec:") && row.checklistId === "CAM-13"));
  assert.ok(!primary.subjects.some(subject => subject.id.includes("H000002")), "same name cannot bind another committee");
  assert.equal(projectHeldPlaceCapture(["other-county"], registry, [], at, families).held.length, 0);
});

test("ballot candidacies, filings and voting sites retain their exact place and publication meaning", () => {
  const state = "ocd-division/country:us/state:az";
  const families = { ballots: [{ election: { id: "az-election", date: "2026-11-03", state: "AZ", name: "General election" },
    contests: [{ id: "contest-1", title: "County Supervisor", ocdId: county, electionId: "az-election", voteFor: 1, termYears: 4, provenance }],
    candidacies: [{ id: "candidate-1", contestId: "contest-1", givenName: "Candidate", familyName: "One", incumbent: null, provenance }],
    measures: [] }],
    votingSites: { jurisdictions: [{ ocdId: county, name: "County", model: "VOTE_CENTER", election: "2026 General",
      sites: [{ id: "site-1", name: "Public hall", address: "1 Main Street" }], refusal: null, sourceUrl: provenance.sourceUrl, collectedAt: at },
      { ocdId: neighbour, sites: [], refusal: { wall: "unread" } }] },
    filings: [{ id: "filing-1", kind: "CANDIDATE_FILING_DOCUMENT", bodyId: "county-body", bodyName: "County",
      ocdId: county, jurisdictionName: "County", sourceUrl: provenance.sourceUrl, documentUrl: "https://cochise.az.gov/filing.pdf",
      collectedAt: at, verifiedAt: at, facts: { candidateName: "Filed Candidate", office: "Supervisor" } }],
    electionDates: [{ state: "AZ", electionDay: "2026-11-03", sourceUrl: provenance.sourceUrl,
      collectedAt: "2026-08-01", steps: [{ label: "Registration deadline", date: "2026-10-05", detail: "11:59 pm" }] }],
  } as unknown as HeldPlaceFamilies;
  const result = projectHeldPlaceCapture([county, state], registry, [], at, families);
  assert.ok(result.held.some(field => field.subjectId === "candidate-1" && field.checklistId === "CAN-02"));
  assert.ok(!result.held.some(field => field.checklistId === "ELE-07"), "filing and candidacy membership do not claim certification");
  assert.deepEqual(result.held.filter(field => field.subjectId === "filing-1").map(field => field.checklistId), ["CAN-01"]);
  assert.ok(result.held.some(field => field.checklistId === "ELE-09"));
  const deadline = result.held.find(field => field.checklistId === "ELE-08");
  assert.equal(deadline?.state, "held");
  assert.equal(deadline?.checkedAt, "2026-08-01");
  assert.ok(Date.parse(deadline!.freshUntil) < Date.parse(at), "adopted calendar is not newly checked by reading it");
  const owed = buildPlaceOwedList({ divisions: [{ id: county, label: "County" }, { id: state, label: "State" }], ...result, now: at });
  assert.deepEqual(owed.filter(row => row.subject.id === deadline!.subjectId).map(row => row.checklistId), ["ELE-08"]);
  assert.ok(owed.filter(row => row.subject.id === "candidate-1").every(row => row.checklistId.startsWith("CAN-")));
  assert.ok(owed.some(row => row.subject.id === `voting-sites:${county}` && row.checklistId === "ELE-22"), "actual site hours remain owed");
  const elsewhere = projectHeldPlaceCapture([neighbour], registry, [], at, families);
  assert.ok(!elsewhere.subjects.some(subject => subject.kind === "contest" || subject.kind === "deadline"));
});

test("canonical legislative roles reach the owed list without guessing from a person's title", () => {
  const state = "ocd-division/country:us/state:mo", district = `${state}/sldl:1`;
  const families = { rosters: [{ officeholders: [
    { id: "congress:test", name: "Federal Member", officeTitle: "Member", level: "FEDERAL", provenance },
    { id: "state:test", name: "State Member", officeTitle: "Member", level: "STATE", provenance },
    { id: "other:test", name: "Unknown Member", officeTitle: "State Senator", level: "LOCAL", provenance },
  ], divisions: [
    { officeholderId: "congress:test", ocdId: state },
    { officeholderId: "state:test", ocdId: district },
    { officeholderId: "other:test", ocdId: county },
  ] }] } as unknown as HeldPlaceFamilies;
  const capture = projectHeldPlaceCapture([state, district, county], registry, [], at, families);
  assert.equal(capture.subjects.find(s => s.id === "congress:test")?.captureKind, "federal-legislator");
  assert.equal(capture.subjects.find(s => s.id === "state:test")?.captureKind, "state-legislator");
  assert.equal(capture.subjects.find(s => s.id === "other:test")?.captureKind, undefined);
  const owed = buildPlaceOwedList({ divisions: [state, district, county].map(id => ({ id, label: id })), ...capture, now: at });
  assert.ok(!owed.some(row => row.subject.id === "state:test" && row.checklistId.startsWith("PRL-")));
  assert.ok(owed.some(row => row.subject.id === "congress:test" && row.checklistId === "PRL-01"));
});

test("unmatched state finance and unreported totals cannot fill published-money fields", () => {
  const makeRecord = (filingState: string, targetKeys: string[], totals: Record<string, unknown>) => ({ dataClass: "STATE_COMMITTEE",
    jurisdiction: "AZ", electionYear: 2026, registeredName: "Committee", candidateNameAsFiled: "Member",
    committeeId: "C1", agency: "Secretary of State", filingsUrl: provenance.sourceUrl, checkedAt: at,
    provenance: { ...provenance, verifiedAt: at }, filingState, targetKeys,
    match: { allThreeAgree: true }, totals,
  });
  const families = { stateMoney: [{ records: [makeRecord("FILED", ["member"], { receipts: 0, expenditures: null, cashOnHand: null, coveringPeriod: "2026 Q2" }),
    makeRecord("LEAD", ["member"], { receipts: 999 }), makeRecord("FILED", ["unknown-person"], { receipts: 888 })] }] } as unknown as HeldPlaceFamilies;
  const result = projectHeldPlaceCapture([county], registry, [], at, families);
  assert.equal(result.held.filter(field => field.checklistId === "CAM-05").length, 1);
  assert.equal((result.held.find(field => field.checklistId === "CAM-05")?.value as { amount: number }).amount, 0);
  assert.ok(!result.held.some(field => field.checklistId === "CAM-06" || field.checklistId === "CAM-07"));
  const owed = buildPlaceOwedList({ divisions: [{ id: county, label: "County" }], ...result, now: at });
  assert.ok(owed.some(row => row.subject.id.startsWith("state-money:") && row.checklistId === "CAM-14"));
  assert.ok(!owed.some(row => row.subject.id.startsWith("state-money:") && ["CAM-13", "CAM-15"].includes(row.checklistId)));
});
