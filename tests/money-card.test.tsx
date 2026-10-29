import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CampaignMoneyCard, FederalAwardsCard } from "../components/funding/money-card.tsx";
import { campaignClaims, federalAwardClaim, filedAmount, type CampaignPeriodRecord, type FiledAmount, type MoneyClaim } from "../lib/funding/money-records.ts";
import {
  campaignMoneySources, campaignMoneyView, federalAwardSources, federalAwardsView, type MoneyFactRow,
} from "../lib/funding/money-card-view.ts";
import { readCampaignMoneyView, readFederalAwardsView } from "../lib/funding/money-read.ts";
import { publicCampaignDonors } from "../lib/funding/state-view.ts";
import type { Query } from "../lib/facts/publish.ts";
import { FederalMoneySection } from "../components/funding/federal-money-section.tsx";
import { StateCampaignSection } from "../components/funding/state-campaign-section.tsx";
import { FEDERAL_MONEY_SOURCES, type FederalMoneyFact } from "../lib/federal-money/model.ts";
import type { FederalMoneyPlaceRead } from "../lib/federal-money/reader.ts";
import type { CampaignFinancePlaceRead } from "../lib/funding/state-reader.ts";
import type { CampaignMoneyView, FederalAwardsView } from "../lib/funding/money-card-view.ts";

const filed = (line: string, text: string): FiledAmount => filedAmount(line, text)!;
const FILER = { id: "C-100", name: "Citizens for Dana Hart", candidateName: "Dana Hart", office: "State Representative", district: "12", jurisdiction: null };
const row = (claim: MoneyClaim, checkedAt = "2026-10-20T00:00:00.000Z"): MoneyFactRow => ({ entityId: claim.subjectId, field: claim.field, value: claim.value, quote: claim.quote, checkedAt });

function period(key: string, to: string, raised: string, small: string | null, named: readonly [string, string, string, "individual" | "organization"][]): CampaignPeriodRecord {
  const line = (label: string, text: string) => filed(`${label} ${text}`, text);
  return {
    filer: FILER, period: { key, label: `Period ending ${to}`, from: null, to, cycle: 2026 }, filingUrl: `https://kref.ky.gov/filing/${key}`, publisher: "Kentucky Registry of Election Finance",
    raised: line("Total receipts", raised), spent: line("Total expenditures", "$400.00"), individual: line("Individual contributions", "$1,000.00"),
    individualSmall: small ? line("Unitemized individual", small) : null,
    donors: named.filter(item => item[3] === "individual").map(([name, text, id]) => ({ partyKey: name, name, kind: "individual" as const, lineId: id, amount: line(`${name} gave`, text) })),
    committees: named.filter(item => item[3] === "organization").map(([name, text, id]) => ({ partyKey: name, name, kind: "organization" as const, lineId: id, amount: line(`${name} gave`, text) })),
  };
}
const claimsFor = (...records: CampaignPeriodRecord[]) => records.flatMap(record => campaignClaims("person:ky:dana-hart", record)).map(claim => row(claim));

test("a person's money card is one summary and one table, with each period's totals, donors over $200, committees and filing link", () => {
  const rows = claimsFor(
    period("2026-Q1", "2026-03-31", "$2,000.00", "$620.00", [["Marcus Bell", "$300.00", "r1", "individual"], ["Citizens PAC", "$50.00", "r2", "organization"]]),
    period("2026-Q2", "2026-06-30", "$3,000.00", "$900.00", [["Jordan Wells", "$1,000.00", "r3", "individual"]]));
  const view = campaignMoneyView("person:ky:dana-hart", rows)!;
  assert.equal(view.periods.length, 2);
  assert.equal(view.periods[0].label, "Period ending 2026-06-30", "newest first");
  assert.match(view.summary, /^Raised \$5,000 and spent \$800 in the 2026 cycle\. \$1,520 \(\d+%\) of individual money came from donors giving \$200 or less in the cycle\.$/);
  const html = renderToStaticMarkup(createElement(CampaignMoneyCard, { view, id: "t" }));
  assert.equal((html.match(/<table/g) ?? []).length, 1, "one table");
  assert.match(html, /Raised \$5,000 and spent \$800/);
  assert.match(html, /<th[^>]*>Raised<\/th>/);
  assert.match(html, /\$2,000/);
  assert.match(html, /Donors over \$200:<\/span> Marcus Bell \$300/);
  assert.match(html, /Jordan Wells \$1,000/);
  assert.match(html, /Committees and organizations:<\/span> Citizens PAC \$50/);
  assert.match(html, /href="https:\/\/kref\.ky\.gov\/filing\/2026-Q1"/);
  // Sources carry each total with the exact filing line behind it.
  const [q2, q1] = campaignMoneySources(view);
  assert.equal(q1.provenance.sourceUrl, "https://kref.ky.gov/filing/2026-Q1");
  assert.match(q1.what, /Raised: Total receipts \$2,000\.00/);
  assert.match(q2.what, /From donors giving \$200 or less: Unitemized individual \$900\.00/);
});

