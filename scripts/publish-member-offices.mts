/**
 * The daily member-office refresh, run by the routine runner
 * (lib/civic-data/automatic-refresh.ts; one pass: `--only=member-offices`).
 * Reads each official state roster and Open States' file for that state,
 * joins them and promotes every state's offices through the curated
 * `member-offices` door (lib/officials/member-offices-publication.ts).
 * Writes no repository file. Prints exactly one RCD_RECEIPT line when the door
 * answered; a pass with nothing publishable prints none and exits non-zero.
 */
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { MEMBER_OFFICES_CONTRACT_ID, publishMemberOffices } from "../lib/officials/member-offices-publication.ts";

if (!process.argv.includes("--promote")) {
  throw new Error("Refusing a non-promoting member-office operation. Pass --promote.");
}
installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();
const published = await publishMemberOffices({ store, now });
console.log(JSON.stringify({ contractId: MEMBER_OFFICES_CONTRACT_ID, candidateId: published.candidateId,
  promotedVersionId: published.promotedVersionId, records: published.records, gaps: published.gaps }, null, 2));
if (published.outcome === null || published.candidateId === null) {
  console.error(`MEMBER_OFFICES_NOTHING_PUBLISHABLE: ${published.gaps.map(gap => `${gap.key} ${gap.detail}`).join(" | ") || "no state answered"}`);
  process.exitCode = 2;
} else {
  printSourceRunnerReceipt(MEMBER_OFFICES_CONTRACT_ID, { id: published.candidateId }, published.outcome);
  if (!published.outcome.promoted) process.exitCode = 2;
}
