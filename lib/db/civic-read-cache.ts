import { createHash } from "node:crypto";

export interface CivicRowVersion { readonly key: string; readonly etag: string }
interface Entry<T> { readonly etag: string; readonly value: T }
interface CacheIO {
  readonly read: (key: string) => Promise<string | null>;
  readonly write: (key: string, saved: string) => Promise<void>;
  readonly readCheckpoint?: (key: string) => Promise<string | null>;
  readonly writeCheckpoint?: (key: string, saved: string) => Promise<void>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** A held copy that does not answer this fast is a miss: the database read goes ahead without it. */
const CIVIC_READ_CACHE_LOOKUP_MS = 2_000;
/** A read waits this long at most for its copy to be saved; a slower save finishes on its own. */
const CIVIC_READ_CACHE_SAVE_WAIT_MS = 1_000;
async function boundedWait(work: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, CIVIC_READ_CACHE_SAVE_WAIT_MS); })]);
  clearTimeout(timer);
}

/** Disposable runner copies. A fresh content fingerprint decides every use. */
export class CivicReadCache {
  private readonly io: CacheIO;
  constructor(io: CacheIO) { this.io = io; }

  /** Rows already owned by a standing job must not be evicted by unrelated source copies. */
  jobState(): CivicReadCache {
    return new CivicReadCache({ ...this.io,
      read: this.io.readCheckpoint ?? this.io.read,
      write: this.io.writeCheckpoint ?? this.io.write });
  }

  private async read<T>(key: string, checkpoint = false): Promise<Entry<T> | null> {
    try {
      const raw = await (checkpoint ? this.io.readCheckpoint ?? this.io.read : this.io.read)(hash(key));
      if (raw === null) return null;
      const saved = JSON.parse(raw);
      if (typeof saved.body !== "string" || hash(saved.body) !== saved.digest) return null;
      const entry = JSON.parse(saved.body);
      return typeof entry.etag === "string" && Object.hasOwn(entry, "value") ? entry : null;
    } catch { return null; }
  }

  private async save<T>(key: string, entry: Entry<T>, checkpoint = false): Promise<void> {
    try {
      const body = JSON.stringify(entry);
      await (checkpoint ? this.io.writeCheckpoint ?? this.io.write : this.io.write)(hash(key), JSON.stringify({ digest: hash(body), body }));
    } catch { /* A failed disposable copy never changes the actual read. */ }
  }

  /** A job's own continuation, never reader truth. Source hashes decide whether it still applies. */
  async readCheckpoint<T>(namespace: string, key: string): Promise<T | null> {
    return (await this.read<T>(namespace + ":" + key, true))?.value ?? null;
  }

  async checkpoint<T>(namespace: string, key: string, value: T, etag = hash(JSON.stringify(value))): Promise<void> {
    await this.save(namespace + ":" + key, { etag, value }, true);
  }

  /** One statement can return either the changed value or confirmation of the held revision. */
  async row<T>(input: { readonly namespace: string; readonly key: string;
    readonly source?: { readonly namespace: string; readonly project: (value: T) => T;
      readonly newer?: (sourceEtag: string, heldEtag: string) => boolean };
    readonly current: (etag: string | null, held?: T) => Promise<{ readonly etag: string; readonly value: T } | { readonly etag: string; readonly unchanged: true } | null> }): Promise<T | null> {
    const key = input.namespace + ":" + input.key;
    let held = await this.read<T>(key);
    let projectedSource = false;
    if (input.source && (!held || input.source.newer)) {
      const source = await this.read<T>(input.source.namespace + ":" + input.key);
      if (source && (!held || input.source.newer?.(source.etag, held.etag))) {
        held = { etag: source.etag, value: input.source.project(source.value) };
        projectedSource = true;
      }
    }
    const current = await input.current(held?.etag ?? null, held?.value);
    if (current === null) return null;
    if (typeof current.etag !== "string" || current.etag.length === 0) throw new Error("A stored row read returned no database version");
    if ("unchanged" in current) {
      if (held?.etag !== current.etag) throw new Error("A changed-row read confirmed an unavailable revision");
      if (projectedSource) await this.save(key, held);
      return held.value;
    }
    await boundedWait(this.save(key, current));
    return current.value;
  }

