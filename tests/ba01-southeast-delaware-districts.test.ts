import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ballotForDivisions } from '../lib/ballot/contests.ts';
import type { BallotSet } from '../lib/ballot/types.ts';

async function stateBallot(): Promise<BallotSet> {
  return Object.values(JSON.parse(await readFile(new URL('../data/ballot/2026-general/de.json', import.meta.url), 'utf8')).ballots)[0] as BallotSet;
}

test('all eleven Delaware county district races require their exact county and district', async () => {
  const state = await stateBallot();
  const expected = [
    ['new_castle', 1, 1], ['new_castle', 2, 2], ['new_castle', 3, 2],
    ['new_castle', 4, 1], ['new_castle', 5, 1], ['new_castle', 6, 2],
    ['kent', 2, 1], ['kent', 4, 1], ['kent', 6, 1],
    ['sussex', 4, 2], ['sussex', 5, 2],
  ] as const;
  for (const [county, district, candidates] of expected) {
    const base = ['ocd-division/country:us/state:de', `ocd-division/country:us/state:de/county:${county}`];
    assert.equal(ballotForDivisions(state, base).contests.some(row => row.id.startsWith('de-county-districts-2026-')), false);
    const projection = ballotForDivisions(state, [...base, `${base[1]}/council_district:${district}`]);
    const rows = projection.contests.filter(row => row.id.startsWith('de-county-districts-2026-'));
    assert.equal(rows.length, 1);
    assert.equal(projection.candidacies.filter(row => row.contestId === rows[0].id).length, candidates);
  }
  const races = state.contests.filter(row => row.id.startsWith('de-county-districts-2026-'));
  const ids = new Set(races.map(row => row.id));
  const candidates = state.candidacies.filter(row => ids.has(row.contestId));
  assert.equal(races.length, 11);
  assert.equal(candidates.length, 16);
  assert.ok(races.every(row => row.candidateListComplete));
  assert.ok(candidates.every(row => JSON.stringify(Object.keys(row).sort()) === JSON.stringify(Object.keys(candidates[0]).sort())));
  assert.equal(candidates.some(row => row.familyName === 'Christopher W. Muntz'), false, 'the certified list marks this filing withdrawn');
});

test('Delaware official sample 01-01 has all eleven source-identified contests', async () => {
  const state = await stateBallot();
  const base = 'ocd-division/country:us/state:de';
  const sample = ballotForDivisions(state, [base, `${base}/cd:at-large`, `${base}/sldu:1`, `${base}/sldl:1`, `${base}/county:new_castle`, `${base}/county:new_castle/council_district:4`]);
  assert.equal(sample.contests.length, 11);
  assert.equal(sample.contests.filter(row => row.id.startsWith('de-county-districts-2026-')).length, 1);
  assert.ok(sample.candidacies.some(row => row.familyName === 'Jason Hoover'));
});
