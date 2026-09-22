import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { start, prepare, check, close } from '../scripts/session-workspace.mjs';

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const services = { pullRequests: () => [] };
function fixture(t: { after: (cb: () => void) => void }) {
  const base = mkdtempSync(join(tmpdir(), 'meanwhile-closeout-test-'));
  // Only this fixture's resolved, randomly allocated root can be removed by the test teardown.
  assert.ok(resolve(base).startsWith(resolve(tmpdir())));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, 'main'), remote = join(base, 'origin.git');
  mkdirSync(repo);
  const git = (...a: string[]) => execFileSync('git', ['-c', 'gc.auto=0', ...a], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--bare', remote); git('init', '-b', 'main');
  git('config', 'user.name', 'Closeout test'); git('config', 'user.email', 'closeout@example.invalid');
  writeFileSync(join(repo, '.gitignore'), '.scratch/\n.env.local\n');
  writeFileSync(join(repo, 'delivered.txt'), 'permanent result\n');
  git('add', '.'); git('commit', '-m', 'fixture'); git('remote', 'add', 'origin', remote); git('push', '-u', 'origin', 'main');
  const launched = start({ repo, home: join(base, 'worktrees'), name: 'disposable-session', branch: 'codex/disposable-session', owner: 'test-owner', purpose: 'Disposable closeout test' });
  const root = launched.root;
  const taskGit = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('push', 'origin', 'codex/disposable-session');
  const plan: Record<string, unknown> = prepare(launched.handoff), planPath = join(base, 'closeout.json');
  const privateFile = join(repo, '.env.local'); writeFileSync(privateFile, 'TEST_ONLY=preserve\n');
  const permanent = { path: join(repo, 'delivered.txt'), sha256: sha(join(repo, 'delivered.txt')) };
  function receipt(name: string, data: unknown) {
    const path = join(base, `${name}.json`); writeFileSync(path, JSON.stringify(data)); return { path, sha256: sha(path) };
  }
  function save() {
    plan.reviewedAt = new Date().toISOString();
    plan.release = receipt('release', { owner: 'test-owner', root, released: true });
    plan.dependencyReview = receipt('dependencies', { root, head: plan.head, reviewedAt: plan.reviewedAt, noActiveConsumers: true, noUnsavedBuffers: true, noUnregisteredProcesses: true, noBranchConsumers: true });
    plan.delivery = receipt('delivery', { head: plan.head, requiredChecksPassed: true, deploymentVerified: true, evidence: 'Local disposable fixture; no product deployment requested or performed.' });
    const bundle = join(base, 'history.bundle');
    if (existsSync(bundle)) rmSync(bundle);
    git('bundle', 'create', bundle, 'refs/heads/codex/disposable-session');
    plan.recovery = receipt('recovery', { head: plan.head, gitBundle: { path: bundle, sha256: sha(bundle) }, verifiedAt: plan.reviewedAt, volumeVerified: true, protectedFiles: [{ path: privateFile, sha256: sha(privateFile) }] });
    plan.deliverables = [permanent];
    writeFileSync(planPath, JSON.stringify(plan));
  }
  save(); return { base, repo, root, git, taskGit, plan, planPath, save, privateFile, launched };
}

test('external closeout removes one merged workspace and both branches; deliverable and private bytes survive', t => {
  const f = fixture(t), before = readFileSync(f.privateFile);
  const result = close(f.planPath, services);
  assert.equal(result.state, 'complete'); assert.equal(existsSync(f.root), false);
  assert.equal(f.git('branch', '--list', 'codex/disposable-session'), '');
  assert.equal(f.git('ls-remote', '--heads', 'origin', 'refs/heads/codex/disposable-session'), '');
  assert.equal(readFileSync(join(f.repo, 'delivered.txt'), 'utf8'), 'permanent result\n');
  assert.deepEqual(readFileSync(f.privateFile), before);
});
test('ignored unique material is not disposable merely because Git ignores it', t => {
  const f = fixture(t); mkdirSync(join(f.root, '.scratch')); writeFileSync(join(f.root, '.scratch', 'finding.txt'), 'unique');
  assert.throws(() => close(f.planPath, services), /file set changed/);
  assert.ok(existsSync(f.root)); assert.equal(readFileSync(join(f.root, '.scratch', 'finding.txt'), 'utf8'), 'unique');
});
test('active dependency and existing process each prevent removal', t => {
  const f = fixture(t); f.plan.dependencies = [{ resource: 'other-session', state: 'active', reason: 'reads evidence' }]; f.save();
  assert.throws(() => close(f.planPath, services), /Active or unresolved dependency/);
  f.plan.dependencies = []; f.plan.processes = [{ pid: process.pid }]; f.save();
  assert.throws(() => close(f.planPath, services), /still exists/); assert.ok(existsSync(f.root));
});
test('tracked unmerged work and a new open PR prevent removal', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'not-shipped.txt'), 'unshipped');
  f.taskGit('add', '.'); f.taskGit('commit', '-m', 'unshipped');
  f.plan.head = f.taskGit('rev-parse', 'HEAD'); f.save();
  assert.throws(() => check(f.planPath, services), /preservation is unproven/);
  assert.throws(() => check(f.planPath, { pullRequests: () => [{ state: 'OPEN' }] }), /Open PR/);
  assert.ok(existsSync(f.root));
});
test('squash merge content is recognized without guessing from branch ancestry', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'result.txt'), 'shipped by squash');
  f.taskGit('add', '.'); f.taskGit('commit', '-m', 'task result'); f.taskGit('push', 'origin', 'HEAD');
  f.git('merge', '--squash', 'codex/disposable-session'); f.git('commit', '-m', 'squashed result'); f.git('push', 'origin', 'main');
  f.plan.head = f.taskGit('rev-parse', 'HEAD'); f.save();
  const result = close(f.planPath, services);
  assert.ok(result.proof.provenBy.includes('MERGE_IS_NOOP'));
  assert.equal(readFileSync(join(f.repo, 'result.txt'), 'utf8'), 'shipped by squash');
});
test('changed preservation copy and stale review do not pass', t => {
  const f = fixture(t); f.plan.reviewedAt = '2000-01-01T00:00:00.000Z'; writeFileSync(f.planPath, JSON.stringify(f.plan));
  assert.throws(() => check(f.planPath, services), /older than 30 minutes/);
  f.save(); writeFileSync(join(f.repo, 'delivered.txt'), 'changed');
  assert.throws(() => check(f.planPath, services), /Deliverable changed/);
  assert.ok(existsSync(f.root));
});
test('another registered session overrides a mistaken no-consumer declaration', t => {
  const f = fixture(t);
  start({ repo: f.repo, home: join(f.base, 'worktrees'), name: 'dependent-session', branch: 'codex/dependent-session', owner: 'dependent-owner', purpose: 'Read proof', dependencies: [{ resource: f.root, reason: 'proof input', state: 'active' }] });
  assert.throws(() => close(f.planPath, services), /dependent-owner still depends/);
  assert.ok(existsSync(f.root));
});
