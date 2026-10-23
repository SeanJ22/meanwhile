import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ballotForDivisions } from '../lib/ballot/contests.ts';
import type { BallotSet } from '../lib/ballot/types.ts';

test('Florida county readers receive exactly the retentions for their statutory appellate district', async () => {
  const source = JSON.parse(await readFile(new URL('../data/ballot/2026-general/fl.json', import.meta.url), 'utf8'));
  const state = Object.values(source.ballots)[0] as BallotSet;
  for (const [county, district, count] of [
    ['miami_dade', 3, 5],
    ['monroe', 3, 5],
    ['hillsborough', 2, 4],
    ['broward', 4, 5],
    ['duval', 5, 3],
    ['gadsden', 1, 5],
    ['orange', 6, 0],
  ] as const) {
    const ballot = ballotForDivisions(state, ['ocd-division/country:us/state:fl', `ocd-division/country:us/state:fl/county:${county}`]);
    const appellate = ballot.contests.filter(row => row.ocdId.includes('/district_court:'));
    assert.equal(appellate.length, count, county);
    assert.ok(appellate.every(row => row.ocdId === `ocd-division/country:us/state:fl/district_court:${district}`), county);
  }
  const unknownCounty = ballotForDivisions(state, ['ocd-division/country:us/state:fl']);
  assert.equal(unknownCounty.contests.some(row => row.ocdId.includes('/district_court:')), false);
});
