/** R291: external, explicit-resource bookend to handoff. No dependency installs. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyBranch } from '../lib/ops/branch-retirement.ts';

const SELF = fileURLToPath(import.meta.url);
const HASH = b => createHash('sha256').update(b).digest('hex');
const fail = message => { throw new Error(message); };
const need = (condition, message) => { if (!condition) fail(message); };
const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
const inside = (base, path) => { const r = relative(resolve(base), resolve(path)); return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
const json = path => JSON.parse(readFileSync(path, 'utf8'));
function run(cwd, command, args) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
const git = (cwd, ...args) => run(cwd, 'git', ['-c', 'gc.auto=0', ...args]);
const status = (cwd, ...args) => spawnSync('git', args, { cwd, stdio: 'pipe' }).status;
function write(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function plainPath(path) {
  let p = resolve(path);
  while (true) {
    if (existsSync(p)) need(!lstatSync(p).isSymbolicLink(), `Link in resource path: ${p}`);
    const parent = dirname(p); if (parent === p) break; p = parent;
  }
}
function registry(repo) {
  const common = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  return join(common, 'session-handoffs');
}
function worktrees(repo) {
  return git(repo, 'worktree', 'list', '--porcelain').split('\n\n').filter(Boolean).map(block => {
    const lines = block.split('\n');
    return { path: lines.find(l => l.startsWith('worktree '))?.slice(9), branch: lines.find(l => l.startsWith('branch '))?.slice(7), locked: lines.some(l => l.startsWith('locked')) };
  });
}
function inventory(root) {
  const files = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      if (same(dir, root) && name === '.git') continue;
      const path = join(dir, name), st = lstatSync(path);
      need(!st.isSymbolicLink(), `Unresolved link: ${path}. Unlink through its supported owner first; targets are never traversed.`);
      if (st.isDirectory()) walk(path);
      else { need(st.isFile(), `Unsupported file type: ${path}`); files.push({ path: relative(root, path).replaceAll('\\', '/'), sha256: HASH(readFileSync(path)) }); }
    }
  }
  walk(root); return files;
}
function externalFile(root, record, label) {
  need(record && isAbsolute(record.path) && !inside(root, record.path) && !same(root, record.path), `${label} must live outside the temporary workspace`);
  plainPath(record.path);
  need(HASH(readFileSync(record.path)) === record.sha256, `${label} changed or preservation verification failed: ${record.path}`);
}

/** Register only one explicitly named new workspace; never adopt existing folders by inference.
 * @param {{repo: string, home: string, name: string, branch: string, owner: string, purpose: string, base?: string, dependencies?: Array<{resource: string, reason: string, state: string}>, plan?: string|null}} options
 */
