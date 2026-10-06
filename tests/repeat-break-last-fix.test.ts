import test from 'node:test';
import assert from 'node:assert/strict';
import type { ScoutResult } from '../lib/control-plane/scheduler/scout-result.ts';
import type { FreshnessDebt } from '../lib/control-plane/scheduler/debt.ts';
import type { RouteDescriptor } from '../lib/control-plane/scheduler/registry.ts';
import { earlierFixes, failureResponderExecutor, lastFixBrief, repeatBreakRetry, solvedScoutResult } from '../lib/control-plane/workers/detective.ts';

/* DP-31: a door that breaks again starts from what fixed it last time, in plain code before any model call. */

const candidate = (url: string) => ({ url, evidenceArtifactIds: ['captured:' + url], routeId: url });
const fix = (attemptId: string, recordedAt: string, ...urls: string[]) => ({ attemptId, recordedAt, refusal: null, outcome: 'ROUTE_CANDIDATE',
  subjectId: 'body', recordClass: 'meetings', candidates: urls.map(candidate), findings: [] }) as unknown as ScoutResult;
/* First break: the agenda page moved, a detective found the calendar feed. Second break: that feed broke, a detective found the portal. */
const first = fix('fixed-first-break', '2026-08-01T00:00:00Z', 'https://calendar.example.org/feed');
const second = fix('fixed-second-break', '2026-09-01T00:00:00Z', 'https://portal.example.org/meetings');
const deadEnd = { ...fix('dead-end', '2026-09-15T00:00:00Z'), outcome: 'NO_PROGRESS' } as unknown as ScoutResult;
const history = [first, second, deadEnd];
/* Now the portal (the last fix's route) is shut. */
const debt = { obligationId: 'owed', cause: 'EXTRACTION_FAILED', target: 'https://portal.example.org/meetings', detail: 'The page changed shape',
  firstFailedAt: '2026-10-01T00:00:00Z', lastFailedAt: '2026-10-01T00:00:00Z', consecutiveFailures: 1 } as FreshnessDebt;
const route = { open: { kind: 'HTTP_GET', url: 'https://portal.example.org/meetings' } } as RouteDescriptor;
const input = { obligation: { obligation: { id: 'owed' } }, holder: 'worker' } as Parameters<NonNullable<ReturnType<typeof failureResponderExecutor>['workerFor']>>[0];

function responder(sourceFailure: FreshnessDebt, seen: string[] = []) {
  return failureResponderExecutor({ solved: solvedScoutResult(history, 'body', 'meetings'), history, sourceFailure, sourceRoute: route,
    transport: async () => { throw Error('No model request before the last fix is tried'); },
    toolkitFor: () => { throw Error('No research tools'); },
    executorFactory: deps => ({ lane: 'BOUNDED_MODEL_WORKER', workerFor: (i) => ({ role: deps.role ?? 'SCOUT', provider: 'test', version: '1', instance: i.holder }),
      run: async (i) => { seen.push(deps.contextFor(i.obligation).inherited.summary); return { ranAs: 'BOUNDED_MODEL_WORKER', kind: 'DISPOSED', artifacts: [], endedAt: 'now' } as never; } }),
    contextFor: () => ({ route, providerId: null, reason: 'failed source', decision: 'BOUNDED_MODEL_WORKER', inherited: { artifactIds: [], summary: 'PRIOR: earlier work' },
      tools: { vault: async () => ({ stored: true, where: 'test', why: 'saved' }), spaceOut: async () => {} } }) });
}

test('fixes on record are the results that found a route, newest first', () => {
  assert.deepEqual(earlierFixes(history).map(r => r.attemptId), ['fixed-second-break', 'fixed-first-break']);
  assert.equal(solvedScoutResult(history, 'body', 'meetings'), null, 'the latest result is a dead end, so nothing is reused today');
});

test('a repeat break tries the earlier fix in plain code first, at no model cost', async () => {
  const executor = responder(debt);
  assert.equal(executor.lane, 'DETERMINISTIC');
  assert.equal(executor.workerFor!(input).role, 'ACQUIRER');
  const outcome = await executor.run(input as Parameters<typeof executor.run>[0]);
  assert.equal(outcome.cost?.requestCount, 0);
  assert.equal(outcome.cost?.usd, 0);
  assert.match(outcome.detail!, /^REPEAT_BREAK_LAST_FIX: fixed-first-break/);
  assert.equal(outcome.kind, 'DISPOSED');
  if (outcome.kind === 'DISPOSED') {
    assert.match(outcome.disposition!.note, /calendar\.example\.org\/feed/);
    assert.doesNotMatch(outcome.disposition!.note, /portal\.example\.org/, 'the failing route is never handed back');
  }
});

