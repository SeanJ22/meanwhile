/** The place files lane's turn, started by the standing runner with its production write handle: keeps every place's file and every state's index current. */
import { installFactReader, readerFactDb } from "../lib/facts/db.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { installPlaceMapQuery } from "../lib/place-map/reader.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { askOnRelease, laneEnds, laneTurn, slotOrLeave } from "../lib/ops/lane-turn.ts";
import { nationalEverydayRouting, nationalPresident } from "../lib/reader/national.ts";
import { runPlaceFilesLane } from "../lib/reader/place-files-lane.ts";

const facts = readerFactDb(prepareProductionCivicDataWrite().connection).query;
// The reader's own functions read through this connection, so a file says what the reader would have read.
installFactReader(facts);
installPlaceMapQuery(facts);
installReaderDatabaseQuery(async statements => Promise.all(statements.map(statement => facts(statement.text, statement.params))));
const store = resolveReaderArtifactWriteStore();
if (!store) throw new Error("PLACE_FILES_STORE_UNAVAILABLE: the reader store needs the site id and its token");
const total = { considered: 0 };
const turn = laneTurn(() => `Place files: ${total.considered} places looked at`);
askOnRelease(turn.ask);
const { claimEnd, stopRequested, turnEnd } = laneEnds(turn);
const release = await slotOrLeave(turn, "place-files-lane.mts", claimEnd);
try {
  setInterval(() => turn.beat(), 60_000);
  await runPlaceFilesLane({ deps: { facts, store, log: console.log,
    national: async () => ({ president: await nationalPresident(), routing: await nationalEverydayRouting() }) }, turnEnd, total, stopRequested });
  turn.beat();
} finally { release(); }
process.exit(0); // cut-off work may still hold a connection
