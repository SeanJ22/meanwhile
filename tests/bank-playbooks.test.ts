import { fixtureRolePlaybook } from "./helpers/playbooks.ts";
import { fixturePlaybooks } from "./helpers/playbooks.ts";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRolePlaybook, workerSystemPrompt, rolePlaybook } from '../lib/control-plane/playbooks.ts';
import { writeFieldManual } from '../lib/control-plane/field-manual.ts';
import { createMemoryRepositories } from '../lib/control-plane/repository/memory.ts';
import { hunterExecutor, scoutStaticPrefix, type ModelRequest } from '../lib/control-plane/scheduler/scout-executor.ts';
import { HUNTER_TOOL_SPECS } from '../lib/control-plane/scheduler/scout-tools.ts';

test('a changed role playbook is read on the next start and changes the cached system block', async () => {
  const repos = createMemoryRepositories();
  const defaults = fixturePlaybooks(['HUNTER', 'DETECTIVE']);
  await writeFieldManual(repos, defaults, '2026-10-04T00:00:00Z');
  const first = await readRolePlaybook(repos, 'HUNTER');
  const edited = { ...defaults[0]!, payload: { text: 'Read the saved listing before fetching another page.' }, observedAt: '2026-10-04T00:01:00Z' };
  await writeFieldManual(repos, [edited], '2026-10-04T00:01:00Z');
  const next = await readRolePlaybook(repos, 'HUNTER');
  assert.notEqual(first.version, next.version);
  const prefix = scoutStaticPrefix({ toolkitSpecs: [], playbook: next.text, role: 'HUNTER' });
  assert.match(prefix.system[0]!.text, /Read the saved listing/);
  assert.ok(prefix.system[0]!.cache_control);
  assert.match(prefix.system[0]!.text, /Never bypass/);
  assert.match((await readRolePlaybook(repos, 'DETECTIVE')).text, /You are a DETECTIVE/);
});

test('role text is separate from document pointers and the fixed laws survive an empty playbook', () => {
  assert.match(rolePlaybook([], 'HUNTER').error!, /missing/);
  assert.throws(() => workerSystemPrompt('HUNTER', ''), /missing/);
  const frame = workerSystemPrompt('HUNTER', 'Read the saved page.');
  assert.match(frame, /robots\.txt/);
  assert.match(frame, /saved bytes/);
  assert.match(frame, /spending limits/);
});

test('the next actual hunter transport request reads the current Bank playbook', async () => {
  const repos = createMemoryRepositories();
  const defaults = fixturePlaybooks(['HUNTER']);
  await writeFieldManual(repos, defaults, '2026-10-04T00:00:00Z');
  const capture = async (): Promise<ModelRequest> => {
    let sent: ModelRequest | undefined;
    const executor = hunterExecutor({ role: 'HUNTER', playbookFor: role => readRolePlaybook(repos, role),
      transport: async request => { sent ??= request; throw new Error('Captured mock request; no provider called'); },
      toolkitFor: () => ({ specs: HUNTER_TOOL_SPECS, vaultedArtifactIds: new Set(), reported: [], requestCount: 0, bytesFetched: 0, toolCalls: 0,
        call: async () => { throw new Error('No acquisition requested'); } }),
      contextFor: async () => ({ brief: 'playbook request', reason: 'playbook request', blanks: 1, handed: { artifactIds: [] },
        tools: { vault: async () => ({ stored: true, where: 'memory', why: 'test' }), spaceOut: async () => undefined } }),
      now: () => '2026-10-04T00:02:00Z',
    });
    await executor.run({
      obligation: { obligation: { id: 'playbook-request', recordClass: 'meetings', subjectId: 'ocd-division/country:us', routeId: null,
        active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, nextDueAt: '2026-10-04T00:02:00Z', cadenceHours: 24,
        cadenceSource: 'DEFAULT_NO_SIGNAL', basis: 'fixture' },
      routeTaskId: 'route', workItemId: 'work', attemptId: 'attempt', executor: 'BOUNDED_MODEL_WORKER',
      bound: { maxAttempts: 1, maxWallMs: 1000, maxCostUnits: 1 }, holder: 'fixture',
    });
    assert.ok(sent);
    return sent;
  };
  const first = await capture();
  await writeFieldManual(repos, [{ ...defaults[0]!, observedAt: '2026-10-04T00:01:00Z', payload: { text: 'Inspect the saved listing before another fetch.' } }], '2026-10-04T00:01:00Z');
  const next = await capture();
  assert.notDeepEqual(first.system, next.system);
  assert.match(next.system[0]!.text, /Inspect the saved listing/);
  assert.match(next.system[0]!.text, /Never bypass/);
  assert.ok(next.system[0]!.cache_control);
});
