import assert from "node:assert/strict";
import test from "node:test";
import { withFederalPortraits, placePortraitsScope } from "../lib/officials/federal-directory-read-model.ts";
import { federalDirectoryVersion } from "../lib/officials/people-version.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";

const provenance = { sourceUrl: "https://example.gov/", sourceOrg: "Example", collectedAt: "2026-10-12", verifiedAt: null } as Officeholder["provenance"];
const person = (id: string, extra: Partial<Officeholder> = {}): Officeholder => ({ id, personId: id, name: id, officeTitle: "Representative", level: "FEDERAL", state: "AZ",
  profileUrls: [], termStart: "", termEnd: "", birthDate: null, partyLabel: null, websiteUrl: null, contactFormUrl: null, phone: "202-225-1000", email: null, campaignUrl: null,
  photo: null, social: {}, provenance, ...extra } as Officeholder);
const set = (officeholders: Officeholder[]): OfficeholderSet => ({ scope: "US", generatedAt: "2026-10-12", officeholders, divisions: [], unmatched: [] });
const photo = { url: "https://congress.gov/jane.png" } as unknown as NonNullable<Officeholder["photo"]>;

test("a held portrait is laid on its own person and nothing else about the directory changes", () => {
  const directory = set([person("a"), person("b")]);
  const portraits = set([person("a", { photo, profileUrls: ["https://jane.house.gov/"], phone: null })]);
  const merged = withFederalPortraits(directory, portraits);
  assert.equal(merged.officeholders[0].photo, photo);
  assert.deepEqual(merged.officeholders[0].profileUrls, ["https://jane.house.gov/"]);
  assert.equal(merged.officeholders[0].phone, "202-225-1000", "the directory's contact stays");
  assert.equal(merged.officeholders[1], directory.officeholders[1], "an unmatched person is untouched");
  assert.equal(merged.officeholders.length, 2);
});

test("with no held portrait the directory is returned as it was", () => {
  const directory = set([person("a")]);
  assert.equal(withFederalPortraits(directory, set([person("a")])), directory);
  assert.equal(withFederalPortraits(directory, set([])), directory);
});

test("the served version names the directory and the portraits on it, and is the directory's own when none are held", () => {
  assert.equal(federalDirectoryVersion("dir:1", null), "dir:1");
  assert.notEqual(federalDirectoryVersion("dir:1", "port:1"), federalDirectoryVersion("dir:1", "port:2"));
  assert.notEqual(federalDirectoryVersion("dir:1", "port:1"), federalDirectoryVersion("dir:2", "port:1"));
  assert.equal(federalDirectoryVersion("dir:1", "port:1"), federalDirectoryVersion("dir:1", "port:1"));
  assert.equal(placePortraitsScope("AZ"), "US-AZ:people:portraits:v1", "a place's members of Congress share its portrait record");
});
