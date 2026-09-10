import assert from "node:assert/strict";
import test from "node:test";

import {
  freshReaderClosureReceipt,
  readerCensusOutputPaths,
} from "../scripts/lib/reader-census-output-contract.ts";

const census = "docs/evidence/reader-last-mile-final-closure.json";

test("Reader census preserves its historical side-output defaults", () => {
  assert.deepEqual(readerCensusOutputPaths([], census), {
    activePortraits: "docs/evidence/reader-last-mile-active-portraits.json",
    renderedComponents: "docs/evidence/reader-last-mile-final-closure-components.json",
    bundle: "docs/evidence/reader-last-mile-bundle.json",
    bundleDescriptor: "docs/evidence/reader-last-mile-bundle-descriptor.json",
  });
});

test("Reader census redirects every side output through explicit bounded paths", () => {
  assert.deepEqual(readerCensusOutputPaths([
    "--project",
    "--active-portraits-output", "docs/evidence/reader-last-mile-rehearsal-active-portraits.json",
    "--proof-sources-output", ".runtime/reader-last-mile-rehearsal-proof-sources.json",
    "--render-components",
    "--render-components-output", "docs/evidence/reader-last-mile-rehearsal-components.json",
    "--build-receipt", "docs/evidence/reader-last-mile-rehearsal-build-receipt.json",
    "--bundle-output", "docs/evidence/reader-last-mile-rehearsal-bundle.json",
    "--bundle-descriptor-output", "docs/evidence/reader-last-mile-rehearsal-bundle-descriptor.json",
  ], census), {
    activePortraits: "docs/evidence/reader-last-mile-rehearsal-active-portraits.json",
    renderedComponents: "docs/evidence/reader-last-mile-rehearsal-components.json",
    bundle: "docs/evidence/reader-last-mile-rehearsal-bundle.json",
    bundleDescriptor: "docs/evidence/reader-last-mile-rehearsal-bundle-descriptor.json",
    proofSources: ".runtime/reader-last-mile-rehearsal-proof-sources.json",
  });
});

test("Reader census output redirection fails closed on partial, unused, unsafe, duplicate, or colliding destinations", () => {
  assert.throws(
    () => readerCensusOutputPaths(["--bundle-output", "docs/evidence/reader-last-mile-rehearsal-bundle.json"], census),
    /require --build-receipt|must be passed together/,
  );
  assert.throws(
    () => readerCensusOutputPaths(["--render-components-output", "docs/evidence/reader-last-mile-rehearsal-components.json"], census),
    /requires --render-components/,
  );
  assert.throws(
    () => readerCensusOutputPaths(["--project", "--active-portraits-output"], census),
    /requires an explicit path/,
  );
  assert.throws(
    () => readerCensusOutputPaths(["--proof-sources-output", ".runtime/reader-last-mile-proof-sources.json"], census),
    /requires a writing projection run/,
  );
  assert.throws(
    () => readerCensusOutputPaths(["--project", "--check", "--proof-sources-output", ".runtime/reader-last-mile-proof-sources.json"], census),
    /requires a writing projection run/,
  );
  assert.throws(
    () => readerCensusOutputPaths(["--project", "--proof-sources-output"], census),
    /requires an explicit path/,
  );
  assert.throws(
    () => readerCensusOutputPaths(["--project", "--proof-sources-output", "docs/evidence/reader-last-mile-proof-sources.json"], census),
    /scoped ignored Reader runtime JSON path/,
  );
  assert.throws(
    () => readerCensusOutputPaths(
      ["--project", "--proof-sources-output", ".runtime/reader-last-mile-proof-sources.json"],
      ".runtime/reader-last-mile-proof-sources.json",
    ),
    /cannot overwrite a census artifact/,
  );
  assert.throws(
    () => readerCensusOutputPaths(["--render-components", "--render-components-output", "..\/outside.json"], census),
    /immutable Reader evidence namespace/,
  );
  assert.throws(
    () => readerCensusOutputPaths([
      "--render-components",
      "--render-components-output", "docs/evidence/reader-last-mile-same.json",
      "--render-components-output", "docs/evidence/reader-last-mile-other.json",
    ], census),
    /at most once/,
  );
  assert.throws(
    () => readerCensusOutputPaths([
      "--render-components",
      "--render-components-output", census,
    ], census),
    /cannot overwrite a census artifact/,
  );
});

test("fresh Reader closure serialization cannot acquire an inheritance seam", () => {
  const input = {
    censusPath: census,
    censusSha256: "a".repeat(64),
    holdingsDigest: "b".repeat(64),
    registrySha256: "c".repeat(64),
    sourceHashes: [{ path: "app/page.tsx", sha256: "d".repeat(64) }],
    evidenceHashes: [{ path: "docs/evidence/reader-last-mile-routes.json", sha256: "e".repeat(64) }],
    executionAuthority: {
      phase: "REHEARSAL" as const,
      evidencePath: "docs/evidence/reader-last-mile-rehearsal-authority.json",
      evidenceSha256: "f".repeat(64),
    },
  };
  const receipt = freshReaderClosureReceipt(input);
  assert.equal(Object.hasOwn(receipt, "inheritance"), false);
  assert.deepEqual(Object.keys(receipt).sort(), [
    "censusPath", "censusSha256", "evidenceHashes", "executionAuthority",
    "formatVersion", "holdingsDigest", "registrySha256", "sourceHashes",
  ]);
  assert.throws(
    () => freshReaderClosureReceipt({
      ...input,
      inheritance: { reportPath: "docs/evidence/reader-last-mile-old.json", reportSha256: "0".repeat(64) },
    } as typeof input),
    /cannot carry inheritance/,
  );
});
