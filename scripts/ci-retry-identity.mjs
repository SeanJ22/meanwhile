/** A same-run retry cannot certify a PR whose head, base or draft policy moved. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function samePullRequestInputs(original, current) {
  const sha = /^[a-f0-9]{40}$/;
  return Boolean(original && current &&
    Number.isInteger(original.number) && original.number === current.number &&
    sha.test(original.head?.sha ?? '') && sha.test(original.base?.sha ?? '') &&
    original.head.sha === current.head?.sha && original.base.sha === current.base?.sha &&
    typeof original.draft === 'boolean' && original.draft === current.draft && current.state === 'open');
}

function main() {
  const expected = process.env.GITHUB_SHA ?? '';
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  if (!/^[a-f0-9]{40}$/.test(expected) || actual !== expected) throw new Error('Checkout differs from the original workflow commit. Run full verification on the current commit.');
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return;
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const original = payload.pull_request;
  const repository = process.env.GITHUB_REPOSITORY ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isInteger(original?.number)) throw new Error('Missing PR identity; cannot reuse prerequisite jobs.');
  const current = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/pulls/${original.number}`], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
  if (!samePullRequestInputs(original, current)) throw new Error('PR head, base, or certification policy changed. Require a new full workflow; previous results cannot certify it.');
  console.log('PR head, base, draft policy and checked-out workflow commit match the original run. Successful prerequisites belong to this same immutable run; live schema and integrity are checked again.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(`CI identity refused: ${error.message}`); process.exitCode = 1; }
}
