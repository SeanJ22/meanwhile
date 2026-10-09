import assert from "node:assert/strict";
import test from "node:test";
import { readFilers, nhNativeRecord, type FilerRow } from "../scripts/state-money-nh.mts";
import { upsertStateMoney } from "../lib/funding/state-native.ts";
const row: FilerRow = { filerName: "Filed Committee", firstnameLastname: "Alice Adams", officeSoughtName: "State Senator",
  districtName: "7", town: "Merrimack", electionYear: 2028, totalRaised: 120, totalSpent: null,
  filerEntityId: 100, electionCycle: "2028", filerTypeDesc: "Candidate" };

test("NH follows every source page and keeps its explicit period without a ballot prerequisite", async () => {
  const result = await readFilers("", async ({ pageNumber }) => ({ status: 200, totalItems: 2,
    items: [{ ...row, filerEntityId: pageNumber }] }), { pageSize: 1 });
  assert.equal(result.ok, true); assert.equal(result.retrieved, 2);
  const normalized = nhNativeRecord(result.rows[0], "2028-10-01T00:00:00Z")!;
  assert.equal(normalized.electionYear, 2028); assert.deepEqual(normalized.targetKeys, ["state-finance:NH:1:2028"]);
  assert.equal(normalized.totals.receipts, 120); assert.equal(normalized.totals.expenditures, null);
});

test("NH HTTP failure, changing denominator and repeated pages cannot establish absence", async () => {
  for (const failure of ["HTTP", "COUNT", "DUPLICATE"] as const) {
    const result = await readFilers("", async ({ pageNumber }) => pageNumber === 1
      ? { status: 200, totalItems: 2, items: [row] }
      : { status: failure === "HTTP" ? 503 : 200, totalItems: failure === "COUNT" ? 3 : 2, items: [row] }, { pageSize: 1 });
    assert.equal(result.ok, false); assert.equal(result.rows.length, 1); assert.equal(result.denominatorProven, false);
  }
});

test("NH a genuine empty answer is distinct from a failed read; neither invents a named absence", async () => {
  const empty = await readFilers("", async () => ({ status: 200, totalItems: 0, items: [] }));
  const failed = await readFilers("", async () => ({ status: 503, totalItems: null, items: [] }));
  assert.equal(empty.ok, true); assert.equal(empty.denominatorProven, true);
  assert.equal(failed.ok, false); assert.equal(failed.denominatorProven, false);
  assert.deepEqual(empty.rows, []); assert.deepEqual(failed.rows, []);
});

test("NH unknown lines stay unknown and failed refresh preserves original source dates", () => {
  assert.equal(nhNativeRecord(null as never, "2028-10-01T00:00:00Z"), null);
  const held = nhNativeRecord(row, "2028-09-01T00:00:00Z")!;
  const old = upsertStateMoney(null, [held], { state: "NH", year: 2028, observedAt: held.provenance.collectedAt });
  const unknown = nhNativeRecord({ ...row, totalRaised: null, totalSpent: null }, "2028-10-01T00:00:00Z")!;
  assert.equal(unknown.filingState, "ROUTE_UNREAD");
  const current = upsertStateMoney(old, [unknown], { state: "NH", year: 2028, observedAt: "2028-10-01T00:00:00Z" });
  assert.deepEqual(current.records[0], held);
  const zero = nhNativeRecord({ ...row, totalRaised: 0, totalSpent: 0 }, "2028-10-01T00:00:00Z")!;
  assert.equal(zero.filingState, "REGISTERED_NO_ACTIVITY_REPORTED"); assert.equal(zero.totals.receipts, null);
});

test("NH a bounded walk resumes the source page and denominator without re-reading its prefix", async () => {
  const requested: number[] = [];
  const page = async ({ pageNumber }: { pageNumber: number }) => {
    requested.push(pageNumber); return { status: 200, totalItems: 2, items: [{ ...row, filerEntityId: pageNumber }] };
  };
  const partial = await readFilers("", page, { pageSize: 1, maxPages: 1 });
  assert.equal(partial.ok, false); assert.equal(partial.retrieved, 1);
  const resumed = await readFilers("", page, { pageSize: 1, startPage: 2, startOffset: 1, expectedTotal: 2 });
  assert.equal(resumed.ok, true); assert.deepEqual(requested, [1, 2]);
});

test("native summary refresh retains independent finance details, and changed identities lose old person aliases", () => {
  const held = nhNativeRecord(row, "2028-09-01T00:00:00Z")!;
  held.match.allThreeAgree = true;
  held.targetKeys.push("nh-sos:candidate:alice:2028");
  held.funding = { organizations: [{ kind: "COMMITTEE_OR_ORGANIZATION", filedName: "Filed PAC", filedType: "PAC",
    amount: 20, sourceUrl: "https://cfs.sos.nh.gov/" }], individualItemized: 10, individualUnitemized: 5, individualTotal: 15, scope: "ELECTION_CYCLE" };
  const old = upsertStateMoney(null, [held], { state: "NH", year: 2028, observedAt: held.provenance.collectedAt });
  const next = nhNativeRecord({ ...row, totalRaised: 200 }, "2028-10-01T00:00:00Z")!;
  const refreshed = upsertStateMoney(old, [next], { state: "NH", year: 2028, observedAt: next.provenance.collectedAt });
  assert.equal(refreshed.records[0].totals.receipts, 200);
  assert.deepEqual(refreshed.records[0].funding, held.funding);
  assert.ok(refreshed.records[0].targetKeys.includes("nh-sos:candidate:alice:2028"));
  const changed = nhNativeRecord({ ...row, firstnameLastname: "Changed Native Person" }, "2028-10-02T00:00:00Z")!;
  const unbound = upsertStateMoney(refreshed, [changed], { state: "NH", year: 2028, observedAt: changed.provenance.collectedAt });
  assert.deepEqual(unbound.records[0].targetKeys, ["state-finance:NH:100:2028"]);
  assert.equal(unbound.records[0].funding, undefined);
});