test('the plain try gets the first detective turn only; then the detective starts from the last fix', async () => {
  const again = { ...debt, consecutiveFailures: 2, lastFailedAt: '2026-10-01T02:00:00Z' };
  assert.equal(repeatBreakRetry(earlierFixes(history), again, route), null);
  const seen: string[] = [];
  const executor = responder(again, seen);
  assert.equal(executor.lane, 'BOUNDED_MODEL_WORKER');
  assert.equal(executor.workerFor!(input).role, 'DETECTIVE');
  await executor.run(input as Parameters<typeof executor.run>[0]);
  const brief = seen[0]!;
  assert.ok(brief.startsWith('LAST FIX — this broke before.'), 'the last fix is at the top of the brief');
  assert.match(brief.split('\n')[0]!, /fixed-second-break.*portal\.example\.org\/meetings/);
  assert.match(brief.split('\n')[0]!, /failed at 2026-10-01T02:00:00Z \(EXTRACTION_FAILED\)/);
});

test('a passing outage keeps its plain retry and gets no last-fix handoff; an outage past the threshold does', () => {
  const outage = { ...debt, cause: 'UPSTREAM_ERROR', consecutiveFailures: 1 } as FreshnessDebt;
  assert.equal(repeatBreakRetry(earlierFixes(history), outage, route), null);
  assert.equal(repeatBreakRetry(earlierFixes(history), { ...outage, consecutiveFailures: 3 }, route)?.attemptId, 'fixed-first-break');
  assert.equal(repeatBreakRetry(earlierFixes(history), { ...outage, consecutiveFailures: 4 }, route), null);
  assert.equal(repeatBreakRetry(earlierFixes(history), { ...outage, consecutiveFailures: 2 }, route, 2)?.attemptId, 'fixed-first-break', 'Admin\'s threshold decides the turn');
});

test('no earlier fix on another source, or an unknown failed route, goes straight to the detective', () => {
  assert.equal(repeatBreakRetry([second], debt, route), null);
  assert.equal(repeatBreakRetry(earlierFixes(history), { ...debt, target: 'not-a-url' }, null), null);
  assert.equal(repeatBreakRetry(earlierFixes(history), null, route), null);
});

test('a fix found after the break is not an earlier fix', () => {
  const later = fix('after-the-break', '2026-10-02T00:00:00Z', 'https://elsewhere.example.org/');
  assert.equal(repeatBreakRetry(earlierFixes([later]), debt, route), null);
});

test('the brief line names the last fix in plain words and only claims a failure that came after it', () => {
  assert.equal(lastFixBrief(null, debt), null);
  const line = lastFixBrief(second, debt)!;
  assert.match(line, /^LAST FIX — this broke before\. What fixed it last time \(2026-09-01T00:00:00Z, attempt fixed-second-break\): https:\/\/portal\.example\.org\/meetings\./);
  assert.doesNotMatch(lastFixBrief(fix('newer', '2026-10-05T00:00:00Z', 'https://x.example.org/'), debt)!, /Since then/);
});

test('a blank field with no broken source gets no last-fix line', async () => {
  const seen: string[] = [];
  const executor = failureResponderExecutor({ history, transport: async () => { throw Error('No model'); }, toolkitFor: () => { throw Error('No tools'); },
    executorFactory: deps => ({ lane: 'BOUNDED_MODEL_WORKER', workerFor: (i) => ({ role: deps.role ?? 'SCOUT', provider: 'test', version: '1', instance: i.holder }),
      run: async (i) => { seen.push(deps.contextFor(i.obligation).inherited.summary); return { kind: 'DISPOSED' } as never; } }),
    contextFor: () => ({ route: null, providerId: null, reason: 'blank', inherited: { artifactIds: [], summary: 'REQUIRED_FIELD_MISSING: clerk' },
      tools: { vault: async () => ({ stored: true, where: 'test', why: 'saved' }), spaceOut: async () => {} } }) });
  assert.equal(executor.lane, 'BOUNDED_MODEL_WORKER');
  assert.equal(executor.workerFor!(input).role, 'DETECTIVE');
  await executor.run(input as Parameters<typeof executor.run>[0]);
  assert.doesNotMatch(seen[0]!, /LAST FIX/);
});
