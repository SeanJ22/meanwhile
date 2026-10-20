import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepositories } from '../lib/control-plane/repository/memory.ts';
import { newFieldManualEntry, writeFieldManual } from '../lib/control-plane/field-manual.ts';
import { BANK_WRITE_HEALTH_ID } from '../lib/control-plane/bank-write-health.ts';

const entry = newFieldManualEntry('test', 'lesson', { role: 'SHARED', kind: 'LESSON', title: 'lesson', summary: 'saved', outcome: 'REFERENCE', portable: true });
const count = async (repos: ReturnType<typeof createMemoryRepositories>) =>
  ((await repos.fieldManual.read(BANK_WRITE_HEALTH_ID))?.value.payload as { count: number } | undefined)?.count ?? 0;

test('exhausted writes count once, successful retries count no error', async () => {
  const repos = createMemoryRepositories();
  let failLesson = true;
  const wrapped = { fieldManual: { ...repos.fieldManual, put: async (id: string, value: Parameters<typeof repos.fieldManual.put>[1], now: string) => {
    if (id === entry.id && failLesson) throw new Error('contention');
    return repos.fieldManual.put(id, value, now);
  } } };
  const failed = await writeFieldManual(wrapped, [entry], '2026-10-04T00:00:00Z');
  assert.equal(failed.error, 'contention');
  assert.equal(await count(repos), 1);
  failLesson = false;
  assert.deepEqual(await writeFieldManual(wrapped, [entry], '2026-10-04T00:01:00Z'), { written: 1 });
  assert.equal(await count(repos), 1);
});

test('store outage buffers the error and saves it on the next successful write', async () => {
  const repos = createMemoryRepositories();
  let down = true;
  const wrapped = { fieldManual: { ...repos.fieldManual,
    read: async (id: string) => { if (down) throw new Error('store unavailable'); return repos.fieldManual.read(id); },
    readMany: async (ids: readonly string[]) => { if (down) throw new Error('store unavailable'); return repos.fieldManual.readMany(ids); } } };
  assert.equal((await writeFieldManual(wrapped, [entry], '2026-10-04T00:00:00Z')).error, 'store unavailable');
  down = false;
  await writeFieldManual(wrapped, [entry], '2026-10-04T00:01:00Z');
  assert.equal(await count(repos), 1);
});
