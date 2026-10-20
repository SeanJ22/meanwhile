/** The runner's one-time child: publishes each place's members of Congress and each member's roll-call positions from the held national records. */
import { pathToFileURL } from "node:url";
import { processRegisteredManualCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";
import { federalPeopleCountClean, federalPeopleCountLine, federalPeopleSplitLine } from "../lib/civic-data/federal-people-split.ts";
import { withHeldFederalPeopleSplit } from "../lib/civic-data/federal-people-split-source.ts";
import { readerDatabaseQuery } from "../lib/reader/database.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";

export async function splitHeldFederalPeople(input: { store: RoutineDataStore; now: () => string; log: (line: string) => void; query?: ReadOnlyQuery | null }): Promise<void> {
  const { store, now, log } = input;
  const query = input.query === undefined ? readerDatabaseQuery() : input.query;
  if (!query) throw new Error("FEDERAL_SPLIT_READER_STORE_NOT_CONFIGURED");
  const outcome = (scope: string, from: string, result: PromotionOutcome) => log(federalPeopleSplitLine({ scope, from, to: result.promoted?.versionId ?? result.confirmed?.versionId ?? null,
    ...(result.promoted || result.confirmed ? {} : { refusal: result.candidate.failureCode ?? "REFUSED" }) }));
  await withHeldFederalPeopleSplit(query, async split => {
    log(federalPeopleCountLine(split.count));
    if (!federalPeopleCountClean(split.count)) throw new Error("FEDERAL_SPLIT_COUNT_MISMATCH");
    for (const row of split.candidates()) {
      outcome(row.candidate.scope, row.from, await processRegisteredManualCandidate(store, row.contractId, row.candidate, now(), row.expectedCurrentVersion,
        { confirmUnchanged: row.replaceLegacyPositions ? false : undefined }));
    }
  });
}

async function main() {
  assertRuntimeAuthority({ capabilities: ["FEDERAL_PEOPLE_SPLIT"] });
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  await splitHeldFederalPeople({ store: new PostgresRoutineDataStore(), now: () => new Date().toISOString(), log: line => console.log(line) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
