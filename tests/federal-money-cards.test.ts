import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FederalMoneySection } from "../components/funding/federal-money-section.tsx";
import { CardSourcesList } from "../components/officials/card-sources-list.tsx";
import { federalMoneyRows, federalMoneySources, writeFederalMoneyCard } from "../lib/federal-money/view.ts";
import { composeFederalMoneyAnswer } from "../lib/ask/federal-money.ts";
import { mergeSources } from "../lib/officials/card-sources.ts";
import { FEDERAL_MONEY_SOURCES, type FederalMoneyFact } from "../lib/federal-money/model.ts";

const county = "ocd-division/country:us/state:az/county:pima";
const body = `${county}#governing`;
const grant: FederalMoneyFact = {
  id: "usaspending:transaction", source: "usaspending", sourceId: "transaction", state: "AZ", kind: "GRANT",
  title: "RURAL SELF-HELP HOUSING TECHNICAL ASSIST", amount: -85912, amountLabel: "Federal obligation", period: "2003-08-14",
  recipient: "UNITED HOUSING AND", uei: "SOURCEUEI", identifiers: { awardId: "AWARD-1" }, geography: [{ type: "county", geoid: "04019" }],
  bodyIds: [], divisionIds: [county], joinStatus: "JOINED", joinReason: "Exact county GEOID; recipient remains separate.",
  details: { actionDate: "2003-08-14", awardingAgency: "DEPARTMENT OF AGRICULTURE", awardType: "04", originalCongressionalDistrict: "07", lastRefresh: "2026-10-24T00:12:34Z" },
  provenance: { sourceUrl: "https://files.usaspending.gov/filing.csv", sourceOrg: "USAspending", publicationDate: "2026-10-24", retrievedAt: "2026-10-25T12:00:00Z", official: true, rawHash: "hash" },
};

test("an old reduction names its actual recipient, while exact filing facts and link remain in Sources", () => {
  const row = federalMoneyRows([grant], { divisionId: county, bodyId: body })[0];
  assert.equal(row.relationship, "GEOGRAPHY");
  assert.equal(row.text, "United Housing and had $85,912 taken back from a federal grant from the Department of Agriculture for rural self-help housing technical assistance, on Aug 14, 2003.");
  assert.doesNotMatch(row.text, /-\$|;|Recipient:|Period:|UEI|Award type|Refresh|Pima County got/);
  const sources = federalMoneySources([row]);
  const grouped = mergeSources([...sources, ...federalMoneySources(federalMoneyRows([{ ...grant, id: "another", uei: "EXACTUEI" }], { divisionId: county, bodyId: body }))]);
  assert.equal(grouped.length, 1);
  const markup = renderToStaticMarkup(createElement(CardSourcesList, { sources: grouped }));
  assert.ok(markup.includes("EXACTUEI"));
  for (const fact of ["SOURCEUEI", "AWARD-1", "04", "07", "2026-10-24T00:12:34Z", "2003-08-14", grant.title, grant.recipient!, grant.provenance.sourceUrl]) assert.ok(markup.includes(fact), fact);
});

test("recipient money and area money render as separate lists, each newest award action first", () => {
  const old = { ...grant, id: "old", bodyIds: [body], recipient: "PIMA COUNTY", amount: 85912 };
  const recent = { ...old, id: "recent", period: "2026-10-01", details: { ...old.details, actionDate: "2026-10-01" }, provenance: { ...old.provenance, publicationDate: "2026-10-01" } };
  const rows = federalMoneyRows([grant, old, recent], { divisionId: county, bodyId: body });
  assert.deepEqual(rows.map(row => row.fact.id), ["recent", "old", grant.id]);
  const data = { division: county, bodyId: body, nextCursor: null, sources: FEDERAL_MONEY_SOURCES.map(source => ({ source, status: "HELD" as const, records: source === "usaspending" ? [grant, old, recent] : [], versionId: "version", checkedAt: "2026-10-25" })) };
  const markup = renderToStaticMarkup(createElement(FederalMoneySection, { divisionId: county, bodyId: body, data }));
  const own = markup.slice(markup.indexOf('aria-label="Federal money received by this government"'), markup.indexOf('aria-label="Federal money spent in this area"'));
  const area = markup.slice(markup.indexOf('aria-label="Federal money spent in this area"'));
  assert.match(own, /Pima County got a \$85,912 federal grant/);
  assert.doesNotMatch(own, /United Housing/);
  assert.match(area, /United Housing and had \$85,912 taken back/);
  assert.ok(own.indexOf('data-federal-record="recent"') < own.indexOf('data-federal-record="old"'));
  assert.doesNotMatch(markup, /Recipient:|UEI:|Period:|Award type:|Federal obligation:/);
});

test("disasters describe their county and incident month without implying a payment", () => {
  const disaster = { ...grant, id: "openfema:fire", source: "openfema" as const, kind: "DISASTER" as const, title: "BIGHORN FIRE — Pima (County)", amount: null, recipient: null,
    period: "2020-06-30T00:00:00Z", details: { incidentBegin: "2020-06-05T00:00:00Z", designatedArea: "Pima (County)", publicAssistance: true, disasterNumber: "5337" } };
  assert.equal(writeFederalMoneyCard(disaster), "Bighorn Fire, June 2020: FEMA disaster declaration for Pima County with public assistance.");
  assert.doesNotMatch(writeFederalMoneyCard(disaster), /got|;|5337|Incident begin|Period/);
  assert.match(writeFederalMoneyCard({ ...disaster, details: { ...disaster.details, publicAssistance: false } }), /without public assistance/);
});

test("Ask uses the card's same facts and newest-first sentence with the filing citation", () => {
  const records = [grant, { ...grant, id: "new", amount: 12345, period: "2026-10-01", details: { ...grant.details, actionDate: "2026-10-01" } }].map(fact => ({ kind: "FEDERAL_MONEY" as const, id: fact.id, subjectId: body, text: writeFederalMoneyCard(fact), sourceUrl: fact.provenance.sourceUrl,
    federalMoney: { fact, relationship: "GEOGRAPHY" as const, divisionId: county } }));
  const result = composeFederalMoneyAnswer({ question: "What federal grants reach Pima County?", subject: { kind: "BODY", id: body, name: "Pima County" }, records });
  assert.ok(result);
  assert.ok(result.answer.startsWith(writeFederalMoneyCard(records[1].federalMoney.fact)));
  assert.deepEqual(result.citedUrls, [grant.provenance.sourceUrl]);
  assert.doesNotMatch(result.answer, /-\$|;|Pima County got/);
  assert.equal(composeFederalMoneyAnswer({ question: "What grants did Pima County receive?", subject: { kind: "BODY", id: body, name: "Pima County" }, records }), null,
    "an award reaching the area cannot answer a question about the government's receipts");
});
