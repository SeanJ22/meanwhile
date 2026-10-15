import { publishHeldPlaceMeasures } from "../lib/ballot/held-place-measures.ts";
import { requireBallotState } from "../lib/ballot/state-scopes.ts";
import { netlifyEvidenceStoreFromEnv } from "../lib/control-plane/evidence/netlify-store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { assertRegisteredRuntimeContract } from "../lib/civic-data/runtime-authority.ts";
import { routineProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";

const state = requireBallotState(process.argv.find(value => value.startsWith("--state="))?.slice(8) ?? "");
assertRegisteredRuntimeContract("ballot-measures", "manual");
prepareProductionCivicDataWrite();
const vault = netlifyEvidenceStoreFromEnv();
if (!vault) throw new Error("Held measures require the shared Netlify evidence vault.");
const release = await routineProcessSlots().acquire("scripts/publish-held-measures.mts");
release.observe?.(process.pid);
try {
  const result = await publishHeldPlaceMeasures({ root: process.cwd(), state, vault, store: new PostgresRoutineDataStore(),
    now: () => new Date().toISOString(), report: console.log });
  console.log(`PLACE_MEASURE_PUBLICATION_RESULT=${JSON.stringify(result)}`);
  process.exitCode = result.held ? 2 : 0;
} finally { release(); }
