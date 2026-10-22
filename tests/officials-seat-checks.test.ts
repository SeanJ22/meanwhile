import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { CHAMBER_DIRECTORY_URLS, withChamberDirectories } from "../lib/officials/chamber-directory.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { federalDirectoryProjectionIssues } from "../lib/officials/federal-directory-data-plane.ts";
import { rosterChanges } from "../lib/officials/roster-changes.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import { mergePeopleSets } from "../lib/officials/merge-people.ts";
import { normalizeOfficialLegislaturePage } from "../lib/sources/people/legislature.ts";
import { statewidePageText } from "../lib/sources/statewide/parse.ts";
import { publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { readStatePeopleProjection } from "../lib/state-rollcalls/legislators.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import type { PeopleAcquisitionOptions } from "../lib/sources/people/common.ts";

type Source = { file: string; url: string; retrievedAt: string; sha256: string; bytes: number; encoding?: "gzip" };
const manifest = JSON.parse(readFileSync(new URL("./fixtures/or-01/sources.json", import.meta.url), "utf8")) as { sources: Source[] };
function saved(file: string): Source & { body: string } {
  const row = manifest.sources.find(source => source.file === file)!;
  const raw = readFileSync(new URL(`./fixtures/or-01/${file}`, import.meta.url));
  const bytes = row.encoding === "gzip" ? gunzipSync(raw) : raw;
  assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256, `${file} keeps the publisher's bytes`);
  return { ...row, body: bytes.toString("utf8") };
}
const sha = "a".repeat(40), at = "2026-10-13T04:20:00.000Z";
const FL = "ocd-division/country:us/state:fl";
const house = saved("house-current.xml"), senate = saved("senate-current.xml");
const clerk = { finalUrl: CHAMBER_DIRECTORY_URLS.house, body: house.body, retrievedAt: house.retrievedAt };
const senateList = { finalUrl: CHAMBER_DIRECTORY_URLS.senate, body: senate.body, retrievedAt: senate.retrievedAt };

/** The community mirror as it stood before the official lists changed. */
function mirror() {
  const member = (bioguide: string, first: string, last: string, type: "rep" | "sen", extra: Record<string, unknown>) =>
    ({ id: { bioguide }, name: { first, last }, terms: [{ type, state: "FL", start: "2025-01-03", end: "2027-01-03", ...extra }] });
  return normalizeCongressDirectory({ "legislators-current": [
    member("C001127", "Sheila", "Cherfilus-McCormick", "rep", { district: 20 }),
    member("X000019", "Stale", "Holder", "rep", { district: 19 }),
    member("B001257", "Gus", "Bilirakis", "rep", { district: 12 }),
    member("R000595", "Marco", "Rubio", "sen", { class: 3 }),
    member("S001217", "Rick", "Scott", "sen", { class: 1 }),
  ] }, sha, at);
}

test("each member of Congress is checked against the chamber's own current list, and an explicit vacancy shows as vacant", () => {
  const before = mirror();
  const checked = withChamberDirectories(withChamberDirectories(before, "FL", [clerk], before), "FL", [senateList], before);
  const seats = indexByDivision([checked.roster]);
  assert.deepEqual(seats.get(`${FL}/cd:20`) ?? [], [], "the Clerk states FL-20 vacant, so the resigned member no longer holds it");
  const vacancy = checked.vacancies?.find(row => row.ocdId === `${FL}/cd:20`);
  assert.equal(vacancy?.since, "2026-04-21");
  assert.match(vacancy?.reason ?? "", /resignation of Sheila Cherfilus-McCormick/);
  assert.equal(vacancy?.sourceUrl, CHAMBER_DIRECTORY_URLS.house);
  const nineteen = seats.get(`${FL}/cd:19`)!;
  assert.deepEqual(nineteen.map(holder => holder.id), ["congress:D000032"], "the Clerk's named holder replaces the mirror's stale claim");
  assert.equal(nineteen[0].name, "Byron Donalds");
  assert.equal(nineteen[0].sourceUrl, CHAMBER_DIRECTORY_URLS.house);
  assert.deepEqual(seats.get(`${FL}/cd:12`)?.map(holder => holder.id), ["congress:B001257"], "an agreeing mirror holder keeps the mirror's richer record");
  assert.deepEqual(seats.get(FL)?.map(holder => holder.id).sort(), ["congress:M001244", "congress:S001217"], "the Senate's own list names Florida's two senators");
  assert.deepEqual(federalDirectoryProjectionIssues(checked), []);

  const changes = rosterChanges(before.roster, checked.roster, { prior: before.vacancies ?? [], next: checked.vacancies ?? [] });
  assert.ok(changes.some(change => change.kind === "vacant" && change.divisionId === `${FL}/cd:20` && change.since === "2026-04-21" && change.sourceUrl === CHAMBER_DIRECTORY_URLS.house));
  assert.ok(changes.some(change => change.kind === "departed" && change.name === "Sheila Cherfilus-McCormick" && change.sourceUrl === CHAMBER_DIRECTORY_URLS.house));
  assert.ok(changes.some(change => change.kind === "appointed" && change.name === "Ashley Moody" && change.divisionId === FL));
  assert.ok(changes.some(change => change.kind === "departed" && change.name === "Marco Rubio"));
  assert.ok(!changes.some(change => change.name === "Gus Bilirakis"), "an unchanged seat is not reported");

  // The next mirror step, before either chamber is read again, keeps the chambers' verified seats.
  const replayed = withChamberDirectories(mirror(), "FL", [], checked);
  assert.deepEqual(indexByDivision([replayed.roster]).get(`${FL}/cd:19`)?.map(holder => holder.id), ["congress:D000032"]);
  assert.deepEqual(indexByDivision([replayed.roster]).get(`${FL}/cd:20`) ?? [], []);
});

