import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { applyManualEdit, checkDoorDraft } from "../lib/doors/registry.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { promotedEdgeEntryOf } from "../lib/civic-data/read-model.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { campaignFinancePackage, publishCampaignFinance } from "../lib/funding/campaign-finance.ts";
import { campaignFinanceScope, readCampaignFinance, campaignFinanceForTarget, settleCampaignFinanceReads } from "../lib/funding/campaign-finance-reader.ts";
import { stateMoneyForTarget } from "../lib/funding/state-snapshot.ts";

const now = "2026-10-05T18:00:00Z", division = "ocd-division/country:us/state:oh/place:alder", target = "ballot-candidacy:avery";
const provenance = { sourceUrl: "https://elections.example.gov/candidates", sourceOrg: "Fixture election authority", collectedAt: now, verifiedAt: now };
const ballot: BallotSet = { election: { id: "fixture-election", state: "OH", date: "2026-11-03", name: "General election" },
  contests: [{ id: "contest:alder", electionId: "fixture-election", ocdId: division, divisionVintage: "fixture", title: "Council",
    type: "CANDIDACY", voteFor: 1, termYears: null, scopeNote: null, provenance }],
  candidacies: [{ id: target, contestId: "contest:alder", familyName: "Example", givenName: "Avery", partyLabel: null,
    slogan: null, incumbent: null, websiteUrl: null, provenance }], measures: [], absences: [] };
function source(extra = "") {
  const checked = checkDoorDraft({ doorId: "finance:alder", kind: "campaign-finance-csv", ocdId: division,
    hosts: ["filings.example.gov"], config: { agency: "Fixture filing authority", fieldMap: JSON.stringify({
      committeeId: "Id", registeredName: "Name", candidateName: "Candidate", office: "Office", electionYear: "Cycle",
      reportId: "Report", period: "Period", receipts: "Raised", expenditures: "Spent" }) } });
  assert.ok(checked.ok);
  const door = applyManualEdit(null, checked.value, now);
  const text = "Id,Name,Candidate,Office,Cycle,Report,Period,Raised,Spent\nC1,Friends of Avery,Avery Example,Council,2026,R1,January through June,1200,0\n" + extra;
  const url = "https://filings.example.gov/export", hash = createHash("sha256").update(text).digest("hex");
  return { door, now, ballots: [ballot], responses: [{ url, retrievedAt: now, complete: true, bytes: Buffer.from(text) }],
    captures: [{ evidence: { artifactId: "filing-export", acquiredByAttemptId: "held", sourceId: "Fixture filing authority",
      methodRouteId: "export", canonicalUrl: url, contentHash: `sha256-${hash}`, text, retrievedAt: now },
    observedAt: now, partial: false, transport: "REACHABLE" as const, httpStatus: 200 }] };
}

test("new-jurisdiction finance doors publish exact candidate filings through Slide, typed readback, cards and Ask without sums", async () => {
  const input = source("C1,Friends of Avery,Avery Example,Council,2026,R2,July through September,300,\nC2,Other committee,,Council,2026,R3,January through June,900,100\n");
  const store = new MemoryRoutineDataStore();
  const result = await publishCampaignFinance(store, input);
  assert.ok(result.promoted, JSON.stringify(result.candidate));
  assert.equal(result.readerReadback?.status, "PASS");
  assert.equal(result.unbound.length, 1, "unmatched candidate identity remains work");
  const read = await readCampaignFinance(division, { store, now });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(read.value.records.map(row => row.record.totals.receipts), [1200, 300]);
  assert.equal(read.value.records[1].record.totals.expenditures, null);
  assert.equal(read.value.records[0].record.totals.cashOnHand, null);
  assert.deepEqual(read.value.records.map(row => row.reportId), ["R1", "R2"]);
  const edge = promotedEdgeEntryOf(read, "CURATED_READER_RECORD", campaignFinanceScope(division), store);
  assert.ok(edge);
  const promoted = new Map([[`CURATED_READER_RECORD:${campaignFinanceScope(division)}`, edge]]);
  await withReaderAuthorityEdge({ promoted, edgeOnly: true }, async () => {
    assert.deepEqual(campaignFinanceForTarget(target), [], "no unvalidated edge payload renders");
    assert.equal((await settleCampaignFinanceReads()).length, 1);
    assert.deepEqual(stateMoneyForTarget(target).map(row => row.totals.receipts), [1200, 300]);
    assert.deepEqual(stateMoneyForTarget("another-candidate"), []);
  });
  assert.deepEqual(campaignFinanceForTarget(target), [], "another request cannot inherit this place's filings");
  const absent = await readCampaignFinance("ocd-division/country:us/state:oh/place:birch", { store, now });
  assert.equal(absent.kind, "NOT_RECORDED");
});

