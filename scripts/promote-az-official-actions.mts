/**
 * @freshness-reads-here — retrievedAt dates this exact reviewed projection
 * and source-set receipt read; sourceThrough remains the publisher horizon.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
import type { ExecutiveActionStore } from "../lib/officials/executive-actions.ts";
import { azOfficialActionsCandidate, readAzOfficialActionsPrior } from "../lib/outcomes/data-plane.ts";

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
const retrievedAt = new Date().toISOString();
prepareProductionCivicDataWrite();
const dataStore = new PostgresRoutineDataStore();
const prior = await readAzOfficialActionsPrior(dataStore, retrievedAt);
const candidate = azOfficialActionsCandidate({ store: projection, sourceReceipt, retrievedAt, sourceThrough, prior });
const outcome = await processRegisteredManualCandidate(
  dataStore,
  "az-official-actions",
  candidate,
  retrievedAt,
  prior?.versionId ?? null,
);
if (!outcome.promoted) {
  throw new Error(`Arizona official-action promotion refused: ${outcome.candidate.failureCode ?? outcome.candidate.state}`);
}
console.log(`promoted ${outcome.promoted.versionId}; no tracked runtime artifact was written`);
