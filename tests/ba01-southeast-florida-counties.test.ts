import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ballotForDivisions } from '../lib/ballot/contests.ts';
import type { BallotSet } from '../lib/ballot/types.ts';

async function stateBallot(): Promise<BallotSet> {
  return Object.values(JSON.parse(await readFile(new URL('../data/ballot/2026-general/fl.json', import.meta.url), 'utf8')).ballots)[0] as BallotSet;
}

test('Miami Gardens runoff appears only for the exact residential area electorate', async () => {
  const state = await stateBallot();
  const base = ['ocd-division/country:us/state:fl', 'ocd-division/country:us/state:fl/county:miami_dade', 'ocd-division/country:us/state:fl/place:miami_gardens'];
  const id = 'fl-miami-gardens-2026-residential-seat-4';
  assert.equal(ballotForDivisions(state, base).contests.some(row => row.id === id), false);
  const area = ballotForDivisions(state, [...base, `${base[2]}/council_district:4`]);
  const race = area.contests.find(row => row.id === id)!;
  assert.ok(race);
  assert.equal(race.voteFor, 1);
  assert.equal(race.termYears, 4);
  assert.deepEqual(area.candidacies.filter(row => row.contestId === id).map(row => row.familyName).sort(), ['Mykita Cherry-Prime', 'Rod Mack']);
});

test('Orange countywide facts and Circuit 9 appear for the legally defined counties', async () => {
  const state = await stateBallot();
  const base = 'ocd-division/country:us/state:fl';
  const orange = ballotForDivisions(state, [base, `${base}/county:orange`]);
  const races = orange.contests.filter(row => row.id.startsWith('fl-orange-2026-'));
  assert.equal(races.length, 4);
  assert.equal(orange.candidacies.filter(row => races.some(race => race.id === row.contestId)).length, 6);
  assert.ok(orange.measures.find(row => row.contestId === 'fl-orange-2026-school-board-millage')?.questionText.endsWith('citizens of Orange County?'));
  const courtId = 'fl-orange-2026-circuit-9-group-1';
  const osceola = ballotForDivisions(state, [base, `${base}/county:osceola`]);
  assert.equal(osceola.contests.filter(row => row.id.startsWith('fl-orange-2026-')).length, 1);
  assert.ok(osceola.contests.some(row => row.id === courtId));
  assert.equal(ballotForDivisions(state, [base, `${base}/county:seminole`]).contests.some(row => row.id === courtId), false);
});

test('Florida unopposed certified records stay present with sourced printed-ballot context', async () => {
  const state = await stateBallot();
  const report = JSON.parse(await readFile(new URL('../data/ballot/ba01-southeast-florida-unopposed.json', import.meta.url), 'utf8'));
  assert.equal(report.records.length, 31);
  for (const row of report.records) {
    const contest = state.contests.find(contest => contest.id === row.contestId)!;
    assert.ok(contest.scopeNote?.includes('Certified unopposed.'));
    assert.ok(contest.provenance.quote?.includes('101.151(7)'));
    assert.ok(state.candidacies.some(candidate => candidate.id === row.candidateId));
  }
  const projection = ballotForDivisions(state, ['ocd-division/country:us/state:fl', 'ocd-division/country:us/state:fl/cd:10']);
  assert.ok(projection.candidacies.some(row => row.id === 'fl-doe-2026-general-candidate-89909'));
});

test('Hillsborough numbered countywide seats and exact district seats keep their documented electorates', async () => {
  const state = await stateBallot();
  const base = 'ocd-division/country:us/state:fl';
  const county = `${base}/county:hillsborough`;
  const projection = ballotForDivisions(state, [base, county]);
  for (const slug of ['commission-5', 'commission-7', 'school-6']) {
    const id = 'fl-hillsborough-2026-' + slug;
    assert.ok(projection.contests.some(row => row.id === id));
    assert.equal(projection.candidacies.filter(row => row.contestId === id).length, 2);
  }
  for (const [slug, division] of [['commission-1', 'council_district:1'], ['commission-3', 'council_district:3'], ['school-2', 'school_board_district:2']]) {
    const id = 'fl-hillsborough-2026-' + slug;
    assert.equal(projection.contests.some(row => row.id === id), false);
    const exact = ballotForDivisions(state, [base, county, `${county}/${division}`]);
    assert.equal(exact.candidacies.filter(row => row.contestId === id).length, 2);
  }
  const questions = projection.measures.filter(row => row.contestId.startsWith('fl-hillsborough-2026-referendum-'));
  assert.equal(questions.length, 3);
  assert.ok(questions.find(row => row.officialNumber === '1')?.questionText.includes('Chapter 2026-196'));
  assert.ok(questions.find(row => row.officialNumber === '2')?.questionText.includes('2,500,000'));
  assert.ok(questions.find(row => row.officialNumber === '3')?.questionText.includes('January 1, 2029'));
  const city = ballotForDivisions(state, [base, county, `${base}/place:temple_terrace`]);
  const council = city.contests.find(row => row.id === 'fl-hillsborough-2026-temple-council')!;
  assert.equal(council.voteFor, 3);
  assert.equal(city.candidacies.filter(row => row.contestId === council.id).length, 5);
  assert.equal(projection.contests.some(row => row.id === council.id), false);
});