test("incomplete source, wrong candidate, corrupted bytes and unverified source never replace the last GOOD filings", async () => {
  const store = new MemoryRoutineDataStore(), input = source();
  const good = await publishCampaignFinance(store, input); assert.ok(good.promoted);
  for (const kind of ["incomplete", "wrong-office", "bytes", "partial", "unofficial"]) {
    const changed = source();
    if (kind === "incomplete") changed.responses[0].complete = false;
    if (kind === "wrong-office") changed.ballots = [{ ...ballot, contests: ballot.contests.map(row => ({ ...row, title: "Mayor" })) }];
    if (kind === "bytes") changed.responses[0].bytes = Buffer.from("Corrupt saved export");
    if (kind === "partial") changed.captures[0].partial = true;
    if (kind === "unofficial") {
      changed.responses[0].url = "https://filings.example.com/export";
      changed.captures[0].evidence.canonicalUrl = changed.responses[0].url;
      changed.door = { ...changed.door, hosts: ["filings.example.com"] };
    }
    assert.throws(() => campaignFinancePackage(changed), undefined, kind);
    const read = await readCampaignFinance(division, { store, now, bypassCache: true });
    assert.equal(read.metadata.versionId, good.promoted!.versionId, kind);
  }
});

test("same-place successor retains prior reported periods with their original authority and capture dates", async () => {
  const store = new MemoryRoutineDataStore();
  await publishCampaignFinance(store, source("C1,Friends of Avery,Avery Example,Council,2026,R2,July through September,300,\n"));
  const changed = source();
  changed.now = "2026-10-05T19:00:00Z";
  await publishCampaignFinance(store, changed);
  const read = await readCampaignFinance(division, { store, now: changed.now, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") {
    assert.deepEqual(new Set(read.value.records.map(row => row.reportId)), new Set(["R1", "R2"]));
    assert.equal(read.value.records.find(row => row.reportId === "R2")!.collectedAt, now);
  }
});

function zip(name: string, data: Buffer): Buffer {
  const filename = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
  const first = Buffer.concat([local, filename, data]), directory = Buffer.concat([central, filename]);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(first.length, 16);
  return Buffer.concat([first, directory, end]);
}


test("saved search API and raw ZIP captures publish through the same door, preserving raw hashes and donor privacy", async () => {
  for (const kind of ["campaign-finance-search-api", "campaign-finance-bulk-zip"]) {
    const base = source(), store = new MemoryRoutineDataStore();
    const bytes = kind.endsWith("zip") ? zip("filings.csv", base.responses[0].bytes) : Buffer.from(JSON.stringify({
      count: 1, results: [{ Id: "C1", Name: "Friends of Avery", Candidate: "Avery Example", Office: "Council", Cycle: 2026,
        Report: "R1", Period: "January through June", Raised: 1200, Spent: 0, DonorName: "Private Donor", Address: "99 Private Lane" }],
    }));
    const response = { ...base.responses[0], bytes, rawHash: createHash("sha256").update(bytes).digest("hex"),
      publisher: "Fixture filing authority", httpStatus: 200, transport: "REACHABLE", partial: false };
    const door = { ...base.door, kind, config: { ...base.door.config, rowsPath: "results", totalPath: "count", fileName: "filings.csv" } };
    const result = await publishCampaignFinance(store, { ...base, door, responses: [response], captures: [] });
    assert.ok(result.promoted, JSON.stringify(result.candidate));
    assert.equal(result.readerReadback?.status, "PASS");
    const read = await readCampaignFinance(division, { store, now });
    assert.equal(read.kind, "PROMOTED");
    if (read.kind === "PROMOTED") {
      assert.equal(read.value.records[0].sourceHash, response.rawHash);
      assert.equal(read.value.records[0].record.totals.receipts, 1200);
      assert.doesNotMatch(JSON.stringify(read.value), /Private Donor|99 Private Lane/);
    }
    for (const changed of [{ ...response, partial: true }, { ...response, httpStatus: 206, partial: true },
      { ...response, transport: "UNKNOWN" }, { ...response, rawHash: "0".repeat(64) }]) {
      assert.throws(() => campaignFinancePackage({ ...base, door, captures: [], responses: [changed] }));
    }
  }
});
