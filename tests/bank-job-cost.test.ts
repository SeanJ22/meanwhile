import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyFieldManual, newFieldManualEntry, projectFieldManual, upsertEntries } from '../lib/control-plane/field-manual.ts';
const observation = (attemptId: string, success: boolean, usd: number | null) => newFieldManualEntry('job-cost', attemptId, {
  role: 'SHARED', kind: 'JOB_COST', title: 'cost', summary: 'observation', outcome: 'REFERENCE',
  payload: { platform: 'legistar', recordClass: 'meetings', attemptId, success, usd, durationMs: 1000, requestCount: 2 },
});

test('cost per success includes failed attempts and is not doubled by a replay', () => {
  const rows = [observation('one', false, 0.1), observation('two', true, 0.2)];
  let store = upsertEntries(emptyFieldManual(), rows, 'one');
  store = upsertEntries(store, rows, 'two');
  const profile = store.entries.find(entry => entry.kind === 'COST_PROFILE')!;
  assert.equal((profile.payload as { attempts: number }).attempts, 2);
  assert.match(profile.summary, /typically 4 requests, \$0\.30 per success; 2000 ms/);
  assert.deepEqual(projectFieldManual(store).entryIds, [profile.id]);
});

test('unpriced work remains unknown rather than a zero-dollar success', () => {
  const store = upsertEntries(emptyFieldManual(), [observation('one', true, null)], 'now');
  const profile = store.entries.find(entry => entry.kind === 'COST_PROFILE')!;
  assert.equal((profile.payload as { usdPerSuccess: number | null }).usdPerSuccess, null);
  assert.match(profile.summary, /cost not fully recorded/);
});
