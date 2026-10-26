/** One turn of the place-page rebuild queue, started by the standing runner with its production write handle. */
import { readerFactDb } from "../lib/facts/db.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { PLACE_PAGE_TURN_LINE, PLACE_PAGE_TURN_MS, rebuildPlacePageTurn } from "../lib/reader/place-page-worker.ts";

const facts = readerFactDb(prepareProductionCivicDataWrite().connection);
const result = await rebuildPlacePageTurn(facts, Math.min(passDeadlineFromEnv(), Date.now() + PLACE_PAGE_TURN_MS));
console.log(`${PLACE_PAGE_TURN_LINE}${JSON.stringify(result)}`);
