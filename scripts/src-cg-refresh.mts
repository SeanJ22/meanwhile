import { isDirectModuleExecution } from "../lib/ops/main-module.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { isFederalSource } from "../lib/sources/congress/targets.ts";
import { refreshFederalSource } from "../lib/sources/congress/refresh.ts";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { recordDoorOutcome } from "../lib/doors/outcome.ts";
import { feedDoorId } from "../lib/doors/registry.ts";

if (isDirectModuleExecution(import.meta.url)) {
  const args = process.argv.slice(2), source = args.find(arg => arg.startsWith("--source="))?.slice(9) ?? "";
  if (!args.includes("--promote") || !isFederalSource(source)) throw new Error("Use --promote --source=<registered SRC-CG source>.");
  prepareProductionCivicDataWrite();
  const connection = controlPlaneUrlFromEnv();
  const repos = connection ? await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true }) : null;
  const result = await refreshFederalSource({ source, store: new PostgresRoutineDataStore(),
    doorOutcome: repos ? (ok, at, reason) => recordDoorOutcome(repos.doors, feedDoorId(source), ok ? "SUCCESS" : "FAILURE", at, false, reason) : undefined });
  process.exitCode = result.ok ? 0 : 2;
}
