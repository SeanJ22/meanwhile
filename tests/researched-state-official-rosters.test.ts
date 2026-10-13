import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";

import { parseResearchedLegislature } from "../lib/sources/official-rosters/researched-states.ts";
import { first, nodes, parseHtml, textOf } from "../lib/sources/official-rosters/html.ts";
import { GEORGIA_MEMBER_URL_PREFIX, GEORGIA_SESSIONS_URL, georgiaCurrentSession, georgiaPublicApiRequest, georgiaPublicTokenRequest, officialRosterRequest } from "../lib/sources/official-rosters/request.ts";

type Fixture = {
  id: string;
  state: string;
  url: string;
  fixture: string;
  retrievedAt: string;
  sha256: string;
  bytes: number;
  expectedRecords?: number;
  expectedComplete?: boolean;
  expectedFailure?: string;
};

const directory = new URL("./fixtures/official-rosters/states/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest-researched-states.json", directory), "utf8")) as Fixture[];
function fixture(id: string) {
  const item = manifest.find(row => row.id === id)!;
  const bytes = gunzipSync(readFileSync(new URL(item.fixture, directory)));
  return { ...item, body: bytes.toString("utf8"), sourceBytes: bytes };
}
function roster(id: string) {
  const item = fixture(id);
  return parseResearchedLegislature(item.state, item)!;
}

