import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

const stateId = "ocd-division/country:us/state:ar";
const packageValue = JSON.parse(await readFile(new URL("../data/ballot/2026-general/ar.json", import.meta.url), "utf8"));
const ballot = Object.values(packageValue.ballots)[0] as BallotSet;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("the saved state roster independently marks every candidate as current on the general ballot", async () => {
  const evidence = JSON.parse(await readFile(new URL("../data/ballot/evidence/ba01-south/ar-core/sos-general-details.json", import.meta.url), "utf8"));
  assert.equal(evidence.sources.length, 198);
  const names = new Map<string, string>();
  for (const source of evidence.sources) {
    assert.equal(sha(source.body), source.sha256);
    const row = JSON.parse(source.body);
    assert.equal(row.ElecCyDesc, "General and Nonpartisan Judicial Runoff");
    assert.equal(row.OnGeneralBallot, "True");
    assert.equal(row.Withdrawn, "False");
    assert.ok(!names.has(row.FilerID));
    names.set(row.FilerID, row.CanBallotName);
  }
  assert.equal(names.get("4800"), "Kara Armas");
  assert.equal(names.get("4802"), "Parker John Stohlton");
});

test("county membership includes exactly the official circuit runoff and its full candidate pair", () => {
  const members = [
    [2, ["clay", "craighead", "crittenden", "greene", "mississippi", "poinsett"]],
    [4, ["madison", "washington"]],
    [16, ["cleburne", "fulton", "independence", "izard", "stone"]],
  ] as const;
  for (const [circuit, counties] of members) {
    for (const county of counties) {
      const selected = ballotForDivisions(ballot, [`${stateId}/county:${county}`]);
      const races = selected.contests.filter(row => row.ocdId.includes("/circuit_court:"));
      assert.equal(races.length, 1, county);
      assert.equal(races[0].ocdId, `${stateId}/circuit_court:${circuit}`, county);
      assert.equal(selected.candidacies.filter(row => row.contestId === races[0].id).length, 2, county);
    }
  }
  for (const divisions of [[stateId], [`${stateId}/county:benton`], ["ocd-division/country:us/state:ms/county:washington"]]) {
    assert.equal(ballotForDivisions(ballot, divisions).contests.some(row => row.ocdId.includes("/circuit_court:")), false);
  }
});

test("House District 8 retains separate regular and special contests on the same ballot", () => {
  const selected = ballotForDivisions(ballot, [`${stateId}/sldl:8`]);
  const races = selected.contests.filter(row => row.ocdId === `${stateId}/sldl:8`);
  assert.equal(races.length, 2);
  const special = races.find(row => /Special Election/.test(row.title))!;
  const regular = races.find(row => row.id !== special.id)!;
  assert.deepEqual(selected.candidacies.filter(row => row.contestId === special.id).map(row => row.familyName).sort(), ["Kara Armas", "Parker John Stohlton"]);
  assert.equal(selected.candidacies.filter(row => row.contestId === regular.id).length, 1);
  assert.ok(selected.candidacies.some(row => row.contestId === regular.id && /Brian Armas/.test(row.familyName)));
});
