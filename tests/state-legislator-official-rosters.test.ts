import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { officialStateLegislatorsCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { recordRegisteredSourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  AZ_LEGISLATURE_CRAWL_DELAY_MS,
  AZ_LEGISLATURE_ROSTER_SOURCE_CONTRACT,
  parseAzLegislatureRoster,
  validateAzLegislatureRosterFinalUrl,
} from "../lib/sources/az-legislature/roster.ts";
import {
  NJ_LEGISLATURE_ROSTER_URL,
  parseNjLegislatureRoster,
  validateNjLegislatureRosterFinalUrl,
} from "../lib/sources/nj-legislature/roster.ts";

const NOW = "2026-09-09T12:00:00.000Z";
const LATER = "2026-09-09T13:00:00.000Z";

test("the standing AZ/NJ adapter builds official complete-roster candidates instead of horizon probes", () => {
  const source = readFileSync(new URL("../scripts/state-legislators.mts", import.meta.url), "utf8");
  assert.match(source, /parseAzLegislatureRoster/);
  assert.match(source, /parseNjLegislatureRoster/);
  assert.match(source, /officialStateLegislatorsCandidate/);
  assert.doesNotMatch(source, /officialStateLegislatorHorizonRefusalCandidate/);
  assert.doesNotMatch(source, /writeFile|appendFile|createWriteStream|\bgit\s+(?:add|commit|push)\b/i);
});

function azRow(input: {
  chamber: "House" | "Senate";
  personId: number;
  district: number;
  name: string;
  inactive?: string;
}): string {
  const handle = input.name.replace(/[^A-Za-z]/g, "").toUpperCase();
  return `<tr class="${input.inactive ? "inactive" : ""}">
    <td><a href="https://www.azleg.gov/${input.chamber}/${input.chamber}-member/?legislature=57&session=130&legislator=${input.personId}" class="roster-tooltip">${input.name}<strong></strong><span></span></a></td>
    <td><a href="https://www.azleg.gov/images/LegislativeDistrictMaps/LegislativeDistrict${String(input.district).padStart(2, "0")}.pdf">${input.district}</a></td>
    <td><span title="${input.district % 2 ? "Republican" : "Democratic"}">${input.district % 2 ? "R" : "D"}</span></td>
    <td>${input.inactive ?? `<a href="https://www.azleg.gov/emailazleg/?legislatorId=${input.personId}">Email: ${handle}</a>`}</td>
    <td>${input.inactive ? "" : "Room 101"}</td><td>${input.inactive ? "" : "(602) 926-1234"}</td>
  </tr>`;
}

function azFixture(): string {
  const house = Array.from({ length: 30 }, (_, district) => [
    azRow({ chamber: "House", personId: 1000 + district * 2 + 1, district: district + 1, name: `House One ${district + 1}` }),
    azRow({ chamber: "House", personId: 1000 + district * 2 + 2, district: district + 1, name: `House Two ${district + 1}` }),
  ]).flat();
  house.splice(5, 0,
    azRow({ chamber: "House", personId: 2299, district: 3, name: "Joseph Chaplik", inactive: "Resigned on 3/2 to run for Congress" }),
    azRow({ chamber: "House", personId: 2321, district: 7, name: "David Marshall, Sr.", inactive: "Resigned on 4/17 with no reason given" }),
  );
  const senate = Array.from({ length: 30 }, (_, district) =>
    azRow({ chamber: "Senate", personId: 2001 + district, district: district + 1, name: `Senate Member ${district + 1}` })
  );
  senate.splice(9, 0, azRow({ chamber: "Senate", personId: 2374, district: 9, name: "Eva Burch", inactive: "Resigned 03/14/2025" }));
  return `<html><table id="HouseRoster"><thead><tr><th>Legislator</th></tr></thead>${house.join("\n")}</table><table id="SenateRoster">${senate.join("\n")}</table></html>`;
}

function njFixture(): string {
  const senate = Array.from({ length: 40 }, (_, district) => ({
    Full_Name: `Senator${district + 1}, Sample`, DisplayName: `Senator${district + 1}, Sample`,
    LegTitle: "Senator ", RosterHouseCode: "S", Roster_House: "Senate", Roster_District: district + 1,
    Party: district % 2 ? "D" : "R", PartyDescription: district % 2 ? "Democrat" : "Republican", Suffix: null,
    BioLink: `/legislative-roster/${300 + district}/senator-sample-${district + 1}`,
    Last_Name: `Senator${district + 1}`, First_Name: "Sample", Middle_Name: null, VacantSort: 0,
    ContactLink: `https://nj-${String(district + 1).padStart(2, "0")}-senate.web.fireside21.app/forms/writeyourrep/`,
  }));
  const assembly = Array.from({ length: 40 }, (_, district) => [0, 1].map((seat) => ({
    Full_Name: `Assembly${district + 1}${seat + 1}, Sample`, DisplayName: `Assembly${district + 1}${seat + 1}, Sample`,
    LegTitle: seat === 0 ? "Assemblyman " : "Assemblywoman ", RosterHouseCode: "A", Roster_House: "Assembly", Roster_District: district + 1,
    Party: district % 2 ? "D" : "R", PartyDescription: district % 2 ? "Democrat" : "Republican", Suffix: null,
    BioLink: `/legislative-roster/${400 + district * 2 + seat}/${seat === 0 ? "assemblyman" : "assemblywoman"}-sample-${district + 1}-${seat + 1}${district === 5 && seat === 0 ? "-jr." : ""}`,
    Last_Name: `Assembly${district + 1}${seat + 1}`, First_Name: "Sample", Middle_Name: null, VacantSort: 0,
    ContactLink: `https://nj-${String(district + 1).padStart(2, "0")}-assembly.web.fireside21.app/forms/writeyourrep/`,
  }))).flat();
  return `<html><footer>©<!-- -->2026<!-- --> New Jersey Office of Legislative Services</footer><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { legrosterData: [[...senate, ...assembly], [], []] } },
    page: "/legislative-roster", query: {}, isFallback: false,
  })}</script></html>`;
}

test("Arizona official roster accounts for every active and resigned publisher row", () => {
  const result = parseAzLegislatureRoster(azFixture(), NOW);
  assert.equal(result.term, "57th Legislature (2025-2026)");
  assert.equal(result.legislature, 57);
  assert.equal(result.session, 130);
  assert.equal(result.observedRecords, 93);
  assert.deepEqual(result.excludedRecords, [
    {
      officialPersonId: "2299", chamber: "lower", name: "Joseph Chaplik", district: 3,
      disposition: "Resigned on 3/2 to run for Congress",
      sourceUrl: "https://www.azleg.gov/House/House-member/?legislature=57&session=130&legislator=2299",
    },
    {
      officialPersonId: "2321", chamber: "lower", name: "David Marshall, Sr.", district: 7,
      disposition: "Resigned on 4/17 with no reason given",
      sourceUrl: "https://www.azleg.gov/House/House-member/?legislature=57&session=130&legislator=2321",
    },
    {
      officialPersonId: "2374", chamber: "upper", name: "Eva Burch", district: 9,
      disposition: "Resigned 03/14/2025",
      sourceUrl: "https://www.azleg.gov/Senate/Senate-member/?legislature=57&session=130&legislator=2374",
    },
  ]);
  assert.equal(result.roster.officeholders.filter(({ chamber }) => chamber === "lower").length, 60);
  assert.equal(result.roster.officeholders.filter(({ chamber }) => chamber === "upper").length, 30);
  assert.equal(result.roster.officeholders[0]?.id, "az-legislature:1001");
  assert.equal(result.roster.officeholders[0]?.termStart, "2025-01-06");
  assert.equal(result.roster.officeholders[0]?.termEnd, "2027-01-04");
  assert.equal(result.roster.divisions.filter(({ ocdId }) => ocdId.endsWith("/sldl:1")).length, 2);
  assert.equal(result.roster.divisions.filter(({ ocdId }) => ocdId.endsWith("/sldu:1")).length, 1);
  assert.equal(AZ_LEGISLATURE_ROSTER_SOURCE_CONTRACT.requestsPerAcquisition, 1);
  assert.equal(AZ_LEGISLATURE_ROSTER_SOURCE_CONTRACT.minIntervalBetweenRequestsMs, AZ_LEGISLATURE_CRAWL_DELAY_MS);
  assert.equal(AZ_LEGISLATURE_CRAWL_DELAY_MS, 120_000);
  assert.equal(validateAzLegislatureRosterFinalUrl(AZ_LEGISLATURE_ROSTER_SOURCE_CONTRACT.requestedUrl), AZ_LEGISLATURE_ROSTER_SOURCE_CONTRACT.requestedUrl);
  assert.throws(() => validateAzLegislatureRosterFinalUrl("https://example.com/MemberRoster/"), /not the canonical official roster/);
});

test("Arizona roster refuses stale terms, silent exclusions, and incomplete seat topology", () => {
  assert.throws(() => parseAzLegislatureRoster(azFixture().replaceAll("legislature=57", "legislature=56"), NOW), /expected 57/);
  assert.throws(() => parseAzLegislatureRoster(azFixture().replace("Resigned on 3/2 to run for Congress", "Unavailable"), NOW), /explicit resigned disposition/);
  assert.throws(() => parseAzLegislatureRoster(azFixture().replace("LegislativeDistrictMaps/LegislativeDistrict01.pdf\">1", "LegislativeDistrictMaps/LegislativeDistrict02.pdf\">2"), NOW), /district 1 has lower=1/);
});

test("New Jersey official roster requires 120 unique BioLink identities and exact 2/1 district topology", () => {
  const result = parseNjLegislatureRoster(njFixture(), NOW);
  assert.equal(result.term, "222nd New Jersey Legislature (2026-2027)");
  assert.equal(result.legislature, 222);
  assert.equal(result.observedRecords, 120);
  assert.equal(result.roster.officeholders.filter(({ chamber }) => chamber === "lower").length, 80);
  assert.equal(result.roster.officeholders.filter(({ chamber }) => chamber === "upper").length, 40);
  assert.equal(new Set(result.roster.officeholders.map(({ id }) => id)).size, 120);
  assert.equal(result.roster.officeholders[0]?.id, "nj-legislature:300");
  assert.equal(result.roster.officeholders[0]?.termStart, "2024-01-09");
  assert.equal(result.roster.officeholders[0]?.termEnd, "2028-01-11");
  assert.equal(result.roster.officeholders[40]?.termStart, "2026-01-13");
  assert.equal(result.roster.divisions.filter(({ ocdId }) => ocdId.endsWith("/sldl:40")).length, 2);
  assert.equal(result.roster.divisions.filter(({ ocdId }) => ocdId.endsWith("/sldu:40")).length, 1);
  assert.equal(validateNjLegislatureRosterFinalUrl(NJ_LEGISLATURE_ROSTER_URL), NJ_LEGISLATURE_ROSTER_URL);
  assert.throws(() => validateNjLegislatureRosterFinalUrl(`${NJ_LEGISLATURE_ROSTER_URL}?historic=true`), /not the canonical official roster/);
});

test("New Jersey roster refuses malformed IDs, duplicates, vacancies, and truncation", () => {
  assert.throws(() => parseNjLegislatureRoster(njFixture().replace("/legislative-roster/300/", "/legislative-roster/not-numeric/"), NOW), /invalid BioLink/);
  assert.throws(() => parseNjLegislatureRoster(njFixture().replace("/legislative-roster/301/", "/legislative-roster/300/"), NOW), /BioLink id 300 is duplicated/);
  assert.throws(() => parseNjLegislatureRoster(njFixture().replace('"VacantSort":0', '"VacantSort":1'), NOW), /not an active named member/);
  const parsed = JSON.parse(/<script[^>]*>([\s\S]*?)<\/script>/.exec(njFixture())![1]!);
  parsed.props.pageProps.legrosterData[0].pop();
  const short = `<html><footer>©<!-- -->2026<!-- --> New Jersey Office of Legislative Services</footer><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(parsed)}</script></html>`;
  assert.throws(() => parseNjLegislatureRoster(short, NOW), /expected 80\/40\/120/);
});

test("an Arizona document failure is durable and cannot replace either its LKG or New Jersey's disposition", async () => {
  const parsed = parseAzLegislatureRoster(azFixture(), NOW);
  const store = new MemoryRoutineDataStore();
  const candidate = officialStateLegislatorsCandidate({
    sourceId: "az-legislature",
    jurisdiction: "US-AZ",
    rawBodies: [azFixture()],
    requestedUrl: AZ_LEGISLATURE_ROSTER_SOURCE_CONTRACT.requestedUrl,
    finalUrl: AZ_LEGISLATURE_ROSTER_SOURCE_CONTRACT.requestedUrl,
    httpStatus: 200,
    retrievedAt: NOW,
    term: parsed.term,
    expectedTerm: parsed.term,
    declaredTotal: 90,
    roster: parsed.roster,
    sourceAudit: {
      observedRecords: parsed.observedRecords,
      excludedRecords: parsed.excludedRecords,
      legislature: parsed.legislature,
      session: parsed.session,
    },
  });
  const promoted = await processRegisteredRoutineCandidate(store, "az-state-legislators", candidate, NOW);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.deepEqual(
    [candidate.normalization.inputRecords, candidate.normalization.outputRecords, candidate.normalization.droppedRecords],
    [93, 90, 3],
  );
  assert.deepEqual(
    (candidate.readModel as { sourceAudit: { excludedRecords: readonly { officialPersonId: string }[] } }).sourceAudit.excludedRecords.map((row) => row.officialPersonId),
    ["2299", "2321", "2374"],
  );
  const njParsed = parseNjLegislatureRoster(njFixture(), NOW);
  const njCandidate = officialStateLegislatorsCandidate({
    sourceId: "nj-legislature",
    jurisdiction: "US-NJ",
    rawBodies: [njFixture()],
    requestedUrl: NJ_LEGISLATURE_ROSTER_URL,
    finalUrl: NJ_LEGISLATURE_ROSTER_URL,
    httpStatus: 200,
    retrievedAt: NOW,
    term: njParsed.term,
    expectedTerm: njParsed.term,
    declaredTotal: 120,
    roster: njParsed.roster,
    sourceAudit: {
      observedRecords: njParsed.observedRecords,
      excludedRecords: [],
      legislature: njParsed.legislature,
      session: null,
    },
  });
  const njPromoted = await processRegisteredRoutineCandidate(store, "nj-state-legislators", njCandidate, NOW);
  assert.equal(njPromoted.candidate.state, "PROMOTED");
  const pointer = await store.readPromotion("STATE_LEGISLATOR", "US-AZ");
  const njPointer = await store.readPromotion("STATE_LEGISLATOR", "US-NJ");
  let failure: unknown;
  try {
    parseAzLegislatureRoster("<html>publisher changed shape</html>", LATER);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof Error);
  const failed = await recordRegisteredSourceAcquisitionFailure({
    store,
    contractId: "az-state-legislators",
    failure: failure as Parameters<typeof recordRegisteredSourceAcquisitionFailure>[0]["failure"],
    requestedUrl: AZ_LEGISLATURE_ROSTER_SOURCE_CONTRACT.requestedUrl,
    attemptedAt: LATER,
  });
  assert.equal(failed.outcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal(failed.outcome.candidate.lastKnownGoodVersion, candidate.id);
  assert.deepEqual(await store.readPromotion("STATE_LEGISLATOR", "US-AZ"), pointer);
  assert.deepEqual(await store.readPromotion("STATE_LEGISLATOR", "US-NJ"), njPointer);
});
