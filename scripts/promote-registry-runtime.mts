/**
 * Promote one owner-reviewed registry runtime package to the permanent plane.
 * This command never writes tracked files. Static registry identities remain
 * reviewed software inputs; mutable body/contact/photo bindings arrive only
 * through the exact-byte source receipt embedded in the package.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  readRegistryRuntimePrior,
  registryRuntimeCandidate,
  type RegistryRuntimePackage,
} from "../lib/registry/runtime-data-plane.ts";
import { assignment } from "./cli-args.mts";

async function main(): Promise<void> {
  if (!process.argv.includes("--promote")) {
    throw new Error("Refusing a non-promoting registry operation. Pass --promote; tracked registry runtime files are first-seed/test evidence only.");
  }
  const packagePath = assignment(process.argv, "package");
  if (!packagePath) throw new Error("Pass --package=<reviewed-registry-runtime-package.json>.");
  const input = JSON.parse(readFileSync(resolve(packagePath), "utf8")) as RegistryRuntimePackage;
  if (input.contractId !== "registry-runtime-bindings") throw new Error(`Wrong registry contract: ${String(input.contractId)}.`);
  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();
  const prior = await readRegistryRuntimePrior(store, input.sourceReceipt.reviewedAt);
  const candidate = registryRuntimeCandidate(input, { prior });
  const outcome = await processRegisteredManualCandidate(
    store,
    "registry-runtime-bindings",
    candidate,
    input.sourceReceipt.reviewedAt,
    prior?.versionId ?? null,
  );
  if (!outcome.promoted) {
    throw new Error(`Registry runtime candidate ${candidate.id} was held as ${outcome.candidate.state}: ${outcome.candidate.failureDetail ?? "validation refused"}`);
  }
  console.log(JSON.stringify({
    contractId: input.contractId,
    candidateId: candidate.id,
    promotedVersionId: outcome.promoted.versionId,
    changes: outcome.candidate.candidate.changeSet,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