test("an incomplete chamber read can neither remove a seated member nor invent a vacancy", () => {
  const before = mirror();
  const partial = { ...clerk, body: '<MemberData><members><member><statedistrict>FL12</statedistrict><member-info><bioguideID>B001257</bioguideID><official-name>Gus M. Bilirakis</official-name></member-info></member></members></MemberData>' };
  const checked = withChamberDirectories(before, "FL", [partial], before);
  const seats = indexByDivision([checked.roster]);
  assert.deepEqual(seats.get(`${FL}/cd:20`)?.map(holder => holder.id), ["congress:C001127"], "an omitted seat is no statement about who holds it");
  assert.deepEqual(checked.vacancies ?? [], []);
  const cut = withChamberDirectories(before, "FL", [{ ...clerk, body: house.body.slice(0, house.body.indexOf("<statedistrict>GA01")) }], before);
  assert.deepEqual(indexByDivision([cut.roster]).get(`${FL}/cd:19`)?.map(holder => holder.id), ["congress:X000019"], "a cut-off list checks no seat");
  assert.equal(withChamberDirectories(before, "AS", [clerk], null).chambers?.house?.members.length, 1, "the Clerk's AQ00 seat code joins American Samoa by its state field");
});

const fixtureDivisions = (state: string) => ["sldl", "sldu"].flatMap(type => Array.from({ length: 205 }, (_, index) =>
  ({ divisionType: type, ocdId: `ocd-division/country:us/state:${state}/${type}:${index + 1}`, label: `District ${index + 1}` })));
function legislaturePage(file: string, state: string) {
  const page = saved(file);
  const options = { state, sourceId: "official-state-people", asOf: "2026-10-13", signal: new AbortController().signal, divisions: fixtureDivisions(state) } as PeopleAcquisitionOptions;
  return { page, roster: normalizeOfficialLegislaturePage(page.body, page.url, options, page.retrievedAt) };
}

test("legislature roster pages that say a seat is Vacant publish that vacancy in the page's own words", () => {
  for (const [file, state, expected] of [
    ["la-house.html.gz", "la", ["sldl:77", "sldl:92"]],
    ["mo-senate.html.gz", "mo", ["sldu:10"]],
    ["oh-house.html.gz", "oh", ["sldl:89"]],
    ["oh-senate.html.gz", "oh", ["sldu:13"]],
    ["va-house.html.gz", "va", ["sldl:20"]],
    ["md-house.html.gz", "md", []],
  ] as const) {
    const { page, roster } = legislaturePage(file, state);
    assert.deepEqual((roster.vacancies ?? []).map(row => row.ocdId.split("/").at(-1)).sort(), [...expected], file);
    for (const vacancy of roster.vacancies ?? []) {
      assert.equal(vacancy.sourceUrl, page.url);
      assert.equal(vacancy.since, null, `${file}: no departure date is printed, so none is invented`);
      assert.match(vacancy.reason, /^Vacant\b/);
      const words = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      assert.ok(words(statewidePageText(page.body)).includes(words(vacancy.reason)), `${file}: the stated words are on the saved page`);
    }
  }
});

const person = (id: string, name: string, ocdId: string, extra: Partial<Officeholder> = {}): Officeholder => ({ id, personId: id, name, officeTitle: "State Representative",
  level: "STATE", state: "LA", chamber: "lower", termStart: "", termEnd: "", birthDate: null, partyLabel: null, websiteUrl: null, contactFormUrl: null,
  phone: null, email: null, campaignUrl: null, photo: null, memberships: [{ id: `${id}:m`, personId: id, officeId: ocdId, jurisdiction: "US-LA", chamber: "lower", current: true, divisionId: ocdId, sourceUrl: "https://reference.example/" }],
  provenance: { sourceUrl: "https://reference.example/", sourceOrg: "Reference fixture", collectedAt: at, verifiedAt: at }, ...extra });
const set = (officeholders: Officeholder[]): OfficeholderSet => ({ scope: "22", generatedAt: at, officeholders,
  divisions: officeholders.map(holder => ({ officeholderId: holder.id, membershipId: `${holder.id}:m`, ocdId: holder.memberships![0].divisionId!, bodyId: null })), unmatched: [] });

