import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ballotForDivisions } from '../lib/ballot/contests.ts';
import type { BallotSet } from '../lib/ballot/types.ts';

async function stateBallot(): Promise<BallotSet> {
  return Object.values(JSON.parse(await readFile(new URL('../data/ballot/2026-general/md.json', import.meta.url), 'utf8')).ballots)[0] as BallotSet;
}

test('all Maryland county questions retain county applicability, including independent Baltimore City', async () => {
  const state = await stateBallot();
  for (const [division, source, questions] of [
    ['baltimore_24005', 'baltimorecounty', 14],
    ['baltimore_24510', 'baltimorecity', 9],
    ['anne_arundel', 'annearundel', 3],
    ['howard', 'howard', 2],
    ['frederick', 'frederick', 1],
    ['wicomico', 'wicomico', 4],
    ['cecil', 'cecil', 1],
    ['dorchester', 'dorchester', 4],
  ] as const) {
    const county = ballotForDivisions(state, ['ocd-division/country:us/state:md', `ocd-division/country:us/state:md/county:${division}`]);
    const rows = county.measures.filter(row => row.contestId.startsWith('md-county-questions-2026-'));
    assert.equal(rows.length, questions);
    assert.ok(rows.every(row => row.contestId.startsWith(`md-county-questions-2026-${source}-`)));
    assert.ok(rows.every(row => row.questionText.length > 200));
  }
  const statewide = ballotForDivisions(state, ['ocd-division/country:us/state:md']);
  assert.equal(statewide.measures.some(row => row.contestId.startsWith('md-county-questions-2026-')), false);
});

test('certified Maryland ballots supply the complete project list and correct title where the web index differs', async () => {
  const state = await stateBallot();
  const refuse = state.measures.find(row => row.contestId === 'md-county-questions-2026-baltimorecounty-f')!;
  assert.match(refuse.questionText, /closing and capping, repair, and modernization/);
  assert.match(refuse.questionText, /A vote AGAINST the bond issue precludes/);
  const parks = state.measures.find(row => row.contestId === 'md-county-questions-2026-baltimorecounty-i')!;
  assert.equal(parks.questionText.includes('#6'), false);
  const franchise = state.contests.find(row => row.id === 'md-county-questions-2026-baltimorecity-g')!;
  assert.match(franchise.title, /Franchises and Minor Privileges$/);
  const workRules = state.measures.find(row => row.contestId === 'md-county-questions-2026-wicomico-d')!;
  assert.match(workRules.questionText, /^#110-2026 /);
  assert.match(workRules.questionText, /definition of “Work Rules” will not be inserted/);
});
