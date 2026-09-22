/** Resolve relocated proof images without changing a byte of historical reports. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export interface EvidenceLocation {
  original: string;
  aliases: string[];
  destination: string;
  sha256: string;
}
export interface EvidenceLocations { version: 1; images: EvidenceLocation[] }
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const normalized = (p: string) => p.replaceAll('\\', '/');
const homes = new Map<string, string>();

/** The existing machine evidence home is beside main, not beside a temporary worktree. */
export function permanentEvidenceHome(root: string): string {
  const key = resolve(root), prior = homes.get(key);
  if (prior) return prior;
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (!existsSync(join(common, 'HEAD'))) throw new Error('Cannot locate the shared Git evidence home');
  const home = join(dirname(dirname(common)), 'meanwhile-evidence');
  homes.set(key, home); return home;
}

/** Undefined means ordinary evidence: keep its existing reader and validation. */
export function relocatedImageBytes(root: string, path: string, options: { locations?: EvidenceLocations; home?: string } = {}): Buffer | undefined {
  if (!path.toLowerCase().endsWith('.png')) return undefined;
  const manifest = join(root, 'data', 'ops', 'evidence-locations.json');
  if (!options.locations && !existsSync(manifest)) return undefined;
  const locations: EvidenceLocations = options.locations ?? JSON.parse(readFileSync(manifest, 'utf8'));
  if (locations.version !== 1 || !Array.isArray(locations.images)) throw new Error('Invalid evidence location manifest');
  const matches = locations.images.filter(e => [e.original, ...e.aliases].some(alias => normalized(alias) === normalized(path)));
  if (!matches.length) return undefined;
  if (matches.length !== 1) throw new Error(`Ambiguous historical image location: ${path}`);
  const e = matches[0]!;
  if (!/^[a-f0-9]{64}$/.test(e.sha256) || !/^reader-last-mile\/[a-z0-9-]+\/[a-zA-Z0-9_.-]+\.png$/.test(e.destination)) throw new Error('Invalid image relocation binding');
  const home = realpathSync(options.home ?? permanentEvidenceHome(root));
  const target = realpathSync(join(home, e.destination));
  const rel = relative(home, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Relocated image escapes the permanent evidence home');
  const bytes = readFileSync(target);
  if (hash(bytes) !== e.sha256) throw new Error(`Relocated image hash mismatch: ${path}`);
  // A surviving original must agree. A changed original must not be hidden by a backup fallback.
  const original = isAbsolute(e.original) ? e.original : resolve(root, e.original);
  if (existsSync(original) && hash(readFileSync(original)) !== e.sha256) throw new Error(`Historical image changed: ${path}`);
  return bytes;
}
