/** One state's standing member-office refresh. It reuses held source captures and
 * publishes through that state's door without loading another state's offices. */
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { publishMemberOffices } from "../lib/officials/member-offices-publication.ts";
import { memberOfficeContractId } from "../lib/officials/member-office-scope.ts";
import { requiredAssignment } from "./cli-args.mts";

if (!process.argv.includes("--promote")) {
  throw new Error("Refusing a non-promoting member-office operation. Pass --promote.");
}
installNeonRequestDeadline();
prepareProductionCivicDataWrite();

const state = requiredAssignment(process.argv, "state", "MEMBER_OFFICES_STATE_REQUIRED");
const contractId = memberOfficeContractId(state);
const store = new PostgresRoutineDataStore();
const now = new Date().toISOString();
const published = await publishMemberOffices({ state, store, now });
console.log(JSON.stringify({ contractId: contractId, candidateId: published.candidateId,
  promotedVersionId: published.promotedVersionId, records: published.records, gaps: published.gaps }, null, 2));
if (published.outcome === null || published.candidateId === null) {
  console.error(`MEMBER_OFFICES_NOTHING_PUBLISHABLE: ${published.gaps.map(gap => `${gap.key} ${gap.detail}`).join(" | ") || "no state answered"}`);
  process.exitCode = 2;
} else {
  printSourceRunnerReceipt(contractId, { id: published.candidateId }, published.outcome);
  if (!published.outcome.promoted) process.exitCode = 2;
}
