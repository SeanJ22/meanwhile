import assert from "node:assert/strict";
import test from "node:test";
import type { DoorInput, DoorOutcome } from "../lib/core/door.ts";
import { checkFact, type SavedCopy } from "../lib/facts/check.ts";
import { campaignClaims, federalAwardClaim, filedAmount, moneyDoorInput, type FiledAmount } from "../lib/funding/money-records.ts";
import {
  buildPeriodRecords, loadStateMoney, passFilingCursor, type DetectiveCase, type FilingCursor, type FilingLine, type FilingRef, type HolderMatch, type ParsedFiling, type RetireAbsentInput,
} from "../lib/funding/state-money-loader.ts";

const NOW = new Date("2026-10-29T12:00:00Z");
const FILER = { id: "C-100", name: "Citizens for Dana Hart", candidateName: "Dana Hart", office: "State Representative", district: "12", jurisdiction: null };

/** A saved filing as plain text: one line per row, "kind|id|flow|party|partyKind|amount". */
function savedCopy(id: number, rows: readonly string[], finalUrl = `https://kref.ky.gov/filing/${id}`): SavedCopy {
  return { id, finalUrl, text: rows.join("\n"), fetchedAt: NOW, isArchive: false };
}
function amount(row: string, text: string): FiledAmount {
  const filed = filedAmount(row, text);
  assert.ok(filed, `${text} is on ${row}`);
  return filed;
}
function parseFixture(copy: SavedCopy): ParsedFiling[] {
  const rows = copy.text.split("\n");
  const header = rows.find(row => row.startsWith("FILING|"))!.split("|");
  const stated = (label: string) => { const row = rows.find(r => r.startsWith(`TOTAL|${label}|`)); return row ? amount(row, /-?\$[\d,.]+/.exec(row)![0]) : null; };
  const lines: FilingLine[] = rows.filter(row => row.startsWith("LINE|")).map(row => {
    const [, id, flow, name, kind, text] = row.split("|");
    return { flow: flow as FilingLine["flow"], id, party: { key: `${kind}:${name}`, name, kind: kind as "individual" | "organization" }, amount: amount(row, text) };
  });
  return [{ filer: FILER, period: { key: header[1], label: header[2], from: null, to: header[3], cycle: 2026 }, filingUrl: copy.finalUrl, publisher: "Kentucky Registry of Election Finance",
    summary: { raised: stated("raised"), spent: stated("spent"), individual: stated("individual"), individualSmall: stated("small") }, lines }];
}

const q1 = savedCopy(1, [
  "FILING|2026-Q1|Jan 1 – Mar 31, 2026|2026-03-31",
  "TOTAL|raised|Total receipts $2,000.00", "TOTAL|spent|Total expenditures $900.00", "TOTAL|individual|Individual contributions $1,500.00", "TOTAL|small|Unitemized individual $620.00",
  "LINE|r1|receipt|Pamela Roach|individual|$25.00",
  "LINE|r2|receipt|Catherine Knaus|individual|$5.00",
  "LINE|r3|receipt|Marcus Bell|individual|$150.00",
  "LINE|r4|receipt|Citizens PAC|organization|$50.00",
  "LINE|e1|expenditure|Printer Co|organization|$5,000.00",
  "LINE|e2|expenditure|Lynn Vendor|individual|$900.00",
]);
const q2 = savedCopy(2, [
  "FILING|2026-Q2|Apr 1 – Jun 30, 2026|2026-06-30",
  "TOTAL|raised|Total receipts $3,000.00", "TOTAL|individual|Individual contributions $2,100.00", "TOTAL|small|Unitemized individual $900.00",
  "LINE|r5|receipt|Catherine Knaus|individual|$5.00",
  "LINE|r6|receipt|Marcus Bell|individual|$100.00",
  "LINE|r7|receipt|Jordan Wells|individual|$1,000.00",
]);
const SMALL_NAMES = ["Pamela Roach", "Catherine Knaus"];

