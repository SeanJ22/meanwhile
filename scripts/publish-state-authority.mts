import { prepareStateArtifactChild, stateArtifactResultLine } from "../lib/civic-data/state-artifact-dispatch.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { requireBallotState, stateBallotContractId, type StateBallotFamily } from "../lib/civic-data/state-scopes.ts";
import { requireRegistryState, stateRegistryRuntimeContractId } from "../lib/civic-data/state-scopes.ts";
import { isStateAuthorityFamily } from "../lib/meetings/edge-artifacts.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import { assertRegisteredRuntimeContract } from "../lib/civic-data/runtime-authority.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { requiredAssignment } from "./cli-args.mts";

try {
  const argv = process.argv.slice(2);
  const artifacts = resolveReaderArtifactWriteStore();
  if (!artifacts || artifacts.kind === "local-file" && process.env.WTP_READER_EDGE_LOCAL_OK !== "1") throw new Error("STATE_ARTIFACT_STORE_UNAVAILABLE");
  const family = requiredAssignment(argv, "family", "STATE_ARTIFACT_FAMILY_REQUIRED");
  if (!isStateAuthorityFamily(family)) throw new Error("STATE_ARTIFACT_FAMILY_INVALID");
  const stateValue = requiredAssignment(argv, "state", "STATE_ARTIFACT_STATE_REQUIRED");
  const state = family === "registry-runtime" ? requireRegistryState(stateValue) : requireBallotState(stateValue);
  const contract = family === "registry-runtime" ? stateRegistryRuntimeContractId(state) : stateBallotContractId((family === "candidate-publications" ? "candidate-corpus" : family) as StateBallotFamily, state);
  assertRegisteredRuntimeContract(contract,
    family === "candidate-campaign-sites-derived" ? "routine" : "manual");
  const now = requiredAssignment(argv, "observed-at", "STATE_ARTIFACT_TIME_REQUIRED");
  if (!Number.isFinite(Date.parse(now))) throw new Error("STATE_ARTIFACT_TIME_INVALID");
  const entry = await prepareStateArtifactChild(new PostgresRoutineDataStore(), artifacts, state, family,
    requiredAssignment(argv, "version", "STATE_ARTIFACT_VERSION_REQUIRED"), now);
  console.log(stateArtifactResultLine(state, family, entry));
} catch (error) {
  console.error(sanitizedErrorDiagnostic(error));
  process.exitCode = 1;
}
