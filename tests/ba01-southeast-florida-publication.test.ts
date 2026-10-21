import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runBallotPublication } from '../scripts/assemble-ballot-package.mts';
import { MemoryRoutineDataStore } from '../lib/civic-data/store.ts';
import { stateBallotScope } from '../lib/civic-data/state-scopes.ts';
import type { GenericBallotProjection } from '../lib/ballot/generic-projection.ts';

test('actual Florida source package assembles, promotes and preserves every imported measure', async () => {
  const environment = {
    WTP_RUNTIME_MODE: 'staging', WTP_DB_ROLE: 'local',
    DATABASE_URL: 'postgresql://local:local@staging.invalid/reader',
    WTP_CONTROL_PLANE_DATABASE_URL: 'postgresql://local:local@staging.invalid/control',
    WTP_SANCTIONED_WRITE: 'routine-civic-data-promotion',
  };
  const prior = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  try {
    const store = new MemoryRoutineDataStore();
    const result = await runBallotPublication({ state: 'FL', store, now: new Date().toISOString() });
    assert.equal(result.report.status, 'PUBLISHED', result.report.reason ?? JSON.stringify(result.receipt));
    const pointer = await store.readPromotion<GenericBallotProjection>('BALLOT_CANDIDACY', stateBallotScope('ballot-contests', 'FL'));
    assert.ok(pointer);
    const published = Object.values(pointer.payload.ballots)[0];
    const source = Object.values(JSON.parse(await readFile(new URL('../data/ballot/2026-general/fl.json', import.meta.url), 'utf8')).ballots)[0] as typeof published;
    assert.equal(published.contests.length, source.contests.length);
    assert.equal(published.candidacies.length, source.candidacies.length);
    assert.equal(published.measures.length, source.measures.length);
    for (const id of ['fl-orange-2026-school-board-millage', ...[1, 2, 3].map(number => `fl-hillsborough-2026-referendum-${number}`)]) {
      assert.equal(published.contests.find(row => row.id === id)?.type, 'MEASURE');
      assert.ok(published.measures.some(row => row.contestId === id));
    }
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