test("a donor whose cycle total is $200 or less is never named, even if a stored line names them", () => {
  const rows = claimsFor(period("2026-Q1", "2026-03-31", "$2,000.00", null, [["Marcus Bell", "$300.00", "r1", "individual"]]));
  const small = campaignClaims("person:ky:dana-hart", period("2026-Q1", "2026-03-31", "$2,000.00", null, [["Pamela Roach", "$25.00", "r9", "individual"], ["Catherine Knaus", "$75.00", "r10", "individual"]]))
    .filter(claim => claim.field.includes(":donor:")).map(claim => row(claim));
  const view = campaignMoneyView("person:ky:dana-hart", [...rows, ...small])!;
  const html = renderToStaticMarkup(createElement(CampaignMoneyCard, { view, id: "t" }));
  assert.match(html, /Marcus Bell/);
  assert.doesNotMatch(html + JSON.stringify(view), /Pamela Roach|Catherine Knaus/);
  // A stored line over several periods adds up before anyone is named.
  const split = [150, 100].map((dollars, index) => campaignClaims("person:ky:dana-hart", period(`2026-Q${index + 1}`, `2026-0${index * 3 + 3}-30`, "$1.00", null, [["Marcus Bell", `$${dollars}.00`, `s${index}`, "individual"]]))
    .filter(claim => claim.field.includes(":donor:")).map(claim => row(claim))).flat();
  const named = campaignMoneyView("person:ky:dana-hart", split)!.periods.flatMap(item => item.donors.map(donor => donor.name));
  assert.deepEqual(named, ["Marcus Bell", "Marcus Bell"], "$250 in the cycle is over $200");
  assert.equal(campaignMoneyView("person:ky:dana-hart", split.slice(0, 1)), null, "$150 in the cycle is not named, so there is nothing to show");
});

test("the older money display never names a small donor either", () => {
  const donors = [
    { kind: "INDIVIDUAL" as const, filedName: "Pamela Roach", amount: 25, filingUrl: "https://x.gov/a" },
    { kind: "INDIVIDUAL" as const, filedName: "Marcus Bell", amount: 201, filingUrl: "https://x.gov/b" },
    { kind: "INDIVIDUAL" as const, filedName: "Edge Case", amount: 200, filingUrl: "https://x.gov/c" },
    { kind: "COMMITTEE_OR_ORGANIZATION" as const, filedName: "Citizens PAC", amount: 10, filingUrl: "https://x.gov/d" },
  ];
  assert.deepEqual(publicCampaignDonors(donors).map(donor => donor.filedName), ["Marcus Bell", "Citizens PAC"]);
});

