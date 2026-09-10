import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readerBodyEvidencePaths,
} from "../docs/evidence/reader-last-mile-bodies.mts";
import {
  readerCandidateCorpusMapOutput,
} from "../docs/evidence/reader-last-mile-candidate-corpus-map.mts";
import {
  packageReaderEvidence,
  parseReaderPackageArguments,
  READER_FINAL_PACKAGE_TARGETS,
} from "../docs/evidence/reader-last-mile-package-final.mts";
import {
  readerRootBallotEvidencePath,
} from "../docs/evidence/reader-last-mile-root-witnesses.mts";
import {
  readerWitnessRequirementPaths,
} from "../docs/evidence/reader-last-mile-witness-requirements.mts";
import {
  readerPositionEvidencePaths,
} from "../scripts/reader-last-mile-positions.mts";

test("Reader proof generators retain production defaults and accept explicit rehearsal paths", () => {
  assert.deepEqual(readerBodyEvidencePaths({}), {
    census: "docs/evidence/reader-last-mile-current.json",
    output: "docs/evidence/reader-last-mile-bodies.json",
  });
  assert.deepEqual(readerBodyEvidencePaths({
    READER_FINAL_PREPARED_CENSUS: ".runtime/reader-last-mile/final-prepared.json",
    READER_PROOF_OUTPUT: "docs/evidence/reader-last-mile-rehearsal-bodies.json",
  }), {
    census: ".runtime/reader-last-mile/final-prepared.json",
    output: "docs/evidence/reader-last-mile-rehearsal-bodies.json",
  });

  assert.equal(
    readerCandidateCorpusMapOutput({}),
    "docs/evidence/reader-last-mile-candidate-corpus-map.json",
  );
  assert.equal(
    readerCandidateCorpusMapOutput({
      READER_CANDIDATE_CORPUS_MAP_OUTPUT: "docs/evidence/reader-last-mile-rehearsal-candidate-corpus-map.json",
    }),
    "docs/evidence/reader-last-mile-rehearsal-candidate-corpus-map.json",
  );

  assert.deepEqual(readerPositionEvidencePaths({}), {
    candidateCorpusMap: "docs/evidence/reader-last-mile-candidate-corpus-map.json",
    ballotPlan: "docs/evidence/reader-last-mile-ballot-plan.json",
  });
  assert.deepEqual(readerPositionEvidencePaths({
    READER_CANDIDATE_CORPUS_MAP: "docs/evidence/reader-last-mile-rehearsal-candidate-corpus-map.json",
    READER_BALLOT_PLAN: "docs/evidence/reader-last-mile-rehearsal-ballot-plan.json",
  }), {
    candidateCorpusMap: "docs/evidence/reader-last-mile-rehearsal-candidate-corpus-map.json",
    ballotPlan: "docs/evidence/reader-last-mile-rehearsal-ballot-plan.json",
  });

  assert.deepEqual(readerWitnessRequirementPaths({}), {
    census: "docs/evidence/reader-last-mile-current.json",
    components: [
      "docs/evidence/reader-last-mile-current-components.json",
      "docs/evidence/reader-last-mile-bodies.json",
    ],
    output: "docs/evidence/reader-last-mile-witness-requirements.json",
  });
  assert.deepEqual(readerWitnessRequirementPaths({
    READER_FINAL_PREPARED_CENSUS: ".runtime/reader-last-mile/final-prepared.json",
    READER_COMPONENT_EVIDENCE: "docs/evidence/reader-last-mile-final-components.json, docs/evidence/reader-last-mile-rehearsal-bodies.json",
    READER_WITNESS_REQUIREMENTS_OUTPUT: "docs/evidence/reader-last-mile-rehearsal-witness-requirements.json",
  }), {
    census: ".runtime/reader-last-mile/final-prepared.json",
    components: [
      "docs/evidence/reader-last-mile-final-components.json",
      "docs/evidence/reader-last-mile-rehearsal-bodies.json",
    ],
    output: "docs/evidence/reader-last-mile-rehearsal-witness-requirements.json",
  });

  assert.equal(
    readerRootBallotEvidencePath({}),
    "docs/evidence/reader-last-mile-ballot.json",
  );
  assert.equal(
    readerRootBallotEvidencePath({
      READER_BALLOT_EVIDENCE: "docs/evidence/reader-last-mile-rehearsal-ballot.json",
    }),
    "docs/evidence/reader-last-mile-rehearsal-ballot.json",
  );
});

