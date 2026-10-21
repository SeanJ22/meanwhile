import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ballotForDivisions } from '../lib/ballot/contests.ts';
import type { BallotSet } from '../lib/ballot/types.ts';

async function stateBallot(state: string): Promise<BallotSet> {
  const source = JSON.parse(await readFile(new URL(`../data/ballot/2026-general/${state}.json`, import.meta.url), 'utf8'));
  return Object.values(source.ballots)[0] as BallotSet;
}

test('Miami-Dade county questions and circuit races appear county-wide while municipal questions stay in their city', async () => {
  const state = await stateBallot('fl');
  const divisions = ['ocd-division/country:us/state:fl', 'ocd-division/country:us/state:fl/county:miami_dade'];
  const county = ballotForDivisions(state, divisions);
  const local = county.contests.filter(row => row.id.startsWith('fl-miami-dade-2026-'));
  assert.equal(local.length, 9, 'six county questions, the school levy and two circuit races');
  assert.equal(local.filter(row => row.type === 'CANDIDACY').length, 2);
  assert.equal(county.measures.filter(row => row.contestId.startsWith('fl-miami-dade-2026-')).length, 7);
  const levy = county.measures.find(row => row.questionText.includes('one (1) mill ad valorem tax levy'))!;
  assert.match(levy.questionText, /July 1, 2027/);
  assert.match(levy.questionText, /June 30, 2031/);
  assert.equal(county.measures.some(row => row.questionText.includes('$450 million')), false);
  const miami = ballotForDivisions(state, [...divisions, 'ocd-division/country:us/state:fl/place:miami']);
  assert.equal(miami.measures.length - county.measures.length, 3);
  const bond = miami.measures.find(row => row.questionText.includes('$450 million'))!;
  assert.match(bond.questionText, /0\.5935/);
  assert.match(bond.questionText, /independent annual audit/);
  const nmb = ballotForDivisions(state, [...divisions, 'ocd-division/country:us/state:fl/place:north_miami_beach']);
  assert.equal(nmb.measures.length - county.measures.length, 8);
});

test('Sunny Isles residential seats and Pinecrest seat 3 use their officially established at-large electorates', async () => {
  const state = await stateBallot('fl');
  const base = ['ocd-division/country:us/state:fl', 'ocd-division/country:us/state:fl/county:miami_dade'];
  const county = ballotForDivisions(state, base);
  assert.equal(county.contests.some(row => row.title.startsWith('Sunny Isles Beach - ')), false);
  const sunny = ballotForDivisions(state, [...base, 'ocd-division/country:us/state:fl/place:sunny_isles_beach']);
  const sunnyContests = sunny.contests.filter(row => row.title.startsWith('Sunny Isles Beach - '));
  assert.equal(sunnyContests.length, 3);
  const ids = new Set(sunnyContests.map(row => row.id));
  assert.equal(sunny.candidacies.filter(row => ids.has(row.contestId)).length, 9);
  const pinecrest = ballotForDivisions(state, [...base, 'ocd-division/country:us/state:fl/place:pinecrest']);
  assert.equal(pinecrest.contests.filter(row => row.title.startsWith('Pinecrest - ')).length, 2);
});

test('Montgomery council 7 and Mecklenburg commissioner 4 require their exact districts', async () => {
  for (const [stateName, countyName, district, title] of [
    ['md', 'montgomery', '7', 'County Council — Montgomery County, Councilmanic District 7'],
    ['nc', 'mecklenburg', '4', 'MECKLENBURG COUNTY BOARD OF COMMISSIONERS DISTRICT 04'],
  ]) {
    const state = await stateBallot(stateName);
    const county = `ocd-division/country:us/state:${stateName}/county:${countyName}`;
    const base = [`ocd-division/country:us/state:${stateName}`, county];
    assert.equal(ballotForDivisions(state, base).contests.some(row => row.title === title), false);
    const selected = ballotForDivisions(state, [...base, `${county}/council_district:${district}`]);
    assert.ok(selected.contests.some(row => row.title === title));
    const different = ballotForDivisions(state, [...base, `${county}/council_district:1`]);
    assert.equal(different.contests.some(row => row.title === title), false);
  }
});
