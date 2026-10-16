import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FEDERAL_PEOPLE_SPLIT_LOG_KEY, federalPeopleCountClean, federalPeopleCountLine, federalPeopleSplitLine, federalPeopleSplitRecord, federalPeopleSplitRecorded,
  splitFederalPeople } from "../lib/civic-data/federal-people-split.ts";
import type { BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import type { VotesSnapshot } from "../lib/votes/types.ts";

const AT = "2026-10-16T03:00:00.000Z", SHA = "a".repeat(40);
const run = (status: number | null, stdout = ""): BoundedChildResult =>
  ({ id: FEDERAL_PEOPLE_SPLIT_LOG_KEY, status, signal: status === null ? "SIGKILL" : null, stdout, stderr: "", termination: "EXITED", errorMessage: null }) as unknown as BoundedChildResult;
const holder = (id: string, state: string, chamber: "senate" | "house") => ({ id: `congress:${id}`, name: id, officeTitle: "Member", level: "FEDERAL", state, chamber, partyLabel: "Independent",
  termStart: "2025-01-03", termEnd: "2027-01-03", provenance: { sourceUrl: "https://example.test", sourceOrg: "test", collectedAt: AT, verifiedAt: null } });
const directory = (holders: ReturnType<typeof holder>[]): FederalDirectoryReadModel => ({ formatVersion: 1, currentMembershipComplete: true, sourceSha: SHA,
  roster: { scope: "us", generatedAt: AT, officeholders: holders as never, divisions: holders.map(row => ({ officeholderId: row.id, ocdId: `ocd-division/country:us/state:${row.state.toLowerCase()}`, bodyId: null })), unmatched: [] },
  directory: { source: { sha: SHA } as never, counts: {}, committees: { SSAF: { name: "Agriculture", type: "senate", url: null, jurisdiction: null, jurisdictionSource: null }, HSAG: { name: "Agriculture", type: "house", url: null, jurisdiction: null, jurisdictionSource: null } },
    byMember: Object.fromEntries(holders.map(row => [row.id.slice(9), { districtOffices: [], committees: [{ committeeId: row.chamber === "senate" ? "SSAF" : "HSAG" }] }])) as never } });
const votes = (positions: VotesSnapshot["positions"]): { snapshot: VotesSnapshot } => ({ snapshot: { generatedAt: AT, congress: 119, session: 2, window: { houseRolls: [5], senateRolls: [7] },
  identifierMatch: { houseMatched: 1, houseTotal: 1, senateMatched: 2, senateTotal: 2 },
  votes: [{ id: "senate:119-2:7", chamber: "senate", congress: 119, session: 2, rollNumber: 7, date: "2026-10-01", title: "Passage", titleSource: "CHAMBER_QUESTION", question: "On Passage", legisNum: null, result: "Passed 1–1", billUrl: null, rollCallUrl: "https://www.senate.gov/x", retrievedAt: AT },
    { id: "house:119-2:5", chamber: "house", congress: 119, session: 2, rollNumber: 5, date: "2026-10-01", title: "Passage", titleSource: "CHAMBER_QUESTION", question: "On Passage", legisNum: null, result: "Passed 1–0", billUrl: null, rollCallUrl: "https://clerk.house.gov/x", retrievedAt: AT }],
  positions } });

test("every member lands in exactly one place and every position under exactly one member", () => {
  const national = directory([holder("S000001", "WA", "senate"), holder("S000002", "WA", "senate"), holder("H000001", "WA", "house"), holder("D000001", "PR", "house")]);
  const split = splitFederalPeople(national, votes([
    { officeholderId: "congress:S000001", voteId: "senate:119-2:7", position: "YES" }, { officeholderId: "congress:S000002", voteId: "senate:119-2:7", position: "NO" },
    { officeholderId: "congress:H000001", voteId: "house:119-2:5", position: "YES" }]));
  assert.ok(federalPeopleCountClean(split.count));
  assert.deepEqual(split.count.members, { old: 4, new: 4, missing: [], duplicated: [], added: [] });
  assert.equal(split.places.length, 56, "every state, DC and the five territories hold a record, empty or not");
  const wa = split.places.find(place => place.state === "WA")!.projection;
  assert.deepEqual(wa.roster.officeholders.map(row => row.id), ["congress:S000001", "congress:S000002", "congress:H000001"]);
  assert.deepEqual(Object.keys(wa.directory.committees).sort(), ["HSAG", "SSAF"], "a place holds only the committees its members sit on");
  assert.deepEqual(split.places.find(place => place.state === "PR")!.projection.directory.committees, { HSAG: national.directory.committees.HSAG });
  assert.deepEqual(split.members.map(member => member.officeholderId), ["congress:S000001", "congress:S000002", "congress:H000001"], "a member no roll records gets no record");
  assert.deepEqual(split.partyBreakdowns["senate:119-2:7"], [{ party: "Independents", yes: 1, no: 1 }]);
  assert.equal("positions" in split.window, false, "the shared U.S. window carries no member's position");
});

test("a member the split cannot place is a count difference, and any difference blocks", () => {
  const split = splitFederalPeople(directory([holder("S000001", "WA", "senate"), holder("X000001", "ZZ", "senate")]), votes([]));
  assert.deepEqual(split.count.members.missing, ["congress:X000001"]);
  assert.equal(federalPeopleCountClean(split.count), false);
});

test("a finished split is recorded once with its count and every outcome, and a recorded one is never due again", async () => {
  const { ownerDigests } = createMemoryRepositories();
  assert.equal(await federalPeopleSplitRecorded(ownerDigests), false);
  const split = splitFederalPeople(directory([holder("S000001", "WA", "senate")]), votes([{ officeholderId: "congress:S000001", voteId: "senate:119-2:7", position: "YES" }]));
  const stdout = [federalPeopleCountLine(split.count), federalPeopleSplitLine({ scope: "US-WA:current-congress-directory", from: "cv-national", to: "cv-wa" }),
    federalPeopleSplitLine({ scope: "US-PR:current-congress-directory", from: "cv-national", to: null, refusal: "CANNOT_TELL" })].join("\n");
  const record = federalPeopleSplitRecord(run(0, stdout), AT, "b".repeat(40))!;
  assert.equal(record.lines.length, 3);
  assert.equal(record.cycleOk, false, "a refused record is listed, and the record still stands");
  assert.match(record.headline, /1 members in their place records and 1 roll-call positions under their members \(1 and 1 before\); 1 records published, 1 refused/);
  await ownerDigests.append(FEDERAL_PEOPLE_SPLIT_LOG_KEY, record.digestId, record, AT);
  assert.equal(await federalPeopleSplitRecorded(ownerDigests), true);
});

test("a child that did not finish, or never reached its count check, leaves nothing recorded", () => {
  assert.equal(federalPeopleSplitRecord(run(1), AT, null), null);
  assert.equal(federalPeopleSplitRecord(run(null), AT, null), null);
  assert.equal(federalPeopleSplitRecord(run(0, "nothing counted"), AT, null), null);
});

test("the runner launches the split under its own capability, and the script runs under no other", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8"), script = readFileSync("scripts/split-federal-people.mts", "utf8");
  assert.match(runner, /capability: "FEDERAL_PEOPLE_SPLIT"[^)]*\}\)/);
  assert.match(script, /assertRuntimeAuthority\(\{ capabilities: \["FEDERAL_PEOPLE_SPLIT"\] \}\)/);
  assert.match(script, /if \(!federalPeopleCountClean\(split\.count\)\) throw/);
});
