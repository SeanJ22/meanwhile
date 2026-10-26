/**
 * The daily member-office refresh, run by the routine runner
 * (lib/civic-data/automatic-refresh.ts; one pass: `--only=member-offices`).
 * Reads the official roster and Open States' file of each state whose
 * lawmaker list changed, joins them and promotes the offices through the curated
 * `member-offices` door (lib/officials/member-offices-publication.ts). It stops
 * reading before the pass deadline and saves the states it finished; the
 * existing pass cursor names the rest and the runner continues on its next pass.
 * Writes no repository file. Prints exactly one RCD_RECEIPT line when the door
 * answered; a pass with nothing publishable prints none and exits non-zero.
 */
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { MEMBER_OFFICES_CONTRACT_ID, publishMemberOffices } from "../lib/officials/member-offices-publication.ts";
import { sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

if (!process.argv.includes("--promote")) {
  throw new Error("Refusing a non-promoting member-office operation. Pass --promote.");
}
installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();
const published = await publishMemberOffices({ store, now, deadlineMs: passDeadlineFromEnv() });
console.log(JSON.stringify({ contractId: MEMBER_OFFICES_CONTRACT_ID, candidateId: published.candidateId,
  promotedVersionId: published.promotedVersionId, records: published.records, gaps: published.gaps, pending: published.pending }, null, 2));
if (published.confirmation) {
  console.log("RCD_RECEIPT=" + JSON.stringify({ source: MEMBER_OFFICES_CONTRACT_ID,
    ...sourceHashReceiptFields(published.confirmation), structuralReleaseContract: ZERO_RELEASE_EVENTS }));
} else if (published.outcome === null || published.candidateId === null) {
  console.error(`MEMBER_OFFICES_NOTHING_PUBLISHABLE: ${published.gaps.map(gap => `${gap.key} ${gap.detail}`).join(" | ") || "no state answered"}`);
  process.exitCode = 2;
} else {
  printSourceRunnerReceipt(MEMBER_OFFICES_CONTRACT_ID, { id: published.candidateId }, published.outcome);
  if (!published.outcome.promoted) process.exitCode = 2;
}
