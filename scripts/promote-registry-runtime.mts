/**
 * Promote one owner-reviewed registry runtime package to the permanent plane.
 * This command never writes tracked files. Static registry identities remain
 * reviewed software inputs; mutable body/contact/photo bindings arrive only
 * through the exact-byte source receipt embedded in the package.
 */

import { readFileSync } from "node:fs";
import { printWorkerPublicationReceipt } from "../lib/civic-data/worker-publication-tasks.ts";
import { resolve, join } from "node:path";

import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  readRegistryRuntimePrior,
  registryRuntimeCandidate,
  type RegistryRuntimePackage,
} from "../lib/registry/runtime-data-plane.ts";
import { assignment } from "./cli-args.mts";
import { publishWorkerRosterResults } from "../lib/civic-data/worker-roster-publication.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import { workerVaultResolver } from "../lib/control-plane/workers/vault.ts";
import { evidenceProjection } from "../lib/control-plane/workers/evidence-projection.ts";
import { runNationalPlaceTask } from "../lib/hunt/place-source-task.ts";
import { nationalDelivery, publishNationalPlaceSources, type NationalPlacePublication } from "../lib/civic-data/worker-national-publication.ts";
import { hostSpacer } from "../lib/control-plane/scheduler/http-executor.ts";
import { serializeHostSpacing } from "../lib/control-plane/workers/host-spacing.ts";
import { browseWithPlaywright } from "./scout-browse.mts";

async function main(): Promise<void> {
  if (!process.argv.includes("--promote")) {
    throw new Error("Refusing a non-promoting registry operation. Pass --promote; tracked registry runtime files are first-seed/test evidence only.");
  }
  const workerRosters = assignment(process.argv, "worker-rosters");
  const nationalZips = assignment(process.argv, "national-zips");
  if (workerRosters || nationalZips) {
    prepareProductionCivicDataWrite();
    const connection = controlPlaneUrlFromEnv();
    if (!connection) throw new Error("ROSTER_CONTROL_PLANE_UNAVAILABLE");
    const now = new Date().toISOString();
    const repos = await createPgRepositories(connection, now, { skipBootstrap: true });
    const vault = new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR));
    const store = new PostgresRoutineDataStore();
    const nationalPublications: NationalPlacePublication[] = [];
    const nationalPlaces: { zip: string; officials: number; publishedFields: number; owedFields: number; sourceGaps: unknown }[] = [];
    const failures: string[] = [];
    if (nationalZips) {
      try {
        const places = await runNationalPlaceTask({ tools: { repos, store: vault, spaceOut: serializeHostSpacing(hostSpacer()),
          browse: browseWithPlaywright, now: () => new Date().toISOString() }, store,
          zips: nationalZips.split(",").filter(Boolean), publish: async input => {
            const publication = await publishNationalPlaceSources({ ...input,
              divisions: input.divisions.filter(row => row.sourceDataset).map(row => ({ ...row, sourceDataset: row.sourceDataset! })) });
            nationalPublications.push(publication);
            return publication;
          } });
        nationalPlaces.push(...places.map(place => ({ zip: place.zip, officials: place.sources?.officials.length ?? 0,
          publishedFields: place.items.filter(item => item.state === "published").length,
          owedFields: place.work.length, sourceGaps: place.sources?.gaps ?? [] })));
      } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    }
    const readObject = researchVaultResolver(repos, vault, "freshness");
    const readEvidence = workerVaultResolver(repos, vault, "freshness", { snapshot: true });
    const report = await publishWorkerRosterResults({ repos, store,
      workItemIds: workerRosters?.split(",").filter(Boolean) ?? [], now: new Date().toISOString(), readCapture: async (id, records) => {
        const [{ artifact }, input] = await Promise.all([readObject(id), readEvidence(id)]);
        const evidence = evidenceProjection(input);
        const observations = records.flatMap(record => {
          const result = record.result;
          return result.role === "ACQUIRER" && result.verdict === "ACQUIRED"
            ? result.walk.filter(step => step.rung === result.source.retrieval && step.target === evidence.canonicalUrl &&
              step.transport === "REACHABLE" && step.outcome === "WALKED_AND_FOUND" && step.artifactIds.includes(id)).map(step => step.at) : [];
        });
        return { evidence, observedAt: [evidence.retrievedAt, ...observations].sort().at(-1)!,
          httpStatus: artifact.httpStatus, transport: artifact.transport, partial: artifact.httpStatus === 206 || artifact.retentionPolicy === "DIAGNOSTIC" };
      } });
    const published = report.filter(row => row.outcome.status === "PUBLISHED" || row.outcome.status === "PARTIALLY_PUBLISHED");
    const nationalVersion = nationalPublications.map(row => row.promotedVersionId ?? row.members.at(-1)?.versionId).findLast(Boolean);
    console.log(JSON.stringify({ contractId: "registry-runtime-bindings", candidateId: published.at(-1)?.outcome.candidateId ?? nationalVersion ?? null,
      promotedVersionId: published.at(-1)?.outcome.versionId ?? nationalVersion ?? null,
      workerPublications: report, nationalPlaces, nationalPublications, failures }, null, 2));
    await printWorkerPublicationReceipt(store, "registry-runtime-bindings", report, nationalDelivery(nationalPublications), now);
    if (failures.length && !published.length && !nationalVersion) throw new Error(failures.join("; "));
    return;
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
