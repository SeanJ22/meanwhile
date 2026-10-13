import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseMembers } from "../scripts/nh-gencourt-members.mts";
import { decodeNhPublisherBytes, type NhOfficialDocument } from "../lib/sources/nh-general-court/official-data.ts";
import {
  NH_CURRENT_HOUSE_URL,
  NH_CURRENT_SENATE_URL,
  parseNhCurrentHouseProfile,
  parseNhCurrentHouseRoster,
  parseNhCurrentSenateRoster,
  readNhCurrentMemberIdentities,
} from "../lib/sources/nh-general-court/current-identities.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/or-01/${name}`, import.meta.url), "utf8");
const house = fixture("nh-current-house.html");
const senate = fixture("nh-current-senate.html");
const bulk = parseMembers(decodeNhPublisherBytes(readFileSync(new URL("./fixtures/or-01/nh-members.txt", import.meta.url))));
function document(url: string, body: string): NhOfficialDocument {
  return { requestedUrl: url, finalUrl: url, httpStatus: 200, body, retrievedAt: "2026-10-13T06:00:00.000Z" };
}
const read = async (url: string) => {
  if (url === NH_CURRENT_HOUSE_URL) return document(url, house);
  if (url === NH_CURRENT_SENATE_URL) return document(url, senate);
  if (url.endsWith("?pid=806")) return document(url, fixture("nh-house-profile-806.html"));
  throw new Error(`No official fixture for ${url}`);
};

test("current official House and Senate fixtures expose exact PersonIDs for all 406 members", () => {
  const representatives = parseNhCurrentHouseRoster(house);
  assert.equal(representatives.length, 382);
  assert.deepEqual(representatives.find(row => row.personId === "806"), { personId: "806", familyName: "Aldrich", givenName: "Glen", seatNo: "2080" });
  assert.equal(representatives.find(row => row.personId === "11420")?.familyName, "Sabourin dit Choinière");
  const senators = parseNhCurrentSenateRoster(senate);
  assert.equal(senators.length, 24);
  assert.equal(senators.find(row => row.district === "1")?.personId, "11458");
  assert.equal(senators.find(row => row.district === "21")?.familyName, "Perkins Kwoka");
  assert.equal(senators.find(row => row.district === "21")?.personId, "9856");
  assert.equal(new Set([...representatives, ...senators].map(row => row.personId)).size, 406);
});

test("current chamber rosters replace stale bulk status while preserving exact identity and every source row", async () => {
  assert.equal(bulk.members.find(row => row.familyName === "Aldrich")?.electedStatus, "FORMER");
  const requested: string[] = [];
  const acquired = await readNhCurrentMemberIdentities({ extraction: bulk, read: async url => { requested.push(url); return read(url); } });
  assert.deepEqual(requested.sort(), [NH_CURRENT_HOUSE_URL, NH_CURRENT_SENATE_URL].sort());
  assert.deepEqual(acquired.extraction.byChamber, { H: 382, S: 24 });
  assert.equal(acquired.extraction.counts.logicalInput, 406);
  assert.equal(acquired.extraction.counts.produced, 406);
  assert.equal(acquired.extraction.counts.dropped, 0);
  assert.equal(acquired.currentRosterComplete, true);
  assert.deepEqual(acquired.crosswalk.unresolved, ["House seat selector PersonID 517 (seat 5004) is absent from the current member roster."]);
  const alder = acquired.crosswalk.matches.find(row => row.officialPersonId === "806")!;
  assert.equal(alder.member.electedStatus, "INCUMBENT");
  assert.equal(alder.member.county, "Belknap");
  assert.equal(alder.member.district, "6");
  assert.equal(alder.officeholderId, "nh-general-court:806");
  assert.equal(alder.matchBasis, "EXACT_OFFICIAL_ROSTER_ID");
  assert.deepEqual(acquired.memberSourceUrls[alder.officeholderId], [NH_CURRENT_HOUSE_URL, "https://gc.nh.gov/downloads/Members.txt"]);
  assert.equal(acquired.documents.length, 2);
});

test("a member missing from the bulk export is recovered from its exact PersonID profile", async () => {
  const extraction = { ...bulk, members: bulk.members.filter(row => row.familyName !== "Aldrich") };
  const acquired = await readNhCurrentMemberIdentities({ extraction, read });
  const member = acquired.crosswalk.matches.find(row => row.officialPersonId === "806")!;
  assert.equal(member.member.district, "6");
  assert.equal(member.member.seatNo, "2080");
  assert.equal(acquired.extraction.counts.produced, 406);
  assert.equal(acquired.currentRosterComplete, true);
  assert.deepEqual(acquired.crosswalk.unresolved, ["House seat selector PersonID 517 (seat 5004) is absent from the current member roster."]);
  assert.equal(acquired.documents.length, 3);
  assert.deepEqual(acquired.memberSourceUrls[member.officeholderId], [NH_CURRENT_HOUSE_URL, "https://gc.nh.gov/house/members/member.aspx?pid=806"]);
});

test("an inaccessible new member profile is accounted for without withholding other verified officials", async () => {
  const extraction = { ...bulk, members: bulk.members.filter(row => row.familyName !== "Aldrich") };
  const acquired = await readNhCurrentMemberIdentities({ extraction, read: async url => {
    if (url.includes("?pid=")) throw new Error("Official profile unavailable");
    return read(url);
  } });
  assert.equal(acquired.extraction.counts.logicalInput, 406);
  assert.equal(acquired.extraction.counts.produced, 405);
  assert.equal(acquired.extraction.counts.dropped, 1);
  assert.equal(acquired.currentRosterComplete, false);
  assert.equal(acquired.crosswalk.unresolved?.length, 2);
  assert.ok(acquired.crosswalk.unresolved!.some(detail => /Glen Aldrich .*806.*Official profile unavailable/.test(detail)));
  assert.ok(acquired.crosswalk.matches.some(row => row.officialPersonId === "11458"));
});

test("House profile identity and seat conflicts cannot fabricate a current district", () => {
  const identity = parseNhCurrentHouseRoster(house).find(row => row.personId === "806")!;
  assert.equal(parseNhCurrentHouseProfile(fixture("nh-house-profile-806.html"), identity).county, "Belknap");
  assert.throws(() => parseNhCurrentHouseProfile(fixture("nh-house-profile-806.html"), { ...identity, seatNo: "2081" }), /conflicts/);
  assert.throws(() => parseNhCurrentHouseProfile(fixture("nh-house-profile-806.html"), { ...identity, givenName: "Glenn" }), /conflicts/);
});

test("official selector and Senate identity omissions are reported instead of dropping source records", () => {
  assert.throws(() => parseNhCurrentHouseRoster(house.replace('<option value="806">2080</option>', "")), /disagree/);
  assert.throws(() => parseNhCurrentSenateRoster(senate.replace('legislation.aspx?id=11458', 'legislation.aspx?id=')), /exact numeric/);
  assert.throws(() => parseNhCurrentSenateRoster(senate.replace('legislation.aspx?id=11458', 'legislation.aspx?id=10595')), /repeats/);
});

test("one unavailable chamber records its failure and publishes the other chamber's independently verified members", async () => {
  const acquired = await readNhCurrentMemberIdentities({ extraction: bulk, read: async url => {
    if (url === NH_CURRENT_HOUSE_URL) throw new Error("House source unavailable");
    return read(url);
  } });
  assert.equal(acquired.crosswalk.matches.length, 24);
  assert.equal(acquired.currentRosterComplete, false);
  assert.match(acquired.crosswalk.unresolved![0]!, /House source unavailable/);
});
