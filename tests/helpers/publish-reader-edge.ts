import { publishSupervisorReaderEdge } from "../../lib/civic-data/reader-edge-publication.ts";
import { prepareStateArtifactChild, stateArtifactResultLine } from "../../lib/civic-data/state-artifact-dispatch.ts";
import { isStateAuthorityFamily } from "../../lib/meetings/edge-artifacts.ts";
import { resolveReaderArtifactWriteStore } from "../../lib/meetings/edge-store.ts";

type Inputs = Parameters<typeof publishSupervisorReaderEdge>;

export function publishReaderEdgeOutcomeForTest(store: Inputs[0], now: Inputs[1], selected: Inputs[2] = null, options: Inputs[3] = {}) {
  const artifactStore = options.artifactStore === undefined ? resolveReaderArtifactWriteStore() : options.artifactStore;
  return publishSupervisorReaderEdge(store, now, selected, { ...options, stateArtifactChildren: {
    slots: { acquire: async () => () => {} },
    launch: async command => {
      const arg = (name: string) => command.args.find(value => value.startsWith(`--${name}=`))!.slice(name.length + 3);
      const state = arg("state"), family = arg("family");
      if (!artifactStore || !isStateAuthorityFamily(family)) throw new Error("TEST_STATE_ARTIFACT_INPUT_INVALID");
      const entry = await prepareStateArtifactChild(store, artifactStore, state, family, arg("version"), now);
      return { id: command.id, status: 0, signal: null, termination: "EXITED", stderr: "", errorMessage: null,
        stdout: stateArtifactResultLine(state, family, entry) };
    },
  } }, { WTP_READER_EDGE_LOCAL_OK: "1", WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "f".repeat(40) });
}

export async function publishReaderEdgeForTest(...args: Parameters<typeof publishReaderEdgeOutcomeForTest>): Promise<boolean> {
  return (await publishReaderEdgeOutcomeForTest(...args)).ok;
}
