import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ballotForDivisions } from '../lib/ballot/contests.ts';
import type { BallotSet } from '../lib/ballot/types.ts';

async function stateBallot(): Promise<BallotSet> {
  return Object.values(JSON.parse(await readFile(new URL('../data/ballot/2026-general/fl.json', import.meta.url), 'utf8')).ballots)[0] as BallotSet;
}

test('Coral Gables commission groups are city-wide while Miami-Dade commission and school-board districts require exact divisions', async () => {
  const state = await stateBallot();
  const base = ['ocd-division/country:us/state:fl', 'ocd-division/country:us/state:fl/county:miami_dade'];
  const county = ballotForDivisions(state, base);
  for (const title of ['County Commissioner, District 5', 'School Board Member, District 1', 'Coral Gables - for Commissioner - Group IV', 'Coral Gables - for Commissioner - Group V']) {
    assert.equal(county.contests.some(row => row.title === title), false);
  }
  const coral = ballotForDivisions(state, [...base, 'ocd-division/country:us/state:fl/place:coral_gables']);
  const groups = coral.contests.filter(row => row.title.startsWith('Coral Gables - for Commissioner - Group '));
  assert.equal(groups.length, 2);
  const ids = new Set(groups.map(row => row.id));
  assert.equal(coral.candidacies.filter(row => ids.has(row.contestId)).length, 4);
  for (const [division, title] of [
    ['council_district:5', 'County Commissioner, District 5'],
    ['school_board_district:1', 'School Board Member, District 1'],
  ] as const) {
    const district = ballotForDivisions(state, [...base, `ocd-division/country:us/state:fl/county:miami-dade/${division}`]);
    const contest = district.contests.find(row => row.title === title)!;
    assert.ok(contest);
    assert.equal(contest.voteFor, 1);
    assert.equal(district.candidacies.filter(row => row.contestId === contest.id).length, 2);
  }
});
