import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { zip } from "../scripts/xlsx.mjs";
import { acquireSchoolRelease, NCES_DIRECTORY, schoolListingsFromRelease, schoolReleaseLinks, applyF33NativeCrosswalk } from "../lib/registration/school-sources.ts";
import { referenceGovernmentListings } from "../lib/registration/listings.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

function release(csv: string): KnownRelease {
  const bytes = zip([{ name: "release.csv", data: Buffer.from(csv) }], "2026-10-01");
  return { sourceId: "nces-ccd", releaseId: "2025-26-directory", bytes, sha256: createHash("sha256").update(bytes).digest("hex"), requestedUrl: "https://nces.ed.gov/ccd/data/zip/test.zip", finalUrl: "https://nces.ed.gov/ccd/data/zip/test.zip", httpStatus: 200, retrievedAt: "2026-10-01T00:00:00Z", sourceObservedAt: "2026-10-01T00:00:00Z", checkedAt: "2026-10-01T00:00:00Z", lastCheckStatus: 200, etag: null, lastModified: null, contentType: "application/zip", reused: true };
}

test("only explicit official directory archive links become acquisition targets", () => {
  const html = '<a href="Data/zip/ccd_lea_029_2526_w_0a_050626.zip">Directory</a><a href="https://evil.example/ccd_lea_029_2526.zip">Other</a><a href="Data/zip/sdf23_1a.zip">F33</a>';
  assert.deepEqual(schoolReleaseLinks(html, "lea-directory"), ["https://nces.ed.gov/ccd/Data/zip/ccd_lea_029_2526_w_0a_050626.zip"]);
  assert.deepEqual(schoolReleaseLinks(html, "f33"), ["https://nces.ed.gov/ccd/Data/zip/sdf23_1a.zip"]);
  assert.deepEqual(schoolReleaseLinks("<html>Download unavailable</html>", "f33"), []);
});

test("a failed school archive reports its exact known source URL for the durable retry", async () => {
  const { locks } = createMemoryRepositories(), store = new MemoryEvidenceStore();
  const archive = "https://nces.ed.gov/ccd/Data/zip/ccd_lea_029_2526_w_0a_050626.zip";
  const observed: string[] = [];
  await assert.rejects(acquireSchoolRelease("lea-directory", { signal: AbortSignal.timeout(10000), store, locks,
    onSourceUrl: url => observed.push(url),
    fetchImpl: (async url => String(url) === NCES_DIRECTORY
      ? new Response(`<a href="${archive}">Directory</a>`)
      : new Response("unavailable", { status: 503 })) as typeof fetch }), /KNOWN_SOURCE_HTTP_503/);
  assert.deepEqual(observed, [NCES_DIRECTORY, archive]);
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
});