test("Reader proof path overrides fail closed when blank, duplicate, or outside the evidence namespace", () => {
  assert.throws(() => readerBodyEvidencePaths({ READER_PROOF_OUTPUT: " " }), /present but empty/);
  assert.throws(
    () => readerCandidateCorpusMapOutput({ READER_CANDIDATE_CORPUS_MAP_OUTPUT: "" }),
    /present but empty/,
  );
  assert.throws(() => readerPositionEvidencePaths({ READER_BALLOT_PLAN: " " }), /present but empty/);
  assert.throws(
    () => readerWitnessRequirementPaths({ READER_COMPONENT_EVIDENCE: " " }),
    /empty component artifact/,
  );
  assert.throws(
    () => readerWitnessRequirementPaths({
      READER_COMPONENT_EVIDENCE: "docs/evidence/reader-last-mile-a.json,,docs/evidence/reader-last-mile-b.json",
    }),
    /empty component artifact/,
  );
  assert.throws(
    () => readerWitnessRequirementPaths({
      READER_COMPONENT_EVIDENCE: "docs/evidence/reader-last-mile-a.json,docs/evidence/reader-last-mile-a.json",
    }),
    /repeats a component artifact/,
  );
  assert.throws(
    () => readerRootBallotEvidencePath({ READER_BALLOT_EVIDENCE: " " }),
    /present but empty/,
  );
  assert.throws(
    () => readerRootBallotEvidencePath({ READER_BALLOT_EVIDENCE: "..\\outside.json" }),
    /named Reader evidence namespace/,
  );
});

test("Reader final packaging requires a complete explicit deterministic target denominator", () => {
  assert.deepEqual(parseReaderPackageArguments([
    `--targets=${[...READER_FINAL_PACKAGE_TARGETS].reverse().join(",")}`,
  ]), READER_FINAL_PACKAGE_TARGETS);
  assert.throws(() => parseReaderPackageArguments([]), /complete explicit packaging denominator/);
  assert.throws(() => parseReaderPackageArguments(["--reviews=a,b,c,d"]), /--targets=/);
  assert.throws(
    () => parseReaderPackageArguments([
      "--targets=docs/evidence/reader-last-mile-a.json,docs/evidence/reader-last-mile-a.json",
    ]),
    /duplicates/,
  );
  assert.throws(
    () => parseReaderPackageArguments(["--targets=..\\reader-last-mile-a.json"]),
    /outside the named evidence namespace/,
  );
  assert.throws(
    () => parseReaderPackageArguments(["--targets=docs/evidence/reader-last-mile-final-pack.json"]),
    /cannot package itself/,
  );
  assert.throws(
    () => parseReaderPackageArguments([
      `--targets=${READER_FINAL_PACKAGE_TARGETS.slice(0, -1).join(",")}`,
    ]),
    /exact frozen 21 logical production proof targets/,
  );
  assert.throws(
    () => parseReaderPackageArguments([
      `--targets=${[...READER_FINAL_PACKAGE_TARGETS, "docs/evidence/reader-last-mile-extra.json"].join(",")}`,
    ]),
    /exact frozen 21 logical production proof targets/,
  );
});

test("Reader final packaging is lossless and does not rewrite an inherited closure receipt", (context) => {
  const root = mkdtempSync(join(tmpdir(), "reader-last-mile-package-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const evidenceDirectory = join(root, "docs", "evidence");
  mkdirSync(evidenceDirectory, { recursive: true });
  const targets = READER_FINAL_PACKAGE_TARGETS;
  const sourceBytes = new Map(targets.map((path, index) => [
    path,
    Buffer.from(`${JSON.stringify({ index, path })}\n`),
  ]));
  for (const [path, bytes] of sourceBytes) writeFileSync(join(root, path), bytes);
  const receiptPath = join(evidenceDirectory, "reader-last-mile-closure-receipt.json");
  const receiptBytes = Buffer.from("{\"historical\":true}\n");
  writeFileSync(receiptPath, receiptBytes);

  const manifest = packageReaderEvidence(root, targets);

  assert.deepEqual(manifest.files.map((file) => file.path), targets.map((path) => `${path}.gz`));
  for (const [path, bytes] of sourceBytes) {
    assert.equal(existsSync(join(root, path)), false);
    assert.deepEqual(gunzipSync(readFileSync(join(root, `${path}.gz`))), bytes);
    assert.equal(existsSync(join(root, `${path}.pack.json`)), true);
  }
  assert.deepEqual(readFileSync(receiptPath), receiptBytes);
  const writtenManifest = JSON.parse(readFileSync(
    join(evidenceDirectory, "reader-last-mile-final-pack.json"),
    "utf8",
  )) as typeof manifest;
  assert.deepEqual(writtenManifest, manifest);
});

test("Reader final packaging preflights every source before mutating any source", (context) => {
  const root = mkdtempSync(join(tmpdir(), "reader-last-mile-package-preflight-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const evidenceDirectory = join(root, "docs", "evidence");
  mkdirSync(evidenceDirectory, { recursive: true });
  const present = READER_FINAL_PACKAGE_TARGETS[0];
  const missing = READER_FINAL_PACKAGE_TARGETS.at(-1)!;
  for (const target of READER_FINAL_PACKAGE_TARGETS.slice(0, -1)) {
    writeFileSync(join(root, target), "{}\n");
  }

  assert.throws(
    () => packageReaderEvidence(root, READER_FINAL_PACKAGE_TARGETS),
    /must exist as fresh plain evidence before any packaging begins/,
  );
  assert.equal(existsSync(join(root, present)), true);
  assert.equal(existsSync(join(root, `${present}.gz`)), false);
  assert.equal(existsSync(join(root, missing)), false);
});
