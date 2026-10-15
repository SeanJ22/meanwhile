import { FEDERAL_MONEY_SOURCES } from "../lib/federal-money/model.ts";
import { refreshFederalMoney } from "../lib/federal-money/refresh.ts";
import { locateFederalMoneyFacts } from "../lib/federal-money/locations.ts";
import { readFederalMoneyJoinInput } from "../lib/federal-money/held-identities.ts";
import { recordFederalMoneyDoorRead } from "../lib/federal-money/doors.ts";
import { readerQuery } from "../lib/civic-data/promoted-reader-query.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { publishFederalMoneyPartition, publishFederalMoneyProgress } from "../lib/federal-money/edge-publication.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";

const source = FEDERAL_MONEY_SOURCES.find(source => process.argv.includes(`--source=${source}`));
if (!source || !process.argv.includes("--promote")) throw new Error("A registered federal source and --promote are required.");
try {
  installNeonRequestDeadline();
  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore(), query = readerQuery();
  const url = controlPlaneUrlFromEnv();
  const repos = url ? await createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true }) : null;
  const edge = resolveReaderArtifactWriteStore();
  if (!edge) throw new Error("Federal records cannot publish because the reader artifact store is unavailable.");
  const result = await refreshFederalMoney({ source, store, identities: (state, facts) => readFederalMoneyJoinInput(state, facts, query),
    locate: (state, facts) => locateFederalMoneyFacts(source, state, facts, query),
    onPartition: change => publishFederalMoneyPartition({ ...change, store: edge }),
    onProgress: (row, at) => publishFederalMoneyProgress({ store: edge, state: row.state, source, checkedAt: at, complete: row.status === "COMPLETE" || row.lastCompleteAt !== null, reason: row.reason }),
    ...(repos ? { doorRead: input => recordFederalMoneyDoorRead({ ...input, source, doors: repos.doors }) } : {}),
    onState: row => console.log(`FEDERAL_SOURCE_STATE=${JSON.stringify(row)}`) });
  printSourceRunnerReceipt(source, result.candidate ?? result.outcome.candidate.candidate, result.outcome);
  console.log(`FEDERAL_SOURCE_ROWS=${JSON.stringify({ source, ...result.projection.counts, states: result.projection.states })}`);
  if (!result.outcome.promoted) process.exitCode = 2;
} catch (error) {
  console.error(`FEDERAL_SOURCE_FAILURE=${source}: ${sanitizedErrorDiagnostic(error)}`);
  process.exitCode = 2;
}
