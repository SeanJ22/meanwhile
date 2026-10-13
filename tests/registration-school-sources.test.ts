import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { zip } from "../scripts/xlsx.mjs";
import { acquireSchoolRelease, NCES_SCHOOL_CATALOG, schoolListingsFromRelease, schoolReleaseLinks, applyF33NativeCrosswalk } from "../lib/registration/school-sources.ts";
import { referenceGovernmentListings, schoolDistrictSourceAssociations, mergeSchoolGovernmentListings } from "../lib/registration/listings.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { heldRegistrationReceipt } from "../lib/registration/acquire.ts";
import { registrationCandidate } from "../lib/registration/candidate.ts";
import { REGISTRATION_TARGETS } from "../lib/registration/publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { authorityFor } from "../lib/civic-data/source-authority.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", "national-listings", name), "utf8");

function release(csv: string, member = "release.csv"): KnownRelease {
  const bytes = zip([{ name: member, data: Buffer.from(csv) }], "2026-10-01");
  return { sourceId: "nces-ccd", releaseId: "2025-26-directory", bytes, sha256: createHash("sha256").update(bytes).digest("hex"), requestedUrl: "https://nces.ed.gov/ccd/data/zip/test.zip", finalUrl: "https://nces.ed.gov/ccd/data/zip/test.zip", httpStatus: 200, retrievedAt: "2026-10-01T00:00:00Z", sourceObservedAt: "2026-10-01T00:00:00Z", checkedAt: "2026-10-01T00:00:00Z", lastCheckStatus: 200, etag: null, lastModified: null, contentType: "application/zip", reused: true };
}

test("the real page-loaded catalog chooses the newest official directory and F33 flat file", () => {
  assert.equal(schoolReleaseLinks(fixture("nces-lea-catalog.json"), "lea-directory")[0], "https://nces.ed.gov/ccd/data/zip/ccd_lea_029_2526_w_0a_050626.zip");
  assert.equal(schoolReleaseLinks(fixture("nces-f33-catalog.json"), "f33")[0], "https://nces.ed.gov/ccd/Data/zip/sdf23_1a_txt.zip");
  const untrusted = fixture("nces-lea-catalog.json").replaceAll("https://nces.ed.gov/", "https://evil.example/");
  assert.deepEqual(schoolReleaseLinks(untrusted, "lea-directory"), []);
  const ies = fixture("nces-lea-catalog.json").replaceAll("https://nces.ed.gov/ccd/data/zip/", "https://ies.ed.gov/sites/default/files/");
  const iesUrl = schoolReleaseLinks(ies, "lea-directory")[0];
  assert.ok(iesUrl.startsWith("https://ies.ed.gov/sites/default/files/"));
  assert.ok(authorityFor("census-governments-registration", "REGISTRATION", iesUrl).ok);
  assert.throws(() => schoolReleaseLinks("{}", "lea-directory"), /NCES_CATALOG_INVALID/);
});

test("a failed school archive reports its exact known source URL for the durable retry", async () => {
  const { locks } = createMemoryRepositories(), store = new MemoryEvidenceStore();
  const archive = "https://nces.ed.gov/ccd/data/zip/ccd_lea_029_2526_w_0a_050626.zip";
  const observed: string[] = [];
  await assert.rejects(acquireSchoolRelease("lea-directory", { signal: AbortSignal.timeout(10000), store, locks,
    onSourceUrl: url => observed.push(url),
    fetchImpl: (async url => String(url) === NCES_SCHOOL_CATALOG["lea-directory"]
      ? new Response(fixture("nces-lea-catalog.json"))
      : new Response("unavailable", { status: 503 })) as typeof fetch }), /KNOWN_SOURCE_HTTP_503/);
  assert.deepEqual(observed, [NCES_SCHOOL_CATALOG["lea-directory"], archive]);
});

