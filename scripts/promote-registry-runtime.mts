/**
 * Promote one owner-reviewed registry runtime package to the permanent plane.
 * This command never writes tracked files. Static registry identities remain
 * reviewed software inputs; mutable body/contact/photo bindings arrive only
 * through the exact-byte source receipt embedded in the package.
 */
import { printWorkerPublicationReceipt } from "../lib/civic-data/worker-publication-tasks.ts";
import { runWorkerPublicationJob } from "../lib/civic-data/worker-publication-job.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  readRegistryRuntimePrior,
  REGISTRY_RUNTIME_SCOPE,
  registryRuntimeCandidate,
  type RegistryRuntimePackage,
} from "../lib/registry/runtime-data-plane.ts";
import { assignment } from "./cli-args.mts";
import { readerFactDb } from "../lib/facts/db.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { runNationalPlaceWorkerProcesses } from "../lib/control-plane/workers/process-pool.ts";
import { orderNationalPlaceWork } from "../lib/control-plane/expansion/dispatch-work.ts";
import { publishElectionFields } from "../lib/civic-data/election-field-publication.ts";
import { section3Record } from "../lib/control-plane/promotion/section3.ts";
import { nationalDelivery, publishNationalPlaceSources, type NationalPlacePublication } from "../lib/civic-data/worker-national-publication.ts";

async function main(): Promise<void> {
  if (!process.argv.includes("--promote")) {
    throw new Error("Refusing a non-promoting registry operation. Pass --promote; tracked registry runtime files are first-seed/test evidence only.");
  }
  const workerDirectories = assignment(process.argv, "worker-directories");
  const nationalZips = assignment(process.argv, "national-zips");
  if (workerDirectories || nationalZips) {
    prepareProductionCivicDataWrite();
    const connection = controlPlaneUrlFromEnv();
    if (!connection) throw new Error("ROSTER_CONTROL_PLANE_UNAVAILABLE");
    const now = new Date().toISOString();
    const repos = await createPgRepositories(connection, now, { skipBootstrap: true });
    const store = new PostgresRoutineDataStore();
    if (workerDirectories && !nationalZips) {
      const { report, receipt, exitCode } = await runWorkerPublicationJob({ repos, store,
        contractId: "registry-runtime-bindings", workItemIds: workerDirectories.split(",").filter(Boolean), now });
      const published = report.filter(row => row.outcome.status === "PUBLISHED" || row.outcome.status === "PARTIALLY_PUBLISHED");
      console.log(JSON.stringify({ contractId: "registry-runtime-bindings",
        candidateId: published.at(-1)?.outcome.candidateId ?? null,
        promotedVersionId: published.at(-1)?.outcome.versionId ?? null,
        workerPublications: report, nationalPlaces: [], nationalPublications: [], failures: [] }, null, 2));
      if (receipt) console.log("RCD_RECEIPT=" + JSON.stringify(receipt));
      if (exitCode) process.exitCode = exitCode;
      return;
    }
    const nationalPublications: NationalPlacePublication[] = [];
    const nationalPlaces: ({ zip: string; officials: number; publishedFields: number; owedFields: number; sourceGaps: unknown;
      inherited: unknown; electionPublications: unknown } | { zip: string; deferred: string })[] = [];
    const failures: string[] = [];
    if (nationalZips) {
      const facts = readerFactDb(), clocks = factClocks((await repos.adminConfig.read("current"))?.value ?? null);
      try {
        const zips = [...new Set(nationalZips.split(",").filter(Boolean))];
        await runNationalPlaceWorkerProcesses({ root: process.cwd(), store, zips,
          orderPending: ready => orderNationalPlaceWork(repos, ready, new Date().toISOString()),
          capacity: () => zips.length, publish: async input => {
            const publication = await publishNationalPlaceSources({ ...input, facts, clocks,
              divisions: input.divisions.filter(row => row.sourceDataset).map(row => ({ ...row, sourceDataset: row.sourceDataset! })) });
            nationalPublications.push(publication);
            return publication;
          },
          publishElection: (fields, now) => publishElectionFields({ store, fields, now, verify: section3Record }),
          onResult: place => { nationalPlaces.push("deferred" in place ? place : { zip: place.zip, officials: place.sources?.officials.length ?? 0,
          publishedFields: place.items.filter(item => item.state === "published").length,
          owedFields: place.work.length, sourceGaps: place.sources?.gaps ?? [],
          inherited: place.inherited, electionPublications: place.electionPublications }); },
        });
      } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    }
    const nationalVersion = nationalPublications.map(row => row.promotedVersionId ?? row.members.at(-1)?.versionId).findLast(Boolean);
    console.log(JSON.stringify({ contractId: "registry-runtime-bindings", candidateId: nationalVersion ?? null, promotedVersionId: nationalVersion ?? null,
      workerPublications: [], nationalPlaces, nationalPublications, failures }, null, 2));
    const delivery = nationalDelivery(nationalPublications);
    delivery.gaps.push(...nationalPlaces.flatMap(place => "deferred" in place ? [{ key: `zip:${place.zip}`, detail: place.deferred }] : []));
    // The worker also completes when its lease's due check finds that another
    // pass already worked the place. Name the current door with zero delivery;
    // otherwise this ordinary queue race exits without a receipt forever.
    if (!delivery.versionId && delivery.records === 0 && delivery.gaps.length === 0 && failures.length === 0 &&
      (nationalPlaces.some(place => !("deferred" in place)) || Boolean(nationalZips?.split(",").some(Boolean)))) {
      const pointer = await store.readPromotionIdentity("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE);
      delivery.versionId = pointer?.versionId ?? null;
      delivery.candidateId = pointer?.versionId ?? null;
    }
    await printWorkerPublicationReceipt(store, "registry-runtime-bindings", [], delivery, now);
    if (failures.length && !nationalVersion) throw new Error(failures.join("; "));
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
