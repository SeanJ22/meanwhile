import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CivicRowVersion { readonly key: string; readonly etag: string }
interface Entry<T> { readonly etag: string; readonly value: T }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Disposable runner copies. A fresh database row version decides every use. */
export class CivicReadCache {
  private readonly root: string;
  constructor(root: string) { this.root = root; }
  private path(key: string): string { return join(this.root, hash(key) + ".json"); }

  private async read<T>(key: string): Promise<Entry<T> | null> {
    try {
      const saved = JSON.parse(await readFile(this.path(key), "utf8"));
      if (typeof saved.body !== "string" || hash(saved.body) !== saved.digest) return null;
      const entry = JSON.parse(saved.body);
      return typeof entry.etag === "string" && Object.hasOwn(entry, "value") ? entry : null;
    } catch { return null; }
  }

  private async save<T>(key: string, entry: Entry<T>): Promise<void> {
    const temporary = this.path(key) + "." + randomUUID() + ".tmp";
    try {
      const body = JSON.stringify(entry);
      await mkdir(this.root, { recursive: true });
      await writeFile(temporary, JSON.stringify({ digest: hash(body), body }));
      await rename(temporary, this.path(key));
    } catch { await unlink(temporary).catch(() => {}); }
  }

  /** Read only rows whose database etag differs from the held copy. */
  async rows<T, V extends CivicRowVersion>(input: {
    readonly namespace: string;
    readonly keys: readonly string[];
    readonly versions: (keys: readonly string[]) => Promise<readonly V[]>;
    readonly values: (keys: readonly string[]) => Promise<readonly T[]>;
    readonly keyOf: (value: T) => string;
    /** Event-derived fields are fresh even while the owning row is unchanged. */
    readonly freshen?: (value: T, version: V) => T;
  }): Promise<readonly T[]> {
    if (input.keys.length === 0) return [];
    const versions = await input.versions([...new Set(input.keys)]);
    const result = new Map<string, T>();
    const missing: V[] = [];
    await Promise.all(versions.map(async version => {
      const held = await this.read<T>(input.namespace + ":" + version.key);
      if (held?.etag === version.etag && input.keyOf(held.value) === version.key) {
        result.set(version.key, input.freshen ? input.freshen(held.value, version) : held.value);
      } else missing.push(version);
    }));
    if (missing.length > 0) {
      const keys = missing.map(version => version.key);
      const values = await input.values(keys);
      // An UPDATE racing the whole read must never label old bytes with its
      // newer etag. Return the actual read, but keep only stable row copies.
      const after = new Map((await input.versions(keys)).map(version => [version.key, version.etag]));
      const before = new Map(missing.map(version => [version.key, version.etag]));
      await Promise.all(values.map(async value => {
        const key = input.keyOf(value);
        result.set(key, value);
        if (before.get(key) !== undefined && before.get(key) === after.get(key)) {
          await this.save(input.namespace + ":" + key, { etag: before.get(key)!, value });
        }
      }));
    }
    return input.keys.flatMap(key => result.has(key) ? [result.get(key)!] : []);
  }
}

/** Serving processes keep their existing in-memory caches; runner children
 * share disposable copies across passes and commits in their own checkout. */
export function runtimeCivicReadCache(): CivicReadCache | null {
  if (!process.env.DATABASE_URL ||
      !(process.env.WTP_RUNTIME_AUTHORITY_CAPABILITY || process.env.WTP_RUNTIME_MODE === "staging")) return null;
  return new CivicReadCache(join(process.cwd(), ".runtime", "civic-read-cache", hash(process.env.DATABASE_URL)));
}
