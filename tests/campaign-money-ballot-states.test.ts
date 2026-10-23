import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { bindCampaignMoney, campaignMoneyPeopleIndex, type CampaignMoneyPerson } from "../lib/funding/state-people.ts";
import { campaignSourceRecord } from "../lib/funding/state-source-records.ts";
import { campaignFinanceSource } from "../lib/funding/state-sources.ts";
import { fileCampaignMoneyFacts } from "../lib/funding/state-facts.ts";
import { rebuildCampaignCycles } from "../lib/funding/state-cycles.ts";
import { readCampaignMoneyForTarget } from "../lib/funding/state-reader.ts";
import { renderCardWithSources } from "./helpers/render-card.ts";
import { campaignDb, publishMoneyFixture } from "./helpers/campaign-money-db.ts";

const at = "2026-10-20T00:00:00.000Z";
const FIXTURES = { CT: "ct-native-receipts", HI: "hi-native-excerpt", KY: "ky-native-contributions", SC: "sc-native-contributions", WA: "wa-native-excerpt" } as const;

for (const [state, fixture] of Object.entries(FIXTURES)) {
  test(`${state}: a candidate on the ballot shows the state's filed campaign money, linked to the filing`, async () => {
    const db = await campaignDb();
    try {
      const source = campaignFinanceSource(state).resources[0];
      const [native] = JSON.parse(await readFile(new URL(`./fixtures/campaign-finance/${fixture}.json`, import.meta.url), "utf8"));
      const capture = { url: source.url, rawHash: "a".repeat(64), vaultKey: `${state}-vault`, byteLength: 10, retrievedAt: at, publicationDate: null };
      const parsed = campaignSourceRecord(state, source, native, capture);
      const filed = parsed.candidateName && (parsed.cycle ?? 0) >= 2020 ? parsed
        : { ...parsed, candidateName: "Jordan Example", office: "Governor", period: "2026", transactionDate: "2026-06-15", cycle: 2026, issues: [], unjoinedReason: null };
      const division = `ocd-division/country:us/state:${state.toLowerCase()}`;
      const person: CampaignMoneyPerson = { id: `${state.toLowerCase()}-published-person`, name: filed.candidateName!.replace(/\s*\([^)]*\)\s*/g, " ").trim(), office: filed.office!,
        seat: `${division}#seat`, division, incumbent: false, sourceUrl: `https://${state.toLowerCase()}.example.gov/` };
      const bound = bindCampaignMoney(filed, campaignMoneyPeopleIndex([person]));
      assert.ok(bound, `${state}: the filed candidate binds to the published person`);
      await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [person.id, division]).catch(() => undefined);
      await publishMoneyFixture(db, { recordClass: "REGISTRY_RUNTIME_BINDING", scope: `US-${state}`,
        payload: { bodyRosters: [{ bodyId: person.seat, sourceUrl: person.sourceUrl, members: [{ id: person.id, name: person.name, officeTitle: person.office }] }] } });
      await fileCampaignMoneyFacts(db, state, [bound!], at);
      await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [person.id, division]);
      await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,$2,$3)", [person.id, `campaign-person:${state}`, `ballot-${state.toLowerCase()}-2026-general-candidate`]);
      await rebuildCampaignCycles(db, state, [person.id], at);
      const read = await readCampaignMoneyForTarget(`ballot-${state.toLowerCase()}-2026-general-candidate`, [division], { query: db.query });
      assert.equal(read?.status, "HELD", `${state}: the ballot candidate's money is held`);
      assert.equal(read?.records[0].person.name, person.name);
      assert.ok(read!.records[0].totals.length > 0);
      const markup = await renderCardWithSources({ modulePath: "./components/funding/state-campaign-section.tsx", exportName: "StateCampaignSection",
        props: { divisionId: division, personId: `ballot-${state.toLowerCase()}-2026-general-candidate`, data: { ...read!, nextCursor: null }, bare: true }, sourceUrls: [filed.filingUrl] });
      assert.match(markup, new RegExp(`${read!.records[0].cycle} cycle`));
      assert.match(markup, /Campaign money/);
    } finally { await db.pg.close(); }
  });
}
