import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ballotForDivisions } from '../lib/ballot/contests.ts';
import type { BallotSet } from '../lib/ballot/types.ts';

test('all three Fulton soil/water candidates remain county-scoped with their official fields', async () => {
  const source = JSON.parse(await readFile(new URL('../data/ballot/2026-general/ga.json', import.meta.url), 'utf8'));
  const state = Object.values(source.ballots)[0] as BallotSet;
  const county = ballotForDivisions(state, ['ocd-division/country:us/state:ga', 'ocd-division/country:us/state:ga/county:fulton']);
  const candidates = county.candidacies.filter(row => row.contestId === 'ga-fulton-2026-soil-water-supervisor');
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map(row => [row.familyName, row.partyLabel, row.incumbent]), [
    ['Zane Placie', 'Nonpartisan', false],
    ['Walter S. Rekuc Jr.', 'Nonpartisan', true],
    ['Jason Ulseth', 'Nonpartisan', true],
  ]);
  assert.ok(candidates.every(row => row.websiteUrl === null));
  const outside = ballotForDivisions(state, ['ocd-division/country:us/state:ga', 'ocd-division/country:us/state:ga/county:dekalb']);
  assert.equal(outside.contests.some(row => row.id === 'ga-fulton-2026-soil-water-supervisor'), false);
});
