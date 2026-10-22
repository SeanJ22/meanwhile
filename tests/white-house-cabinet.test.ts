import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { acquirePresidentPeople, cabinetLinks, currentCabinet, verifiedWhiteHouseOfficial, ADMINISTRATION_URL } from "../lib/sources/white-house/president.ts";
import { statewidePageText } from "../lib/sources/statewide/parse.ts";
import { whiteHouseOffice } from "../lib/officials/white-house-offices.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { readPeopleSourceProjection } from "../lib/civic-data/people-source-read.ts";
import { sourceAuthority } from "../lib/civic-data/source-authority.ts";
import { currentPresidentRoster } from "../lib/reader/national.ts";
import { stateCoverage } from "../lib/reader/coverage.ts";
import type { ReaderStatePackage } from "../lib/reader/state.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";

const SOURCE = "statewide-executive-sources", COUNTRY = "ocd-division/country:us";
const CABINET = `${ADMINISTRATION_URL}cabinet/`, OLD_CABINET = `${ADMINISTRATION_URL}the-cabinet/`;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/white-house/${name}.html`, import.meta.url), "utf8");
const REAL: Record<string, string> = {
  [ADMINISTRATION_URL]: fixture("administration"),
  [`${ADMINISTRATION_URL}donald-j-trump/`]: fixture("donald-j-trump"),
  [`${ADMINISTRATION_URL}jd-vance/`]: fixture("jd-vance"),
  [CABINET]: fixture("cabinet"),
};
const CABINET_MEMBERS = [
  ["Scott Bessent", "Secretary of the Treasury"], ["Todd Blanche", "Attorney General"], ["Doug Burgum", "Secretary of the Interior"],
  ["Jay Clayton", "Director of National Intelligence"], ["Doug Collins", "Secretary of Veterans Affairs"], ["Sean Duffy", "Secretary of Transportation"],
  ["Jamieson Greer", "United States Trade Representative"], ["Pete Hegseth", "Secretary of War"], ["Robert F. Kennedy, Jr.", "Secretary of Health and Human Services"],
  ["Kelly Loeffler", "Administrator of the Small Business Administration"], ["Howard Lutnick", "Secretary of Commerce"], ["Linda McMahon", "Secretary of Education"],
  ["Markwayne Mullin", "Secretary of Homeland Security"], ["John Ratcliffe", "Director of the Central Intelligence Agency"], ["Brooke Rollins", "Secretary of Agriculture"],
  ["Marco Rubio", "Secretary of State"], ["Keith Sonderling", "Secretary of Labor"], ["Scott Turner", "Secretary of Housing and Urban Development"],
  ["Russ Vought", "Director of the Office of Management and Budget"], ["Chris Wright", "Secretary of Energy"], ["Lee Zeldin", "Administrator of the Environmental Protection Agency"],
];

/** Serves whitehouse.gov pages; the old Cabinet path redirects to the current one, as the live site does. */
async function acquire(pages: Record<string, string>, at: string) {
  const { locks } = createMemoryRepositories(), store = new MemoryEvidenceStore(), requests: string[] = [];
  const release = await acquirePresidentPeople({ store, locks, now: () => at, signal: new AbortController().signal, acquire: acquireKnownRelease,
    fetchImpl: (async resource => {
      const url = String(resource), final = url === OLD_CABINET ? CABINET : url;
      requests.push(url);
      if (!(final in pages)) return new Response("not found", { status: 404 });
      const response = new Response(pages[final], { headers: { "content-type": "text/html" } });
      Object.defineProperty(response, "url", { value: final });
      return response;
    }) as typeof fetch });
  return { ...release, requests };
}

function readerState(president: ReaderStatePackage["president"]): ReaderStatePackage {
  return { state: "AZ", version: "fixture", boundaryUrl: "/boundaries.pmtiles", president,
    registry: { formatVersion: 1, registry: { generatedAt: "2026-10-22T00:00:00.000Z", divisions: [{ ocdId: `${COUNTRY}/state:az`, label: "Arizona", divisionType: "state", tier: "state" }], bodies: [] },
      bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
      officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } } as unknown as RegistryRuntimeReadModel,
    federal: null, people: null, legislativePeople: null,
    stateLegislatorAuthority: { scope: "US-AZ", kind: "NOT_RECORDED", metadata: {}, code: null, detail: "fixture" },
  } as unknown as ReaderStatePackage;
}

test("the national executive source is re-read under a new parser version", () => {
  assert.equal(sourceAuthority(SOURCE)?.parserVersion, "people-sources/2");
  assert.equal(sourceAuthority("official-state-people")?.parserVersion, "people-sources/1");
});

test("one classification names the President, the Vice President and each Cabinet office", () => {
  assert.equal(whiteHouseOffice("President of the United States"), "president");
  assert.equal(whiteHouseOffice("Vice President"), "vice-president");
  assert.equal(whiteHouseOffice("Secretary of the Treasury"), "cabinet:secretary-of-the-treasury");
  assert.equal(whiteHouseOffice("United States Trade Representative"), "cabinet:united-states-trade-representative");
  for (const [, title] of CABINET_MEMBERS) assert.ok(whiteHouseOffice(title)?.startsWith("cabinet:"), title);
  for (const title of ["U.S. Senator", "U.S. Representative", "Governor", "First Lady", "Secretary"]) assert.equal(whiteHouseOffice(title), null, title);
});

test("today's real whitehouse.gov pages yield the President, the Vice President and all 21 Cabinet members, and the reader shows every one", async () => {
  const at = "2026-10-22T06:30:00.000Z", release = await acquire(REAL, at);
  assert.deepEqual(release.gaps, []);
  assert.equal(release.roster.currentMembershipComplete, true);
  const people = release.roster.officeholders;
  assert.equal(people.length, 23);
  assert.deepEqual(people.slice(0, 2).map(person => [person.name, person.officeTitle]),
    [["Donald J. Trump", "President of the United States"], ["JD Vance", "Vice President of the United States"]]);
  assert.deepEqual(people.slice(2).map(person => [person.name, person.officeTitle]), CABINET_MEMBERS);
  const cabinetText = statewidePageText(REAL[CABINET]);
  for (const person of people.slice(2)) {
    assert.equal(person.provenance.sourceUrl, CABINET);
    assert.equal(person.provenance.quote, `${person.name} ${person.officeTitle}`);
    assert.ok(cabinetText.includes(person.provenance.quote!), person.name);
    assert.equal(person.memberships?.[0].sourceUrl, CABINET);
    assert.equal(person.memberships?.[0].divisionId, COUNTRY);
    assert.equal(person.contactFormUrl, null, "the White House contact form is not a department head's contact");
  }
  assert.equal(new Set(people.map(person => person.id)).size, 23);
  assert.equal(release.coverage.offices.length, 23);
  assert.ok(release.coverage.offices.every(office => office.verified));
  assert.ok(release.coverage.offices.some(office => office.office === "cabinet:secretary-of-the-treasury"));
  assert.ok(release.requests.includes(CABINET));

  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore();
  const published = await publishPeopleSource({ store, vault, state: "us", sourceId: SOURCE, roster: release.roster, acquisitions: release.acquisitions,
    gaps: release.gaps, releaseId: release.releaseId, now: at });
  assert.ok(published.outcome.promoted, JSON.stringify(published.outcome));
  assert.equal(published.candidate.normalization.parserVersion, "people-sources/2");
  assert.deepEqual(published.candidate.excludedFacts ?? [], []);
  const read = await readPeopleSourceProjection("US", SOURCE, { store, now: at });
  assert.equal(read.kind, "PROMOTED");
  const roster = currentPresidentRoster(read.value!.roster)!;
  assert.equal(roster.officeholders.length, 23);
  assert.equal(roster.divisions.length, 23);

  const country = stateCoverage(readerState(roster), [`${COUNTRY}/state:az`], 33.4, -112.1).seats.find(seat => seat.ocdId === COUNTRY)!;
  assert.equal(country.label, "United States");
  assert.equal(country.representatives.length, 23);
  assert.deepEqual(country.representatives.slice(0, 2).map(holder => holder.name), ["Donald J. Trump", "JD Vance"]);
  assert.deepEqual(country.representatives.slice(2).map(holder => holder.name), CABINET_MEMBERS.map(([name]) => name).sort((a, b) => a.localeCompare(b)));
  for (const holder of country.representatives.slice(2)) {
    assert.equal(holder.sourceUrl, CABINET);
    assert.equal(holder.fieldSources?.name?.sourceUrl, CABINET);
  }
});

const index = (cabinetHref: string) => `<main><a href="${ADMINISTRATION_URL}jordan-example/">President Jordan Example</a>` +
  `<a href="${ADMINISTRATION_URL}taylor-example/">Vice President Taylor Example</a><a href="${cabinetHref}">The Cabinet</a></main>`;
const profile = (name: string, title: string) => `<main><h1>${name}</h1><p>${title} of the United States</p></main>`;
const cabinet = (members: readonly (readonly [string, string])[]) => `<main><h1>The Cabinet</h1>${members.map(([name, title]) =>
  `<div><h2><strong>${name}</strong></h2><hr /><h3><strong>${title}</strong></h3></div><p>${name} biography.</p>`).join("")}</main>` +
  `<footer><h2>Initiatives</h2><a href="/x/">Freedom 250</a><h3>Subscribe to the WH Newsletter</h3></footer>`;
const pages = (members: readonly (readonly [string, string])[]) => ({ [ADMINISTRATION_URL]: index(OLD_CABINET),
  [`${ADMINISTRATION_URL}jordan-example/`]: profile("Jordan Example", "President"), [`${ADMINISTRATION_URL}taylor-example/`]: profile("Taylor Example", "Vice President"),
  [CABINET]: cabinet(members) });

test("the Cabinet page is the index's own linked page, reached through its redirect, and only name-title heading pairs are members", async () => {
  const release = await acquire(pages([["Avery Example", "Secretary of the Treasury"], ["Blair Example", "Poet Laureate"]]), "2026-10-22T00:00:00.000Z");
  assert.ok(release.requests.includes(OLD_CABINET));
  assert.deepEqual(release.roster.officeholders.map(person => person.name), ["Jordan Example", "Taylor Example", "Avery Example"]);
  assert.ok(release.gaps.some(gap => gap.detail.includes("CABINET_TITLE_UNCLASSIFIED:Blair Example:Poet Laureate")), "an unclassified title stays open work in Admin");
  assert.equal(release.roster.currentMembershipComplete, false);
  assert.deepEqual(cabinetLinks(index(OLD_CABINET)), [OLD_CABINET]);
  const html = cabinet([["Avery Example", "Secretary of the Treasury"]]);
  assert.throws(() => currentCabinet({ url: ADMINISTRATION_URL, html: index(OLD_CABINET) }, { url: "https://trumpwhitehouse.archives.gov/administration/cabinet/", html }), /CABINET_PAGE_NOT_CURRENT/);
  assert.throws(() => currentCabinet({ url: ADMINISTRATION_URL, html: index(OLD_CABINET) }, { url: `${ADMINISTRATION_URL}other/`, html }), /CABINET_PAGE_NOT_CURRENT/);
  assert.throws(() => currentCabinet({ url: ADMINISTRATION_URL, html: index(OLD_CABINET) }, { url: CABINET, requestedUrl: OLD_CABINET, html: html.replace("<h1>The Cabinet</h1>", "<h1>Archive</h1>") }), /CABINET_PAGE_HEADING_MISSING/);
  assert.throws(() => verifiedWhiteHouseOfficial("cabinet:secretary-of-labor", { url: ADMINISTRATION_URL, html: index(OLD_CABINET) },
    { url: CABINET, requestedUrl: OLD_CABINET, html, retrievedAt: "2026-10-22T00:00:00.000Z" }), /HOLDER_UNRESOLVED/);
});

test("a broken Cabinet page keeps the President and Vice President, and a new Treasury Secretary ends the old one's current membership", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore();
  const publish = async (release: Awaited<ReturnType<typeof acquire>>, now: string) => {
    const result = await publishPeopleSource({ store, vault, state: "us", sourceId: SOURCE, roster: release.roster, acquisitions: release.acquisitions, gaps: release.gaps, releaseId: release.releaseId, now });
    assert.ok(result.outcome.promoted || result.outcome.confirmed, JSON.stringify(result.outcome));
    const read = await readPeopleSourceProjection("US", SOURCE, { store, now, bypassCache: true });
    return { result, roster: read.value!.roster, current: currentPresidentRoster(read.value!.roster)!.officeholders.map(person => [person.name, person.officeTitle]).sort() };
  };
  const firstAt = "2026-10-20T00:00:00.000Z";
  const first = await publish(await acquire(pages([["Avery Example", "Secretary of the Treasury"], ["Casey Example", "Secretary of Defense"]]), firstAt), firstAt);
  assert.deepEqual(first.current, [["Avery Example", "Secretary of the Treasury"], ["Casey Example", "Secretary of Defense"],
    ["Jordan Example", "President of the United States"], ["Taylor Example", "Vice President of the United States"]]);

  const brokenAt = "2026-10-21T00:00:00.000Z", broken = await acquire({ ...pages([]), [CABINET]: "<main><h1>Maintenance</h1></main>" }, brokenAt);
  assert.ok(broken.gaps.some(gap => gap.detail.startsWith("WHITE_HOUSE_OFFICE_UNAVAILABLE:cabinet:")));
  assert.deepEqual(broken.coverage.offices.map(office => office.office), ["president", "vice-president", "cabinet"]);
  assert.deepEqual((await publish(broken, brokenAt)).current, first.current, "a failed Cabinet read retains the last verified members");

  const nextAt = "2026-10-21T12:00:00.000Z";
  const next = await publish(await acquire(pages([["Drew Example", "Secretary of the Treasury"], ["Casey Example", "Secretary of War"]]), nextAt), nextAt);
  assert.deepEqual(next.current, [["Casey Example", "Secretary of War"], ["Drew Example", "Secretary of the Treasury"],
    ["Jordan Example", "President of the United States"], ["Taylor Example", "Vice President of the United States"]]);
  assert.ok(next.roster.endedMemberships?.some(membership => membership.personId === "white-house:avery-example" && membership.current === false));
  assert.ok(next.roster.endedMemberships?.some(membership => membership.personId === "white-house:casey-example" && membership.officeTitle === "Secretary of Defense"));
  const country = stateCoverage(readerState(currentPresidentRoster(next.roster)), [`${COUNTRY}/state:az`], 33.4, -112.1).seats.find(seat => seat.ocdId === COUNTRY)!;
  assert.deepEqual(country.representatives.map(holder => [holder.name, holder.officeTitle]), [["Jordan Example", "President of the United States"],
    ["Taylor Example", "Vice President of the United States"], ["Casey Example", "Secretary of War"], ["Drew Example", "Secretary of the Treasury"]]);
});
