import { pathToFileURL } from "node:url";
import { acquireArizonaVotes, AZ_PLURAL_BILLS_URL } from "../lib/sources/plural/vote-acquisition.ts";
import { arizonaPluralVotesCandidate, AZ_PLURAL_VOTES_CONTRACT, mergeArizonaPluralVotes, readArizonaPluralVotesProjection } from "../lib/sources/plural/votes.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { processRegisteredRoutineCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure, withPublisherAcquisitionDeadline } from "../lib/civic-data/source-acquisition-failure.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

/** Manual invocation and the standing source task share this sole writer. */
export async function refreshArizonaVotes(input: Parameters<typeof acquireArizonaVotes>[0] & { civicStore: RoutineDataStore }) {
  const prior = await readArizonaPluralVotesProjection({ store: input.civicStore, bypassCache: true, now: input.now?.() });
  if (prior.kind !== "PROMOTED" && prior.kind !== "NOT_RECORDED") throw new Error("PLURAL_VOTES_PREDECESSOR_UNAVAILABLE");
  let projection = prior.kind === "PROMOTED" ? prior.value : null;
  let baseVersionId = prior.metadata.versionId;
  let publication: { candidate: ReturnType<typeof arizonaPluralVotesCandidate>; outcome: PromotionOutcome } | null = null;
  const acquisition = await acquireArizonaVotes({ ...input, onBill: async result => {
    if (!result.votes.length) return;
    const candidate = arizonaPluralVotesCandidate({ projection: mergeArizonaPluralVotes(projection, result.votes),
      acquired: [result.evidence], held: result.held, checkedAt: input.now?.() ?? new Date().toISOString() });
    const outcome = await processRegisteredRoutineCandidate(input.civicStore, AZ_PLURAL_VOTES_CONTRACT, candidate,
      input.now?.() ?? new Date().toISOString(), baseVersionId);
    if (!outcome.promoted && !outcome.confirmed) throw new Error(`PLURAL_VOTES_PUBLICATION_REFUSED:${outcome.candidate.failureCode}`);
    projection = candidate.readModel as NonNullable<typeof projection>;
    baseVersionId = outcome.promoted?.versionId ?? outcome.confirmed!.versionId;
    publication = { candidate, outcome };
    await input.onBill?.(result);
  } });
  if (!publication) throw new Error("PLURAL_VOTES_NO_NEW_NATIVE_FACTS_ACQUIRED");
  return { publication: publication as { candidate: ReturnType<typeof arizonaPluralVotesCandidate>; outcome: PromotionOutcome }, held: acquisition.held };
}

async function main() {
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== "--promote") throw new Error("AZ_VOTES_PROMOTION_REQUIRED");
  installNeonRequestDeadline(); prepareProductionCivicDataWrite();
  const civicStore = new PostgresRoutineDataStore();
  let refreshed: Awaited<ReturnType<typeof refreshArizonaVotes>>;
  try {
    refreshed = await withPublisherAcquisitionDeadline("Plural Arizona votes", ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      signal => refreshArizonaVotes({ signal, civicStore }));
  } catch (error) {
    const failure = sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", error instanceof Error ? error.message : String(error));
    const failed = await recordRegisteredSourceAcquisitionFailure({ store: civicStore, contractId: AZ_PLURAL_VOTES_CONTRACT, requestedUrl: AZ_PLURAL_BILLS_URL, failure });
    console.log(failed.line); process.exitCode = 2; return;
  }
  if (refreshed.held.length) {
    const failure = sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", refreshed.held.map(row => `${row.key}: ${row.detail}`).join("; "));
    const failed = await recordRegisteredSourceAcquisitionFailure({ store: civicStore, contractId: AZ_PLURAL_VOTES_CONTRACT,
      requestedUrl: AZ_PLURAL_BILLS_URL, failure });
    console.log(failed.line); process.exitCode = 2; return;
  }
  printSourceRunnerReceipt(AZ_PLURAL_VOTES_CONTRACT, refreshed.publication.candidate, refreshed.publication.outcome);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
