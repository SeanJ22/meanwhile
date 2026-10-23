import assert from "node:assert/strict";
import test from "node:test";
import { executiveCardCompleteness, withExecutiveCompleteness, mergeExecutiveFacts } from "../lib/officials/national-executive.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import { mergePeopleSets } from "../lib/officials/merge-people.ts";
import { personCardSources } from "../lib/officials/card-sources.ts";

const at = "2026-10-22T12:00:00.000Z", url = "https://www.whitehouse.gov/administration/example/";
const provenance = { sourceUrl: url, sourceOrg: "The White House", collectedAt: at, verifiedAt: at };
function person(): Officeholder {
  return { id: "white-house:example", name: "Example Person", officeTitle: "President of the United States", level: "FEDERAL",
    partyLabel: "Republican", termStart: "2025-01-20", termEnd: "2029-01-20", birthDate: null, websiteUrl: url,
    contactFormUrl: "https://www.whitehouse.gov/contact/", phone: null, email: null, campaignUrl: null, photo: null,
    fieldSources: Object.fromEntries(["partyLabel", "termStart", "termEnd", "contactFormUrl"].map(key => [key, provenance])), provenance,
    social: [{ platform: "x", url: "https://x.com/WhiteHouse", accountKind: "OFFICIAL", sourceUrl: url, collectedAt: at }],
    executive: { biography: { text: "Example Person serves as President.", sourceUrl: url, collectedAt: at },
      coverage: Object.fromEntries(["campaignMoney", "executiveOrders", "proclamations", "memoranda", "signedBills", "vetoedBills"].map(key => [key, true])) } };
}
const set = (row: Officeholder): OfficeholderSet => ({ scope: "US", generatedAt: at, officeholders: [row],
  divisions: [{ officeholderId: row.id, ocdId: "ocd-division/country:us", bodyId: null }], unmatched: [] });

test("a portrait lead and a claimed completion flag cannot make an executive card complete", () => {
  const row = person();
  row.portraitCandidate = { imageUrl: "https://www.whitehouse.gov/example.jpg", sourceUrl: url, collectedAt: at };
  row.executive = { ...row.executive, complete: true };
  assert.deepEqual(executiveCardCompleteness(row), { complete: false, missing: ["portrait", "campaignMoney"] });
  row.photo = { url: "/officials/example.jpg", sourceUrl: url, collectedAt: at, license: null, attribution: null };
  assert.equal(withExecutiveCompleteness(row).executive?.complete, false);
  row.fieldSources = { ...row.fieldSources, partyLabel: { ...provenance, sourceUrl: null } };
  assert.ok(executiveCardCompleteness(row).missing.includes("partyLabel"));
});

test("partial rereads preserve held executive facts and the card receives their sources with checked dates", () => {
  const first = person(), next = { ...person(), executive: { coverage: { executiveOrders: false } } };
  const merged = mergePeopleSets([set(first), set(next)])!;
  assert.equal(merged.officeholders[0].executive?.biography?.text, first.executive?.biography?.text);
  assert.equal(merged.officeholders[0].executive?.coverage?.executiveOrders, false);
  const holder = indexByDivision([merged]).get("ocd-division/country:us")![0];
  assert.equal(holder.executive?.biography?.text, first.executive?.biography?.text);
  const sources = personCardSources(holder);
  assert.ok(sources.some(source => source.provenance.sourceUrl === url && source.provenance.collectedAt === at));
});

test("a department source outage retains the held budget, headcount and confirmation", () => {
  const budget = { amount: 100, fiscalYear: 2026, scope: "DEPARTMENT" as const, label: "Budgetary resources" as const, sourceUrl: "https://api.usaspending.gov/api/v2/agency/020/budgetary_resources/", collectedAt: at };
  const headcount = { count: 42, asOf: "2026-08", label: "OPM-covered civilian employees" as const, sourceUrl: "https://data.opm.gov/api/v1/files/employment", collectedAt: at };
  const confirmation = { date: "2025-01-27", yeas: 68, nays: 29, method: "Recorded vote", sourceUrl: "https://api.congress.gov/v3/nomination/119/11-1", evidenceSourceUrl: "https://api.congress.gov/v3/nomination/119/11-1/actions", collectedAt: at, quote: "Confirmed 68–29" };
  const prior = { cabinet: { department: { name: "Department of the Treasury", sourceUrl: url, collectedAt: at, budget, headcount, actions: [] },
    confirmation, priorOffices: [], sources: [], gaps: [], coverage: { budget: true } } };
  const updated = mergeExecutiveFacts(prior, { cabinet: { priorOffices: [], sources: [], gaps: ["Budget source unavailable"], coverage: { budget: false } }, coverage: { budget: false } });
  assert.deepEqual(updated?.cabinet?.department?.budget, budget);
  assert.deepEqual(updated?.cabinet?.department?.headcount, headcount);
  assert.deepEqual(updated?.cabinet?.confirmation, confirmation);
  assert.equal(updated?.coverage?.budget, false);
});

test("place card records omit histories already served by the lazy card endpoints", () => {
  const row = person();
  row.executive = { ...row.executive, records: Array.from({ length: 500 }, (_, at) => ({ id: `action:${at}`, personId: row.id,
    kind: "EXECUTIVE_ORDER" as const, title: "A published action", date: "2026-10-20", sourceUrl: "https://www.federalregister.gov/d/2026-12345",
    evidenceSourceUrl: "https://www.federalregister.gov/api/v1/documents.json", quote: "A published action", collectedAt: at.toString(), details: {} })) };
  const holder = indexByDivision([set(row)]).get("ocd-division/country:us")![0];
  assert.equal(holder.executive?.records, undefined);
  assert.equal(holder.executive?.biography?.text, row.executive.biography?.text);
  assert.ok(JSON.stringify(holder).length < JSON.stringify(row).length / 10);
  assert.equal(row.executive.records?.length, 500, "the national resident holding retains its history");
});

test("a shared White House account cannot fill the Vice President's own official social accounts", () => {
  const row = { ...person(), officeTitle: "Vice President of the United States", social: [] };
  row.executive = { ...row.executive, officeSocial: [{ platform: "twitter", url: "https://x.com/whitehouse", accountKind: "OFFICIAL", label: "The White House on X", scope: "WHITE_HOUSE", sourceUrl: url, collectedAt: at }] };
  assert.ok(executiveCardCompleteness(row).missing.includes("officialSocial"));
});


test("coverage flags cannot replace the sourced money and Cabinet facts", () => {
  const row = person();
  assert.ok(executiveCardCompleteness(row).missing.includes("campaignMoney"));
  const secretary = { ...row, officeTitle: "Secretary of the Treasury", executive: { ...row.executive,
    coverage: Object.fromEntries(["department", "budget", "headcount", "confirmation", "priorOffices", "departmentActions"].map(key => [key, true])) } };
  const missing = executiveCardCompleteness(secretary).missing;
  for (const key of ["department", "budget", "headcount", "confirmation", "priorOffices", "departmentActions"]) assert.ok(missing.includes(key), key);
});
