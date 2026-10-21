import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ballotForDivisions } from '../lib/ballot/contests.ts';
import type { BallotSet } from '../lib/ballot/types.ts';

async function stateBallot(): Promise<BallotSet> {
  return Object.values(JSON.parse(await readFile(new URL('../data/ballot/2026-general/md.json', import.meta.url), 'utf8')).ballots)[0] as BallotSet;
}

test('Baltimore City and Baltimore County each receive their separate complete circuit-court slate', async () => {
  const state = await stateBallot();
  for (const [county, seats, present, absent] of [
    ['baltimore_24005', 5, 'Alexander', 'Chen'],
    ['baltimore_24510', 6, 'Chen', 'Alexander'],
  ] as const) {
    const ballot = ballotForDivisions(state, ['ocd-division/country:us/state:md', `ocd-division/country:us/state:md/county:${county}`]);
    const court = ballot.contests.find(row => row.title.startsWith('Judge of the Circuit Court — '))!;
    assert.equal(court.voteFor, seats);
    const candidates = ballot.candidacies.filter(row => row.contestId === court.id);
    assert.equal(candidates.length, seats);
    assert.ok(candidates.some(row => row.familyName === present));
    assert.equal(candidates.some(row => row.familyName === absent), false);
  }
});

test('shared Maryland circuit numbers do not leak a neighboring county candidate', async () => {
  const state = await stateBallot();
  for (const [county, name, absent] of [
    ['frederick', 'Minner', 'Burrell'],
    ['montgomery', 'Burrell', 'Minner'],
    ['st_mary_s', 'Hill', 'Allen'],
    ['prince_george_s', 'Allen', 'Hill'],
  ]) {
    const ballot = ballotForDivisions(state, ['ocd-division/country:us/state:md', `ocd-division/country:us/state:md/county:${county}`]);
    const courtIds = new Set(ballot.contests.filter(row => row.title.startsWith('Judge of the Circuit Court — ')).map(row => row.id));
    const candidates = ballot.candidacies.filter(row => courtIds.has(row.contestId));
    assert.ok(candidates.some(row => row.familyName === name));
    assert.equal(candidates.some(row => row.familyName === absent), false);
  }
});