test("a stated vacancy retires another source's holder of that seat, while a holder the same page lists stays", () => {
  const LA77 = "ocd-division/country:us/state:la/sldl:77", LA76 = "ocd-division/country:us/state:la/sldl:76";
  const { roster } = legislaturePage("la-house.html.gz", "la");
  const reference = set([person("legiscan:la:1", "Departed Member", LA77), person("legiscan:la:2", "Seated Member", LA76)]);
  const merged = mergePeopleSets([reference, roster])!;
  const seats = indexByDivision([merged]);
  assert.deepEqual(seats.get(LA77) ?? [], []);
  assert.deepEqual(seats.get(LA76)?.map(holder => holder.name), ["Seated Member"], "a seat the page does not call vacant is untouched");
  // A two-member district: the page lists one sitting member and one vacant seat.
  const D5 = "ocd-division/country:us/state:la/sldl:5", url = "https://legis.example.gov/house/members";
  const html = `<html><head><title>House Members</title></head><body><h1>House of Representatives</h1><table>
    <tr><td><a href="https://legis.example.gov/house/members/jane">Jane Seated</a></td><td>District 5</td></tr>
    <tr><td>Vacant</td><td>District 5</td></tr></table></body></html>`;
  const options = { state: "la", sourceId: "official-state-people", asOf: "2026-10-13", signal: new AbortController().signal, divisions: fixtureDivisions("la"),
    roster: set([person("legiscan:la:jane", "Jane Seated", D5, { websiteUrl: "https://legis.example.gov/house/members/jane" })]) } as PeopleAcquisitionOptions;
  const page = normalizeOfficialLegislaturePage(html, url, options, at);
  assert.equal(page.vacancies?.length, 1);
  const district = indexByDivision([mergePeopleSets([set([person("legiscan:la:jane", "Jane Seated", D5, { websiteUrl: "https://legis.example.gov/house/members/jane" }),
    person("legiscan:la:bob", "Bob Departed", D5)]), page])!]).get(D5)!;
  assert.deepEqual([...new Set(district.map(holder => holder.name))], ["Jane Seated"]);
  // A roster that simply omits a member states nothing about the seat.
  const silent = normalizeOfficialLegislaturePage(html.replace(/<tr><td>Vacant<\/td><td>District 5<\/td><\/tr>/, ""), url, options, at);
  assert.equal(silent.vacancies, undefined);
});

test("an official vacancy publishes from its saved page and reaches the state's readers, and an unsupported one does not", async () => {
  const LA77 = "ocd-division/country:us/state:la/sldl:77";
  const { page, roster } = legislaturePage("la-house.html.gz", "la");
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore();
  const reference = await publishPeopleSource({ vault, store, state: "la", sourceId: "legiscan-api", roster: set([person("legiscan:la:1", "Departed Member", LA77)]),
    acquisitions: [{ requestedUrl: "https://api.legiscan.com/?op=getSessionPeople", finalUrl: "https://api.legiscan.com/?op=getSessionPeople", httpStatus: 200, body: "{}", retrievedAt: at }], releaseId: "reference-1", now: at });
  assert.ok(reference.outcome.promoted, JSON.stringify(reference.outcome.candidate.receipt));
  const acquisitions = [{ requestedUrl: page.url, finalUrl: page.url, httpStatus: 200, body: page.body, retrievedAt: page.retrievedAt }];
  const forged = await publishPeopleSource({ vault, store, state: "la", sourceId: "official-state-people", roster: { ...roster, vacancies: roster.vacancies!.map(row => ({ ...row, reason: "Vacant - District 41" })) },
    acquisitions, releaseId: "forged", now: "2026-10-13T05:00:00.000Z" });
  assert.ok(!forged.outcome.promoted, "a vacancy the saved page does not state cannot publish");
  assert.ok(forged.candidate.semantics.violations.some(row => row.startsWith("PEOPLE_VACANCY_UNVERIFIED:")));
  const published = await publishPeopleSource({ vault, store, state: "la", sourceId: "official-state-people", roster, acquisitions, releaseId: "official-1", now: "2026-10-13T05:01:00.000Z" });
  assert.ok(published.outcome.promoted, JSON.stringify(published.outcome.candidate.receipt));
  const changes = (published.candidate.normalizedPayload as { changes?: { kind: string; divisionId: string }[] }).changes ?? [];
  assert.deepEqual(changes.filter(change => change.kind === "vacant").map(change => change.divisionId).sort(), [LA77, "ocd-division/country:us/state:la/sldl:92"]);
  const read = await readStatePeopleProjection("US-LA", { store, now: "2026-10-13T05:02:00.000Z", bypassCache: true });
  assert.equal(read.kind, "PROMOTED"); if (read.kind !== "PROMOTED") return;
  assert.deepEqual(indexByDivision([read.value.roster]).get(LA77) ?? [], [], "the reader no longer shows the departed member in the vacant seat");
  assert.equal(read.value.roster.vacancies?.find(row => row.ocdId === LA77)?.sourceUrl, page.url);
});
