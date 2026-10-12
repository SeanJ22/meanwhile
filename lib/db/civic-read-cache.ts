import { createHash } from "node:crypto";

export interface CivicRowVersion { readonly key: string; readonly etag: string }
interface Entry<T> { readonly etag: string; readonly value: T }
interface CacheIO {
  readonly read: (key: string) => Promise<string | null>;
  readonly write: (key: string, saved: string) => Promise<void>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Disposable runner copies. A fresh database row version decides every use. */
export class CivicReadCache {
  private readonly io: CacheIO;
  constructor(io: CacheIO) { this.io = io; }

  private async read<T>(key: string): Promise<Entry<T> | null> {
    try {
      const raw = await this.io.read(hash(key));
      if (raw === null) return null;
      const saved = JSON.parse(raw);
      if (typeof saved.body !== "string" || hash(saved.body) !== saved.digest) return null;
      const entry = JSON.parse(saved.body);
      return typeof entry.etag === "string" && Object.hasOwn(entry, "value") ? entry : null;
    } catch { return null; }
  }

  private async save<T>(key: string, entry: Entry<T>): Promise<void> {
    try {
      const body = JSON.stringify(entry);
      await this.io.write(hash(key), JSON.stringify({ digest: hash(body), body }));
    } catch { /* A failed disposable copy never changes the actual read. */ }
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
  const endpoint = process.env.WTP_CIVIC_READ_CACHE_URL;
  const token = process.env.WTP_CIVIC_READ_CACHE_TOKEN;
  if (!process.env.DATABASE_URL || !endpoint || !token) return null;
  return new CivicReadCache({
    read: async key => {
      const response = await fetch(endpoint + "/" + key,
        { headers: { authorization: token }, signal: AbortSignal.timeout(10_000) });
      return response.ok ? response.text() : null;
    },
    write: async (key, saved) => {
      await fetch(endpoint + "/" + key, { method: "PUT", body: saved,
        headers: { authorization: token } });
    },
  });
}
