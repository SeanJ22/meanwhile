import { randomUUID } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { LocalFileArtifactReader, READER_MANIFEST_KEY, immutableKey, sameBytes, type ReaderArtifactStore } from "./edge-store.ts";
import type { ReaderManifest } from "./edge-artifacts.ts";

export class LocalFileArtifactStore extends LocalFileArtifactReader implements ReaderArtifactStore {
  async writeManifest(
    manifest: ReaderManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }> {
    const path = this.path(READER_MANIFEST_KEY);
    mkdirSync(dirname(path), { recursive: true });
    const lock = `${path}.lock`;
    let descriptor: number | undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { descriptor = openSync(lock, "wx"); writeFileSync(descriptor, String(process.pid)); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const pid = Number(readFileSync(lock, "utf8"));
          if (Number.isSafeInteger(pid) && pid > 0) {
            try { process.kill(pid, 0); }
            catch (held) { if ((held as NodeJS.ErrnoException).code === "ESRCH") unlinkSync(lock); }
          }
        } catch { /* Another writer may already have released the lock. */ }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
    if (descriptor === undefined) throw new Error("READER_MANIFEST_BUSY");
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      let etag: string | null;
      try { etag = this.etagOf(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; etag = null; }
      if (etag !== expectedEtag) return { modified: false, etag };
      writeFileSync(temporary, JSON.stringify(manifest), { flag: "wx" });
      renameSync(temporary, path);
      return { modified: true, etag: this.etagOf(path) };
    } finally {
      closeSync(descriptor);
      try { unlinkSync(temporary); } catch { /* The atomic rename consumed it. */ }
      unlinkSync(lock);
    }
  }

  async putImmutable(bytes: Uint8Array, suffix: "json" | "json.gz"): Promise<string> {
    const key = immutableKey(bytes, suffix);
    const path = this.path(key);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, bytes, { flag: "wx" });
    try {
      try { linkSync(temporary, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        sameBytes(new Uint8Array(readFileSync(path)), bytes);
      }
    } finally { unlinkSync(temporary); }
    return key;
  }
}
