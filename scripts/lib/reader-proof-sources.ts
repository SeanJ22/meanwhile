import { buildReaderCensus, readerSourceFingerprint, type ReaderSourceHash } from "../../lib/holdings/reader-census.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Execution receipts bind both executable dependencies and the canonical holding bytes. */
export function readerProofSources(root = process.cwd()): ReaderSourceHash[] {
  const census = buildReaderCensus(root);
  const hashes = new Map(readerSourceFingerprint(root).map(source => [source.path, source.sha256]));
  for (const holding of census.holdings) if (holding.sha256) hashes.set(holding.path, holding.sha256);
  hashes.set("lib/holdings/datasets.ts", census.registrySha256);
  for (const path of ["next.config.ts", "package.json", "pnpm-lock.yaml"]) hashes.set(path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex"));
  return [...hashes].sort(([a], [b]) => a.localeCompare(b)).map(([path, sha256]) => ({ path, sha256 }));
}
