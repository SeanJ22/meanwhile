import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";
import { PGlite } from "@electric-sql/pglite";
import { STATE_MONEY_READER_PAYLOAD } from "../lib/civic-data/read-model.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { refreshStateMoneyProjectionFromPromoted, stateMoneyForTarget } from "../lib/funding/state-snapshot.ts";
import { requestedStateMoneySubjects, selectStateMoneyNames } from "../lib/ask/state-money-subjects.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { stateMoneyFixture } from "./helpers/promoted-fixtures.ts";
import { STATE_CAMPAIGN_FINANCE_SOURCES } from "../lib/funding/data-plane.ts";
import { stateCampaignRecordsAsk } from "../lib/ask/state-campaign.ts";

test("a named campaign question reads its source filer's rows without name-joining an officeholder", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE FUNCTION reader_payload_value(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS 'SELECT value';
      CREATE FUNCTION reader_payload_node(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS 'SELECT value';
      CREATE FUNCTION reader_payload_members(value jsonb) RETURNS TABLE(ordinal_index bigint,item jsonb) LANGUAGE sql IMMUTABLE AS 'SELECT n,v FROM jsonb_array_elements(value) WITH ORDINALITY e(v,n)';
      CREATE TABLE money_fixture(payload jsonb)`);
    const records = [{ candidateNameAsFiled: "SELEN, TAYFUN", targetKeys: ["native:first"], totals: { receipts: 42 } },
      { candidateNameAsFiled: "Another Person", targetKeys: ["native:second"] },
      { candidateNameAsFiled: "Tayfun Someone", targetKeys: ["native:third"] }];
    await pg.query("INSERT INTO money_fixture VALUES ($1)", [{ cycle: 2026, formatVersion: 1, records }]);
    const read = (keys: string[]) => pg.query<{ value: { records: unknown } }>(`SELECT ${STATE_MONEY_READER_PAYLOAD} value FROM money_fixture p WHERE $1::text=$2::text`, ["fixture", "fixture", keys]);
    assert.deepEqual((await read(["ask-money-name:tayfun selen"])).rows[0]!.value.records, [records[0]]);
    assert.deepEqual((await read(["native:second"])).rows[0]!.value.records, [records[1]]);
    assert.deepEqual((await read(["ask-money-name:tayfun other"])).rows[0]!.value.records, []);
  } finally { await pg.close(); }
});

test("concurrent campaign questions keep their selected source filings within their own request", async () => {
  let release!: () => void, count = 0;
  const both = new Promise<void>(resolve => { release = resolve; });
  const contract = STATE_CAMPAIGN_FINANCE_SOURCES.NH;
  await Promise.all(["First", "Second"].map(name => withReaderSelection({ states: ["NH"], keys: new Set() }, async () => {
    const base = stateMoneyFixture("NH"), target = `ballot-nh-test:governor:${name.toLowerCase()}`;
    const row = { ...base.records[0]!, candidateNameAsFiled: `${name} Person`, targetKeys: [target, `state-finance:NH:${name}:2026`] };
    selectStateMoneyNames(`How much has ${name} Person raised?`);
    await refreshStateMoneyProjectionFromPromoted("NH", { edge: provenEdgeEntry({ recordClass: "STATE_CAMPAIGN_FINANCE", scope: contract.scope,
      sourceId: contract.sourceId, versionId: `test:money:${name}`, value: { ...base, records: [row] } }) });
    if (++count === 2) release();
    await both;
    assert.deepEqual(stateMoneyForTarget(target).map(row => row.candidateNameAsFiled), [`${name} Person`]);
    const selected = requestedStateMoneySubjects(`How much has ${name} Person raised?`, ["NH"]);
    assert.deepEqual(selected.map(row => row.id), [target]);
    assert.deepEqual(requestedStateMoneySubjects("How much has Other Person raised?", ["NH"]), []);
  })));
});

test("campaign record questions select the explicit state or exact place, and unknown places cannot stand in", () => {
  const state = "ocd-division/country:us/state:ca", oakland = `${state}/place:oakland`, alameda = `${state}/county:alameda`;
  const divisions = [state, oakland, alameda];
  assert.deepEqual(stateCampaignRecordsAsk("What campaign finance records are held for Oakland?", divisions), [oakland]);
  assert.deepEqual(stateCampaignRecordsAsk("What campaign finance records are held for California?", divisions), [state]);
  assert.deepEqual(stateCampaignRecordsAsk("Which campaign filings do you have here?", divisions), [oakland]);
  assert.equal(stateCampaignRecordsAsk("What campaign finance records are held for Fresno?", divisions), null);
  assert.equal(stateCampaignRecordsAsk("What campaign finance records are held for Minnesota?", divisions), null);
  assert.equal(stateCampaignRecordsAsk("How much has Other Person raised?", divisions), null);
  assert.equal(stateCampaignRecordsAsk("Which campaign reports did Other Person file?", divisions), null);
});
