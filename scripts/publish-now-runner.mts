/** Same authorized source executors and receipts as the routine runner, on an independent minute clock.
 * This entry copies changed promoted pointers and runs saved parser results and changed doors. */
import { installFatalRecorder } from "../lib/ops/fatal-line.ts";
import { savePublishNowFailure } from "../lib/civic-data/publish-now-failure.ts";
import { routineOutcomeWasSaved } from "../lib/control-plane/routine-outcome-local.ts";
const inherited = process.env.WTP_ROUTINE_SUPERVISOR_STARTED_AT;
const startedAt = inherited && Number.isFinite(Date.parse(inherited)) && new Date(inherited).toISOString() === inherited
  ? inherited : new Date().toISOString();
installFatalRecorder(record => savePublishNowFailure(startedAt, "PUBLISH_NOW_FATAL", record.line));
let settlingExit = false;
process.on("beforeExit", () => {
  if (settlingExit || !process.exitCode || routineOutcomeWasSaved()) return;
  settlingExit = true;
  void savePublishNowFailure(startedAt, "PUBLISH_NOW_EXIT_NONZERO", `Publish-now ended with exit ${process.exitCode} before saving its outcome.`);
});
if (!process.argv.includes("--publish-now")) process.argv.push("--publish-now");
try { await import("./routine-civic-data-runner.mts"); }
catch (error) {
  const { sanitizedErrorDiagnostic } = await import("../lib/ops/error-diagnostic.ts");
  await savePublishNowFailure(startedAt, "PUBLISH_NOW_FATAL", sanitizedErrorDiagnostic(error));
  process.exitCode = 2;
}
export {};
