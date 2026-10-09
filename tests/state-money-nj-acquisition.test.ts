import assert from "node:assert/strict";
import test from "node:test";
import { collectNjFinance, readElecFilings, parseElecEntities } from "../scripts/state-money-nj.mts";
import { ELEC_CONTROL_LOCATION, ELEC_LOCATION_PAGE, ELEC_ENTITY_ENDPOINT, elecRequestBody, normalizeElecFiling, totalElecMoney } from "../lib/hunt/nj-elec.ts";
import type { StateFinanceIO } from "../scripts/lib/state-money-runner.mts";
const read = (value: unknown): Pick<StateFinanceIO, "read"> => ({ read: async (_url, opts) => {
  const text = JSON.stringify(value); opts?.validate?.(text);
  return { text, receipt: { sourceObservedAt: "2028-10-01T00:00:00Z" } as never };
} });
const filed = (amount: unknown, amend = 0) => ({ ENTITY_S: 12, PERIOD: 1, AMEND_NO: amend,
  DATE_RECEIVED: "2028-09-01T00:00:00", FormName: "R-1", AMT_REC: amount, AMT_DISB: 30 });

test("NJ distinguishes verified empty reports, source failures and a filed amount", async () => {
  assert.equal((await readElecFilings(read([]), "12")).kind, "EMPTY");
  assert.equal((await readElecFilings(read({ error: "gateway" }), "12")).kind, "FAILED");
  assert.equal((await readElecFilings({ read: async () => { throw new Error("HTTP 503"); } }, "12")).kind, "FAILED");
  const good = await readElecFilings(read([filed(100)]), "12");
  assert.equal(good.kind, "FILED"); if (good.kind === "FILED") assert.equal(good.money.receipts, 100);
  assert.equal((await readElecFilings(read([filed(100)]), "13")).kind, "FAILED");
});

test("NJ page requests advance source offsets, and absent denominators are invalid", () => {
  assert.equal(new URLSearchParams(elecRequestBody({ locationCode: "1234", electionYear: "2028", start: 100, length: 100 })).get("start"), "100");
  assert.throws(() => parseElecEntities('{"data":[]}'), /INVALID/);
  assert.deepEqual(parseElecEntities('{"data":[],"recordsTotal":0}'), { rows: [], total: 0, pageRows: 0, invalidRows: 0 });
});

test("NJ amendments replace previous reports, missing amounts remain null, and committee scopes never merge", () => {
  const amended = totalElecMoney([normalizeElecFiling(filed(100)), normalizeElecFiling(filed(70, 1))]);
  assert.equal(amended.receipts, 70); assert.equal(amended.reportsCounted, 1);
  assert.equal(totalElecMoney([normalizeElecFiling(filed(null))]).receipts, null);
  assert.equal(totalElecMoney([normalizeElecFiling(filed(20)), normalizeElecFiling({ ...filed(40), ENTITY_S: 13 })]).receipts, 60);
  assert.throws(() => normalizeElecFiling({ AMT_REC: 10 }), /IDENTITY/);
});

test("NJ collector advances native pages and publishes one verified filing despite another filing's failure", async () => {
  const starts: number[] = [];
  const io: StateFinanceIO = { year: 2028, signal: new AbortController().signal, prior: null, attempts: {}, cursors: {}, gaps: [],
    read: async (url, options) => {
      let text: string;
      if (url === ELEC_LOCATION_PAGE) text = '<select><option value="1234">HELD TOWN</option></select>';
      else if (url === ELEC_ENTITY_ENDPOINT) {
        const params = new URLSearchParams(options?.body);
        if (params.get("LocationCodes") === ELEC_CONTROL_LOCATION) text = JSON.stringify({ data: [], recordsTotal: 0 });
        else {
          const start = Number(params.get("start")); starts.push(start);
          assert.equal(params.get("ElectionYears"), "2028");
          text = JSON.stringify({ data: [{ ENTITY_S: String(12 + start), ENTITYNAME: `Filed Candidate ${start}`,
            OFFICE: "Town Council", ELECTIONYEAR: "2028" }], recordsTotal: 2 });
        }
      } else {
        const id = new URL(url).searchParams.get("ENTITY_S");
        if (id === "13") throw new Error("HTTP 503");
        assert.equal(id, "12"); text = JSON.stringify([filed(100)]);
      }
      options?.validate?.(text);
      return { text, receipt: { httpStatus: 200, sourceObservedAt: "2028-10-01T00:00:00Z" } as never };
    } };
  const result = await collectNjFinance(io);
  assert.deepEqual(starts, [0, 1]); assert.equal(result.complete, false);
  assert.equal(result.records.length, 1); assert.equal(result.records[0].filingState, "FILED");
  assert.equal(result.records[0].totals.receipts, 100); assert.equal(io.cursors["nj:2028:1234:start"], 0);
  assert.ok(io.gaps.some(gap => gap.code === "ELEC_FILING_UNREAD"));
});
