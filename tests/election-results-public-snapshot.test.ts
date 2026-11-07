import assert from "node:assert/strict";
import test from "node:test";
import { publicBallotSnapshot } from "../scripts/election-results-check.mts";

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
