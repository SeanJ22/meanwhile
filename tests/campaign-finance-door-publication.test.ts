import { fetchThroughKey } from "../lib/ask/fetch-through-key.ts";
import { financeQuestionAsked } from "../lib/ask/local-finance.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createWorkItem, type WorkItem } from "../lib/control-plane/work-item.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { applyManualEdit, checkDoorDraft } from "../lib/doors/registry.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { campaignFinancePackage, publishCampaignFinance, runFinanceDoorPublication } from "../lib/funding/campaign-finance.ts";
import { readCampaignFinance } from "../lib/funding/campaign-finance-reader.ts";
import { DEFAULT_SOURCE_POLICY } from "../lib/control-plane/promotion/source-kinds.ts";
import { filedOrganizations, stateSmallDonorSentence } from "../lib/funding/state-money-funding.ts";
import { composeMoneyAnswer } from "../lib/ask/money-answer.ts";
import { zip as createZip } from "../scripts/xlsx.mjs";

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

test("new-jurisdiction finance doors preserve exact candidate filings as typed source evidence without sums", async () => {
  const input = source("C1,Friends of Avery,Avery Example,Council,2026,R2,July through September,300,\nC2,Other committee,,Council,2026,R3,January through June,900,100\n");
  const store = new MemoryRoutineDataStore();
  const result = await publishCampaignFinance(store, input);
  assert.ok(result.promoted, JSON.stringify(result.candidate));
  assert.equal(result.readerReadback?.status, "PASS", JSON.stringify(result.readerReadback));
  assert.equal(result.unbound.length, 1, "unmatched candidate identity remains work");
  const read = await readCampaignFinance(division, { store, now });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(read.value.records.map(row => row.record.totals.receipts), [1200, 300]);
  assert.equal(read.value.records[1].record.totals.expenditures, null);
  assert.equal(read.value.records[0].record.totals.cashOnHand, null);
  assert.deepEqual(read.value.records.map(row => row.reportId), ["R1", "R2"]);
  const absent = await readCampaignFinance("ocd-division/country:us/state:oh/place:birch", { store, now });
  assert.equal(absent.kind, "PROMOTED");
  if (absent.kind === "PROMOTED") assert.deepEqual(absent.value.records, []);
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
    assert.throws(() => campaignFinancePackage(changed), kind);
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

test("incomplete Money facts publish as source documents and preserve known cells", async () => {
  for (const missing of ["amount", "period"]) {
    const input = source(), store = new MemoryRoutineDataStore();
    const text = input.captures[0].evidence.text.replace(missing === "amount" ? ",1200,0" : ",January through June,",
      missing === "amount" ? ",," : ",,");
    input.responses[0].bytes = Buffer.from(text); input.captures[0].evidence.text = text;
    input.captures[0].evidence.contentHash = `sha256-${createHash("sha256").update(text).digest("hex")}`;
    const published = await publishCampaignFinance(store, input); assert.ok(published.promoted, JSON.stringify(published.candidate));
    assert.equal(published.documentsWithOwedMoney.length, 1);
    const read = await readCampaignFinance(division, { store, now }); assert.equal(read.kind, "PROMOTED");
    if (read.kind !== "PROMOTED") continue;
    assert.equal(read.value.records[0].kind, "CAMPAIGN_FINANCE_DOCUMENT");
    assert.equal(read.value.records[0].record.totals.receipts, missing === "period" ? 1200 : null);
    const record = read.value.records[0].record;
    assert.equal(record.committeeId, "C1");
    assert.equal(record.filingsUrl, input.responses[0].url);
    assert.equal(record.totals.expenditures, missing === "period" ? 0 : null);
  }
  const disabled = source();
  Object.assign(disabled.captures[0], { sourcePolicy: { ...DEFAULT_SOURCE_POLICY, enabled: { ...DEFAULT_SOURCE_POLICY.enabled, FILING: false } } });
  assert.throws(() => campaignFinancePackage(disabled), /SOURCE_KIND_DISABLED/);
});

function zip(name: string, data: Buffer): Buffer {
  return createZip([{ name, data }], "2026-10-05");
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
    assert.equal(result.readerReadback?.status, "PASS", JSON.stringify(result.readerReadback));
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


test("the admitted finance worker retains publication and unresolved rows in the existing work item", async () => {
  const repos = createMemoryRepositories(), store = new MemoryRoutineDataStore();
  const item = createWorkItem({ project: "fixture", subject: division, obligation: "campaign finance", why: "Held filings are owed", now });
  const plan = { version: 1, jurisdiction: "US-OH", contract: { schemaVersion: 2, recordClass: "CAMPAIGN_FINANCE_FILING", jurisdiction: { state: "OH" } },
    publication: { contractId: "campaign-finance", bodyId: division } } as unknown as NonNullable<WorkItem["autonomousPlan"]>;
  await repos.workItems.put(item.id, { ...item, autonomousPlan: plan }, now);
  const inputs = source("C2,Other committee,,Council,2026,R2,January through June,900,100\n");
  const first = await runFinanceDoorPublication({ ...inputs, repos, store, workItemId: item.id, workerResultId: "held-source-read" });
  assert.equal(first.outcome.status, "PARTIALLY_PUBLISHED");
  assert.equal(first.outcome.acceptedRecordIds!.length, 1);
  assert.equal(first.outcome.recovery, "WORKER");
  assert.deepEqual((await repos.workItems.mustRead(item.id)).value.publicationOutcome, first.outcome);
  const failed = source(); failed.responses[0].complete = false;
  const refusal = await runFinanceDoorPublication({ ...failed, repos, store, workItemId: item.id, workerResultId: "incomplete-source-read" });
  assert.equal(refusal.outcome.status, "HELD");
  const read = await readCampaignFinance(division, { store, now });
  assert.equal(read.metadata.versionId, first.outcome.versionId);
  const foreign = { ...plan, contract: { ...plan.contract, schemaVersion: 2 as const, jurisdiction: { state: "MI" } } } as unknown as typeof plan;
  const latest = await repos.workItems.mustRead(item.id);
  await repos.workItems.compareAndSet(item.id, latest.revision, { ...latest.value, autonomousPlan: foreign }, now);
  await assert.rejects(runFinanceDoorPublication({ ...source(), repos, store, workItemId: item.id, workerResultId: "foreign-worker" }), /admitted state/);
});

test("filed organizations and aggregate private giving reach cards and Ask, with cycle-only small-donor share", async () => {
  const check = checkDoorDraft({ doorId: "finance:organizations", kind: "campaign-finance-search-api", ocdId: division,
    hosts: ["filings.example.gov"], config: { agency: "Fixture filing authority", rowsPath: "results", totalPath: "count", fieldMap: JSON.stringify({
      committeeId: "Id", registeredName: "Name", candidateName: "Candidate", office: "Office", electionYear: "Cycle", reportId: "Report", period: "Period",
      receipts: "Raised", organizations: "Groups", individualItemized: "Itemized", individualUnitemized: "Unitemized", individualTotal: "Individual", donorScope: "Scope" }) } });
  assert.ok(check.ok);
  const door = applyManualEdit(null, check.value, now);
  const text = JSON.stringify({ count: 1, results: [{ Id: "C1", Name: "Friends of Avery", Candidate: "Avery Example", Office: "Council", Cycle: 2026,
    Report: "Cycle report", Period: "2026 election cycle", Raised: 1200, Itemized: 300, Unitemized: 100, Individual: 400, Scope: "ELECTION_CYCLE", Groups: [
      { kind: "COMMITTEE", filedName: "Neighbors PAC", filedType: "PAC", amount: 700, MailingAddress: "66 Private Road" },
      { kind: "CORPORATION", filedName: "Alder Organization", filedType: "Corporation", amount: 100 },
      { kind: "INDIVIDUAL", filedName: "Private Donor", filedType: "Person", amount: 99, MailingAddress: "99 Private Lane" },
      { filedName: "Unclassified Person", amount: 50 },
    ] }] });
  const bytes = Buffer.from(text), url = "https://filings.example.gov/export";
  const store = new MemoryRoutineDataStore();
  const input = { door, now, ballots: [ballot], captures: [], responses: [{ url, bytes, retrievedAt: now, complete: true, partial: false,
    rawHash: createHash("sha256").update(bytes).digest("hex"), publisher: "Fixture filing authority", httpStatus: 200, transport: "REACHABLE" as const }] };
  const result = await publishCampaignFinance(store, input);
  assert.ok(result.promoted, result.candidate.failureDetail ?? "held");
  assert.equal(result.readerReadback?.status, "PASS", JSON.stringify(result.readerReadback));
  const read = await readCampaignFinance(division, { store, now });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("Finance absent");
  const record = read.value.records[0].record;
  assert.deepEqual(filedOrganizations(record.funding).map(row => [row.filedName, row.amount]), [["Neighbors PAC", 700], ["Alder Organization", 100]]);
  assert.match(stateSmallDonorSentence(record.funding)!, /25%/);
  assert.equal(stateSmallDonorSentence({ ...record.funding!, scope: "REPORT_PERIOD" }), null);
  assert.doesNotMatch(JSON.stringify(read.value), /Private Donor|Private Lane|Private Road|Unclassified Person/);
  const subject = { kind: "PERSON" as const, id: target, name: "Avery Example" };
  const evidence = {records:[{kind:"FINANCE_SUMMARY" as const,id:`state-money:${target}`,subjectId:target,text:"Filed campaign totals",sourceUrl:url,
    stateDetailSource:record.detailSource,finance:{jurisdiction:record.jurisdiction,filingState:record.filingState,totals:record.totals,registeredName:record.registeredName,agency:record.agency,electionYear:record.electionYear,checkedAt:record.checkedAt,funding:record.funding}}]};
  const answer = composeMoneyAnswer({ ask: { kind: "WHO_GAVE" }, subject, records: evidence.records, gaps: [] });
  assert.ok(answer, "held organization amounts should compose without a writer");
  assert.match(answer.answer, /Neighbors PAC/);
  assert.doesNotMatch(answer.answer, /not the identities|name no donors|Private Donor/);
  assert.deepEqual(answer.citedUrls, [url]);
  assert.equal(financeQuestionAsked("List every PAC that gave to Avery Example this year"), true);
  const detail = await fetchThroughKey({ question: "List all campaign contributors to Avery Example", subject, records: evidence.records,
    deadlineMs: Date.now() + 1000, apiOptions: { fetchImpl: async (requested, init) => {
      assert.equal(requested, url); assert.equal(init?.redirect, "error");
      return new Response(bytes, { status: 200 });
    } } });
  assert.equal(detail?.status, "COMPLETE"); assert.equal(detail.records.length, 3);
  assert.doesNotMatch(JSON.stringify(detail), /Private Donor|Private Lane|Private Road|Unclassified Person/);
  assert.ok(detail.records.every(row => row.sourceUrl === url && row.subjectId === subject.id));
  const foreignText = text.replace('"Candidate":"Avery Example"', '"Candidate":"Other Person"');
  const foreign = await fetchThroughKey({ question: "List all campaign contributors to Avery Example", subject, records: evidence.records,
    deadlineMs: Date.now() + 1000, apiOptions: { fetchImpl: async () => new Response(foreignText) } });
  assert.equal(foreign?.status, "UNAVAILABLE"); assert.equal(foreign?.records.length, 0);
});
