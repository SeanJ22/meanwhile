import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ballotForDivisions } from '../lib/ballot/contests.ts';
import type { BallotSet } from '../lib/ballot/types.ts';

async function stateBallot(): Promise<BallotSet> {
  return Object.values(JSON.parse(await readFile(new URL('../data/ballot/2026-general/ga.json', import.meta.url), 'utf8')).ballots)[0] as BallotSet;
}

test('Georgia DA circuits follow exact whole-county electorates including the new West Georgia boundary', async () => {
  const state = await stateBallot();
  for (const [county, circuit] of [['bryan', 'Atlantic'], ['liberty', 'Atlantic'], ['hall', 'Northeastern'], ['dawson', 'Northeastern'], ['carroll', 'West Georgia'], ['heard', 'West Georgia']]) {
    const selected = ballotForDivisions(state, ['ocd-division/country:us/state:ga', `ocd-division/country:us/state:ga/county:${county}`]);
    const da = selected.contests.filter(row => row.id.startsWith('ga-district-attorney-2026-'));
    assert.equal(da.length, 1);
    assert.equal(da[0].title, `District Attorney, ${circuit} Judicial Circuit`);
  }
  const coweta = ballotForDivisions(state, ['ocd-division/country:us/state:ga', 'ocd-division/country:us/state:ga/county:coweta']);
  assert.equal(coweta.contests.some(row => row.title.includes('West Georgia Judicial Circuit')), false);
  const stateOnly = ballotForDivisions(state, ['ocd-division/country:us/state:ga']);
  assert.equal(stateOnly.contests.some(row => row.id.startsWith('ga-district-attorney-2026-')), false);
});

test('both certified Atlantic candidates retain the same fields and their stated Republican affiliation', async () => {
  const state = await stateBallot();
  const selected = ballotForDivisions(state, ['ocd-division/country:us/state:ga', 'ocd-division/country:us/state:ga/county:bryan']);
  const candidates = selected.candidacies.filter(row => row.contestId === 'ga-district-attorney-2026-atlantic');
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every(row => row.partyLabel === 'Republican'));
  assert.deepEqual(Object.keys(candidates[0]).sort(), Object.keys(candidates[1]).sort());
  const incumbent = candidates.find(row => row.familyName === 'Richard Eugene Braun, Jr.')!;
  assert.equal(incumbent.incumbent, true);
  assert.match(incumbent.provenance.sourceUrl!, /pacga\.org/);
});
