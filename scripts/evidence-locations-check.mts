/** Offline image-location verification. No proof renewal or live reads. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { relocatedImageBytes, type EvidenceLocations } from '../lib/holdings/evidence-location.ts';
import { floored } from '../lib/ops/denominator-floor.ts';
const root = resolve(process.argv[2] ?? '.');
const locations: EvidenceLocations = JSON.parse(readFileSync(resolve(root, 'data/ops/evidence-locations.json'), 'utf8'));
const names = new Set<string>();
let verified = 0;
for (const image of locations.images) {
  for (const path of [image.original, ...image.aliases]) {
    const key = path.replaceAll('\\', '/');
    if (names.has(key)) throw new Error(`Duplicate evidence alias: ${path}`);
    names.add(key);
    const bytes = relocatedImageBytes(root, path, { locations });
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error(`Image location did not preserve bytes: ${path}`);
    verified++;
  }
}
const expectedPaths = locations.images.reduce((n, image) => n + 1 + image.aliases.length, 0);
const coverage = floored('verified image locations', 'evidence-locations manifest', expectedPaths, verified);
console.log(JSON.stringify({ images: locations.images.length, verifiedPaths: verified, coverage, proofRenewals: 0, productWrites: 0 }));
