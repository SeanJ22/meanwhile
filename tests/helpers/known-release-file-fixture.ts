import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import type { KnownRelease } from "../../lib/sources/known-release.ts";
import type { KnownReleaseFile } from "../../lib/sources/known-release-file.ts";

const directories: string[] = [];
after(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }); });

export function knownReleaseFileFixture(release: KnownRelease): KnownReleaseFile {
  const directory = mkdtempSync(join(tmpdir(), "meanwhile-release-fixture-"));
  directories.push(directory);
  const path = join(directory, "source.bin");
  const { bytes, ...metadata } = release;
  writeFileSync(path, bytes);
  return { ...metadata, path, byteLength: bytes.byteLength, raw: { vaultKey: `fixture/${release.sha256}`, rawHash: release.sha256, byteLength: bytes.byteLength },
    dispose: async () => { rmSync(directory, { recursive: true, force: true }); } };
}