  /** Read only rows whose content fingerprint differs; freshen small mutable headers separately. */
  async rows<T, V extends CivicRowVersion>(input: {
    readonly namespace: string;
    readonly keys: readonly string[];
    readonly versions: (keys: readonly string[]) => Promise<readonly V[]>;
    readonly values: (keys: readonly string[]) => Promise<readonly T[]>;
    readonly keyOf: (value: T) => string;
    readonly etagOf?: (value: T) => string;
    /** Event-derived fields are fresh even while the owning row is unchanged. */
    readonly freshen?: (value: T, version: V) => T;
  }): Promise<readonly T[]> {
    if (input.keys.length === 0) return [];
    const versions = await input.versions([...new Set(input.keys)]);
    if (versions.some(version => typeof version.key !== "string" || typeof version.etag !== "string" || !version.etag.length)) {
      throw new Error("A stored row read returned no database version");
    }
    const result = new Map<string, T>();
    const missing: V[] = [];
    await Promise.all(versions.map(async version => {
      const held = await this.read<T>(input.namespace + ":" + version.key);
      if (held && held.etag === version.etag && input.keyOf(held.value) === version.key) {
        result.set(version.key, input.freshen ? input.freshen(held.value, version) : held.value);
      } else missing.push(version);
    }));
    if (missing.length > 0) {
      const keys = missing.map(version => version.key);
      const values = await input.values(keys);
      // An UPDATE racing the whole read must never label old bytes with its
      // newer etag. Return the actual read, but keep only stable row copies.
      const after = new Map((await input.versions(keys)).map(version => [version.key, version]));
      const before = new Map(missing.map(version => [version.key, version.etag]));
      const saves: Promise<void>[] = [];
      for (const value of values) {
        const key = input.keyOf(value);
        const version = after.get(key);
        result.set(key, version && input.freshen ? input.freshen(value, version) : value);
        if (input.etagOf || before.get(key) !== undefined && before.get(key) === version?.etag) {
          saves.push(this.save(input.namespace + ":" + key, { etag: input.etagOf?.(value) ?? before.get(key)!, value }));
        }
      }
      await boundedWait(Promise.all(saves));
    }
    return input.keys.flatMap(key => result.has(key) ? [result.get(key)!] : []);
  }
}

const MEMORY_BYTES = 32 * 1024 * 1024;
const memory = new Map<string, string>();
let memoryBytes = 0;
const memoryIO: CacheIO = {
  read: async key => {
    const value = memory.get(key);
    if (value !== undefined) { memory.delete(key); memory.set(key, value); }
    return value ?? null;
  },
  write: async (key, value) => {
    const bytes = Buffer.byteLength(value);
    if (bytes > MEMORY_BYTES) return;
    memoryBytes -= Buffer.byteLength(memory.get(key) ?? "");
    memory.delete(key);
    while (memoryBytes + bytes > MEMORY_BYTES && memory.size) {
      const oldest = memory.keys().next().value!;
      memoryBytes -= Buffer.byteLength(memory.get(oldest)!); memory.delete(oldest);
    }
    memory.set(key, value); memoryBytes += bytes;
  },
};

/** Every runtime uses the same version check. Runner children share their
 * supervisor's disposable copies; other processes use bounded local copies. */
export function runtimeCivicReadCache(connection = process.env.DATABASE_URL ?? ""): CivicReadCache {
  const endpoint = process.env.WTP_CIVIC_READ_CACHE_URL;
  const token = process.env.WTP_CIVIC_READ_CACHE_TOKEN;
  const namespace = hash(connection);
  if (!endpoint || !token) return new CivicReadCache({
    read: key => memoryIO.read(namespace + key),
    write: (key, value) => memoryIO.write(namespace + key, value),
  });
  const remoteKey = (key: string) => hash(namespace + key);
  return new CivicReadCache({
    read: async key => {
      const response = await fetch(endpoint + "/" + remoteKey(key),
        { headers: { authorization: token }, signal: AbortSignal.timeout(CIVIC_READ_CACHE_LOOKUP_MS) });
      return response.ok ? response.text() : null;
    },
    write: async (key, saved) => {
      await fetch(endpoint + "/" + remoteKey(key), { method: "PUT", body: saved,
        headers: { authorization: token }, signal: AbortSignal.timeout(10_000) });
    },
    readCheckpoint: async key => {
      const response = await fetch(endpoint + "/checkpoint/" + remoteKey(key),
        { headers: { authorization: token }, signal: AbortSignal.timeout(10_000) });
      return response.ok ? response.text() : null;
    },
    writeCheckpoint: async (key, saved) => {
      const response = await fetch(endpoint + "/checkpoint/" + remoteKey(key), { method: "PUT", body: saved,
        headers: { authorization: token }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("The job continuation could not be saved");
    },
  });
}
