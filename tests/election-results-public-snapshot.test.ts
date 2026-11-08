import assert from "node:assert/strict";
import test from "node:test";
import { publicBallotSnapshot, verifyZipResultsOnCopy } from "../scripts/election-results-check.mts";
import { parseMultiStateResults } from "../lib/election-results/multistate.ts";
import { WORK_DDL } from "../lib/core/work.ts";
import { factDb } from "./helpers/fact-db.ts";

const response = (value: unknown) => `<script>self.__next_f.push([1,${JSON.stringify(`a:${JSON.stringify(value)}\n`)}])</script>`;

test("the live check reads served contest and candidate identities from the page response", () => {
  const set = publicBallotSnapshot(response({ pickable: [{ contestId: "served-governor", contestTitle: "Governor / Lt. Governor",
    contestOcdId: "ocd-division/country:us/state:xx", voteFor: 1, options: [{ id: "Lead Person / Mate Person", label: "Lead Person / Mate Person",
      reactionTargetId: "served-choice", reactionTargetAliases: ["earlier-choice", "served-governor|Lead Person"] }] }] }), "00001", "XX");
  assert.equal(set.contests[0].id, "served-governor");
  assert.equal(set.candidacies[0].id, "served-choice");
  assert.equal(set.candidacies[0].familyName, "Lead Person");
  assert.deepEqual(set.candidacies[0].aliases, ["earlier-choice", "served-governor|Lead Person", "served-governor|Lead Person / Mate Person"]);
});

test("the live check keeps every served measure, including cards whose official text is not rendered", () => {
  const set = publicBallotSnapshot(response({ pickable: [{ contestId: "served-measure", contestTitle: "Amendment 1: Voting rules",
    contestOcdId: "ocd-division/country:us/state:xx", voteFor: 1, options: [{ id: "YES", label: "Yes" }, { id: "NO", label: "No" }] }] }), "00001", "XX");
  assert.equal(set.contests[0].type, "MEASURE");
  assert.equal(set.measures[0].contestId, "served-measure");
  assert.equal(set.measures[0].officialNumber, "Amendment 1");
  assert.deepEqual(set.candidacies, []);
});

test("a public response missing candidate identifiers is an explicit read failure", () => {
  assert.throws(() => publicBallotSnapshot(response({ pickable: [{ contestId: "served", contestTitle: "Governor",
    contestOcdId: "ocd-division/country:us/state:xx", options: [{ id: "Lead", label: "Lead Person" }] }] }), "00001", "XX"), /Candidate identity missing/);
});

test("the national check requires an observed election date instead of assuming November 3", () => {
  const choice = { pickable: [{ contestId: "served", contestTitle: "Governor", contestOcdId: "ocd-division/country:us/state:az",
    options: [{ id: "Lead", label: "Lead Person", reactionTargetId: "lead" }] }] };
  assert.throws(() => publicBallotSnapshot(response(choice), "85001", "AZ", { requireElectionDate: true }), /observed election date/);
  const ballot = publicBallotSnapshot(response({ ...choice, electionDate: "2026-11-17" }), "85001", "AZ", { requireElectionDate: true });
  assert.equal(ballot.election.date, "2026-11-17");
});

test("visible contests without voting controls retain names and IDs across streamed component references", () => {
  const frame = (id: string, value: unknown) => `<script>self.__next_f.push([1,${JSON.stringify(`${id}:${JSON.stringify(value)}\n`)}])</script>`;
  const page = frame("a", { electionDate: "2026-11-03", attrs: { "data-contest-id": "served-governor", "data-ocd-id": "ocd-division/country:us/state:ga" },
    title: "Governor", children: "$b" }) + frame("b", [
      { "data-candidate-target": "served-choice", "data-candidate-aliases": '["old-choice"]', children: "$Lc" },
      { "data-filing-candidacy": "withdrawn-choice", children: { cardId: "CANDIDATE:Earlier Person" } },
    ]) + frame("c", { cardId: "CANDIDATE:Lead Person", cardKind: "CANDIDATE", children: "Visible name" });
  const set = publicBallotSnapshot(page, "30303", "GA", { requireElectionDate: true });
  assert.equal(set.contests[0].id, "served-governor");
  assert.equal(set.contests[0].voteFor, null);
  assert.deepEqual(set.candidacies.map(row => [row.id, row.familyName, row.aliases]), [["served-choice", "Lead Person", ["old-choice"]]]);
});

test("length-prefixed Flight text cannot hide the following contest frame or introduce fake choice records", () => {
  const text = 'A public source URL with a newline and unicode 🌵\nfake:{"pickable":[{"contestId":"not-a-contest"}]}';
  const card = { electionDate: "2026-11-03", attrs: { "data-contest-id": "served-house", "data-ocd-id": "ocd-division/country:us/state:ar/sldl:35" },
    title: "State Representative District 35", children: { "data-candidate-target": "served-person", children: { cardId: "CANDIDATE:Audrey Person" } } };
  const stream = `a:T${Buffer.byteLength(text).toString(16)},${text}b:${JSON.stringify(card)}\n`;
  const page = `<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`;
  const set = publicBallotSnapshot(page, "72301", "AR", { requireElectionDate: true });
  assert.deepEqual(set.contests.map(row => row.id), ["served-house"]);
  assert.deepEqual(set.candidacies.map(row => [row.id, row.familyName]), [["served-person", "Audrey Person"]]);
});

test("a ZIP copy never declares races elsewhere in its state missing from the full ballot", async () => {
  const db = await factDb();
  try {
    for (const statement of WORK_DDL) await db.pg.exec(statement);
    const at = "2026-11-07T00:00:00.000Z";
    const set = publicBallotSnapshot(response({ pickable: [{ contestId: "served-governor", contestTitle: "Governor",
      contestOcdId: "ocd-division/country:us/state:az", voteFor: 1,
      options: [{ id: "Lead Person", label: "Lead Person", reactionTargetId: "served-lead" }] }] }), "85001", "AZ");
    const batch = parseMultiStateResults(JSON.stringify({ general_events: [{ state: "AZ", statewide_races:
      [[1, "Governor", "Lead Person"], [2, "Attorney General", "Other Person"]].map(([seat_id, office, name]) => ({
        seat_id, office, election_date: "2026-11-03", general_results: { contests: [{ type: "General", result_status: "Counting",
          candidates: [{ candidate_id: seat_id, name, votes: 10, pct: 100 }] }] },
      })) }] }), at);
    assert.equal(batch.races.length, 2);
    const checked = await verifyZipResultsOnCopy(db, set, [batch], at);
    assert.equal(checked.unmatchedSourceRaces, 0);
    assert.equal(checked.fixRows, 0, "a statewide source outside this ZIP sample is not a ballot defect");
    assert.equal(checked.publishedFacts, 2);
    assert.equal((await db.query("SELECT count(*)::int n FROM work WHERE kind='fix'"))[0].n, 0);
  } finally { await db.pg.close(); }
});