test("real national catalogs and files acquire once, and every state registration publishes from their saved bytes", async () => {
  const { locks } = createMemoryRepositories(), evidence = new MemoryEvidenceStore();
  const directory = release(fixture("nces-lea-directory.csv"));
  const f33 = release(fixture("nces-f33.txt"), "sdf23_1a.txt");
  const calls: string[] = [];
  const fetchImpl = (async url => {
    calls.push(String(url));
    if (String(url) === NCES_SCHOOL_CATALOG["lea-directory"]) return new Response(fixture("nces-lea-catalog.json"));
    if (String(url) === NCES_SCHOOL_CATALOG.f33) return new Response(fixture("nces-f33-catalog.json"));
    if (String(url).includes("ccd_lea_029_2526")) return new Response(Buffer.from(directory.bytes));
    if (String(url).includes("sdf23_1a_txt.zip")) return new Response(Buffer.from(f33.bytes));
    throw new Error(`Unexpected fixture URL: ${url}`);
  }) as typeof fetch;
  // Each acquisition gets its own 120 s budget; the 56-state publication loop below is not an acquisition and must not spend it.
  const options = () => ({ signal: AbortSignal.timeout(120000), store: evidence, locks, fetchImpl, now: () => "2026-10-12T12:00:00.000Z" });
  const leaRelease = await acquireSchoolRelease("lea-directory", options());
  const f33Release = await acquireSchoolRelease("f33", options());
  let associatedStates = 0, mergedStates = 0;
  for (const target of REGISTRATION_TARGETS) {
    const reference = loadRegistrationReference(process.cwd(), target.state);
    const listings = new Map(referenceGovernmentListings(reference).map(row => [row.id, row]));
    const school = schoolListingsFromRelease(reference, leaRelease);
    for (const row of school) listings.set(row.id, row);
    const refreshed = { ...reference, listings: applyF33NativeCrosswalk([...listings.values()], f33Release) };
    const rows = referenceGovernmentListings(refreshed);
    if (school.some(row => row.associations.length)) associatedStates++;
    if (rows.some(row => row.nativeIds.census_pid6 && row.nativeIds.nces_leaid && row.associations.length)) mergedStates++;
    for (const row of rows.filter(row => row.nativeIds.census_pid6 && row.additionalSources?.length)) {
      assert.ok(row.additionalSources!.some(source => source.sourceUrl === leaRelease.requestedUrl));
      assert.ok(row.additionalSources!.some(source => source.sourceUrl === f33Release.requestedUrl));
      assert.ok(row.aliases.some(alias => alias.startsWith(`government:US-${target.state}:nces:`)));
    }
    const candidate = registrationCandidate({ target, reference: refreshed, receipt: heldRegistrationReceipt() });
    const outcome = await processRegisteredRoutineCandidate(new MemoryRoutineDataStore(), target.contractId, candidate, "2026-10-12T12:00:00.000Z");
    assert.equal(outcome.promoted?.versionId, candidate.id, `${target.state}: ${outcome.candidate.failureDetail}`);
  }
  assert.ok(associatedStates >= 51, "source-code school associations cover every state and DC in the real sample");
  assert.ok(mergedStates >= 40, "real F33 native identities connect Census governments across regions");
  await acquireSchoolRelease("lea-directory", options());
  await acquireSchoolRelease("f33", options());
  assert.equal(calls.length, 4, "56 state projections share the same two catalogs and two national files");
});

test("a school source code cannot claim a charter, another state or an ambiguous district layer", () => {
  const prior = loadRegistrationReference(process.cwd(), "AZ");
  const district = schoolListingsFromRelease(prior, release(fixture("nces-lea-directory.csv"))).find(row => row.associations.length)!;
  assert.ok(district);
  const association = district.associations[0];
  assert.equal(association.geoid, district.nativeIds.nces_leaid);
  assert.equal(association.basis, "SOURCE_CODE");
  assert.deepEqual(schoolDistrictSourceAssociations({ ...district, nativeIds: { ...district.nativeIds, nces_charter_lea: "CHRTIDEAESEA" } }, prior.reference), []);
  assert.deepEqual(schoolDistrictSourceAssociations({ ...district, state: "OH" }, prior.reference), []);
  const duplicate = prior.reference.divisions.find(row => row[2] === association.geoid)!;
  assert.deepEqual(schoolDistrictSourceAssociations(district, { ...prior.reference, divisions: [...prior.reference.divisions, duplicate] }), []);
  assert.deepEqual(schoolDistrictSourceAssociations({ ...district, status: "Closed", nativeIds: { ...district.nativeIds, nces_lea_status: "Closed" } }, prior.reference), []);
});

