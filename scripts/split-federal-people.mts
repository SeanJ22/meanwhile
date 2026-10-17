/** The runner's one-time child: publishes each place's members of Congress and each member's roll-call positions from the held national records. */
import { pathToFileURL } from "node:url";
import { processRegisteredManualCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";
import { federalPeopleCountClean, federalPeopleCountLine, federalPeopleSplitLine, splitFederalPeople } from "../lib/civic-data/federal-people-split.ts";
import { federalDirectoryContractId, heldDirectoryCandidate, type FederalDirectoryCapture, type FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import { federalMemberVotesCandidate, federalRollCallsCandidate, FEDERAL_ROLLCALL_SCOPE, type HeldAcquisition } from "../lib/votes/data-plane.ts";
import type { BillSummariesFile } from "../lib/votes/bill-summaries.ts";
import type { VotesSnapshot } from "../lib/votes/types.ts";

const NATIONAL_DIRECTORY_SCOPE = "US:current-congress-directory";

async function held(store: RoutineDataStore, recordClass: "FEDERAL_DIRECTORY" | "FEDERAL_ROLL_CALL", scope: string) {
  const pointer = await store.readPromotion(recordClass, scope);
  const version = pointer ? await store.readCandidate(pointer.versionId) : null;
  if (!version) throw new Error(`FEDERAL_SPLIT_SOURCE_UNAVAILABLE:${scope}`);
  return version.candidate;
}

export async function splitHeldFederalPeople(input: { store: RoutineDataStore; now: () => string; log: (line: string) => void }): Promise<void> {
  const { store, now, log } = input;
  const directory = await held(store, "FEDERAL_DIRECTORY", NATIONAL_DIRECTORY_SCOPE);
  const rollCalls = await held(store, "FEDERAL_ROLL_CALL", FEDERAL_ROLLCALL_SCOPE);
  const votes = rollCalls.readModel as { snapshot: VotesSnapshot; billSummaries: BillSummariesFile };
  const split = splitFederalPeople(directory.readModel as FederalDirectoryReadModel, votes);
  log(federalPeopleCountLine(split.count));
  if (!federalPeopleCountClean(split.count)) throw new Error("FEDERAL_SPLIT_COUNT_MISMATCH");
  const outcome = (scope: string, from: string, result: PromotionOutcome) => log(federalPeopleSplitLine({ scope, from, to: result.promoted?.versionId ?? result.confirmed?.versionId ?? null,
    ...(result.promoted || result.confirmed ? {} : { refusal: result.candidate.failureCode ?? "REFUSED" }) }));
  const captures = (directory.normalizedPayload as { acquisitions: FederalDirectoryCapture[] }).acquisitions;
  for (const { state, projection } of split.places) {
    const candidate = heldDirectoryCandidate({ state, acquisitions: captures, retrievedAt: directory.retrieval.retrievedAt!, projection });
    outcome(candidate.scope, directory.id, await processRegisteredManualCandidate(store, federalDirectoryContractId(state), candidate, now()));
  }
  const acquisitions = (rollCalls.normalizedPayload as { acquisitions: HeldAcquisition[] }).acquisitions;
  const common = { acquisitions, retrievedAt: rollCalls.retrieval.retrievedAt!, expectedCongress: split.window.congress, expectedSession: split.window.session, snapshot: split.window };
  for (const { officeholderId, positions } of split.members) {
    const candidate = federalMemberVotesCandidate({ ...common, officeholderId, positions });
    outcome(candidate.scope, rollCalls.id, await processRegisteredManualCandidate(store, "congress-rollcalls", candidate, now()));
  }
  const window = federalRollCallsCandidate({ ...common, partyBreakdowns: split.partyBreakdowns, billSummaries: votes.billSummaries });
  outcome(window.scope, rollCalls.id, await processRegisteredManualCandidate(store, "congress-rollcalls", window, now(), rollCalls.id));
}

async function main() {
  assertRuntimeAuthority({ capabilities: ["FEDERAL_PEOPLE_SPLIT"] });
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  await splitHeldFederalPeople({ store: new PostgresRoutineDataStore(), now: () => new Date().toISOString(), log: line => console.log(line) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