test("a body's money card is one summary and one table of awards, and $0 and negative awards stay hidden", () => {
  const award = (awardId: string, text: string, date: string, agency: string) => federalAwardClaim("government:us-wy:casper", {
    awardId, title: `Entitled Cities ${awardId}`, total: filed(`"Award Amount":"${text}"`, text), date, agency, recipientName: "City of Casper", sourceUrl: "https://api.usaspending.gov/api/v2/awards/" + awardId });
  const claims = [award("A1", "459916.00", "2026-02-01", "Department of Housing and Urban Development"), award("A2", "100000.00", "2025-05-01", "Department of Transportation"),
    award("A3", "0.00", "2026-03-01", "Department of Energy"), award("A4", "-85912.00", "2026-04-01", "Department of Energy")];
  assert.deepEqual(claims.map(claim => claim === null), [false, false, true, true], "$0 and negative-only awards are never claimed");
  // A stored $0 or negative award is hidden by the card as well.
  const rows = [...claims.filter((claim): claim is MoneyClaim => claim !== null).map(claim => row(claim)),
    { entityId: "government:us-wy:casper", field: "money-federal:Z0", quote: "x", checkedAt: "2026-10-20T00:00:00.000Z", value: { v: 1, awardId: "Z0", title: "Zero", amount: 0, date: "2026-05-01", agency: "Department of Energy", recipient: "City of Casper", sourceUrl: "https://api.usaspending.gov/z" } },
    { entityId: "government:us-wy:casper", field: "money-federal:Z1", quote: "x", checkedAt: "2026-10-20T00:00:00.000Z", value: { v: 1, awardId: "Z1", title: "Negative", amount: -5, date: "2026-05-02", agency: "Department of Energy", recipient: "City of Casper", sourceUrl: "https://api.usaspending.gov/z" } }];
  const sums = [{ year: "2026", agency: "Department of Housing and Urban Development", amount: 459916 }, { year: "2025", agency: "Department of Transportation", amount: 100000 },
    { year: "2026", agency: "Department of Energy", amount: 0 }, { year: "2019", agency: "Department of Transportation", amount: 777 }];
  const view = federalAwardsView(sums, rows, new Date("2026-10-29T00:00:00Z"))!;
  assert.deepEqual(view.awards.map(item => item.awardId), ["A1", "A2"]);
  assert.equal(view.thisYear, 459916);
  assert.equal(view.sinceYear, 559916, "2019 is before 2020 and $0 adds nothing");
  assert.deepEqual(view.agencies.map(agency => agency.name), ["Department of Housing and Urban Development", "Department of Transportation"]);
  assert.match(view.summary, /^Received \$460,000 this year and \$560,000 since 2020\. Top agencies: Department of Housing and Urban Development \(\$460,000\), Department of Transportation \(\$100,000\)\.$/);
  const html = renderToStaticMarkup(createElement(FederalAwardsCard, { view, id: "t" }));
  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.match(html, /Entitled Cities A1/);
  assert.match(html, /\$459,916/);
  assert.match(html, /February 1st, 2026/);
  assert.doesNotMatch(html, /Zero|Negative|Entitled Cities A3|Entitled Cities A4/);
  assert.equal(federalAwardSources(view)[0].provenance.sourceUrl, "https://api.usaspending.gov/api/v2/awards/A1");
  assert.equal(federalAwardsView([{ year: "2026", agency: "X", amount: 0 }], [], new Date("2026-10-29T00:00:00Z")), null, "only $0 awards: nothing to show");
});

const division = "ocd-division/country:us/state:wy/place:casper";
const body = `${division}#governing`;
const oldGrant: FederalMoneyFact = {
  id: "usaspending:old", source: "usaspending", sourceId: "old", state: "WY", kind: "GRANT", title: "OLD GEOGRAPHY GRANT", amount: 5, amountLabel: null, period: "2021",
  recipient: "SOME OTHER RECIPIENT", uei: null, identifiers: {}, geography: [], bodyIds: [], divisionIds: [division], joinStatus: "UNJOINED", joinReason: "County FIPS", details: {},
  provenance: { sourceUrl: "https://api.usaspending.gov/old", sourceOrg: "USAspending", publicationDate: null, retrievedAt: "2026-10-01T00:00:00.000Z", official: true, rawHash: "0".repeat(64) },
};
const oldRead = (awards?: FederalAwardsView): FederalMoneyPlaceRead => ({ division, bodyId: body, nextCursor: null, ...(awards ? { awards } : {}),
  sources: FEDERAL_MONEY_SOURCES.map(source => ({ source, status: source === "usaspending" ? "HELD" as const : "NOT_HELD" as const, records: source === "usaspending" ? [oldGrant] : [],
    versionId: null, checkedAt: null, coverageComplete: true })) });

test("a government card shows the rebuilt awards in place of the older award rows, and keeps the older rows until there are rebuilt awards", () => {
  const view = federalAwardsView([{ year: "2026", agency: "Department of Housing and Urban Development", amount: 459916 }],
    [{ entityId: body, field: "money-federal:A1", quote: `"Award Amount":"459916.00"`, checkedAt: "2026-10-20T00:00:00.000Z",
      value: { v: 1, awardId: "A1", title: "Entitled Cities", amount: 459916, date: "2026-02-01", agency: "Department of Housing and Urban Development", recipient: "City of Casper", sourceUrl: "https://api.usaspending.gov/a1" } }],
    new Date("2026-10-29T00:00:00Z"))!;
  const rebuilt = renderToStaticMarkup(createElement(FederalMoneySection, { divisionId: division, bodyId: body, data: oldRead(view) }));
  assert.match(rebuilt, /data-money-card="federal"/);
  assert.match(rebuilt, /Entitled Cities/);
  assert.doesNotMatch(rebuilt, /data-federal-record="usaspending:old"/);
  const older = renderToStaticMarkup(createElement(FederalMoneySection, { divisionId: division, bodyId: body, data: oldRead() }));
  assert.doesNotMatch(older, /data-money-card/);
  assert.match(older, /data-federal-record="usaspending:old"/);
});

