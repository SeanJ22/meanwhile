import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { applyManualEdit, checkDoorDraft, type DoorDraft } from "../lib/doors/registry.ts";
import { readFinanceDoor, type FinanceDoorKind } from "../lib/funding/finance-door-reader.ts";

const at = "2026-10-04T08:00:00.000Z";
const map = { committeeId: "Filer", registeredName: "Committee", candidateName: "Candidate", office: "Office", electionYear: "Cycle", reportId: "Report", period: "Period", receipts: "Raised", expenditures: "Spent" };
const csv = 'Filer,Committee,Candidate,Office,Cycle,Report,Period,Raised,Spent,DonorName,MailingAddress\nC1,Friends of Avery,Avery Example,Council,2026,R1,January through June,"$1,200.25",0,Private Donor,99 Private Lane\n';
const response = (bytes: Buffer | string, complete = true) => ({ url: "https://filings.example.gov/export", bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), retrievedAt: at, complete });
const edit = (previous: Parameters<typeof applyManualEdit>[0], draft: DoorDraft) => {
  const checked = checkDoorDraft(draft);
  assert.ok(checked.ok);
  return applyManualEdit(previous, checked.value, at);
};
const door = (kind: FinanceDoorKind, fieldMap = map) => edit(null, {
  doorId: "finance:fixture", kind, ocdId: "ocd-division/country:us/state:tx/county:alder", hosts: ["filings.example.gov"],
  config: { fieldMap: JSON.stringify(fieldMap), rowsPath: "results", totalPath: "count", fileName: "filings.csv" },
});

function zip(name: string, data: Buffer): Buffer {
  const filename = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const first = Buffer.concat([local, filename, data]), directory = Buffer.concat([central, filename]);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(first.length, 16);
  return Buffer.concat([first, directory, end]);
}

test("CSV export, search API and bulk archive readers retain the same filed amounts and raw capture hash", () => {
  const payloads: [FinanceDoorKind, Buffer | string][] = [
    ["campaign-finance-csv", csv],
    ["campaign-finance-search-api", JSON.stringify({ count: 1, results: [{ Filer: "C1", Committee: "Friends of Avery", Candidate: "Avery Example", Office: "Council", Cycle: 2026, Report: "R1", Period: "January through June", Raised: 1200.25, Spent: 0, DonorName: "Private Donor", MailingAddress: "99 Private Lane" }] })],
    ["campaign-finance-bulk-zip", zip("filings.csv", Buffer.from(csv))],
  ];
  for (const [kind, bytes] of payloads) {
    const saved = response(bytes), read = readFinanceDoor(door(kind), [saved]);
    assert.equal(read.paginationComplete, true);
    assert.equal(read.filings.length, 1);
    assert.equal(read.filings[0].receipts, 1200.25);
    assert.equal(read.filings[0].expenditures, 0);
    assert.equal(read.filings[0].cashOnHand, null, "a missing filed line stays unknown");
    assert.equal(read.filings[0].registeredName, "Friends of Avery");
    assert.equal(read.filings[0].sourceHash, createHash("sha256").update(saved.bytes).digest("hex"));
    assert.doesNotMatch(JSON.stringify(read), /Private Donor|99 Private Lane/);
  }
});

test("changing a door's field map changes its read without a place-specific adapter", () => {
  const first = door("campaign-finance-csv");
  const changed = edit(first, { ...first, ocdId: "ocd-division/country:us/state:mi/place:birch", config: { fieldMap: JSON.stringify({ ...map, committeeId: "Id", registeredName: "Name", electionYear: "Year", receipts: "Received" }) } });
  const read = readFinanceDoor(changed, [response("Id,Name,Year,Received\nC2,Birch Campaign,2028,42.50\n")]);
  assert.equal(read.filings[0].receipts, 42.5);
  assert.equal(read.filings[0].ocdId, changed.ocdId);
  assert.equal(read.filings[0].candidateName, null);
  assert.equal(read.filings[0].office, null);
});

test("incomplete pages never claim completeness, and changing counts or repeated reports cannot be silently summed", () => {
  const api = door("campaign-finance-search-api");
  const row = { Filer: "C1", Committee: "Friends of Avery", Cycle: 2026, Report: "R1", Raised: 10 };
  assert.equal(readFinanceDoor(api, [response(JSON.stringify({ count: 2, results: [row] }))]).paginationComplete, false);
  assert.equal(readFinanceDoor(door("campaign-finance-csv"), [response(csv, false)]).paginationComplete, false);
  assert.throws(() => readFinanceDoor(api, [response(JSON.stringify({ count: 2, results: [row] })), response(JSON.stringify({ count: 3, results: [{ ...row, Report: "R2" }] }))]), /count changed/);
  assert.throws(() => readFinanceDoor(api, [response(JSON.stringify({ count: 2, results: [row, row] }))]), /repeats a report/);
  assert.throws(() => readFinanceDoor(api, [{ ...response(JSON.stringify({ count: 1, results: [row] })), url: "https://unrelated.example/export" }]), /outside/);
  assert.throws(() => readFinanceDoor(door("campaign-finance-csv"), [response("<html>Sign in to continue</html>")]), /lacks/);
});

test("an unknown or Boolean publisher count never becomes a complete zero-result read", () => {
  const api = door("campaign-finance-search-api");
  for (const count of [null, false, true, "", " ", [], {}, -1, 0.5]) {
    assert.throws(() => readFinanceDoor(api, [response(JSON.stringify({ count, results: [] }))]), /count changed or is unreadable/);
  }
  for (const count of [0, "0"]) {
    assert.equal(readFinanceDoor(api, [response(JSON.stringify({ count, results: [] }))]).paginationComplete, true);
  }
});