export function start({ repo, home, name, branch, owner, purpose, base = 'origin/main', dependencies = [], plan = null }) {
  repo = realpathSync(repo); home = resolve(home);
  need(/^[a-z0-9][a-z0-9-]{2,63}$/.test(name), 'Use a clear lowercase hyphenated workspace name');
  need(/^(codex|claude|ws)\/[a-z0-9][a-z0-9/-]+$/.test(branch) && !branch.includes('..'), 'Only explicitly named task branches can be registered');
  need(owner?.trim() && purpose?.trim(), 'Owner and purpose are required');
  need(Array.isArray(dependencies) && dependencies.every(d => typeof d.resource === 'string' && d.resource && typeof d.reason === 'string' && d.reason), 'Dependencies require resource and reason');
  need(!inside(repo, home) && !same(repo, home), 'Temporary home must be outside the main repository');
  need(worktrees(repo).every(t => !same(t.path, home) && !inside(t.path, home)), 'Temporary home overlaps an existing checkout');
  need(dependencies.every(d => d.state === 'active' || d.state === 'released'), 'Each shared dependency needs an explicit state');
  plainPath(home); const root = join(home, name); need(!existsSync(root), 'Workspace already exists; do not adopt or overwrite it');
  const store = registry(repo); mkdirSync(store, { recursive: true });
  const path = join(store, `${name}.json`); need(!existsSync(path), 'A handoff already owns this name');
  mkdirSync(home, { recursive: true });
  const record = { version: 1, owner, purpose, repo, home, root, branch, base, plan, dependencies, processes: [], createdAt: new Date().toISOString(), state: 'creating' };
  write(path, record);
  const baseHead = git(repo, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`);
  git(repo, 'worktree', 'add', '-b', branch, root, baseHead);
  record.state = 'active'; writeFileSync(path, JSON.stringify(record, null, 2) + '\n');
  // The installed helper and classifier outlive the target. No app state or global settings.
  const code = readFileSync(SELF), classifierCode = readFileSync(new URL('../lib/ops/branch-retirement.ts', import.meta.url));
  const toolVersion = HASH(Buffer.concat([code, classifierCode]));
  const helper = join(store, 'tools', toolVersion, 'scripts', 'session-workspace.mjs');
  const classifier = join(store, 'tools', toolVersion, 'lib', 'ops', 'branch-retirement.ts');
  mkdirSync(dirname(helper), { recursive: true }); mkdirSync(dirname(classifier), { recursive: true });
  writeFileSync(helper, code);
  writeFileSync(classifier, classifierCode);
  return { root, handoff: path, helper };
}

/** Capture every regular file, including ignored files. Classification is an owner duty, not an ignore rule. */
export function prepare(handoff) {
  const r = json(handoff);
  const tracked = new Set(git(r.root, 'ls-files', '-z').split('\0'));
  return { version: 1, handoff: { path: resolve(handoff), sha256: HASH(readFileSync(handoff)) }, head: git(r.root, 'rev-parse', 'HEAD'),
    reviewedAt: null, release: null, dependencyReview: null, delivery: null, recovery: null,
    dependencies: r.dependencies, processes: r.processes, files: inventory(r.root).filter(f => !tracked.has(f.path)), deliverables: [] };
}

function branchProof(r, head, main, prs) {
  const ahead = Number(git(r.repo, 'rev-list', '--count', `${main}..${head}`));
  const behind = Number(git(r.repo, 'rev-list', '--count', `${head}..${main}`));
  const merge = spawnSync('git', ['merge-tree', '--write-tree', main, head], { cwd: r.repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const mergeIsNoop = merge.status === 0 && merge.stdout.trim() === git(r.repo, 'rev-parse', `${main}^{tree}`);
  return classifyBranch({ ref: r.branch, tipSha: head, lastCommitAt: git(r.repo, 'show', '-s', '--format=%cI', head), aheadOfMain: ahead, behindMain: behind,
    mergeIsNoop, cherryUnique: ahead, uniquePaths: git(r.repo, 'diff', '--name-only', main, head).split('\n').filter(Boolean),
    integrationAncestry: [], pullRequests: prs.map(p => ({ number: p.number, state: p.state, mergeSha: p.mergeCommit?.oid ?? null,
      mergeShaInMain: !!p.mergeCommit?.oid && status(r.repo, 'merge-base', '--is-ancestor', p.mergeCommit.oid, main) === 0, mergedHeadOid: p.headRefOid })) },
    { activeRefs: [], ownerNamespaces: ['sean'], ownerRetirementPolicy: null });
}

/** Preflight is repeated immediately before apply. Ambiguous/inaccessible facts fail closed. */
export function check(planPath, services = {}) {
  const p = json(planPath); const r = json(p.handoff.path);
  need(p.version === 1 && r.version === 1 && r.state === 'active', 'Unknown or inactive handoff');
  externalFile(r.root, p.handoff, 'Handoff');
  need(same(p.handoff.path, join(registry(r.repo), `${r.root.split(/[\\/]/).at(-1)}.json`)), 'Handoff is outside the repository session registry');
  need(inside(r.home, r.root) && same(dirname(r.root), r.home) && !inside(r.root, r.repo) && !same(r.root, r.repo), 'Target must be one direct child of its registered temporary home');
  need(/^(codex|claude|ws)\/.+/.test(r.branch) && !['main', 'master'].includes(r.branch), 'Protected branch');
  plainPath(r.root); plainPath(r.repo);
  need(!inside(r.root, process.cwd()) && !same(r.root, process.cwd()) && !inside(r.root, SELF), 'Move execution and this helper outside the worktree first');
  need(!inside(r.root, planPath), 'Closeout plan must be outside the worktree');
  const age = Date.now() - Date.parse(p.reviewedAt);
  need(Number.isFinite(age) && age >= 0 && age <= 30 * 60 * 1000, 'Dependency/process review is missing or older than 30 minutes');
  for (const [label, receipt] of Object.entries({ release: p.release, dependencyReview: p.dependencyReview, delivery: p.delivery, recovery: p.recovery })) externalFile(r.root, receipt, label);
  const release = json(p.release.path), review = json(p.dependencyReview.path), delivery = json(p.delivery.path);
  const recovery = json(p.recovery.path);
  need(recovery.head === p.head && recovery.verifiedAt === p.reviewedAt && recovery.volumeVerified === true, 'Current recovery volume/history verification is missing');
  externalFile(r.root, recovery.gitBundle, 'Git history recovery');
  git(r.repo, 'bundle', 'verify', recovery.gitBundle.path);
  need(git(r.repo, 'bundle', 'list-heads', recovery.gitBundle.path).split('\n').some(line => line.startsWith(`${p.head} `)), 'Verified recovery bundle does not retain this exact task head');
  need(Array.isArray(recovery.protectedFiles) && recovery.protectedFiles.length > 0, 'Credentials/instructions/shared-resource baseline is missing');
  for (const f of recovery.protectedFiles) externalFile(r.root, f, 'Protected resource');
  need(release.owner === r.owner && same(release.root, r.root) && release.released === true, 'Owner release does not cover this exact workspace');
  need(review.head === p.head && same(review.root, r.root) && review.noActiveConsumers === true && review.noUnsavedBuffers === true && review.noUnregisteredProcesses === true && review.noBranchConsumers === true, 'Actual consumer, buffer, process and branch review is incomplete');
  need(review.reviewedAt === p.reviewedAt, 'Review receipt does not match this review');
  need(delivery.head === p.head && delivery.requiredChecksPassed === true && delivery.deploymentVerified === true && typeof delivery.evidence === 'string' && delivery.evidence.length > 0, 'Delivery checks and authorized deployment verification require evidence');
  need(Array.isArray(p.dependencies) && p.dependencies.every(d => d.state === 'released' && d.evidence), 'Active or unresolved dependency blocks removal');
  need(r.dependencies.every(d => p.dependencies.some(q => q.resource === d.resource)), 'A registered dependency disappeared from the handoff');
  for (const name of readdirSync(registry(r.repo)).filter(n => n.endsWith('.json') && !n.includes('-closeout-'))) {
    const other = json(join(registry(r.repo), name));
    if (other.state !== 'active' || same(other.root, r.root)) continue;
    for (const d of other.dependencies ?? []) {
      const pointsHere = d.resource === r.branch || d.resource === `refs/heads/${r.branch}` ||
        (isAbsolute(d.resource) && (same(d.resource, r.root) || inside(r.root, d.resource)));
      need(!pointsHere || d.state === 'released', `Registered session ${other.owner} still depends on this workspace: ${d.resource}`);
    }
  }
  need(Array.isArray(p.processes) && r.processes.every(d => p.processes.some(q => q.pid === d.pid)), 'Registered process omitted');
  for (const pr of p.processes) {
    need(Number.isSafeInteger(pr.pid) && pr.pid > 0, 'Invalid recorded process');
    try { process.kill(pr.pid, 0); fail(`Recorded PID ${pr.pid} still exists (possibly reused); refresh identity and close through its owner. No process was killed.`); }
    catch (e) { if (e.code !== 'ESRCH') throw e; }
  }
  const trees = worktrees(r.repo), entry = trees.find(t => same(t.path, r.root));
  need(entry && !entry.locked && entry.branch === `refs/heads/${r.branch}`, 'Git registration/branch changed or is locked');
  need(trees.filter(t => t.branch === entry.branch).length === 1, 'Another checkout uses this branch');
  need(git(r.root, 'rev-parse', '--path-format=absolute', '--git-common-dir') === git(r.repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'Shared Git parent changed');
  need(git(r.root, 'rev-parse', 'HEAD') === p.head && git(r.repo, 'rev-parse', `refs/heads/${r.branch}`) === p.head, 'Task head changed');
  need(git(r.root, 'status', '--porcelain', '--untracked-files=no') === '', 'Tracked changes are not preserved through the normal commit/merge path');
  const tracked = new Set(git(r.root, 'ls-files', '-z').split('\0'));
  const extras = inventory(r.root).filter(f => !tracked.has(f.path));
  need(Array.isArray(p.files) && extras.length === p.files.length, 'Untracked/ignored file set changed; inspect and preserve it');
  for (const f of extras) {
    const item = p.files.find(i => i.path === f.path);
    need(item?.sha256 === f.sha256, `Unique or changed file is unpreserved: ${f.path}`);
    need(item.reason?.trim(), `Missing use/classification reason: ${f.path}`);
    if (item.disposition === 'preserved') {
      externalFile(r.root, item.copy, f.path); need(item.copy.sha256 === f.sha256, `Preserved bytes differ: ${f.path}`);
      externalFile(r.root, item.recoveryCopy, `Recovery ${f.path}`); need(item.recoveryCopy.sha256 === f.sha256, `Recovery bytes differ: ${f.path}`);
    }
    else need(item.disposition === 'disposable' && item.noConsumers === true && !/(^|\/)(\.env($|\.)|\.npmrc$|credentials|secrets)/i.test(f.path), `Unique/credential material must be preserved: ${f.path}`);
  }
  need(Array.isArray(p.deliverables) && p.deliverables.length > 0, 'No permanent deliverables recorded');
  for (const f of p.deliverables) externalFile(r.root, f, 'Deliverable');
  // Fetch only the intended target; never prune or update any checkout.
  git(r.repo, 'fetch', '--no-auto-maintenance', 'origin', 'main');
  const main = git(r.repo, 'rev-parse', 'FETCH_HEAD');
  const prs = services.pullRequests ? services.pullRequests(r) : JSON.parse(run(r.repo, 'gh', ['pr', 'list', '--state', 'all', '--head', r.branch, '--limit', '1000', '--json', 'number,state,headRefOid,mergeCommit']));
  need(prs.length < 1000 && !prs.some(pr => pr.state === 'OPEN'), 'Open PR or incomplete PR enumeration needs this branch');
  const proof = branchProof(r, p.head, main, prs);
  need(proof.disposition === 'SAFE_DELETE', `Branch preservation is unproven: ${proof.evidence}`);
  const remote = git(r.repo, 'ls-remote', '--heads', 'origin', `refs/heads/${r.branch}`);
  const remoteHead = remote ? remote.split(/\s/)[0] : null;
  need(!remoteHead || remoteHead === p.head, 'Remote task branch changed or differs from local head');
  return { r, p, extras, proof, remoteHead, main, planSha256: HASH(readFileSync(planPath)) };
}

export function close(planPath, services = {}) {
  const v = check(planPath, services), { r, p } = v;
  const journal = join(registry(r.repo), `${r.root.split(/[\\/]/).at(-1)}-closeout-${Date.now()}.json`);
  write(journal, { state: 'preflight-passed', head: p.head, proof: v.proof, planSha256: v.planSha256 });
  try {
    // No recursive filesystem deletion. Every extra was individually classified and hashed.
    for (const f of v.extras) {
      const path = resolve(r.root, f.path); need(inside(r.root, path), 'File escapes workspace'); plainPath(path);
      need(HASH(readFileSync(path)) === f.sha256, `File changed before removal: ${f.path}`);
      unlinkSync(path);
    }
    need(git(r.root, 'status', '--porcelain') === '', 'Work changed during closeout; stop before Git removal');
    git(r.repo, 'worktree', 'remove', r.root); // never --force; locked/in-use/dirty work remains protected
    need(!existsSync(r.root) && !worktrees(r.repo).some(t => same(t.path, r.root)), 'Git left a folder or registration; keep the branch and inspect the residue');
    if (v.remoteHead) git(r.repo, 'push', `--force-with-lease=refs/heads/${r.branch}:${v.remoteHead}`, 'origin', `:refs/heads/${r.branch}`);
    // Exact compare-and-delete handles squash/rebase preservation without branch -D guessing.
    git(r.repo, 'update-ref', '-d', `refs/heads/${r.branch}`, p.head);
    need(status(r.repo, 'show-ref', '--verify', '--quiet', `refs/heads/${r.branch}`) === 1, 'Local task branch remains');
    need(!git(r.repo, 'ls-remote', '--heads', 'origin', `refs/heads/${r.branch}`), 'Remote task branch remains');
    for (const f of p.deliverables) externalFile(r.root, f, 'Deliverable');
    for (const f of json(p.recovery.path).protectedFiles) externalFile(r.root, f, 'Protected resource');
    r.state = 'closed'; r.finishedAt = new Date().toISOString();
    writeFileSync(p.handoff.path, JSON.stringify(r, null, 2) + '\n');
    const result = { state: 'complete', root: r.root, branch: r.branch, removedFiles: v.extras.length, proof: v.proof.contentRepresentedInMain, finishedAt: new Date().toISOString() };
    writeFileSync(journal, JSON.stringify(result, null, 2) + '\n'); return { ...result, journal };
  } catch (e) {
    writeFileSync(journal, JSON.stringify({ state: 'implementation complete; cleanup blocked', root: r.root, branch: r.branch, error: e.message }, null, 2) + '\n'); throw e;
  }
}

if (process.argv[1] && same(process.argv[1], SELF)) {
  try {
    const [command, path] = process.argv.slice(2);
    need(path, 'Usage: session-workspace.mjs start config.json | prepare handoff.json | check plan.json | close plan.json');
    const output = command === 'start' ? start(json(path)) : command === 'prepare' ? prepare(path) : command === 'check' ? (() => { const v = check(path); return { state: 'ready', root: v.r.root, proof: v.proof }; })() : command === 'close' ? close(path) : fail('Unknown command');
    console.log(JSON.stringify(output, null, 2));
  } catch (e) { console.error(`implementation complete; cleanup blocked: ${e.message}`); process.exitCode = 1; }
}