test("a person's card shows the rebuilt money when there is any, and today's money when there is not", () => {
  const view = campaignMoneyView("person:ky:dana-hart", claimsFor(period("2026-Q1", "2026-03-31", "$2,000.00", "$620.00", [["Marcus Bell", "$300.00", "r1", "individual"]])))!;
  const read = (rebuilt?: CampaignMoneyView): CampaignFinancePlaceRead => ({ division: "ocd-division/country:us/state:ky", state: "KY", status: "HELD", checkedAt: null, count: null, nextCursor: null,
    ...(rebuilt ? { rebuilt, records: [] } : { records: [{ id: "old", person: { id: "p", name: "Dana Hart", seat: "s" }, committee: "OLD COMMITTEE", cycle: 2024, totals: [{ label: "Receipts", amount: 77 }],
      sources: [], donors: [{ kind: "INDIVIDUAL", filedName: "Pamela Roach", amount: 25, filingUrl: "https://x.gov/a" }, { kind: "INDIVIDUAL", filedName: "Marcus Bell", amount: 300, filingUrl: "https://x.gov/b" }] }] }) });
  const props = { divisionId: "ocd-division/country:us/state:ky", personId: "person:ky:dana-hart", bare: true, context: null };
  const rebuilt = renderToStaticMarkup(createElement(StateCampaignSection, { ...props, data: read(view) }));
  assert.match(rebuilt, /data-money-card="campaign"/);
  assert.doesNotMatch(rebuilt, /OLD COMMITTEE/);
  const older = renderToStaticMarkup(createElement(StateCampaignSection, { ...props, data: read() }));
  assert.match(older, /Old Committee/);
  assert.match(older, /Marcus Bell/);
  assert.doesNotMatch(older, /Pamela Roach/, "today's display never names a small donor");
});

test("the reader files a person's rebuilt money through the person's own id and returns nothing for a person with none", async () => {
  const stored = claimsFor(period("2026-Q1", "2026-03-31", "$2,000.00", null, [["Marcus Bell", "$300.00", "r1", "individual"]]))
    .map(item => ({ entity_id: item.entityId, field: item.field, value: item.value, quote: item.quote, checked_at: item.checkedAt }));
  const asked: string[] = [];
  const query: Query = async (text, params = []) => {
    asked.push(text);
    if (text.includes("entity_external_id") && text.includes("coalesce")) return [{ id: params[0] }];
    if (text.includes("checked_fact")) return params[0] === "person:ky:dana-hart" ? stored : [];
    return [];
  };
  const view = await readCampaignMoneyView(query, "person:ky:dana-hart");
  assert.equal(view?.periods.length, 1);
  assert.equal(await readCampaignMoneyView(query, "person:ky:nobody"), null);
  assert.ok(asked.every(text => !/campaign-money:|campaign-cycle:|campaign-donor:/.test(text)), "the old stored lines are not read");

  const award = federalAwardClaim("government:us-wy:casper", { awardId: "A1", title: "Entitled Cities", total: filed(`"Award Amount":"459916.00"`, "459916.00"), date: "2026-02-01",
    agency: "Department of Housing and Urban Development", recipientName: "City of Casper", sourceUrl: "https://api.usaspending.gov/a1" })!;
  const federal: Query = async text => text.includes("GROUP BY")
    ? [{ year: "2026", agency: "Department of Housing and Urban Development", amount: "459916.00" }]
    : [{ entity_id: award.subjectId, field: award.field, value: award.value, quote: award.quote, checked_at: "2026-10-20T00:00:00.000Z" }];
  const awards = await readFederalAwardsView(federal, ["government:us-wy:casper"], new Date("2026-10-29T00:00:00Z"));
  assert.equal(awards?.awards[0].awardId, "A1");
  assert.equal(await readFederalAwardsView(federal, [], new Date()), null);
});
