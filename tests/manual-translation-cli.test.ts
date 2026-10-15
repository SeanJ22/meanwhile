import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { translationPackage } from "../lib/translate/publication.ts";
import { translationHash, translationRecordIssue, type MeasureTranslation } from "../lib/translate/records.ts";
import { measureReference } from "./helpers/measure-reference.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";

test("manual package and worker-result commands refuse translation imports, including disguised contracts and fabricated quotes", async () => {
  const now = "2026-10-15T16:00:00Z", text = "Libraries receive funding. A YES vote adopts the levy. A NO vote retains current law.";
  const sourceHash = translationHash(text), subjectId = "measure:1";
  const capture: WorkerPublicationCapture = { evidence: { artifactId: "official", acquiredByAttemptId: "held", sourceId: "State election authority",
    methodRouteId: "official-text", canonicalUrl: "https://elections.example.gov/measure-1", text,
    contentHash: `sha256-${sourceHash}`, retrievedAt: now }, observedAt: now, partial: false, httpStatus: 200, transport: "REACHABLE" };
  const sourceReference = measureReference(capture.evidence);
  const measure = { contestId: subjectId, whatItDoes: "Libraries receive funding.", yesMeans: "A YES vote adopts the levy.",
    noMeans: "A NO vote retains current law.", parts: [], sourceUrl: sourceReference.sourceUrl, sourceHash, writtenAt: now };
  const sentences = ["whatItDoes", "yesMeans", "noMeans"].map(field => ({ field, text: measure[field as "whatItDoes"], quote: measure[field as "whatItDoes"] }));
  const record: MeasureTranslation = { kind: "MEASURE", id: `translation:${subjectId}`, subjectId,
    ocdId: "ocd-division/country:us/state:oh", sourceUrl: sourceReference.sourceUrl, sourceHash, sourceTextHash: sourceHash,
    sourceReference, retrievedAt: now, writtenAt: now, writerModel: "writer", checkerModel: "checker", playbookVersion: "a".repeat(64),
    measure, sentences, checked: sentences.map(({ field, text }) => ({ field, text, supported: true })) };
  const input = translationPackage({ record, captures: [{ ...capture, sourceReference }], now });
  sentences[0].quote = "An invented official statement.";
  assert.equal(translationRecordIssue(record), null);
  assert.match(translationRecordIssue(record, text)!, /source passage/);
  const directory = await mkdtemp(resolve(tmpdir(), "manual-translation-refusal-"));
  try {
    const packagePath = resolve(directory, "package.json");
    const run = (args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
      "--import", "./tests/helpers/install-fixture-doors.ts", "scripts/promote-manual-civic-projection.mts", ...args], {
      env: { ...process.env, NODE_ENV: "development", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local",
        DATABASE_URL: "postgresql://local:local@staging.invalid/reader", WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control" },
      encoding: "utf8", timeout: 30_000,
    });
    await writeFile(packagePath, JSON.stringify(input));
    const direct = run(["--contract=plain-english-translations", `--package=${packagePath}`]);
    assert.equal(direct.status, 1); assert.match(direct.stderr, /usage:/); assert.doesNotMatch(direct.stdout, /RECEIPT/);
    const disguised = run(["--contract=government-budgets", `--package=${packagePath}`]);
    assert.equal(disguised.status, 1); assert.match(disguised.stderr, /TRANSLATION_REQUIRES_CHECKED_SOURCE_PUBLICATION/);
    await writeFile(packagePath, JSON.stringify({ ...input, payload: { ...input.payload, kind: "government-budgets" } }));
    const identity = run(["--contract=government-budgets", `--package=${packagePath}`]);
    assert.equal(identity.status, 1); assert.match(identity.stderr, /TRANSLATION_REQUIRES_CHECKED_SOURCE_PUBLICATION/);
    await writeFile(packagePath, JSON.stringify({ ...input, contractId: "government-budgets" }));
    const payload = run(["--contract=government-budgets", `--package=${packagePath}`]);
    assert.equal(payload.status, 1); assert.match(payload.stderr, /TRANSLATION_REQUIRES_CHECKED_SOURCE_PUBLICATION/);
    const worker = run(["--contract=plain-english-translations", "--worker-results=held-result"]);
    assert.equal(worker.status, 1); assert.match(worker.stderr, /WORKER_PUBLICATION_CONTRACT_ARGUMENT_INVALID/);
    for (const refused of [disguised, identity, payload, worker]) assert.doesNotMatch(refused.stdout, /RECEIPT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
