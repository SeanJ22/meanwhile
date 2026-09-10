import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { packReaderEvidence } from "../../lib/holdings/reader-census.ts";

const READER_EVIDENCE_PATTERN = /^docs\/evidence\/reader-last-mile-[a-z0-9-]+\.json$/;
const FINAL_PACK_PATH = "docs/evidence/reader-last-mile-final-pack.json";

export const READER_FINAL_PACKAGE_TARGETS = [
  "docs/evidence/reader-last-mile-bodies.json",
  "docs/evidence/reader-last-mile-final-agenda.json",
  "docs/evidence/reader-last-mile-final-ask-exhaustive.json",
  "docs/evidence/reader-last-mile-final-ballot-ask.json",
  "docs/evidence/reader-last-mile-final-ballot.json",
  "docs/evidence/reader-last-mile-final-build-receipt.json",
  "docs/evidence/reader-last-mile-final-bundle.json",
  "docs/evidence/reader-last-mile-final-candidate-profiles-ask.json",
  "docs/evidence/reader-last-mile-final-closure.json",
  "docs/evidence/reader-last-mile-final-delta-components.json",
  "docs/evidence/reader-last-mile-final-delta-routes.json",
  "docs/evidence/reader-last-mile-final-federal-money-ask.json",
  "docs/evidence/reader-last-mile-final-key-votes-ask.json",
  "docs/evidence/reader-last-mile-final-meeting-knowledge-ask.json",
  "docs/evidence/reader-last-mile-final-meeting-routes.json",
  "docs/evidence/reader-last-mile-final-meetings-ask.json",
  "docs/evidence/reader-last-mile-final-money-ask.json",
  "docs/evidence/reader-last-mile-final-portraits.json",
  "docs/evidence/reader-last-mile-final-render.json",
  "docs/evidence/reader-last-mile-final-routes.json",
  "docs/evidence/reader-last-mile-surface-witnesses.json",
] as const;

function assertFrozenReaderPackageTargets(targets: readonly string[]): void {
  assert.deepEqual(
    targets,
    READER_FINAL_PACKAGE_TARGETS,
    "The explicit Reader packaging denominator must equal the exact frozen 21 logical production proof targets",
  );
}

export function parseReaderPackageArguments(argv: readonly string[]): readonly string[] {
  assert.equal(
    argv.length,
    1,
    "Pass the complete explicit packaging denominator once via --targets=path,path; implicit or inherited targets are forbidden.",
  );
  const argument = argv[0];
  assert.ok(
    argument?.startsWith("--targets="),
    "Pass the complete explicit packaging denominator via --targets=path,path.",
  );
  const targets = argument.slice("--targets=".length).split(",").map((path) => path.trim());
  assert.ok(targets.length > 0 && targets.every(Boolean), "The explicit Reader packaging denominator is empty");
  for (const target of targets) {
    assert.match(target, READER_EVIDENCE_PATTERN, `Reader package target is outside the named evidence namespace: ${target}`);
    assert.notEqual(target, FINAL_PACK_PATH, "The package manifest cannot package itself");
  }
  assert.equal(new Set(targets).size, targets.length, "The explicit Reader packaging denominator contains duplicates");
  const normalizedTargets = targets.sort();
  assertFrozenReaderPackageTargets(normalizedTargets);
  return normalizedTargets;
}

export function packageReaderEvidence(
  root: string,
  targets: readonly string[],
): {
  readonly formatVersion: 1;
  readonly rule: string;
  readonly files: readonly ReturnType<typeof packReaderEvidence>[];
} {
  const normalizedTargets = [...targets];
  assert.ok(normalizedTargets.length, "The explicit Reader packaging denominator is empty");
  assert.deepEqual(
    normalizedTargets,
    [...normalizedTargets].sort(),
    "Reader package targets must be in deterministic lexical order",
  );
  assert.equal(new Set(normalizedTargets).size, normalizedTargets.length, "Reader package targets contain duplicates");
  assertFrozenReaderPackageTargets(normalizedTargets);
  for (const target of normalizedTargets) {
    assert.match(target, READER_EVIDENCE_PATTERN, `Reader package target is outside the named evidence namespace: ${target}`);
    assert.notEqual(target, FINAL_PACK_PATH, "The package manifest cannot package itself");
    assert.ok(
      existsSync(resolve(root, target)),
      `Reader package target must exist as fresh plain evidence before any packaging begins: ${target}`,
    );
  }

  const files = normalizedTargets.map((target) => packReaderEvidence(root, target));
  const manifest = {
    formatVersion: 1 as const,
    rule: "Only the explicitly enumerated fresh proof set is packaged. Original bytes and hashes are preserved with zero gzip modification time; no closure receipt is inherited or rewritten.",
    files,
  };
  writeFileSync(resolve(root, FINAL_PACK_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const main = typeof process.argv[1] === "string" &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (main) {
  const targets = parseReaderPackageArguments(process.argv.slice(2));
  console.log(JSON.stringify(packageReaderEvidence(process.cwd(), targets), null, 2));
}
