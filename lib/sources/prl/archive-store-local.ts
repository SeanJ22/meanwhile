import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import {
  assertSafeObjectKey,
  resolveS3ArchiveStore,
  type PrlArchiveStore,
  type PrlObjectMeta,
} from "./archive-store.ts";

/**
 * The on-disk archive store, for tests, measurement and manual runs only. It is
 * deliberately not on the standing runner's import path, which writes only to
 * object storage.
 */
export class LocalFileArchiveStore implements PrlArchiveStore {
  readonly kind = "local-file" as const;
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  private path(key: string): string {
    assertSafeObjectKey(key);
    return join(this.root, ...key.split("/"));
  }

  async put(key: string, body: Uint8Array, contentType?: string): Promise<PrlObjectMeta> {
    const file = this.path(key);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    const etag = createHash("md5").update(body).digest("hex");
    return { key, size: body.byteLength, etag, contentType };
  }

  async get(key: string): Promise<Uint8Array | null> {
    const file = this.path(key);
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
  }

  async head(key: string): Promise<PrlObjectMeta | null> {
    const file = this.path(key);
    if (!existsSync(file)) return null;
    return { key, size: statSync(file).size };
  }

  async list(prefix: string): Promise<PrlObjectMeta[]> {
    const out: PrlObjectMeta[] = [];
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else {
          const key = relative(this.root, full).split(sep).join("/");
          if (key.startsWith(prefix)) out.push({ key, size: statSync(full).size });
        }
      }
    };
    walk(this.root);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
}

/** The default on-disk root for the local store; override with `PRL_ARCHIVE_ROOT`. */
export function defaultArchiveRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.PRL_ARCHIVE_ROOT ?? join(process.cwd(), "data", "prl", "archive");
}

/**
 * Resolves an archive store for a non-routine caller: the Neon bucket when
 * configured, otherwise the durable local store.
 */
export function resolvePrlArchiveStore(env: NodeJS.ProcessEnv = process.env): PrlArchiveStore {
  try {
    return resolveS3ArchiveStore(env);
  } catch {
    return new LocalFileArchiveStore(defaultArchiveRoot(env));
  }
}
