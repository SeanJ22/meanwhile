import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ballotForDivisions } from '../lib/ballot/contests.ts';
import type { BallotSet } from '../lib/ballot/types.ts';

async function stateBallot(state: string): Promise<BallotSet> {
  return Object.values(JSON.parse(await readFile(new URL(`../data/ballot/2026-general/${state}.json`, import.meta.url), 'utf8')).ballots)[0] as BallotSet;
}

test('Prince Georges has all ten county questions and all nine circuit candidates without exposing them in Montgomery', async () => {
  const state = await stateBallot('md');
  const county = ballotForDivisions(state, ['ocd-division/country:us/state:md', 'ocd-division/country:us/state:md/county:prince_george_s']);
  const questions = county.measures.filter(row => row.contestId.startsWith('md-prince-georges-2026-question-'));
  assert.equal(questions.length, 10);
  for (const question of questions) assert.ok(question.officialStatement, 'the election authority provides a statement for each question');
  assert.ok(questions.some(row => row.questionText.includes('$140,089,000')));
  assert.ok(questions.some(row => row.questionText.includes('$53,503,000')));
  const court = county.contests.find(row => row.id === 'md-prince-georges-2026-circuit-7')!;
  assert.equal(court.voteFor, 9);
  assert.equal(county.candidacies.filter(row => row.contestId === court.id).length, 9);
  const other = ballotForDivisions(state, ['ocd-division/country:us/state:md', 'ocd-division/country:us/state:md/county:montgomery']);
  assert.equal(other.contests.some(row => row.id.startsWith('md-prince-georges-2026-')), false);
});

test('Fulton includes the full school tax and debt question while municipal questions and the Atlanta exclusion retain their scopes', async () => {
  const state = await stateBallot('ga');
  const base = ['ocd-division/country:us/state:ga', 'ocd-division/country:us/state:ga/county:fulton'];
  const county = ballotForDivisions(state, base);
  const local = county.contests.filter(row => row.id.startsWith('ga-fulton-2026-'));
  assert.equal(local.length, 3, 'county chair, soil/water supervisor and county-wide education tax');
  const education = county.measures.find(row => row.questionText.includes('$2,095,680,577.00'))!;
  assert.match(education.questionText, /\$350,000,000\.00/);
  assert.match(education.questionText, /APS Projects located in Fulton County\.$/);
  assert.equal(county.measures.some(row => row.questionText.includes('additional 0.75 percent')), false, 'the transportation tax excludes Atlanta and cannot appear county-wide');
  const sandy = ballotForDivisions(state, [...base, 'ocd-division/country:us/state:ga/place:sandy_springs']);
  assert.equal(sandy.measures.length - county.measures.length, 1);
  assert.ok(sandy.measures.some(row => row.questionText.includes('Redevelopment Powers')));
  const palmetto = ballotForDivisions(state, [...base, 'ocd-division/country:us/state:ga/place:palmetto']);
  assert.equal(palmetto.measures.length - county.measures.length, 1);
  assert.ok(palmetto.measures.some(row => row.questionText.includes('100% of city ad valorem tax exemption')));
});

test('Cutler Bay and North Miami Beach residential or numbered seats use their documented at-large electorates', async () => {
  const state = await stateBallot('fl');
  const base = ['ocd-division/country:us/state:fl', 'ocd-division/country:us/state:fl/county:miami_dade'];
  for (const [place, prefix, races, candidates] of [
    ['cutler_bay', 'Cutler Bay - ', 3, 9],
    ['north_miami_beach', 'North Miami Beach - ', 3, 9],
    ['south_miami', 'South Miami - ', 3, 3],
  ] as const) {
    const county = ballotForDivisions(state, base);
    assert.equal(county.contests.some(row => row.title.startsWith(prefix)), false);
    const city = ballotForDivisions(state, [...base, `ocd-division/country:us/state:fl/place:${place}`]);
    const ids = new Set(city.contests.filter(row => row.title.startsWith(prefix)).map(row => row.id));
    assert.equal(ids.size, races);
    assert.equal(city.candidacies.filter(row => ids.has(row.contestId)).length, candidates);
  }
});
