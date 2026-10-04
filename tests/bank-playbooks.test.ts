import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPlaybookEntries, readRolePlaybook, workerSystemPrompt, rolePlaybook } from '../lib/control-plane/playbooks.ts';
import { writeFieldManual } from '../lib/control-plane/field-manual.ts';
import { createMemoryRepositories } from '../lib/control-plane/repository/memory.ts';
import { scoutStaticPrefix } from '../lib/control-plane/scheduler/scout-executor.ts';
import { RESEARCH_BOUNDS } from '../lib/control-plane/scheduler/research-policy.ts';

test('a changed role playbook is read on the next start and changes the cached system block', async () => {
  const repos = createMemoryRepositories();
  const defaults = defaultPlaybookEntries(['SCOUT', 'DETECTIVE']);
  await writeFieldManual(repos, defaults, '2026-10-04T00:00:00Z');
  const first = await readRolePlaybook(repos, 'SCOUT');
  const edited = { ...defaults[0]!, payload: { text: 'Read the saved listing before fetching another page.' }, observedAt: '2026-10-04T00:01:00Z' };
  await writeFieldManual(repos, [edited], '2026-10-04T00:01:00Z');
  const next = await readRolePlaybook(repos, 'SCOUT');
  assert.notEqual(first.version, next.version);
  const prefix = scoutStaticPrefix({ toolkitSpecs: [], bound: RESEARCH_BOUNDS.perDispatch, minRungs: 4, playbook: next.text });
  assert.match(prefix.system[0]!.text, /Read the saved listing/);
  assert.ok(prefix.system[0]!.cache_control);
  assert.match(prefix.system[0]!.text, /Never bypass/);
  assert.match((await readRolePlaybook(repos, 'DETECTIVE')).text, /web\.archive\.org/);
});

test('role text is separate from document pointers and the fixed laws survive an empty playbook', () => {
  assert.match(rolePlaybook([], 'SCOUT').text, /You are a SCOUT/);
  const frame = workerSystemPrompt('SCOUT', '');
  assert.match(frame, /robots\.txt/);
  assert.match(frame, /saved bytes/);
  assert.match(frame, /spending limits/);
});
