/** The ZIP answers lane's turn, started by the standing runner with its production write handle: keeps every ZIP's published answer current. */
import { installFactReader, readerFactDb } from "../lib/facts/db.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { installPlaceMapQuery } from "../lib/place-map/reader.ts";
import { askOnRelease, laneEnds, laneTurn, slotOrLeave } from "../lib/ops/lane-turn.ts";
import { runZipAnswersLane } from "../lib/reader/zip-lane.ts";
import { buildZipAnswer } from "../lib/reader/zip-answer-build.ts";

const facts = readerFactDb(prepareProductionCivicDataWrite().connection).query;
// The routes' own readers read through this connection, so a published answer is what they would have answered.
installFactReader(facts);
installPlaceMapQuery(facts);
const store = resolveReaderArtifactWriteStore();
if (!store) throw new Error("ZIP_ANSWER_STORE_UNAVAILABLE: the reader store needs the site id and its token");
const total = { considered: 0, written: 0 };
const turn = laneTurn(() => `ZIP answers: ${total.considered} ZIPs read, ${total.written} answers written`);
askOnRelease(turn.ask);
const { claimEnd, stopRequested, turnEnd } = laneEnds(turn);
const release = await slotOrLeave(turn, "zip-answers-lane.mts", claimEnd);
try {
  setInterval(() => turn.beat(), 60_000);
  await runZipAnswersLane({ deps: { facts, store, build: buildZipAnswer }, turnEnd, total, stopRequested, log: console.log });
  turn.beat();
} finally { release(); }
process.exit(0); // cut-off work may still hold a connection
