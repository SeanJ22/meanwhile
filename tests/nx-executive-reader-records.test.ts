import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import { serverReaderValue } from "../lib/reader/memory.ts";

// Install the server's existing shared national shelf before importing routes;
// every endpoint must use this resident value rather than fetch another source.
const state = { roster: null as OfficeholderSet | null, reads: 0, unavailable: false };
serverReaderValue("national-president", () => async () => { state.reads++; if (state.unavailable) throw new Error("planted national shelf failure"); return state.roster; });
const { verifiedWhiteHouseOfficial, ADMINISTRATION_URL } = await import("../lib/sources/white-house/president.ts");
const { presidentialRegisterRecords, presidentialBillRecords, senateTieVoteLinks, senateTieVoteRecord, SENATE_TIE_VOTES_URL } = await import("../lib/sources/white-house/presidential-records.ts");
const { cabinetDepartment, departmentRegisterActions } = await import("../lib/sources/white-house/cabinet-records.ts");
const { nationalExecutiveActions, nationalExecutiveVotes, readNationalExecutiveActions, readNationalExecutiveVotes } = await import("../lib/officials/national-executive-records.ts");
const { GET: actionsGET } = await import("../app/api/official-actions/[subject]/route.ts");
const { GET: votesGET } = await import("../app/api/votes/route.ts");
const fixture = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
const at = "2026-10-23T00:00:00.000Z";
const index = { url: ADMINISTRATION_URL, html: fixture("white-house/administration.html"), retrievedAt: at };
const personSet = (office: "president" | "vice-president" | "cabinet:secretary-of-state", slug: string) => verifiedWhiteHouseOfficial(office, index, { url: `${ADMINISTRATION_URL}${slug}/`, html: fixture(`white-house/${slug}.html`), retrievedAt: at });
const presidentSet = personSet("president", "donald-j-trump"), viceSet = personSet("vice-president", "jd-vance"), secretarySet = personSet("cabinet:secretary-of-state", "cabinet");
const president = { ...presidentSet.officeholders[0], termStart: "2025-01-20", termEnd: "2029-01-20" };
const vice = { ...viceSet.officeholders[0], termStart: "2025-01-20", termEnd: "2029-01-20" };
const secretary = secretarySet.officeholders[0];
const frUrl = "https://www.federalregister.gov/api/v1/documents.json?conditions%5Bpresident%5D=donald-trump";
const register = presidentialRegisterRecords({ url: frUrl, body: fixture("nx-executive/presidential/register-complete.json"), retrievedAt: at }, president, "donald-trump");
const signed = presidentialBillRecords({ url: "https://api.congress.gov/v3/bill/119/hr/1/actions?format=json&limit=250", body: fixture("nx-executive/presidential/congress-actions.json"), retrievedAt: at }, president);
const links = senateTieVoteLinks({ url: SENATE_TIE_VOTES_URL, body: fixture("nx-executive/presidential/senate-ties.html"), retrievedAt: at }, vice);
const link = links.find(row => row.url.endsWith("vote_119_1_00015.xml"))!;
const tie = senateTieVoteRecord({ url: link.url, body: fixture("nx-executive/presidential/senate-vote.xml"), retrievedAt: at }, vice, link);
const cabinetFixture = (JSON.parse(fixture("nx-executive/cabinet/sources.json")) as {sources:{file:string;url:string}[]}).sources.find(row => row.file === "fr-state.json")!;
const own = cabinetDepartment(secretary.officeTitle)!;
const departmentActions = departmentRegisterActions({ url: cabinetFixture.url, body: fixture("nx-executive/cabinet/fr-state.json"), retrievedAt: at }, own);
const roster: OfficeholderSet = { scope: "US", generatedAt: at,
  officeholders: [{ ...president, executive: { records: [...register, ...signed] } }, { ...vice, executive: { records: [tie], coverage: { tieBreakingVotes: true } } },
    { ...secretary, executive: { cabinet: { department: { name: own.name, sourceUrl: "https://www.state.gov/", collectedAt: at, actions: departmentActions }, priorOffices: [], sources: [], gaps: [], coverage: {} } } }],
  divisions: [...presidentSet.divisions, ...viceSet.divisions, ...secretarySet.divisions], unmatched: [] };
state.roster = roster;

