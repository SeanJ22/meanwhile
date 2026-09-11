import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readReaderEvidence,
  type ReaderCensus,
} from "../../lib/holdings/reader-census.ts";
import { configuredReaderProofPath } from "../../lib/holdings/reader-proof-environment.ts";
import { bodyRenderProof } from "../../scripts/lib/reader-body-render-proof.ts";
import {
  prepareReaderProofRuntime,
  requiredPreparedReaderProofMeetingsAuthority,
} from "../../scripts/lib/reader-proof-runtime.ts";

const DEFAULT_CENSUS = "docs/evidence/reader-last-mile-current.json";
const DEFAULT_OUTPUT = "docs/evidence/reader-last-mile-bodies.json";

export function readerBodyEvidencePaths(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { readonly census: string; readonly output: string } {
  return {
    census: configuredReaderProofPath(environment, "READER_FINAL_PREPARED_CENSUS", DEFAULT_CENSUS),
    output: configuredReaderProofPath(environment, "READER_PROOF_OUTPUT", DEFAULT_OUTPUT),
  };
}

export async function generateReaderBodyEvidence(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  await prepareReaderProofRuntime();
  const paths = readerBodyEvidencePaths(environment);
  const prepared = JSON.parse(
    readReaderEvidence(process.cwd(), paths.census).toString("utf8"),
  ) as ReaderCensus;
  const result = await bodyRenderProof(
    process.cwd(),
    prepared,
    requiredPreparedReaderProofMeetingsAuthority(),
  );
  writeFileSync(paths.output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ cases: result.cases.length, failures: result.failures.length, firstFailures: result.failures.slice(0, 10), unsupported: result.unsupported }, null, 2));
  assert.equal(result.failures.length, 0);
}

const main = typeof process.argv[1] === "string" &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (main) await generateReaderBodyEvidence();