function harness(copies: readonly SavedCopy[], match: HolderMatch = { status: "matched", subjectId: "person:ky:dana-hart" }) {
  const calls = { load: 0, parse: 0, match: 0 };
  const published: DoorInput[] = [], cases: DetectiveCase[] = [], stored = new Map<string, string>();
  const retired: RetireAbsentInput[] = [];
  const ref = (copy: SavedCopy): FilingRef => ({ fingerprint: `sha256-${copy.id}`, filerId: FILER.id, cycle: 2026, load: async () => { calls.load++; return copy; } });
  const refs = copies.map(ref);
  const cursor: FilingCursor = {
    read: async keys => new Map(keys.flatMap(key => stored.has(key) ? [[key, stored.get(key)!] as const] : [])),
    write: async entries => { for (const [key, value] of entries) stored.set(key, value); },
  };
  const options = {
    state: "KY", filings: refs, parserVersion: "test-1", cursor,
    parse: (copy: SavedCopy) => { calls.parse++; return parseFixture(copy); },
    match: async () => { calls.match++; return match; },
    publish: async (input: DoorInput): Promise<DoorOutcome> => { published.push(input); return { decision: "PUBLISH", factId: published.length }; },
    retireAbsent: async (input: RetireAbsentInput) => { retired.push(input); return 0; },
    detective: async (item: DetectiveCase) => { cases.push(item); },
  };
  return { calls, published, retired, cases, stored, options, ref };
}

test("donors giving $200 or less in the cycle are folded into a sum and their names never leave the loader", async () => {
  const run = harness([q1, q2]);
  const summary = await loadStateMoney(run.options);
  // Catherine Knaus gave $5 + $5 and Pamela Roach $25: $35 from two donors, no names.
  assert.deepEqual(summary.smallIndividuals, { amount: 35, donors: 2 });
  // Marcus Bell gave $150 then $100: $250 in the cycle, so he is named, line by line, in each period.
  const bell = run.published.filter(input => /donor:/.test(input.field) && (input.value as { name?: string }).name === "Marcus Bell");
  assert.deepEqual(bell.map(input => (input.value as { amount: number }).amount).sort(), [100, 150]);
  assert.ok(run.published.some(input => (input.value as { name?: string }).name === "Jordan Wells"));
  assert.ok(run.published.some(input => (input.value as { name?: string }).name === "Citizens PAC" && input.field.includes(":pac:")), "organizations show by filed name at any amount");
  // Nothing handed to the Slide, the detective or the report carries a small donor's name. The saved copy is the source document itself.
  const everything = JSON.stringify([run.published.map(({ copy: _copy, ...input }) => input), run.cases, summary]);
  for (const name of SMALL_NAMES) assert.doesNotMatch(everything, new RegExp(name));
  assert.equal(summary.published, run.published.length);
});

test("spending lines are never counted as contributions", async () => {
  const run = harness([q1, q2]);
  const summary = await loadStateMoney(run.options);
  assert.equal(summary.spendingLinesIgnored, 2);
  const named = run.published.filter(input => /:(donor|pac):/.test(input.field)).map(input => (input.value as { name: string }).name).sort();
  assert.deepEqual(named, ["Citizens PAC", "Jordan Wells", "Marcus Bell", "Marcus Bell"], "no payee is a donor");
  const everything = JSON.stringify(run.published.map(({ copy: _copy, ...input }) => input));
  assert.doesNotMatch(everything, /Printer Co|Lynn Vendor/);
  const raised = run.published.find(input => input.field.endsWith(":raised"))!;
  assert.equal(raised.valueText, "$2,000.00");
  assert.equal(raised.quote, "TOTAL|raised|Total receipts $2,000.00");
  // $5,900 of spending lines, however they add up, never changes what the filing states was raised.
  assert.equal((raised.value as { amount: number }).amount, 2000);
});

test("a total the filing does not state is a blank, never a sum of lines", () => {
  const copy = savedCopy(3, ["FILING|2026-Q3|Jul 1 – Sep 30, 2026|2026-09-30", "LINE|r9|receipt|Jordan Wells|individual|$1,000.00"]);
  const built = buildPeriodRecords(parseFixture(copy).map(filing => ({ copy, filing })));
  assert.equal(built.records[0].raised, null);
  assert.deepEqual(built.blanks.map(blank => blank.reason), ["FILING_STATES_NO_TOTAL", "FILING_STATES_NO_TOTAL"]);
  assert.deepEqual(campaignClaims("person:x", built.records[0]).map(claim => claim.field.split(":").at(-2)), ["donor"]);
});

