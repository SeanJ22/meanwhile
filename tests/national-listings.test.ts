import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { zip } from "../scripts/xlsx.mjs";
import { parseCsv } from "../lib/reference/index.ts";
import { censusGovernmentContacts } from "../lib/registration/census-contacts.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { registrationReferenceFromRelease } from "../lib/registration/source-reference.ts";
import { referenceGovernmentListings } from "../lib/registration/listings.ts";
import { governmentListingEvidence } from "../lib/ask/government-listings.ts";
import { governmentListingsForDivisions } from "../lib/registry/server.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";
import type { RegistrationReadModel } from "../lib/registration/candidate.ts";

const sourceUrl = "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP";
const fixture = readFileSync(new URL("./fixtures/national-listings/census-government-sample.csv", import.meta.url), "utf8");
const [header, ...rows] = parseCsv(fixture);
const bytes = zip([{ name: "government-sample.csv", data: Buffer.from(fixture) }], "2026-09-23");
const release: KnownRelease = { sourceId: "census-governments-registration", releaseId: "cog-2022", bytes,
  sha256: createHash("sha256").update(bytes).digest("hex"), requestedUrl: sourceUrl, finalUrl: sourceUrl, httpStatus: 200,
  retrievedAt: "2026-09-23T00:00:00.000Z", sourceObservedAt: "2026-09-23T00:00:00.000Z", checkedAt: "2026-09-23T00:00:00.000Z",
  lastCheckStatus: 200, etag: null, lastModified: null, contentType: "application/zip", reused: true };

test("real Census contact values reach the area's listing and Ask in five regions", async () => {
  for (const row of rows) {
    const get = (field: string) => row[header.indexOf(field)];
    const state = get("state");
    const reference = registrationReferenceFromRelease(loadRegistrationReference(process.cwd(), state), release);
    const listing = referenceGovernmentListings(reference).find(item => item.nativeIds.census_pid6 === get("census_id_pid6"));
    assert.ok(listing);
    assert.equal(listing.contactTitle, get("title"));
    assert.ok(listing.mailingAddress?.startsWith(get("address1")));
    assert.ok(listing.mailingAddress?.includes(get("city")));
    assert.equal(listing.website, new URL(get("web_address")).href);
    assert.ok(listing.associations.length);
    const value = { state, governments: [listing], divisions: [], bodies: [] } as unknown as RegistrationReadModel;
    await withReaderAuthorityEdge({ edgeOnly: true, registrations: { states: new Set([state.toLowerCase()]), load: async code => {
      assert.equal(code, state.toLowerCase()); return { value, versionId: `fixture:${state}` };
    } } }, async () => {
      const read = await governmentListingsForDivisions(listing.associations.map(link => link.divisionId));
      assert.equal(read.records.length, 1);
      assert.equal(read.records[0].mailingAddress, listing.mailingAddress);
      const evidence = governmentListingEvidence(read.records[0]);
      assert.ok(evidence.text.includes(get("address1")) && evidence.text.includes(listing.website!));
      assert.equal(evidence.sourceUrl, sourceUrl);
    });
  }
});

test("a Census row without a street address stays blank while its other contact facts publish", () => {
  const fields: Record<string, string> = { TITLE: "CLERK", CITY: "Town", STATE: "AZ", ZIP: "85001", WEB_ADDRESS: "example.gov" };
  const contacts = censusGovernmentContacts((...names) => names.map(name => fields[name] ?? "").find(Boolean) ?? "");
  assert.equal(contacts.mailingAddress, null);
  assert.equal(contacts.contactTitle, "CLERK");
  assert.equal(contacts.website, "http://example.gov/");
});
