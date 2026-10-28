/** The standing source job loads one state, keeping the prior map on failure. */
import { readerFactDb } from "../lib/facts/db.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { runStatePlaceMapJob } from "../lib/place-map/job.ts";

const state = process.argv.find(arg => arg.startsWith("--state="))?.slice(8);
if (!state || !/^[A-Z]{2}$/.test(state)) throw new Error("A state abbreviation is required");
installNeonRequestDeadline();
const prepared = prepareProductionCivicDataWrite();
process.exitCode = await runStatePlaceMapJob({ facts: readerFactDb(prepared.connection), store: new PostgresRoutineDataStore(), root: process.cwd(), state });
