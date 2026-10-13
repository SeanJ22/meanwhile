import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { parseLegislatureRoster } from "../lib/sources/official-rosters/legislature.ts";
import { officialLegislatureTarget } from "../lib/sources/official-rosters/targets.ts";

interface SourceFixture { id: string; url: string; fixture: string; sha256: string; bytes: number; retrievedAt: string }
const folder = new URL("./fixtures/official-rosters/states/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest-north-dakota.json", folder), "utf8")) as SourceFixture[];
const documents = manifest.map(item => ({ ...item, sourceBytes: gunzipSync(readFileSync(new URL(item.fixture, folder))) }))
  .map(item => ({ ...item, body: item.sourceBytes.toString("utf8") }));
const target = officialLegislatureTarget("ND")!;
const AT = "2026-10-13T06:00:00.000Z";

test("North Dakota's ten official source pages retain their exact acquired bytes", () => {
  assert.equal(documents.length, 10);
  for (const item of documents) {
    assert.equal(createHash("sha256").update(item.sourceBytes).digest("hex"), item.sha256, item.id);
    assert.equal(item.sourceBytes.byteLength, item.bytes, item.id);
  }
});

test("North Dakota source departure badges replace seven former holders with their listed current successors", () => {
  const roster = parseLegislatureRoster(target, documents, AT);
  assert.equal(roster.currentMembershipComplete, true);
  assert.deepEqual(new Set(roster.coveredChambers), new Set(["lower", "upper"]));
  assert.equal(roster.officeholders.length, 141);
  assert.equal(roster.officeholders.filter(row => row.chamber === "lower").length, 94);
  assert.equal(roster.officeholders.filter(row => row.chamber === "upper").length, 47);
  const former = ["Josh Boschee", "Josh Christy", "Liz Conmy", "Jared C. Hagert", "Emily O'Brien", "Jeremy L. Olson", "Cynthia Schreiber-Beck"];
  assert.equal(roster.officeholders.some(row => former.includes(row.name)), false);
  assert.equal(roster.officeholders.find(row => row.chamber === "upper" && row.memberships?.some(membership => membership.district === "44"))?.name, "Jamie Selzler");
  assert.deepEqual(new Set(roster.officeholders.filter(row => row.chamber === "lower" && row.memberships?.some(membership => membership.district === "27")).map(row => row.name)), new Set(["TJ Brown", "Gregory Stemen"]));
  assert.equal(roster.vacancies?.length, 0);
});

test("North Dakota's shared House districts retain both holders and its published 4A/4B subdistricts", () => {
  const roster = parseLegislatureRoster(target, documents, AT);
  const house = roster.officeholders.filter(row => row.chamber === "lower");
  const district = house.filter(row => row.memberships?.some(membership => membership.district === "27"));
  assert.equal(district.length, 2);
  assert.equal(new Set(district.map(row => row.id)).size, 2);
  assert.equal(roster.divisions.filter(row => row.ocdId.endsWith("/sldl:4a")).length, 1);
  assert.equal(roster.divisions.filter(row => row.ocdId.endsWith("/sldl:4b")).length, 1);
});

test("a last page or an interrupted North Dakota inventory cannot claim whole-chamber completeness", () => {
  const last = parseLegislatureRoster(target, [documents.find(row => row.id === "nd-page-9")!], AT);
  assert.equal(last.currentMembershipComplete, false);
  assert.deepEqual(last.coveredChambers, []);
  const interrupted = parseLegislatureRoster(target, documents.filter(row => row.id !== "nd-page-4"), AT);
  assert.equal(interrupted.currentMembershipComplete, false);
  assert.deepEqual(interrupted.coveredChambers, []);
});
