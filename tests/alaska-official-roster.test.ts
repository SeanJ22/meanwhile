import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { ALASKA_DIRECTORY_URL, alaskaCurrentProfileRoutes, alaskaProfileIssue, parseAlaskaProfile, parseAlaskaRoster } from "../lib/sources/official-rosters/alaska.ts";
import { parseLegislatureRoster } from "../lib/sources/official-rosters/legislature.ts";
import { officialLegislatureTarget } from "../lib/sources/official-rosters/targets.ts";

interface SourceFixture { id: string; url: string; fixture: string; sha256: string; bytes: number; retrievedAt: string }
const folder = new URL("./fixtures/official-rosters/states/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest-alaska.json", folder), "utf8")) as SourceFixture[];
const documents = manifest.map(item => ({ ...item, sourceBytes: gunzipSync(readFileSync(new URL(item.fixture, folder))) }))
  .map(item => ({ ...item, body: item.sourceBytes.toString("utf8") }));
const directory = documents.find(document => document.id === "ak-directory")!;
const AT = "2026-10-13T05:00:00.000Z";

test("Alaska real official directory and profile fixtures retain their source bytes", () => {
  for (const item of documents) {
    assert.equal(createHash("sha256").update(item.sourceBytes).digest("hex"), item.sha256, item.id);
    assert.equal(item.sourceBytes.byteLength, item.bytes, item.id);
  }
  assert.equal(directory.url, ALASKA_DIRECTORY_URL);
});

test("Alaska's source inventory supplies 60 current profile routes without resigned holders or superseded names", () => {
  const routes = alaskaCurrentProfileRoutes(directory.body);
  assert.equal(routes.length, 60);
  assert.equal(routes.some(url => /code=(?:SHO|HUS|RAU|TLT|BUR)$/.test(url)), false);
  assert.ok(routes.every(url => /^https:\/\/www\.akleg\.gov\/basis\/Member\/Detail\/34\?code=[A-Z]{3}$/.test(url)));
  for (const url of routes) {
    const document = documents.find(item => item.url === url)!;
    assert.ok(document, url);
    assert.equal(alaskaProfileIssue(document.body, document.url), null, url);
  }
});

test("Alaska publishes exact profile names, current successors, and source oath dates for all 60 seats", () => {
  const parsed = parseAlaskaRoster(documents, AT);
  assert.equal(parsed.complete, true);
  assert.equal(parsed.records.filter(row => row.chamber === "lower").length, 40);
  assert.equal(parsed.records.filter(row => row.chamber === "upper").length, 20);
  assert.equal(parsed.records.find(row => row.chamber === "lower" && row.district === "26")?.name, "Steve St. Clair");
  assert.equal(parsed.records.find(row => row.chamber === "lower" && row.district === "26")?.termStart, "2025-12-30");
  assert.equal(parsed.records.find(row => row.chamber === "lower" && row.district === "29")?.name, "Garret Nelson");
  assert.equal(parsed.records.find(row => row.chamber === "lower" && row.district === "29")?.termStart, "2025-12-30");
  assert.equal(parsed.records.find(row => row.chamber === "lower" && row.district === "40")?.name, "Robyn Niayuq Frier");
  const senator = parsed.records.find(row => row.chamber === "upper" && row.district === "M")!;
  assert.equal(senator.name, "Cathy Tilton");
  assert.equal(senator.divisionId, "ocd-division/country:us/state:ak/sldu:m");
  assert.equal(parsed.records.some(row => /Mike Shower|Shelley Hughes|Robyn Niayuq Burke/.test(row.name)), false);
  assert.equal(parsed.records.filter(row => row.vacant).length, 0);
  assert.ok(parsed.records.every(row => row.nativeId === row.sourceUrl));
});

test("the shared official-roster normalizer preserves every Alaska seat and publisher-scoped profile identity", () => {
  const urls = [ALASKA_DIRECTORY_URL, ...alaskaCurrentProfileRoutes(directory.body)];
  const known = officialLegislatureTarget("AK")!;
  const target = { ...known, routes: urls, legislatureRoutes: urls.map(url => ({ url, chamber: "both" as const })) };
  const roster = parseLegislatureRoster(target, documents.filter(document => urls.includes(document.url)), AT);
  assert.equal(roster.currentMembershipComplete, true);
  assert.equal(roster.officeholders.length, 60);
  assert.equal(roster.divisions.length, 60);
  assert.equal(roster.unmatched.length, 0);
  assert.equal(roster.divisions.filter(row => row.ocdId.endsWith("/sldu:d")).length, 1);
  assert.equal(roster.officeholders.find(row => row.name === "Jamie Allard")?.nativeIds?.["official-legislature-ak"]?.[0], "https://www.akleg.gov/basis/Member/Detail/34?code=ALR");
});

test("Alaska partial reads publish verified profiles without inventing vacancies for unavailable profiles", () => {
  const allard = documents.find(document => document.id === "ak-profile-alr")!;
  const standalone = parseAlaskaRoster([allard], AT);
  assert.equal(standalone.complete, false);
  assert.equal(standalone.records[0]?.name, "Jamie Allard");
  const partial = parseAlaskaRoster([directory, allard], AT);
  assert.equal(partial.complete, false);
  assert.equal(partial.records.length, 1);
  assert.equal(partial.records.some(row => row.vacant), false);
  assert.equal(partial.unmatched?.length, 59);
});

test("Alaska's actual resigned profile supplies its departure date, while the current directory resolves its successor", () => {
  const shower = documents.find(document => document.id === "ak-profile-sho")!;
  const departed = parseAlaskaProfile(shower.body, shower.url);
  assert.equal(departed.vacant, true);
  assert.equal(departed.since, "2025-11-03");
  const current = parseAlaskaRoster(documents, AT);
  assert.equal(current.records.find(row => row.chamber === "upper" && row.district === "M")?.vacant, false);
});

test("an Alaska profile's sourced departure publishes when its directory still lists the departed holder", () => {
  const shower = documents.find(document => document.id === "ak-profile-sho")!;
  // Retain the real source's departed row as a stale directory entry; the actual profile supplies the departure.
  const lagging = directory.body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, row => {
    if (/code=(?:TTN|HUS)/.test(row)) return "";
    if (/code=SHO/.test(row)) return row.replace(/Resigned November 03, 2025/g, "");
    return row;
  });
  assert.notEqual(lagging, directory.body);
  const parsed = parseAlaskaRoster([{ ...directory, body: lagging }, shower], AT);
  assert.equal(parsed.complete, false);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0]?.vacant, true);
  assert.equal(parsed.records[0]?.since, "2025-11-03");
  assert.ok(parsed.unmatched?.some(row => /Official source disagreement/.test(row.reason)));
});

test("Alaska profile format failures and external profile destinations are explicit acquisition failures", () => {
  assert.match(alaskaProfileIssue("<html><body>Unavailable</body></html>", documents[1]!.url) ?? "", /identity section/);
  assert.throws(() => parseAlaskaProfile(documents[1]!.body, "https://example.com/basis/Member/Detail/34?code=ALR"), /official member URL/);
  assert.throws(() => alaskaCurrentProfileRoutes(directory.body.slice(0, -200)), /truncated/);
});