test("merged school contacts retain the source that supplied each chosen value", () => {
  const reference = loadRegistrationReference(process.cwd(), "OH");
  const agencies = schoolListingsFromRelease(reference, release(fixture("nces-lea-directory.csv")));
  const crosswalk = applyF33NativeCrosswalk(referenceGovernmentListings(reference), release(fixture("nces-f33.txt"), "sdf23_1a.txt"));
  const government = crosswalk.find(row => row.nativeIds.census_pid6 && agencies.some(agency => agency.nativeIds.nces_leaid === row.nativeIds.nces_leaid))!;
  const agency = agencies.find(row => row.nativeIds.nces_leaid === government.nativeIds.nces_leaid)!;
  assert.ok(agency.website && agency.officePhone && government.mailingAddress);
  const merged = mergeSchoolGovernmentListings([{ ...government, website: null, officePhone: null }, agency])[0];
  assert.equal(merged.website, agency.website);
  assert.equal(merged.officePhone, agency.officePhone);
  assert.deepEqual(merged.contactProvenance?.website, agency.provenance);
  assert.deepEqual(merged.contactProvenance?.officePhone, agency.provenance);
  assert.deepEqual(merged.contactProvenance?.mailingAddress, government.contactProvenance?.mailingAddress ?? government.provenance);
  const replayed = mergeSchoolGovernmentListings([merged, agency])[0];
  assert.deepEqual(replayed.contactProvenance, merged.contactProvenance, "a later merge preserves the original contact sources");
});

test("LEA publication retains inactive and charter records, native status and office contacts without inventing governments", () => {
  const reference = loadRegistrationReference(process.cwd(), "OH");
  const rows = schoolListingsFromRelease(reference, release('LEAID,LEA_NAME,ST,FIPST,LEA_TYPE,SY_STATUS,PHONE,LSTREET1,LCITY,LSTATE,LZIP\n3900001,Charter Agency,OH,39,7,Closed,555-0100,100 School Ave,Columbus,OH,43215\n3900002,Future Agency,OH,39,1,Future,,,,,\n0400001,Other State,AZ,04,1,Open,,,,,\n'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "Closed"); assert.equal(rows[1].status, "Future");
  assert.ok(rows.every(row => row.kind === "EDUCATION_AGENCY" && row.bodyIds.length === 0 && row.associations.length === 0));
  assert.equal(rows[0].officeAddress, "100 School Ave, Columbus, OH, 43215");
});

test("F33 uses a reversible native crosswalk and leaves ambiguous or unmatched government identities independent", () => {
  const reference = loadRegistrationReference(process.cwd(), "OH");
  const rows = referenceGovernmentListings(reference).filter(row => row.nativeIds.census_pid6).slice(0, 3);
  const source = release(`PID6,LEAID\n${rows[0].nativeIds.census_pid6},3900001\n${rows[1].nativeIds.census_pid6},3900002\n${rows[1].nativeIds.census_pid6},3900003\n`);
  const joined = applyF33NativeCrosswalk(rows, source);
  assert.equal(joined[0].nativeIds.nces_leaid, "3900001");
  assert.equal(joined[0].id, rows[0].id);
  assert.equal(joined[1].nativeIds.nces_leaid, undefined);
  assert.equal(joined[2].nativeIds.nces_leaid, undefined);
  assert.deepEqual(joined[0].bodyIds, []);
  assert.throws(() => applyF33NativeCrosswalk(rows, release("CENSUSID,LEAID\n123456789,3900001\n")),
    /NCES_F33_NATIVE_CROSSWALK_UNAVAILABLE/, "a generic historical Census code is never assumed to be PID6");
});
