import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newFieldManualEntry, readFieldManual, writeFieldManual } from '../lib/control-plane/field-manual.ts';
import { createMemoryRepositories } from '../lib/control-plane/repository/memory.ts';
const observation = (attemptId: string, success: boolean, usd: number | null) => newFieldManualEntry('job-cost', attemptId, {
  role: 'SHARED', kind: 'JOB_COST', title: 'cost', summary: 'observation', outcome: 'REFERENCE', platforms: ['legistar'], recordClasses: ['meetings'],
  payload: { platform: 'legistar', recordClass: 'meetings', attemptId, success, usd, durationMs: 1000, requestCount: 2 },
});
const profileOf = async (repos: ReturnType<typeof createMemoryRepositories>) =>
  (await repos.fieldManual.list()).map(row => row.value).find(entry => entry.kind === 'COST_PROFILE')!;

test('cost per success includes failed attempts and is not doubled by a replay', async () => {
  const repos = createMemoryRepositories();
  const rows = [observation('one', false, 0.1), observation('two', true, 0.2)];
  await writeFieldManual(repos, rows, '2026-10-01T00:00:00.000Z');
  await writeFieldManual(repos, rows, '2026-10-01T00:01:00.000Z');
  const profile = await profileOf(repos);
  assert.equal((profile.payload as { attempts: number }).attempts, 2);
  assert.match(profile.summary, /typically 4 requests, \$0\.30 per success; 2000 ms/);
  const read = await readFieldManual(repos, { platform: 'legistar' });
  assert.deepEqual(read.projection.entryIds, [profile.id], 'the profile reaches a legistar job; the raw observations do not');
});

test('cost observations written apart are all counted', async () => {
  const repos = createMemoryRepositories();
  await Promise.all([writeFieldManual(repos, [observation('one', true, 0.1)], '2026-10-01T00:00:00.000Z'),
    writeFieldManual(repos, [observation('two', true, 0.3)], '2026-10-01T00:00:01.000Z')]);
  await writeFieldManual(repos, [observation('three', false, 0.2)], '2026-10-01T00:00:02.000Z');
  assert.equal(((await profileOf(repos)).payload as { attempts: number }).attempts, 3);
});

test('unpriced work remains unknown rather than a zero-dollar success', async () => {
  const repos = createMemoryRepositories();
  await writeFieldManual(repos, [observation('one', true, null)], '2026-10-01T00:00:00.000Z');
  const profile = await profileOf(repos);
  assert.equal((profile.payload as { usdPerSuccess: number | null }).usdPerSuccess, null);
  assert.match(profile.summary, /cost not fully recorded/);
});
