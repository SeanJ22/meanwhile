import assert from 'node:assert/strict';
import test from 'node:test';
import { samePullRequestInputs } from '../scripts/ci-retry-identity.mjs';

const original = {number: 12, head: {sha: 'a'.repeat(40)}, base: {sha: 'b'.repeat(40)}, draft: false, state: 'open'};
test('receipt-only refresh retains an unchanged PR input identity', () => {
  assert.equal(samePullRequestInputs(original, {...original, updated_at: 'new receipt time'}), true);
});
test('changed head, combined base, tier, closed PR or missing identity requires full proof', () => {
  for (const change of [{head: {sha: 'c'.repeat(40)}}, {base: {sha: 'c'.repeat(40)}}, {draft: true}, {state: 'closed'}, {number: 13}, {head: {}}, {base: null}]) {
    assert.equal(samePullRequestInputs(original, {...original, ...change}), false);
  }
  assert.equal(samePullRequestInputs(undefined, original), false);
  assert.equal(samePullRequestInputs(original, undefined), false);
});
