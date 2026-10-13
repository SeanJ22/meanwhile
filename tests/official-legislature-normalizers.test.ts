import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { parseLegislatureRoster } from "../lib/sources/official-rosters/legislature.ts";
import { officialLegislatureTarget } from "../lib/sources/official-rosters/targets.ts";

type Fixture = { id: string; state: string; url: string; retrievedAt: string; sha256: string; bytes: number; fixture: string;
  expectedHolders: number | null; expectedVacancies: number; expectedCoveredChambers: string[] };
const directory = new URL("./fixtures/official-rosters/states/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest-observed-states.json", directory), "utf8")) as Fixture[];
function fixture(id: string) {
  const row = manifest.find(row => row.id === id)!;
  const bytes = gunzipSync(readFileSync(new URL(row.fixture, directory)));
  return { ...row, body: bytes.toString("utf8"), bytes };
}
function roster(id: string) {
  const row = fixture(id);
  return parseLegislatureRoster(officialLegislatureTarget(row.state)!, [row], row.retrievedAt);
}

test("committed official pages retain original bytes and normalize exact published seats", () => {
  for (const row of manifest) {
    const document = fixture(row.id);
    assert.equal(document.bytes.byteLength, row.bytes, row.id);
    assert.equal(createHash("sha256").update(document.bytes).digest("hex"), row.sha256, row.id);
    const parsed = roster(row.id);
    if (row.expectedHolders !== null) assert.equal(parsed.officeholders.length, row.expectedHolders, row.id);
    assert.equal(parsed.vacancies?.length, row.expectedVacancies, row.id);
    assert.deepEqual(parsed.coveredChambers, row.expectedCoveredChambers, row.id);
    assert.equal(parsed.unmatched.length, 0, row.id);
    for (const holder of parsed.officeholders) {
      assert.ok(holder.name && holder.memberships?.length === 1 && holder.memberships[0]!.officeId && holder.provenance.sourceUrl);
      assert.equal(holder.provenance.collectedAt, document.retrievedAt);
      assert.ok(parsed.divisions.some(division => division.officeholderId === holder.id), `${row.id}: the source seat reaches its division`);
    }
  }
});

test("the North Carolina roster excludes the deceased holder and publishes the actual appointed successor with its source date", () => {
  const parsed = roster("nc-0");
  assert.ok(!parsed.officeholders.some(holder => holder.name === "Mike Clampitt"));
  const successor = parsed.officeholders.find(holder => holder.name === "Anna Ferguson")!;
  assert.equal(successor.memberships?.[0]?.officeId, "US-NC:lower:119");
  assert.equal(successor.termStart, "2026-04-16");
  assert.equal(successor.provenance.sourceUrl, "https://www.ncleg.gov/Members/MemberList/H");
  assert.equal(parsed.officeholders.filter(holder => holder.memberships?.[0]?.district === "119").length, 1);
  assert.ok(!roster("nc-1").officeholders.some(holder => holder.name === "Bobby Hanig"));
  assert.equal(roster("nc-1").officeholders.find(holder => holder.name === "Jerry Tillett")?.termStart, "2026-09-03");
});

test("explicit publisher vacancies keep their sources and never invent dates from a check time", () => {
  const texas = roster("tx-0");
  assert.deepEqual(texas.vacancies?.map(vacancy => vacancy.id).sort(), ["US-TX:lower:1", "US-TX:lower:93"]);
  assert.ok(texas.vacancies?.every(vacancy => vacancy.since === null && vacancy.provenance.sourceUrl?.startsWith("https://house.texas.gov/members/")));
  const arkansas = roster("ar-all");
  assert.equal(arkansas.officeholders.length + (arkansas.vacancies?.length ?? 0), 135);
  assert.ok(!arkansas.officeholders.some(holder => ["Stan Berry", "Gary Stubblefield", "Carlton Wing"].includes(holder.name)));
  assert.ok(arkansas.vacancies?.every(vacancy => vacancy.since === null));
});

test("a seat URL never becomes a person identity or transfers the departed holder's optional fields", () => {
  const document = fixture("ne-0");
  const target = officialLegislatureTarget("NE")!;
  const before = parseLegislatureRoster(target, [document], document.retrievedAt).officeholders.find(holder => holder.name === "Andersen, Bob")!;
  const after = parseLegislatureRoster(target, [{ ...document, body: document.body.replace("Andersen, Bob", "A new publisher-listed holder") }], document.retrievedAt)
    .officeholders.find(holder => holder.name === "A new publisher-listed holder")!;
  assert.notEqual(before.id, after.id);
  assert.match(before.id, /^official-roster-record:ne:/);
  assert.equal(before.personId, undefined);
  assert.equal(before.nativeIds, undefined);
  assert.equal(after.memberships?.[0]?.officeId, before.memberships?.[0]?.officeId);
});

test("an invalid member district and a truncated document cannot claim complete current coverage", () => {
  const document = fixture("nc-0"), target = officialLegislatureTarget("NC")!;
  assert.throws(() => parseLegislatureRoster(target, [{ ...document, body: document.body.replace(/>District 96</, ">District unavailable<") }], document.retrievedAt), /name, district or native profile URL/);
  assert.throws(() => parseLegislatureRoster(target, [{ ...document, body: document.body.slice(0, -100) }], document.retrievedAt), /truncated/);
});
