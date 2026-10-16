import { prepareStateArtifactChild, retireStateArtifactChild, stateArtifactResultLine } from "../lib/civic-data/state-artifact-dispatch.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { requireBallotState, stateBallotContractId, type StateBallotFamily } from "../lib/ballot/state-scopes.ts";
import { isStateAuthorityFamily } from "../lib/meetings/edge-artifacts.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { assertRegisteredRuntimeContract } from "../lib/civic-data/runtime-authority.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { assignment, requiredAssignment } from "./cli-args.mts";

try {
  const argv = process.argv.slice(2), retire = assignment(argv, "retire-state");
  const state = requireBallotState(retire ?? requiredAssignment(argv, "state", "STATE_ARTIFACT_STATE_REQUIRED"));
  const artifacts = resolveReaderArtifactWriteStore();
  if (!artifacts || artifacts.kind === "local-file" && process.env.WTP_READER_EDGE_LOCAL_OK !== "1") throw new Error("STATE_ARTIFACT_STORE_UNAVAILABLE");
  if (retire !== null) {
    assertRegisteredRuntimeContract(stateBallotContractId("ballot-contests", state), "manual");
    prepareProductionCivicDataWrite();
    const retired = await retireStateArtifactChild(new PostgresRoutineDataStore(), artifacts, state);
    console.log("STATE_AUTHORITY_RETIRED=" + JSON.stringify({ state, retired }));
  } else {
    const family = requiredAssignment(argv, "family", "STATE_ARTIFACT_FAMILY_REQUIRED");
    if (!isStateAuthorityFamily(family)) throw new Error("STATE_ARTIFACT_FAMILY_INVALID");
    assertRegisteredRuntimeContract(stateBallotContractId((family === "candidate-publications" ? "candidate-corpus" : family) as StateBallotFamily, state),
      family === "candidate-campaign-sites-derived" ? "routine" : "manual");
    const now = requiredAssignment(argv, "observed-at", "STATE_ARTIFACT_TIME_REQUIRED");
    if (!Number.isFinite(Date.parse(now))) throw new Error("STATE_ARTIFACT_TIME_INVALID");
    const entry = await prepareStateArtifactChild(new PostgresRoutineDataStore(), artifacts, state, family,
      requiredAssignment(argv, "version", "STATE_ARTIFACT_VERSION_REQUIRED"), now);
    console.log(stateArtifactResultLine(state, family, entry));
  }
} catch (error) {
  console.error(sanitizedErrorDiagnostic(error));
  process.exitCode = 1;
}
