/**
 * @freshness-reads-here — retrievedAt dates this exact reviewed projection
 * and source-set receipt read; sourceThrough remains the publisher horizon.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import type { ExecutiveActionStore } from "../lib/officials/executive-actions.ts";
import { publishAzOfficialActionsPackage } from "../lib/outcomes/official-actions-package.ts";

function value(flag: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return exact ? exact.slice(flag.length + 1) : null;
}

const projectionPath = value("--projection");
const receiptPath = value("--receipt");
const sourceThrough = value("--source-through");
if (!projectionPath || !receiptPath || !sourceThrough) {
  throw new Error(
    "Usage: pnpm official-actions:promote --projection=<reviewed projection.json> " +
      "--receipt=<exact-byte source-set receipt.json> --source-through=<ISO instant>. " +
      "This command has no tracked-file default.",
  );
}

const projection = JSON.parse(readFileSync(resolve(projectionPath), "utf8")) as ExecutiveActionStore;
const sourceReceipt = JSON.parse(readFileSync(resolve(receiptPath), "utf8")) as ManualSourceSetReceipt;
prepareProductionCivicDataWrite();
const dataStore = new PostgresRoutineDataStore();
const result=await publishAzOfficialActionsPackage({projection,sourceReceipt,sourceThrough},dataStore,new Date().toISOString());
if(result.replay){console.log(`reused ${result.replay.versionId}; original source dates retained`);}
else{
const {outcome}=result.publication!;
if (!outcome.promoted&&!outcome.confirmed) {
  throw new Error(`Arizona official-action promotion refused: ${outcome.candidate.failureCode ?? outcome.candidate.state}`);
}
console.log(`promoted ${outcome.promoted?.versionId??outcome.confirmed!.versionId}; no tracked runtime artifact was written`);
}
