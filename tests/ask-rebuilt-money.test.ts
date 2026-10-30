import assert from "node:assert/strict";
import test from "node:test";
import { stateCampaignEvidence } from "../lib/ask/state-campaign.ts";
import { readCampaignMoneyForTarget } from "../lib/funding/state-reader.ts";
import { campaignClaims, filedAmount, type CampaignPeriodRecord, type FiledAmount } from "../lib/funding/money-records.ts";
import type { Query } from "../lib/facts/publish.ts";
import { factDb } from "./helpers/fact-db.ts";
import { door } from "../lib/core/door.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { moneyDoorInput } from "../lib/funding/money-records.ts";
import { readCampaignMoneyView } from "../lib/funding/money-read.ts";

const NOW = new Date("2026-10-26T10:00:00.000Z");

const PERSON = "person:ky:dana-hart";
const DIVISION = "ocd-division/country:us/state:ky";
const filed = (line: string, text: string): FiledAmount => filedAmount(line, text)!;
const named = (name: string, text: string, id: string) => ({ partyKey: name, name, kind: "individual" as const, lineId: id, amount: filed(`${name} gave ${text}`, text) });

const record: CampaignPeriodRecord = {
  filer: { id: "C-100", name: "Citizens for Dana Hart", candidateName: "Dana Hart", office: "State Representative", district: "12", jurisdiction: null },
  period: { key: "2026-Q1", label: "Jan 1 – Mar 31, 2026", from: null, to: "2026-03-31", cycle: 2026 }, filingUrl: "https://kref.ky.gov/filing/2026-Q1",
  publisher: "Kentucky Registry of Election Finance", raised: filed("Total receipts $2,000.00", "$2,000.00"), spent: filed("Total expenditures $400.00", "$400.00"),
  individual: filed("Individual contributions $1,000.00", "$1,000.00"), individualSmall: filed("Unitemized individual $620.00", "$620.00"),
  // The loader never stores a small donor's name; a stored line that names one anyway is still never shown.
  donors: [named("Marcus Bell", "$300.00", "r1"), named("Pamela Roach", "$25.00", "r2"), named("Catherine Knaus", "$75.00", "r3")],
  committees: [{ partyKey: "Citizens PAC", name: "Citizens PAC", kind: "organization", lineId: "r4", amount: filed("Citizens PAC gave $50.00", "$50.00") }],
};
const stored = campaignClaims(PERSON, record).map(claim => ({ entity_id: PERSON, field: claim.field, value: claim.value, quote: claim.quote, checked_at: "2026-10-20T00:00:00.000Z" }));

/** Answers the one rebuilt-money statement for the person; every other statement is today's records, and is recorded. */
function store(rebuilt: boolean) {
  const older: string[] = [];
  const query: Query = async (text, params = []) => {
    if (text.includes("money-campaign") || text.includes("$2") && text.includes("checked_fact f ON")) {
      return rebuilt ? stored.map(row => ({ subject: PERSON, ...row })) : [{ subject: PERSON, entity_id: null, field: null }];
    }
    older.push(text);
    return [];
  };
  return { query, older };
}

test("Ask reads a person's rebuilt money, with donors over $200 and the small-donor share, and never a small donor's name", async () => {
  const { query, older } = store(true);
  const evidence = await stateCampaignEvidence([DIVISION], PERSON, { query });
  assert.equal(evidence.records.length, 1);
  const [only] = evidence.records;
  assert.equal(only.kind, "FINANCE_COMMITTEE");
  assert.equal(only.subjectId, PERSON);
  assert.equal(only.sourceUrl, "https://kref.ky.gov/filing/2026-Q1");
  assert.match(only.text, /Raised: \$2,000\.00/);
  assert.match(only.text, /Donors over \$200: Marcus Bell \$300\.00/);
  assert.match(only.text, /Committees and organizations: Citizens PAC \$50\.00/);
  assert.match(only.text, /\$620 \(\d+%\) of individual money came from donors giving \$200 or less/);
  assert.doesNotMatch(JSON.stringify(evidence), /Pamela Roach|Catherine Knaus/);
  assert.deepEqual(evidence.filers, ["Citizens for Dana Hart"]);
  assert.equal(older.length, 0, "today's records are not read for a person who has rebuilt money");
});

test("Ask falls back to today's records only where a person has no rebuilt money", async () => {
  const { query, older } = store(false);
  const evidence = await stateCampaignEvidence([DIVISION], PERSON, { query });
  assert.equal(evidence.records.length, 0);
  assert.ok(older.length > 0, "today's records were read");
});

test("a state money reaction is valid for a person who has only rebuilt money", async () => {
  const read = await readCampaignMoneyForTarget(PERSON, [DIVISION], { query: store(true).query });
  assert.ok(read?.rebuilt, "the target reads as held, so the reaction route accepts it");
  assert.equal((await readCampaignMoneyForTarget(PERSON, [DIVISION], { query: store(false).query }))?.rebuilt, undefined);
});

test("the card read is one statement against the real store, returns the same view, and carries the filing details once per period", async t => {
  const db = await factDb();
  t.after(() => db.pg.close());
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'person','Dana Hart','KY')", [PERSON]);
  await db.query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,'https://kref.ky.gov/filing/2026-Q1','https://kref.ky.gov/filing/2026-Q1',$1,repeat('a',64),'s')", [NOW.toISOString()]);
  const many = (kind: "individual" | "organization") => Array.from({ length: 10 }, (_, index) => ({ partyKey: `${kind}-${index}`, name: `Giver ${kind} ${index}`, kind, lineId: `m${kind}${index}`,
    amount: filed(`2026-03-10,"Giver ${kind} ${index}","123 MAIN ST","LEXINGTON","KY","$${300 + index}.00"`, `$${300 + index}.00`) }));
  const claims = campaignClaims(PERSON, { ...record, donors: [...record.donors, ...many("individual")], committees: many("organization") });
  const copy = { id: 1, finalUrl: "https://kref.ky.gov/filing/2026-Q1", fetchedAt: NOW, isArchive: false, text: claims.map(claim => claim.quote).join("\n") };
  for (const claim of claims) assert.ok("decision" in await door(db, moneyDoorInput(claim, copy, "money:KY"), factClocks(null), NOW, { purge: async () => ({ purged: true }) }), claim.field);
  let statements = 0, bytes = 0;
  const counted: Query = async (text, params) => { statements++; const rows = await db.query(text, params); bytes += Buffer.byteLength(JSON.stringify(rows)); return rows; };
  const view = await readCampaignMoneyView(counted, PERSON);
  assert.equal(statements, 1);
  assert.equal(view?.periods.length, 1);
  assert.equal(view?.periods[0].donors.length, 11);
  assert.ok(view?.periods[0].donors.some(donor => donor.name === "Marcus Bell") && !view.periods[0].donors.some(donor => /Pamela|Catherine/.test(donor.name)));
  assert.equal(view?.periods[0].committees.length, 10);
  assert.equal(view?.periods[0].filingUrl, "https://kref.ky.gov/filing/2026-Q1");
  assert.equal(view?.periods[0].raised?.line, "Total receipts $2,000.00");
  const full = Buffer.byteLength(JSON.stringify(claims.map(claim => ({ field: claim.field, value: claim.value, quote: claim.quote }))));
  assert.ok(bytes < full * 0.8, `${bytes} bytes read for ${claims.length} lines, against ${full} if each line carried the whole filing`);
  assert.equal(await readCampaignMoneyView(counted, "person:ky:nobody"), null);
});
