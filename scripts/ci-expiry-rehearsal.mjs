// Unmergeable rehearsal: in-memory inputs only; never writes a production receipt.
import assert from 'node:assert/strict';
import { evaluateReleaseFreeze, MAX_READING_AGE_HOURS } from '../lib/ops/production-integrity.ts';
const served = 'a'.repeat(40);
const record = { formatVersion: 1, deployedSha: served, mainSha: served,
  observed: 'HELD', failureClass: null, detail: 'SYNTHETIC REHEARSAL ONLY',
  observedAt: '2026-08-28T12:00:00.000Z', moment: 'post-deploy', gateExit: 0 };
const check = age => evaluateReleaseFreeze({record, candidateSha: 'b'.repeat(40),
  changedPaths: ['app/api/meetings/route.ts'],
  production: {servedSha: served, how: 'SYNTHETIC REHEARSAL ONLY', readingAgeHours: age, maxAgeHours: MAX_READING_AGE_HOURS}});
const expired = check(39.9);
const fresh = check(1);
assert.equal(MAX_READING_AGE_HOURS, 24);
assert.equal(expired.frozen, true);
assert.equal(expired.freshness, 'READING_EXPIRED');
assert.equal(fresh.frozen, false);
console.log(JSON.stringify({synthetic: true, ageHours: 39.9, maxAgeHours: MAX_READING_AGE_HOURS,
  expired, fresh, disposition: 'INTENTIONAL FAILURE: expensive downstream work must not start'}));
process.exitCode = 1;
