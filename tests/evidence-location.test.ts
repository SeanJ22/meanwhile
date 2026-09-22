import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { relocatedImageBytes, type EvidenceLocations } from '../lib/holdings/evidence-location.ts';

test('historical image aliases resolve exact bytes after the original is gone, without rewriting hash-bound reports', t => {
  const root = mkdtempSync(join(tmpdir(), 'meanwhile-image-location-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'evidence'), destination = 'reader-last-mile/original-run/proof.png';
  mkdirSync(join(home, 'reader-last-mile/original-run'), { recursive: true });
  const image = Buffer.from('exact proof pixels'), sha256 = createHash('sha256').update(image).digest('hex');
  writeFileSync(join(home, destination), image);
  const original = join(root, 'retired', 'proof.png'), locations: EvidenceLocations = { version: 1, images: [{ original, aliases: ['../retired/proof.png'], destination, sha256 }] };
  const immutableReport = JSON.stringify({ exactHead: 'historical-head', screenshots: [{ path: original, sha256 }] });
  assert.deepEqual(relocatedImageBytes(root, original, { locations, home }), image);
  assert.deepEqual(relocatedImageBytes(root, '../retired/proof.png', { locations, home }), image);
  assert.equal(JSON.parse(immutableReport).screenshots[0].sha256, sha256);
  assert.equal(relocatedImageBytes(root, 'other.png', { locations, home }), undefined);
  mkdirSync(join(root, 'retired')); writeFileSync(original, 'changed original');
  assert.throws(() => relocatedImageBytes(root, original, { locations, home }), /Historical image changed/);
  rmSync(original); writeFileSync(join(home, destination), 'corrupt');
  assert.throws(() => relocatedImageBytes(root, original, { locations, home }), /hash mismatch/);
});
test('ambiguous mappings and traversal are rejected; JSON proof bytes cannot be redirected', () => {
  const entry = { original: 'old.png', aliases: [], destination: '../elsewhere.png', sha256: 'a'.repeat(64) };
  assert.throws(() => relocatedImageBytes('.', 'old.png', { locations: { version: 1, images: [entry] } }), /Invalid image relocation/);
  assert.throws(() => relocatedImageBytes('.', 'old.png', { locations: { version: 1, images: [entry, entry] } }), /Ambiguous/);
  assert.equal(relocatedImageBytes('.', 'proof.json', { locations: { version: 1, images: [entry] } }), undefined);
});
