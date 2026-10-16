import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client, neon } from "@neondatabase/serverless";
import { STATE_BALLOT_FAMILIES, stateBallotContractId } from "../lib/ballot/state-scopes.ts";
import { installDatabaseTransferCounter } from "../lib/db/transfer.ts";
import { readJsonFile } from "../lib/ops/json-file.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { assertRegisteredRuntimeContract } from "../lib/civic-data/runtime-authority.ts";
import type { StateBucketSource } from "../lib/civic-data/state-bucket-publication.ts";
import { stateRegistryRuntimeContractId } from "../lib/registry/state-scopes.ts";
import { assignment } from "./cli-args.mts";
import { withStateBucketCursor } from "../lib/civic-data/state-bucket-cursor.ts";

try {
  const argv = process.argv.slice(2), prepare = assignment(argv, "prepare"), unit = assignment(argv, "unit"), sha = assignment(argv, "sha256"), contract = assignment(argv, "contract");
  if (Boolean(prepare) === Boolean(unit) || prepare && (sha !== null || contract !== null) || unit && (!contract || !/^[a-f0-9]{64}$/.test(sha ?? ""))) {
    throw new Error("STATE_BUCKET_ARGUMENTS_INVALID");
  }
  installDatabaseTransferCounter();
  if (prepare) {
    assertRegisteredRuntimeContract("registry-runtime-bindings", "manual");
    const connection = process.env.DATABASE_URL;
    if (!connection) throw new Error("STATE_BUCKET_DATABASE_UNAVAILABLE");
    const directory = resolve(prepare);
    const { prepareStateAuthorityBootstrap } = await import("../lib/civic-data/state-bucket-bootstrap.ts");
    const client = new Client({ connectionString: connection });
    await client.connect();
    const plan = await (async () => {
      try { return await withStateBucketCursor(client, source => prepareStateAuthorityBootstrap({ directory, ...source })); }
      finally { await client.end(); }
    })();
    const manifestPath = join(directory, "manifest.json"), text = JSON.stringify(plan);
    let prior: string | null = null;
    try { prior = await readFile(manifestPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (prior !== text) {
      const temporary = `${manifestPath}.${process.pid}.tmp`;
      await writeFile(temporary, text, { mode: 0o600 });
      await rename(temporary, manifestPath);
    }
    console.log("STATE_BUCKET_PREPARED=" + JSON.stringify({ manifestPath, unitCount: plan.units.length, unassignedCount: plan.unassigned.length, missingOriginCount: plan.missingOrigins.length }));
  } else {
    const hash = createHash("sha256");
    const source = await readJsonFile(resolve(unit!), { onChunk: chunk => { hash.update(chunk); } });
    if (hash.digest("hex") !== sha) throw new Error("STATE_BUCKET_FILE_HASH_MISMATCH");
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("STATE_BUCKET_INPUT_INVALID");
    const { family, state } = source as StateBucketSource;
    if (typeof state !== "string" || family !== "registry-runtime" && !STATE_BALLOT_FAMILIES.includes(family)) throw new Error("STATE_BUCKET_INPUT_INVALID");
    const expectedContract = family === "registry-runtime" ? stateRegistryRuntimeContractId(state) : stateBallotContractId(family, state);
    if (contract !== expectedContract) throw new Error("STATE_BUCKET_CONTRACT_MISMATCH");
    const handle = prepareProductionCivicDataWrite(), sql = neon(handle.connection);
    const { publishStateBucket } = await import("../lib/civic-data/state-bucket-publication.ts");
    const result = await publishStateBucket(source as StateBucketSource, (text, params) => sql.query(text, [...params]));
    console.log("STATE_BUCKET_RESULT=" + JSON.stringify(result));
  }
} catch (error) {
  console.error(sanitizedErrorDiagnostic(error));
  process.exitCode = 1;
}
