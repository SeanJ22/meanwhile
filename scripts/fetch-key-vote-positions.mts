/**
 * Explicitly refresh every official roll selected by reviewed key-question
 * version v1 and promote its facts/positions to the civic-data plane.
 *
 * `pnpm key-votes:positions`
 *
 * The selected question list and roll identities are a reviewed version
 * input. Question text, tally, official URL verification, and member position
 * are acquired again from House/Senate records. The command has no tracked
 * output mode, no scheduler, and no release side effect.
 *
 * @freshness-reads-here — each roll is stamped only after its official body,
 * tally, and non-empty current-member position set have parsed successfully.
 */
import { pathToFileURL } from "node:url";
import { refreshFederalKeyVotes } from "../lib/votes/key-vote-refresh.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

async function main() {
  if (!process.argv.includes("--promote")) throw new Error("PASS_--promote: this command has no tracked-output mode");
  prepareProductionCivicDataWrite();
  const result = await refreshFederalKeyVotes({ store: new PostgresRoutineDataStore() });
  if (result.confirmation) {
    console.log("RCD_RECEIPT=" + JSON.stringify({ source: "federal-key-votes", ...sourceHashReceiptFields(result.confirmation), structuralReleaseContract: ZERO_RELEASE_EVENTS }));
    return;
  }
  const { candidate, outcome } = result.publication!;
  printSourceRunnerReceipt("federal-key-votes", candidate, outcome);
  if (result.counts) console.log([
    `refs: ${result.counts.acquired} acquired of ${result.counts.refsSeen} selected`,
    `house: ${result.counts.houseCurrent} current of ${result.counts.houseSeen} recorded positions`,
    `senate: ${result.counts.senateCurrent} current of ${result.counts.senateSeen} recorded positions`,
    `candidate: ${candidate.id} ${outcome.candidate.state}`,
  ].join("\n"));
  for (const failure of result.failures) console.log(`  HELD ${failure}`);
  if (!outcome.promoted && !outcome.confirmed) throw new Error(`FEDERAL_KEY_VOTE_PROMOTION_REFUSED:${outcome.candidate.failureCode ?? outcome.candidate.state}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