test("official source fixtures retain publisher bytes and parse every observed territorial seat", () => {
  for (const item of manifest) {
    const observed = fixture(item.id);
    assert.equal(observed.sourceBytes.byteLength, item.bytes, item.id);
    assert.equal(createHash("sha256").update(observed.sourceBytes).digest("hex"), item.sha256, item.id);
    if (item.expectedRecords === undefined) continue;
    const parsed = parseResearchedLegislature(item.state, observed)!;
    assert.equal(parsed.records.length, item.expectedRecords, item.id);
    assert.equal(parsed.complete, item.expectedComplete, item.id);
    for (const record of parsed.records) {
      assert.ok(record.name && record.district && /^https:\/\//.test(record.sourceUrl), `${item.id}: verified minimum`);
    }
  }
});

test("Colorado's real resignation removes Rutinel and the listed successor replaces Michaelson Jenet", () => {
  const parsed = roster("co-both");
  const vacant = parsed.records.find(row => row.chamber === "lower" && row.district === "32")!;
  assert.equal(vacant.vacant, true);
  assert.equal(vacant.since, "2026-09-04");
  assert.equal(vacant.sourceUrl, "https://leg.colorado.gov/legislators");
  assert.equal(parsed.records.some(row => /Rutinel|Michaelson Jenet/.test(row.name)), false);
  assert.equal(parsed.records.find(row => row.chamber === "upper" && row.district === "21")?.name, "Benavidez, Adrienne");
});

test("Florida distinguishes deceased and resigned former members from successors and explicit vacancies", () => {
  const parsed = roster("fl-house");
  assert.equal(parsed.records.some(row => /Casello|Persons-Mulicka|Steele, Kevin/.test(row.name)), false);
  assert.equal(parsed.records.find(row => row.district === "90")?.vacant, false);
  assert.equal(parsed.records.find(row => row.district === "78")?.since, "2026-05-20");
  assert.equal(parsed.records.find(row => row.district === "55")?.since, "2026-08-05");
  assert.equal(parsed.records.find(row => row.district === "116")?.since, "2026-08-21");
  assert.equal(parsed.records.filter(row => row.vacant).length, 4);
});

test("Iowa's publisher term ranges never leave a departed person as the current holder", () => {
  const house = roster("ia-both");
  assert.equal(house.records.find(row => row.district === "100")?.name, "Blaine C. Watkins");
  assert.equal(house.records.some(row => /Martin L. Graber|Michael V. Sexton/.test(row.name)), false);
  assert.equal(house.records.find(row => row.district === "38")?.since, "2026-10-05");
  const senate = roster("ia-senate");
  assert.equal(senate.records.find(row => row.district === "16")?.name, "Renee Hardman");
  assert.equal(senate.records.some(row => /Claire Celsi|Rocky De Witt/.test(row.name)), false);
});

test("Maine's source departure badges allow its listed successors to replace deceased and resigned holders", () => {
  const parsed = roster("me-house-roster");
  assert.equal(parsed.records.some(row => /Kathy Javner|Kristen Cloutier/.test(row.name)), false);
  assert.equal(parsed.records.find(row => row.district === "29")?.name, "Nancy Theriault");
  assert.equal(parsed.records.find(row => row.district === "94")?.name, "Scott Harriman");
  assert.equal(parsed.complete, false);
  const document = parseHtml(fixture("me-house-roster").body);
  const rows = nodes(document, node => node.tag === "tr" && !!first(node, child => child.tag === "a" && /\/MemberProfiles\/Details\//.test(child.attrs.href ?? "")));
  const current = rows.filter(row => !/\b(?:Resigned|Deceased)\b/.test(textOf(row)));
  assert.equal(current.length, 153);
  assert.equal(current.filter(row => /\bTribal Representative\b/.test(textOf(row))).length, 2);
  assert.equal(parsed.records.length, 151);
});

test("Idaho preserves two distinct House seats in each district and renders source name entities", () => {
  const parsed = roster("id-house");
  const district = parsed.records.filter(row => row.district === "4");
  assert.equal(district.length, 2);
  assert.deepEqual(new Set(district.map(row => row.seat)), new Set(["A", "B"]));
  assert.ok(district.every(row => row.nativeId === undefined));
  assert.ok(district.every(row => row.seatBound));
  assert.ok(parsed.records.some(row => row.name === "Robert “Rob” Beiswenger"));
  assert.ok(parsed.records.some(row => row.name === "Soñia R. Galaviz"));
});

test("Massachusetts keeps its published named districts and explicit vacant seats", () => {
  const parsed = roster("ma-both");
  assert.equal(parsed.records.find(row => row.name === "Homar Gómez")?.district, "2nd Hampshire");
  const vacancy = parsed.records.find(row => row.district === "1st Franklin")!;
  assert.equal(vacancy.vacant, true);
  assert.equal(vacancy.since, undefined);
  assert.equal(vacancy.divisionId, undefined);
});

test("a partial official response cannot claim the missing seats were checked", () => {
  const actual = fixture("mn-senate-json");
  const data = JSON.parse(actual.body) as { members: unknown[] };
  data.members.pop();
  const partial = parseResearchedLegislature("mn", { ...actual, body: JSON.stringify(data) })!;
  assert.equal(partial.records.length, 66);
  assert.equal(partial.complete, false);
  assert.equal(roster("ks-house-roster").complete, false);
  const html = fixture("co-both");
  assert.throws(() => parseResearchedLegislature("co", { ...html, body: html.body.slice(0, -200) }), /truncated/);
  assert.throws(() => parseResearchedLegislature("ga", fixture("ga-house")));
});

test("Georgia uses its official current session inventory and public website authentication protocol", () => {
  const sessions = fixture("ga-sessions-json");
  assert.equal(sessions.url, GEORGIA_SESSIONS_URL);
  const id = georgiaCurrentSession(sessions.sourceBytes);
  assert.equal(id, "1033");
  assert.equal(fixture("ga-roster-1033").url, GEORGIA_MEMBER_URL_PREFIX + id);
  const now = "2026-10-13T04:23:00.000Z";
  const auth = georgiaPublicTokenRequest(now);
  const authUrl = new URL(auth.url);
  assert.equal(authUrl.origin, "https://www.legis.ga.gov");
  assert.equal(authUrl.pathname, "/api/authentication/token");
  assert.equal(authUrl.searchParams.get("ms"), String(new Date(now).getTime()));
  assert.equal(authUrl.searchParams.get("key")?.length, 128);
  assert.throws(() => georgiaPublicApiRequest("public-session-test", "https://other.example/api/"), /official API/);
  assert.throws(() => georgiaCurrentSession(Buffer.from("[]")), /one current/);
});

test("Delaware JSON rosters preserve their observed POST semantics", () => {
  const source = fixture("de-house-post");
  const request = officialRosterRequest({ state: "DE" }, source.url, source.retrievedAt);
  assert.equal(request.method, "POST");
  assert.equal(request.body, "");
  const parsed = roster("de-house-post");
  assert.equal(parsed.records.find(row => row.district === "1")?.name, "Nnamdi O. Chukwuocha");
});