test("President records fill the existing official-action response including every saved memorandum", () => {
  const answer = nationalExecutiveActions(president.id, roster);
  assert.equal(answer.status, "RESOLVED");
  assert.equal(answer.count, register.length + signed.length);
  assert.equal(answer.records.filter(row => row.kind === "MEMORANDUM").length, 35);
  const bill = answer.records.find(row => row.kind === "BILL_SIGNED")!;
  assert.match(bill.text, /2025-07-04/);
  assert.doesNotMatch(bill.text, /Governor/);
  for (const row of answer.records) { assert.equal(row.officialId, president.id); assert.equal(row.collectedAt, at); assert.ok(row.sourceUrl.startsWith("https://")); }
});

test("current identity and current term prevent predecessor or cross-person actions from leaking", () => {
  const contaminated: OfficeholderSet = { ...roster, officeholders: roster.officeholders.map(person => person.id === president.id ? { ...person,
    executive: { ...person.executive, records: [...person.executive!.records!, { ...register[0], id: "another-person", personId: vice.id }, { ...register[0], id: "earlier-term", date: "2017-01-25" }] } } : person) };
  const answer = nationalExecutiveActions(president.id, contaminated);
  assert.equal(answer.count, register.length + signed.length);
  assert.deepEqual(answer.withheldRecords.map(row => row.id), ["another-person", "earlier-term"]);
  assert.equal(nationalExecutiveActions("white-house:someone-else", roster).status, "IDENTITY_UNRESOLVED");
  assert.equal(nationalExecutiveActions(president.id, { ...roster, divisions: roster.divisions.filter(row => row.officeholderId !== president.id) }).count, 0);
  assert.equal(nationalExecutiveActions(president.id, null).status, "NOT_HELD");
});

test("Cabinet department acts render as department acts in the same official-action shape", () => {
  const answer = nationalExecutiveActions(secretary.id, roster);
  assert.equal(answer.count, departmentActions.length);
  assert.ok(answer.records.every(row => row.kind === "DEPARTMENT_ACTION" && row.text.startsWith(`${own.name}: `) && row.sourceOrg === "Federal Register"));
  assert.equal(nationalExecutiveActions(vice.id, roster).count, 0, "Senate votes are not mislabelled executive actions");
});

test("Senate VP tie breaker uses existing roll-call fields, sourced position, result and checked date", () => {
  const answer = nationalExecutiveVotes(vice.id, roster);
  assert.equal(answer.holdingStatus, "HELD");
  assert.equal(answer.chamber, "senate");
  assert.equal(answer.count, 1);
  const vote = answer.votes[0];
  assert.equal(vote.title, tie.title);
  assert.equal(vote.position, "YES");
  assert.equal(vote.rollCallUrl, tie.sourceUrl);
  assert.equal(vote.retrievedAt, tie.collectedAt);
  assert.match(vote.result, /50–50/);
  assert.equal(vote.partyBreakdown, null);
  assert.equal(nationalExecutiveVotes(president.id, roster).count, 0);
});

test("real card endpoints use the same resident national roster without touching source websites", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Reader attempted an external or database fetch"); };
  const before = state.reads;
  try {
    const actions = await actionsGET(new Request(`https://meanwhileusa.com/api/official-actions/${encodeURIComponent(president.id)}`), { params: Promise.resolve({ subject: president.id }) });
    assert.equal(actions.status, 200);
    const actionBody = await actions.json();
    assert.equal(actionBody.count, register.length + signed.length);
    const votes = await votesGET(new Request(`https://meanwhileusa.com/api/votes?member=${encodeURIComponent(vice.id)}`));
    assert.equal(votes.status, 200);
    const voteBody = await votes.json();
    assert.equal(voteBody.votes[0].id, tie.id);
    assert.equal(state.reads - before, 2, "both endpoints consume the already-resident roster accessor");
  } finally { globalThis.fetch = originalFetch; }
});

test("source-store failure remains explicit and never becomes an empty successful record", async () => {
  const readers = { roster: async () => { throw new Error("unavailable"); } };
  assert.equal((await readNationalExecutiveActions(president.id, readers)).status, 503);
  assert.equal((await readNationalExecutiveVotes(vice.id, false, readers)).status, 503);
  const history = await readNationalExecutiveVotes(vice.id, true, { roster: async () => roster });
  assert.equal((await history.json()).historyStatus, "COMPLETE");
  const partial = { ...roster, officeholders: roster.officeholders.map(person => person.id === vice.id ? { ...person, executive: { ...person.executive, coverage: { tieBreakingVotes: false } } } : person) };
  assert.equal((await (await readNationalExecutiveVotes(vice.id, true, { roster: async () => partial })).json()).historyStatus, "UNAVAILABLE");
});
