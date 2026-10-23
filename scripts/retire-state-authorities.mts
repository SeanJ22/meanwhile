import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@neondatabase/serverless";
import { assignment } from "./cli-args.mts";
import { installDatabaseTransferCounter } from "../lib/db/transfer.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { temporaryPath } from "../lib/civic-data/temporary-path.ts";
import { assertRuntimeAuthority, assertRegisteredRuntimeContract } from "../lib/civic-data/runtime-authority.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { requireRegistryState } from "../lib/civic-data/state-scopes.ts";
import type { StateRetirementOrigin } from "../lib/civic-data/state-retirement-inputs.ts";

try {
  const args = process.argv.slice(2), prepare = assignment(args, "prepare"), unit = assignment(args, "unit"),
    originsFile = assignment(args, "origins"), seal = assignment(args, "seal"), sha256 = assignment(args, "sha256"), contractId = assignment(args, "contract");
  if (Boolean(prepare) === Boolean(unit) || prepare && (!originsFile || sha256 || contractId || seal) || unit && (!contractId || !/^[a-f0-9]{64}$/.test(sha256 ?? "") || !/^[a-f0-9]{64}$/.test(seal ?? "") || originsFile))
    throw new Error("STATE_RETIREMENT_ARGUMENTS_INVALID");
  installDatabaseTransferCounter();
  if (prepare) {
    assertRuntimeAuthority({ capabilities: ["ROUTINE_SUPERVISOR"], immediateParentPid: process.ppid });
    const origins = JSON.parse(await readFile(temporaryPath(originsFile!), "utf8")) as StateRetirementOrigin[];
    if (!Array.isArray(origins) || !origins.length) throw new Error("STATE_RETIREMENT_ORIGINS_INVALID");
    const { prepareRetirementStateInputs } = await import("../lib/civic-data/state-retirement-inputs.ts");
    const { withRetirementSourceCursor } = await import("../lib/civic-data/state-retirement-inputs.ts");
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("STATE_RETIREMENT_DATABASE_UNAVAILABLE");
    const client = new Client({ connectionString });
    await client.connect();
    const directory = temporaryPath(resolve(prepare));
    try {
      const states = assignment(args, "states")?.split(",").map(requireRegistryState);
      const plan = await withRetirementSourceCursor(client, source => prepareRetirementStateInputs({ ...source, directory, origins, states }));
      const manifestPath = temporaryPath(join(directory, "manifest.json")), temporary = temporaryPath(`${manifestPath}.${process.pid}.tmp`);
      await writeFile(temporary, JSON.stringify(plan), { mode: 0o600 });
      await rename(temporary, manifestPath);
      console.log("STATE_RETIREMENT_PREPARED=" + JSON.stringify({ manifestPath, unitCount: plan.units.length, unassignedCount: plan.unassigned.length }));
    } finally { await client.end(); }
  } else {
    assertRegisteredRuntimeContract(contractId!, contractId!.startsWith("candidate-campaign-sites-derived:") ? "routine" : "manual");
    prepareProductionCivicDataWrite();
    const { reconcileRetirementStateInput } = await import("../lib/civic-data/state-retirement-merge.ts");
    const { PostgresRoutineDataStore } = await import("../lib/civic-data/store.ts");
    const result = await reconcileRetirementStateInput({ file: temporaryPath(resolve(unit!)), sha256: sha256!, seal: seal!, contractId: contractId!,
      store: new PostgresRoutineDataStore(), now: new Date().toISOString() });
    console.log("STATE_RETIREMENT_UNIT=" + JSON.stringify(result));
  }
} catch (error) {
  console.error(sanitizedErrorDiagnostic(error));
  process.exitCode = 1;
}
