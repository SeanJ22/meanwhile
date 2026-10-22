import { hostname } from "node:os";
import { appendRoutineCivicDataSupervisorDigest, routineCivicDataSupervisorOutcome } from "../control-plane/freshness-cycle-outcome.ts";
import { saveRoutineOutcomeLocal } from "../control-plane/routine-outcome-local.ts";
import { boundedRoutineSupervisorDigest, writeRoutineSupervisorFailureSummary } from "../control-plane/routine-outcome-summary.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { routineSupervisorCycleId } from "./runner.ts";

/** Last-resort reporting is independent of source admission and never changes a source's disposition. */
export async function savePublishNowFailure(startedAt: string, code: string, detail: string): Promise<void> {
  const finishedAt = new Date().toISOString();
  const sha = process.env.WTP_RUNTIME_AUTHORITY_SHA;
  const input = boundedRoutineSupervisorDigest({ outcome: routineCivicDataSupervisorOutcome({
    lane: "publish-now", cycleId: routineSupervisorCycleId(hostname(), startedAt, "publish-now"), startedAt, finishedAt,
    testedSha: sha && /^[a-f0-9]{40}$/.test(sha) ? sha : null, host: hostname(), provider: "postgres", durable: true,
    attemptedTasks: 0, verifiedSourceSuccesses: 0, verifiedSourceFailures: 0,
    failures: [{ taskId: "publish-now-runner", code, detail }],
  }), lines: [`Publish-now failed: ${code}`, detail] });
  writeRoutineSupervisorFailureSummary(input);
  try { console.error(`RCD_OUTCOME_LOCAL=${saveRoutineOutcomeLocal(input)}`); }
  catch (error) { console.error(`RCD_OUTCOME_LOCAL_FAILED ${sanitizedErrorDiagnostic(error)}`); }
  const connection = controlPlaneUrlFromEnv();
  if (!connection) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const repos = await createPgRepositories(connection, finishedAt, { skipBootstrap: true });
        await appendRoutineCivicDataSupervisorDigest(repos, input);
      })(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("PUBLISH_NOW_FAILURE_RECORD_TIMEOUT")), 10_000); }),
    ]);
  } catch (error) { console.error(`RCD_OUTCOME_CANONICAL_FAILED ${sanitizedErrorDiagnostic(error)}; the runner's local outcome remains available`); }
  finally { clearTimeout(timer); }
}