test("money is filed to the seat's holder only: a tie goes to a detective and publishes nothing", async () => {
  const tied = harness([q1, q2], { status: "tie", candidates: ["person:ky:dana-hart", "person:ky:dana-hart-2"] });
  const summary = await loadStateMoney(tied.options);
  assert.equal(tied.published.length, 0);
  assert.equal(summary.ties, 1, "one case per filer and cycle, not one per period");
  assert.deepEqual(tied.cases.map(item => [item.reason, item.candidates]), [["HOLDER_TIE", ["person:ky:dana-hart", "person:ky:dana-hart-2"]]]);
  assert.equal(tied.stored.size, 0, "a tie is read again once the matcher can decide");

  const matched = harness([q1, q2]);
  await loadStateMoney(matched.options);
  assert.ok(matched.published.length > 0);
  for (const input of matched.published) {
    assert.equal((input as { subjectId: string }).subjectId, "person:ky:dana-hart");
    assert.equal((input as { places?: unknown }).places, undefined, "never also filed to a place");
  }
});

test("each set of filings is read once: an unchanged set is skipped unread, a new filing reads the set again", async () => {
  const run = harness([q1, q2]);
  await loadStateMoney(run.options);
  assert.deepEqual(run.calls, { load: 2, parse: 2, match: 1 });
  const again = await loadStateMoney(run.options);
  assert.deepEqual(run.calls, { load: 2, parse: 2, match: 1 });
  assert.equal(again.unchanged, 1);
  const q3 = savedCopy(3, ["FILING|2026-Q3|Jul 1 – Sep 30, 2026|2026-09-30", "TOTAL|raised|Total receipts $10.00"]);
  const loaded = await loadStateMoney({ ...run.options, filings: [...run.options.filings, run.ref(q3)] });
  assert.equal(loaded.loaded, 1);
  assert.deepEqual(run.calls, { load: 5, parse: 5, match: 2 });
});

test("an amended filing replaces the earlier one for its period and a repeated transaction counts once", () => {
  const first = savedCopy(5, ["FILING|2026-Q1|Jan 1 – Mar 31, 2026|2026-03-31", "TOTAL|raised|Total receipts $100.00", "LINE|r1|receipt|Marcus Bell|individual|$300.00"]);
  const amended = { ...savedCopy(6, ["FILING|2026-Q1|Jan 1 – Mar 31, 2026|2026-03-31", "TOTAL|raised|Total receipts $400.00", "LINE|r1|receipt|Marcus Bell|individual|$300.00"]), fetchedAt: new Date(NOW.getTime() + 1000) };
  const later = savedCopy(7, ["FILING|2026-Q2|Apr 1 – Jun 30, 2026|2026-06-30", "TOTAL|raised|Total receipts $50.00", "LINE|r1|receipt|Marcus Bell|individual|$300.00"]);
  const built = buildPeriodRecords([first, amended, later].flatMap(copy => parseFixture(copy).map(filing => ({ copy, filing }))));
  assert.deepEqual(built.records.map(record => [record.period.key, record.raised!.amount, record.donors.length]), [["2026-Q1", 400, 1], ["2026-Q2", 50, 0]]);
});

test("a giver with more lines than a record can show is left out, not shown short", () => {
  const rows = ["FILING|2026-Q1|Jan 1 – Mar 31, 2026|2026-03-31", "TOTAL|raised|Total receipts $9,999.00",
    ...Array.from({ length: 51 }, (_, index) => `LINE|r${index}|receipt|Marcus Bell|individual|$300.00`)];
  const copy = savedCopy(8, rows);
  const built = buildPeriodRecords(parseFixture(copy).map(filing => ({ copy, filing })));
  assert.equal(built.records[0].donors.length, 0);
  assert.ok(built.blanks.some(blank => blank.reason === "TOO_MANY_LINES_FOR_ONE_GIVER"));
});

