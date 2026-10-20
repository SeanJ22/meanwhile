import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newFieldManualEntry, normalizeEntry, readFieldManual, writeFieldManual } from '../lib/control-plane/field-manual.ts';
import { createMemoryRepositories } from '../lib/control-plane/repository/memory.ts';
import { jobCostProfiles } from '../lib/control-plane/bank-job-cost.ts';
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

test('a cost profile consumes its history once and keeps unknown request counts', () => {
  const one = observation('one', false, 0.1), two = observation('two', true, 0.2);
  const uncounted = { ...one, payload: { ...(one.payload as object), requestCount: null } };
  let traversals = 0;
  const entries = { [Symbol.iterator]: function* () {
    assert.equal(++traversals, 1); yield uncounted; yield two;
  }};
  const [profile] = jobCostProfiles(entries, [two], '2026-10-20');
  assert.deepEqual(profile.payload, { platform: 'legistar', recordClass: 'meetings', attempts: 2, successes: 1,
    typicalRequests: null, usdPerSuccess: 0.30000000000000004, durationMsPerSuccess: 2000 });
});

test('saved profiles stream all observations, deduplicate overlapping scopes and never request full manual rows', async () => {
  const repos = createMemoryRepositories(), repo = repos.fieldManual;
  for (let n = 0; n < 1000; n++) {
    const entry = normalizeEntry({ ...observation(`prior-${n}`, true, 0.1), platforms: ['legistar', 'civicplus'], recordClasses: ['meetings', 'officials'] });
    await repo.put(entry.id, entry, '2026-10-01T00:00:00.000Z');
  }
  const fullRead = repo.read.bind(repo);
  for (const method of ['read', 'readMany', 'list', 'slice'] as const) repo[method] = async () => { throw new Error(`Full ${method} forbidden`); };
  const visit = repo.visitSlice.bind(repo);
  repo.visitSlice = (query, each, projection) => visit(query, async row => { await each(row); await each(row); }, projection);
  const own = observation('own', true, 0.2), other = observation('other', true, 0.4);
  const civic = { ...other, platforms: ['civicplus'], recordClasses: ['officials'], payload: { ...(other.payload as object), platform: 'civicplus', recordClass: 'officials' } };
  const result = await writeFieldManual(repos, [own, civic], '2026-10-20T00:00:00.000Z');
  assert.equal(result.error, undefined);
  const key = newFieldManualEntry('job-cost-profile', 'legistar:meetings', { role: 'SHARED', kind: 'COST_PROFILE', title: '', summary: '', outcome: 'REFERENCE' }).id;
  const profile = (await fullRead(key))!.value;
  assert.equal((profile.payload as { attempts: number }).attempts, 1001);
  assert.equal((profile.payload as { successes: number }).successes, 1001);
  assert.equal((profile.payload as { typicalRequests: number }).typicalRequests, 2);
});
