import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StateOfficeContacts } from "../components/state-office-contacts.tsx";
import { US_STATES } from "../lib/control-plane/readiness/catalog.ts";
import { readRecords } from "../lib/reference/index.ts";
import { compileStateCampaignFinanceAgencies } from "../lib/reference/state-campaign-finance.ts";
import { stateOfficesForStates, stateOfficesForDivisions } from "../lib/reference/state-offices.ts";
import { collectNationalPlaceSources } from "../lib/sources/plural/place.ts";

test("the two national CSVs are read once per process while state readers stay bounded", () => {
  const original = fs.readFileSync;
  const count: Record<string, number> = {};
  fs.readFileSync = ((path: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
    const name = String(path).split("/").at(-1)!;
    if (["fec_state_election_offices.csv", "state-cf-agencies.csv"].includes(name)) count[name] = (count[name] ?? 0) + 1;
    return Reflect.apply(original, fs, [path, ...args]);
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  try {
    const first = stateOfficesForStates(["az"]);
    const second = stateOfficesForStates(["WI"]);
    stateOfficesForStates(["AZ", "AZ"]);
    assert.deepEqual(count, { "fec_state_election_offices.csv": 1, "state-cf-agencies.csv": 1 });
    assert.deepEqual([first.map(row => row.state), second.map(row => row.state)], [["AZ", "AZ"], ["WI", "WI"]]);
  } finally { fs.readFileSync = original; syncBuiltinESMExports(); }
});

test("all 56 jurisdictions expose their source-listed election and campaign-finance offices, phone and official link", () => {
  for (const state of US_STATES) {
    const offices = stateOfficesForStates([state.code]);
    for (const kind of ["ELECTION_OFFICE", "CAMPAIGN_FINANCE_OFFICE"] as const) {
      assert.ok(offices.some(row => row.kind === kind), `${state.name}: ${kind}`);
      for (const office of offices.filter(row => row.kind === kind)) {
        assert.equal(office.state, state.code.toUpperCase());
        assert.match(office.phone, /\d{3}\/\d{3}-\d{4}/);
        assert.match(office.url, /^https?:\/\//);
        assert.match(office.sourceUrl, /^https:\/\/www\.fec\.gov\//);
      }
    }
  }
  assert.equal(stateOfficesForStates(US_STATES.map(state => state.code)).length, 114, "retain both source-listed KY and RI election offices");
  assert.equal(stateOfficesForStates(["KY"]).filter(row => row.kind === "ELECTION_OFFICE").length, 2);
  assert.equal(stateOfficesForStates(["RI"]).filter(row => row.kind === "ELECTION_OFFICE").length, 2);
});

test("real FEC records render office phones and links in five regions with no other state", () => {
  for (const state of ["AZ", "TX", "WI", "NY", "WA"]) {
    const rows = stateOfficesForStates([state]);
    const markup = renderToStaticMarkup(createElement(StateOfficeContacts, { offices: rows }));
    assert.equal([...markup.matchAll(/data-state-office=/g)].length, rows.length);
    for (const row of rows) {
      assert.ok(markup.includes(`href="${row.url.replaceAll("&", "&amp;")}"`));
      for (const phone of row.phone.split(/\s+/)) assert.ok(markup.includes(phone));
      assert.ok(markup.includes(`data-office-state="${state}"`));
    }
    assert.deepEqual(stateOfficesForDivisions([`ocd-division/country:us/state:${state.toLowerCase()}/county:test`]), rows);
  }
  assert.ok(stateOfficesForDivisions(["ocd-division/country:us/territory:pr"]).every(row => row.state === "PR"));
  assert.ok(stateOfficesForDivisions(["ocd-division/country:us/district:dc"]).every(row => row.state === "DC"));
  assert.deepEqual(stateOfficesForDivisions(["ocd-division/country:ca/province:bc"]), []);
});

test("campaign offices regenerate from real FEC source blocks, rejecting federal-only substitutes", () => {
  const sample = JSON.parse(readFileSync("tests/fixtures/reference/fec-campaign-office-blocks.json", "utf8"));
  const compiled = compileStateCampaignFinanceAgencies({ directory: readRecords("fec_combined_federal_state_disclosure_directory"),
    previous: readRecords("state-cf-agencies"), correctedBlocks: sample.blocks, sourceCheckedAt: sample.capturedAt.slice(0, 10) });
  assert.deepEqual(compiled, readRecords("state-cf-agencies"));
  const expected = { ALASKA: "PUBLIC OFFICES COMMISSION", MASSACHUSETTS: "OFFICE OF CAMPAIGN AND POLITICAL FINANCE",
    "SOUTH CAROLINA": "STATE ETHICS COMMISSION", COLORADO: "SECRETARY OF STATE", "NORTH CAROLINA": "STATE BOARD OF ELECTIONS", VIRGINIA: "DEPARTMENT OF ELECTIONS" };
  for (const [state, office] of Object.entries(expected)) assert.equal(compiled.find(row => row.jurisdiction === state)?.agency, office);
  assert.equal(compiled.find(row => row.jurisdiction === "WASHINGTON")?.agency, "PUBLIC DISCLOSURE COMMISSION");
  assert.throws(() => compileStateCampaignFinanceAgencies({ directory: [{ jurisdiction: "ALABAMA", office: "Federal office", records_held: "Federal Campaign Finance Reports", url: "https://www.fec.gov", phone: "202/694-1000" }], previous: [], correctedBlocks: [], sourceCheckedAt: "2026-10-02" }), /FEC_STATE_CAMPAIGN_OFFICE_MISSING:ALABAMA/);
});

test("a national election hunt starts from held state links without rereading EAC or USA.gov for a ZIP", async () => {
  const opened: string[] = [];
  const source = stateOfficesForStates(["AZ"]).find(row => row.kind === "ELECTION_OFFICE")!;
  const collected = await collectNationalPlaceSources({sourceHints:async()=>[], divisions: [{ id: source.divisionId, label: "Arizona", divisionType: "state", geoid: "04", sourceUrl: "https://census.gov" }],
    now: "2026-10-12T00:00:00Z", families: { officials: false, elections: true }, read: async url => { opened.push(url); throw Error("Workspace sample source unavailable"); } });
  assert.deepEqual(opened, [source.url]);
  assert.deepEqual(collected.gaps.map(row => row.sourceUrl), [source.url]);
});
