import assert from "node:assert/strict";
import { test } from "node:test";

import { settleAgendaSupportingHoldings } from "../app/api/agenda/route.ts";
import type { MeetingReaderRecords } from "../lib/meetings/reader-records.ts";

const records: MeetingReaderRecords = {
  meetingId: "meeting-1",
  bodyId: "body-1",
  status: "HELD",
  agenda: [],
  actions: [],
  rollCalls: [],
  counts: { agenda: 0, actions: 0, rollCalls: 0, votes: 0 },
  sourceUrl: "https://publisher.example/meeting-1",
  sourceOrg: "Publisher",
};

test("outcome-store failure cannot erase an independently held meeting or listing identity", async () => {
  const listing = { sourceListingCount: 1 };
  const result = await settleAgendaSupportingHoldings("meeting-1", "body-1", {
    outcomes: async () => { throw new Error("planted outcome failure"); },
    listingIdentity: async () => listing,
  });
  assert.equal(result.records.status, "HOLDING_UNAVAILABLE");
  assert.equal(result.listingIdentity, listing);
  assert.equal(result.supportingHoldingStatus, "PARTIAL");
  assert.deepEqual(result.unavailableAuthorities, ["MEETING_OUTCOME"]);
});

test("registry failure cannot erase held outcome records", async () => {
  const result = await settleAgendaSupportingHoldings("meeting-1", "body-1", {
    outcomes: async () => records,
    listingIdentity: async () => { throw new Error("planted registry failure"); },
  });
  assert.equal(result.records, records);
  assert.equal(result.listingIdentity, null);
  assert.equal(result.supportingHoldingStatus, "PARTIAL");
  assert.deepEqual(result.unavailableAuthorities, ["REGISTRY_RUNTIME_BINDING"]);
});