test("every claim is one number on one exact line of the saved copy, and passes the Slide's check", () => {
  const copy = savedCopy(1, q1.text.split("\n"));
  const built = buildPeriodRecords(parseFixture(copy).map(filing => ({ copy, filing })));
  const claims = campaignClaims("person:ky:dana-hart", built.records[0]);
  assert.ok(claims.length >= 5);
  const entity = { id: "person:ky:dana-hart", fullName: "Dana Hart", stateName: "Kentucky", hosts: [], externalIds: [] };
  for (const claim of claims) {
    const input = moneyDoorInput(claim, copy, "money:KY");
    assert.equal(input.fieldKind, "money");
    const verdict = checkFact({ ...input, entity } as never, NOW, () => 2160);
    assert.equal(verdict.ok, true, `${claim.field} ${JSON.stringify(verdict)}`);
  }
  const wrong = { ...claims[0], quote: "TOTAL|raised|Total receipts $2,001.00" };
  assert.equal(checkFact({ ...moneyDoorInput(wrong, copy, "money:KY"), entity } as never, NOW, () => 2160).ok, false);
});

test("a federal award is filed to its recipient with its stated total, and $0 or negative awards are never published", () => {
  const response = JSON.stringify([{ id: "A1", "Award Amount": "58912.00" }, { id: "A2", "Award Amount": "0.00" }, { id: "A3", "Award Amount": "-85912.00" }]);
  const copy: SavedCopy = { id: 9, finalUrl: "https://api.usaspending.gov/api/v2/search/spending_by_award/", text: response, fetchedAt: NOW, isArchive: false };
  const award = (awardId: string, line: string, text: string) => ({ awardId, title: "Galaxy Evolution and Origins Probe", total: amount(line, text), date: "2026-03-01",
    agency: "National Aeronautics and Space Administration", recipientName: "University of Arizona", sourceUrl: copy.finalUrl });
  const good = federalAwardClaim("government:us-az:university", award("A1", `"Award Amount":"58912.00"`, "58912.00"));
  assert.ok(good);
  assert.equal(good.subjectId, "government:us-az:university");
  assert.equal(checkFact({ ...moneyDoorInput(good, copy, "money:federal"), entity: { id: "government:us-az:university", fullName: "University of Arizona", stateName: "Arizona", hosts: [], externalIds: [] } } as never, NOW, () => 2160).ok, true);
  assert.equal(federalAwardClaim("government:x", award("A2", `"Award Amount":"0.00"`, "0.00")), null);
  assert.equal(federalAwardClaim("government:x", award("A3", `"Award Amount":"-85912.00"`, "-85912.00")), null);
});

test("after each period is filed, what the read no longer shows is retired, and a refused line holds the retire back", async () => {
  const run = harness([q1, q2]);
  const summary = await loadStateMoney(run.options);
  assert.deepEqual(run.retired.map(item => [item.subjectId, item.fieldPrefix]), [["person:ky:dana-hart", "money-campaign:C-100:2026-Q1:"], ["person:ky:dana-hart", "money-campaign:C-100:2026-Q2:"]]);
  for (const item of run.retired) assert.ok(item.stillShown.length > 0 && item.stillShown.every(field => field.startsWith(item.fieldPrefix)) && item.at.getTime() === NOW.getTime() && item.sourceUrl.startsWith("https://kref.ky.gov/"));
  assert.equal(summary.retired, 0);

  const refusing = harness([q1, q2]);
  const refused = await loadStateMoney({ ...refusing.options, publish: async () => ({ refused: "QUOTE_NOT_IN_COPY" }) });
  assert.equal(refusing.retired.length, 0, "a line the Slide refused is not a line the source stopped showing");
  assert.ok(refused.refused.length > 0);
  assert.equal(refusing.stored.size, 0, "and the set is read again");
});

test("the pass cursor keeps one fingerprint per filer and cycle under the state's own names", async () => {
  const rows = new Map<string, string>();
  const query = async (text: string, params: readonly unknown[] = []) => {
    if (text.startsWith("SELECT")) return (params[0] as string[]).flatMap(name => rows.has(name) ? [{ name, position: rows.get(name) }] : []);
    (params[0] as string[]).forEach((name, index) => rows.set(name, (params[1] as string[])[index]));
    return [];
  };
  const cursor = passFilingCursor(query, "KY");
  await cursor.write([["C-100|2026", "abc"]]);
  assert.deepEqual([...rows.keys()], ["money-filings:KY:C-100|2026"]);
  assert.deepEqual([...(await cursor.read(["C-100|2026", "C-200|2026"]))], [["C-100|2026", "abc"]]);
  assert.equal((await cursor.read([])).size, 0);
});
